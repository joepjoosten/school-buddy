-- School Buddy — macOS companion (Hammerspoon)
-- Watches lid/wake events, shows question popups, menu bar icon.
-- The brains live in the local daemon (apps/daemon), this file is only UI + signals.

local hs = hs

local M = {}

local DAEMON = "http://127.0.0.1:4823"
local JSON_HEADERS = { ["Content-Type"] = "application/json" }

-- --- prompt display (one at a time) ---------------------------------------

local promptQueue = {}
local showing = false

-- hs.json.encode only accepts tables, so scalars are escaped by hand
local function jsonString(str)
  local escaped = str:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"'
    elseif c == '\\' then return '\\\\'
    elseif c == '\n' then return '\\n'
    elseif c == '\r' then return '\\r'
    elseif c == '\t' then return '\\t'
    else return string.format('\\u%04x', c:byte()) end
  end)
  return '"' .. escaped .. '"'
end

local function postAnswer(id, answer, dismissed)
  local body = string.format(
    '{"id":%s,"answer":%s,"dismissed":%s}',
    jsonString(id),
    answer ~= nil and jsonString(answer) or "null",
    tostring(dismissed)
  )
  hs.http.asyncPost(DAEMON .. "/api/prompts/answer", body, JSON_HEADERS, function(status)
    if status < 200 or status >= 300 then
      print("school-buddy: prompt answer failed with status " .. tostring(status))
    end
  end)
end

local showNext -- forward declaration

local function showPrompt(prompt)
  showing = true
  hs.application.frontmostApplication() -- ensure we can take focus
  if prompt.kind == "homework-check" then
    -- focus() so the dialog appears above the current app
    hs.focus()
    local button, text = hs.dialog.textPrompt(
      "School Buddy 🎒",
      prompt.text .. "\n\nTyp je huiswerk, of laat leeg als je niks hebt gekregen.",
      "",
      "Opslaan",
      "Later"
    )
    if button == "Opslaan" then
      local answer = nil
      if text ~= nil and text:match("%S") then answer = text end
      postAnswer(prompt.id, answer, false)
    end
    -- "Later": leave pending, it re-appears on the next wake/poll
  else
    hs.focus()
    hs.dialog.blockAlert("School Buddy 🎒", prompt.text, "OK")
    postAnswer(prompt.id, nil, true)
  end
  showing = false
  showNext()
end

showNext = function()
  if showing then return end
  local nextPrompt = table.remove(promptQueue, 1)
  if nextPrompt then showPrompt(nextPrompt) end
end

local function enqueuePrompts(prompts)
  local queuedIds = {}
  for _, p in ipairs(promptQueue) do queuedIds[p.id] = true end
  for _, p in ipairs(prompts or {}) do
    if not queuedIds[p.id] then table.insert(promptQueue, p) end
  end
  showNext()
end

local function checkPending()
  hs.http.asyncGet(DAEMON .. "/api/prompts/pending", nil, function(status, body)
    if status == 200 then enqueuePrompts(hs.json.decode(body)) end
  end)
end

-- --- signals ---------------------------------------------------------------

local function sendSignal(kind)
  local payload = hs.json.encode({
    kind = kind,
    at = os.date("!%Y-%m-%dT%H:%M:%S.000Z")
  })
  hs.http.asyncPost(DAEMON .. "/api/signal", payload, JSON_HEADERS, function(status, body)
    if status == 200 and (kind == "wake" or kind == "unlock" or kind == "startup") then
      enqueuePrompts(hs.json.decode(body))
    end
  end)
end

local watcher = hs.caffeinate.watcher.new(function(event)
  local w = hs.caffeinate.watcher
  if event == w.systemDidWake then
    sendSignal("wake")
  elseif event == w.systemWillSleep then
    sendSignal("sleep")
  elseif event == w.screensDidLock then
    sendSignal("lock")
  elseif event == w.screensDidUnlock then
    sendSignal("unlock")
  end
end)

-- --- menu bar --------------------------------------------------------------

local menubar = hs.menubar.new()

-- --- quick chat + menu (single left click on the menu bar icon) -------------
-- Everything lives in one chooser: with an empty query it lists the menu
-- actions, and as soon as you type it turns into "ask your buddy". A right
-- click on a status bar item is not reliably delivered to Hammerspoon, so it
-- is only a bonus path — this chooser is the one that always works.

local function openUrl(path)
  return function() hs.urlevent.openURL(DAEMON .. path) end
end

