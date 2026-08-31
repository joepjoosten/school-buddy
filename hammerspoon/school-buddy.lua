-- School Buddy — macOS companion (Hammerspoon)
-- Watches lid/wake events, shows question popups, menu bar icon.
-- The brains live in the local daemon (apps/daemon), this file is only UI + signals.

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

local function menuItems()
  return {
    { title = "📅 Rooster & huiswerk", fn = function() hs.urlevent.openURL(DAEMON) end },
    { title = "❓ Vragen checken", fn = checkPending },
    { title = "💬 Chat", fn = function() hs.urlevent.openURL(DAEMON .. "/#chat") end },
    { title = "⚙️ Instellingen", fn = function() hs.urlevent.openURL(DAEMON .. "/#instellingen") end },
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
          if health.updateAvailable then
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
  chooser = hs.chooser.new(function(choice)
    -- Enter selects the mirrored row, which carries the typed question;
    -- an empty choices list would make Enter do nothing (delayed dismiss)
    if choice ~= nil and choice.question ~= nil and choice.question:match("%S") then
      hs.urlevent.openURL(DAEMON .. "/#chat?q=" .. hs.http.encodeForQuery(choice.question))
    end
  end)
  chooser:placeholderText("Vraag je buddy iets… (Enter om te sturen)")
  chooser:queryChangedCallback(function(query)
    if query:match("%S") then
      chooser:choices({
        { text = query, subText = "Druk Enter om dit aan je buddy te vragen", question = query }
      })
    else
      chooser:choices({})
    end
  end)
  chooser:rows(1)
  chooser:width(30)
  chooser:show()
end

-- --- start -----------------------------------------------------------------

local function showMenu()
  menubar:setMenu(menuItems())
  menubar:popupMenu(hs.mouse.absolutePosition())
  menubar:setMenu(nil)
end

function M.start()
  if menubar then
    menubar:setTitle("🎒")
    -- No permanent menu: left click = quick chat, ctrl+click = the menu.
    -- (The status bar only delivers LEFT clicks to this callback.)
    menubar:setClickCallback(function(mods)
      if mods and (mods.ctrl or mods.alt) then
        showMenu()
      else
        quickChat()
      end
    end)
    -- Right / two-finger clicks never reach the click callback, so catch them
    -- with an eventtap limited to the icon's frame. Needs the Accessibility
    -- permission Hammerspoon asks for; ctrl+click keeps working without it.
    -- (kept on M so the tap isn't garbage-collected)
    M.rightClickTap = hs.eventtap.new({ hs.eventtap.event.types.rightMouseDown }, function(event)
      local frame = menubar:frame()
      if frame == nil then return false end
      local loc = event:location()
      if loc.x >= frame.x and loc.x <= frame.x + frame.w
        and loc.y >= frame.y and loc.y <= frame.y + frame.h then
        showMenu()
        return true
      end
      return false
    end)
    M.rightClickTap:start()
  end
  watcher:start()
  -- also poll while the lid stays open (lessons end without a sleep/wake)
  M.timer = hs.timer.doEvery(5 * 60, checkPending)
  sendSignal("startup")
end

M.start()
return M
