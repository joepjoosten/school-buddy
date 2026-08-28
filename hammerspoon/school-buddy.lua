-- School Buddy — macOS companion (Hammerspoon)
-- Watches lid/wake events, shows question popups, menu bar icon.
-- The brains live in the local daemon (apps/daemon), this file is only UI + signals.

local M = {}

local DAEMON = "http://127.0.0.1:4823"
local JSON_HEADERS = { ["Content-Type"] = "application/json" }

-- --- prompt display (one at a time) ---------------------------------------

local promptQueue = {}
local showing = false

local function postAnswer(id, answer, dismissed)
  -- note: a nil `answer` disappears from a Lua table, so hs.json.encode would
  -- drop the key entirely; encode with an explicit JSON null instead
  local answerJson = answer ~= nil and hs.json.encode(answer) or "null"
  local body = string.format(
    '{"id":%s,"answer":%s,"dismissed":%s}',
    hs.json.encode(id), answerJson, tostring(dismissed)
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

local function runUpdate()
  local bin = os.getenv("HOME") .. "/.school-buddy/app/school-buddy"
  hs.alert.show("Update wordt gecontroleerd…")
  local task = hs.task.new(bin, function(exitCode, stdOut, stdErr)
    if exitCode == 0 then
      hs.alert.show("✅ School Buddy is bijgewerkt")
    else
      hs.alert.show("Update mislukt — zie ~/.school-buddy/daemon.log")
      print("school-buddy update failed:", stdOut, stdErr)
    end
  end, { "update" })
  if not (task and task:start()) then
    hs.alert.show("Geen release-installatie gevonden (development?)")
  end
end

local function menuItems()
  return {
    { title = "📅 Rooster & huiswerk", fn = function() hs.urlevent.openURL(DAEMON) end },
    { title = "❓ Vragen checken", fn = checkPending },
    { title = "💬 Chat", fn = function() hs.urlevent.openURL(DAEMON .. "/#chat") end },
    { title = "⚙️ Instellingen", fn = function() hs.urlevent.openURL(DAEMON .. "/#instellingen") end },
    { title = "⬆️ Update installeren", fn = runUpdate },
    { title = "-" },
    {
      title = "Status",
      fn = function()
        hs.http.asyncGet(DAEMON .. "/api/health", nil, function(status, body)
          if status ~= 200 then
            hs.alert.show("School Buddy daemon draait niet 😴")
            return
          end
          local health = hs.json.decode(body)
          local msg = "Versie: " .. health.version .. "\nSomtoday: " .. health.somtoday
          if health.lastSync then msg = msg .. "\nLaatste sync: " .. health.lastSync end
          if health.latestVersion and health.latestVersion ~= health.version
            and health.version ~= "dev" then
            msg = msg .. "\n⬆️ Update beschikbaar: " .. health.latestVersion
          end
          hs.alert.show(msg)
        end)
      end
    }
  }
end

-- --- quick chat (left click on the menu bar icon) ---------------------------

local function quickChat()
  local chooser
  chooser = hs.chooser.new(function(_)
    local q = chooser:query()
    if q ~= nil and q:match("%S") then
      hs.urlevent.openURL(DAEMON .. "/#chat?q=" .. hs.http.encodeForQuery(q))
    end
  end)
  chooser:placeholderText("Vraag je buddy iets… (Enter om te sturen)")
  chooser:choices({})
  chooser:rows(0)
  chooser:width(30)
  chooser:show()
end

-- --- start -----------------------------------------------------------------

function M.start()
  if menubar then
    menubar:setTitle("🎒")
    -- no permanent menu: left click = quick chat, right click = the menu
    menubar:setClickCallback(function()
      local buttons = hs.eventtap.checkMouseButtons()
      if buttons.right then
        menubar:setMenu(menuItems())
        menubar:popupMenu(hs.mouse.absolutePosition())
        menubar:setMenu(nil)
      else
        quickChat()
      end
    end)
  end
  watcher:start()
  -- also poll while the lid stays open (lessons end without a sleep/wake)
  M.timer = hs.timer.doEvery(5 * 60, checkPending)
  sendSignal("startup")
end

M.start()
return M