local function showStatus()
  hs.http.asyncGet(DAEMON .. "/api/health", nil, function(status, body)
    if status ~= 200 then
      hs.alert.show("School Buddy daemon draait niet 😴")
      return
    end
    local health = hs.json.decode(body)
    local msg = "Versie: " .. health.version .. "\nSomtoday: " .. health.somtoday
    if health.lastSync then msg = msg .. "\nLaatste sync: " .. health.lastSync end
    if health.updateAvailable then
      msg = msg .. "\n⬆️ Update beschikbaar: " .. health.latestVersion
    end
    hs.alert.show(msg)
  end)
end

local ACTIONS = {
  { id = "rooster", text = "📅 Rooster & huiswerk", subText = "Weekoverzicht openen", fn = openUrl("") },
  { id = "planning", text = "🗓️ Planning", subText = "Je leersessies per dag", fn = openUrl("/#planning") },
  { id = "chat", text = "💬 Chat openen", subText = "Volledig chatscherm met je buddy", fn = openUrl("/#chat") },
  { id = "vragen", text = "❓ Vragen checken", subText = "Openstaande vragen ophalen", fn = nil },
  { id = "instellingen", text = "⚙️ Instellingen", subText = "Somtoday, AI, planning, updates", fn = openUrl("/#instellingen") },
  { id = "status", text = "ℹ️ Status", subText = "Versie en laatste sync", fn = showStatus }
}

local function actionChoices()
  local choices = {}
  for _, a in ipairs(ACTIONS) do
    table.insert(choices, { id = a.id, text = a.text, subText = a.subText })
  end
  return choices
end

local function quickChat()
  local chooser
  chooser = hs.chooser.new(function(choice)
    if choice == nil then return end
    if choice.id == "ask" then
      if choice.question ~= nil and choice.question:match("%S") then
        hs.urlevent.openURL(DAEMON .. "/#chat?q=" .. hs.http.encodeForQuery(choice.question))
      end
      return
    end
    for _, a in ipairs(ACTIONS) do
      if a.id == choice.id then
        if a.id == "vragen" then checkPending() elseif a.fn ~= nil then a.fn() end
        return
      end
    end
  end)
  chooser:placeholderText("Vraag je buddy iets, of kies hieronder…")
  chooser:queryChangedCallback(function(query)
    if query:match("%S") then
      chooser:choices({
        { id = "ask", text = query, subText = "Druk Enter om dit aan je buddy te vragen", question = query }
      })
    else
      chooser:choices(actionChoices())
    end
  end)
  chooser:choices(actionChoices())
  chooser:rows(6)
  chooser:width(30)
  chooser:show()
end

-- --- self-reload on update -------------------------------------------------
-- The installer replaces this file, but a running Hammerspoon keeps executing
-- the old code until it reloads. Watch the install directory and reload when
-- it changes, so an update takes effect without touching Hammerspoon.

local function configDir()
  local source = debug.getinfo(1, "S").source:sub(2)
  return source:match("(.*)/[^/]*$") or "."
end

local function watchForUpdates()
  local dir = configDir()
  -- the installer removes and recreates this directory, so watch its parent
  local parent = dir:match("(.*)/[^/]*$") or dir
  M.reloadTimer = nil
  M.configWatcher = hs.pathwatcher.new(parent, function(paths)
    local touched = false
    for _, path in ipairs(paths or {}) do
      if path:match("%.lua$") then touched = true end
    end
    if not touched then return end
    -- an install writes several files; reload once, after it settles
    if M.reloadTimer then M.reloadTimer:stop() end
    M.reloadTimer = hs.timer.doAfter(3, function()
      hs.notify.new({ title = "School Buddy 🎒", informativeText = "Bijgewerkt — configuratie herladen" }):send()
      hs.reload()
    end)
  end)
  M.configWatcher:start()
end

function M.start()
  if menubar then
    menubar:setTitle("🎒")
    -- Single left click opens the chooser: it doubles as the menu, so no
    -- right-click eventtap (and no Accessibility permission) is needed.
    menubar:setClickCallback(quickChat)
  end
  watcher:start()
  watchForUpdates()
  -- reload on demand too: `open -g "hammerspoon://school-buddy-reload"`
  hs.urlevent.bind("school-buddy-reload", function() hs.reload() end)
  -- also poll while the lid stays open (lessons end without a sleep/wake)
  M.timer = hs.timer.doEvery(5 * 60, checkPending)
  sendSignal("startup")
end

M.start()
return M
