# School Buddy — Research & Decisions

Research for a macOS "school buddy" for a Dutch secondary-school student: background
process + menu bar companion that fetches the Somtoday roster/homework, pops up
just-in-time questions ("was there homework?"), and serves a weekly roster/homework
web page. Must be deployable on a second macOS laptop.

Status: research phase — findings below, open questions at the end.
Date: 2026-08-27

---

## 1. Somtoday access (roster + homework)

### Unofficial API (the one the mobile app uses)

- Canonical docs: [elisaado/somtoday-api-docs](https://github.com/elisaado/somtoday-api-docs) — still the reference in 2026.
- Base URL: `https://api.somtoday.nl`, but **read it from the token response** (`somtoday_api_url`), don't hardcode.

**Roster:**
- `GET /rest/v1/afspraken?begindatum=YYYY-MM-DD&einddatum=YYYY-MM-DD` — lessons/appointments.

**Homework:**
- `GET /rest/v1/studiewijzers` — study guides
- `GET /rest/v1/studiewijzeritemafspraaktoekenningen` — homework tied to lessons
- `GET /rest/v1/studiewijzeritemdagtoekenningen` — homework by day
- `GET /rest/v1/studiewijzeritemweektoekenningen` — homework by week
- `PUT /rest/v1/swigemaakt/{id}` — mark homework as done
- Also useful: `/rest/v1/leerlingen`, `/rest/v1/cijfers` (grades), `/rest/v1/vakken`.

### Authentication (OAuth2 + PKCE)

- Authorize: `https://inloggen.somtoday.nl/oauth2/authorize`, token: `https://inloggen.somtoday.nl/oauth2/token`.
- OAuth2 authorization-code flow with PKCE (S256). School identified by tenant/school UUID.
- Client IDs (verified 2026-08: **the old UUID-style ids were revoked**): use
  `somtoday-leerling-native` (redirect `somtoday://nl.topicus.somtoday.leerling/oauth/callback`)
  or `somtoday-leerling-web` (redirect `https://leerling.somtoday.nl/oauth/callback`).
- School list (verified 2026-08): `servers.somtoday.nl/organisaties.json` was **removed**
  by Topicus ([docs issue #42](https://github.com/elisaado/somtoday-api-docs/issues/42)).
  Use the auto-regenerated community mirror with the identical shape:
  `https://raw.githubusercontent.com/NONtoday/organisaties.json/refs/heads/main/organisaties.json`
  (fallback: the undocumented autocomplete on inloggen.somtoday.nl, needs session cookies).
- Access token TTL ≈ 1 hour. **Refresh tokens rotate**: every refresh returns a new
  refresh token and invalidates the old one → must persist the newest one every cycle.
  Stays valid effectively indefinitely with regular use, but school/IdP can force re-auth.

### Microsoft SSO (our case)

- With Microsoft/Entra SSO you **cannot script the credential POST**. Practical pattern
  (documented in [RobinBoers' gist](https://gist.github.com/RobinBoers/2fb550080bec7984bd68953b0fd0569d)):
  1. Open the Somtoday authorize URL (PKCE + school UUID) in a real browser.
  2. Complete the Microsoft login manually (one time).
  3. Intercept the `somtoday://...` redirect and grab the `code` from the URL.
  4. Exchange code + verifier for access + refresh tokens; persist.
- After that: unattended refresh-token grant works long-term. Build a
  "refresh failed → notify to re-login" path (password change / MFA policy can kill it).
- Fully headless cold-start with Microsoft SSO is **not reliably achievable**.

### Existing libraries

| Repo | Lang | SSO | Notes |
|---|---|---|---|
| [luxkatana/somtodayapi_python](https://github.com/luxkatana/somtodayapi_python) | Python | no (planned) | PyPI `somtodaypython`, v1.2.2 Aug 2025, most current |
| [skuperuser/somtoday-web-lib](https://github.com/skuperuser/somtoday-web-lib) | Python | yes, via real browser | Scrapes web UI with browser cookies; grades/homework/schedule |
| [elisaado/somtoday.js](https://github.com/elisaado/somtoday.js) | JS/TS | no | Low maintenance |
| [raketwissenschaftler/somtoday_api](https://github.com/raketwissenschaftler/somtoday_api) | Py/PHP | no | Wraps mobile API |

Conclusion: no clean headless SSO library exists → implement the token dance ourselves
(it's small: PKCE authorize URL + one manual login + token refresh loop).

### Official alternative: iCal feed

- Somtoday offers an official personal **iCalendar token** (Profiel → Agenda →
  Mijn instellingen → iCalendar-token genereren). Any calendar app can subscribe.
- **Roster only — no homework/tests in the feed.** 10–60 min sync latency.
- Zero auth headaches; survives SSO changes. Good as fallback for the schedule.

### Practical plan

- Roster + homework via the private API: one-time manual SSO login → store rotating
  refresh token → hourly-ish refresh in background job. Occasional manual re-login expected.
- iCal token as robust roster fallback / cross-check.
- No published rate limits; poll gently, back off on 429/5xx. API is unofficial and can change.

---

## 2. Agent framework as base (OpenClaw / pi / Hermes)

### OpenClaw ([openclaw.ai](https://openclaw.ai))

- Self-hosted personal AI assistant (Steinberger; now an OpenAI-backed open-source foundation).
- Local Node.js **Gateway** daemon: sessions, channels (WhatsApp/Telegram/…), skills
  (SKILL.md folders), built-in cron (`openclaw automations create "0 7 * * *" "prompt"`),
  markdown memory, macOS menu-bar companion app that manages launchd + native notifications.
- Ticks every feature box, **but**: ~200–400 MB idle RAM (4–8 GB guidance), needs an LLM
  API key used constantly, and has a **serious security record**: 40k+ exposed gateways
  found (~35% vulnerable), CVEs for command injection / SSRF / path traversal /
  prompt-injection→code-exec. It's a shell-capable, prompt-injectable resident agent —
  a poor fit for a child's laptop.

### pi ([pi.dev](https://pi.dev), Mario Zechner)

- Deliberately minimal coding-agent harness (read/write/edit/bash, <1k-token system prompt).
- Extensions (TS modules), skills, print/JSON one-shot mode, RPC mode, SDK. No resident
  daemon, no channels/notifications/web server built in — library-grade, you compose the rest.
- Community extensions exist for scheduled prompts (`pi-schedule-prompt`, `pi-rig`).
- Reasonable **only as a per-task helper** (e.g. parse messy content into JSON via a cheap
  one-shot call), not as the backbone.

### Hermes Agent (Nous Research, Feb 2026)

- OpenClaw-like self-hosted gateway (channels, cron, sub-agents, browser automation) with
  self-improving skill authoring. Same "resident autonomous agent" objections as OpenClaw —
  arguably worse on a kid's device (self-modifying skills).

### Comparison for this use case

| Criterion | OpenClaw | pi | Custom launchd/Hammerspoon app |
|---|---|---|---|
| Idle footprint | 200–400 MB daemon | none (CLI per run) | near zero |
| API keys on laptop | required, constant use | required, per run | none needed |
| Complexity | heavy (gateway + app + onboarding) | medium (compose yourself) | low |
| Child-safety | poor (CVEs, shell-capable agent) | moderate | best (fixed, auditable code paths) |
| LLM cost | ongoing | per run | zero (optional) |

### Recommendation from this track

The three core tasks (fetch roster, ask a question at the right moment, serve a week page)
are **deterministic** — no resident LLM agent needed. Recommended: a small custom app
(launchd/long-running agent + dialogs + tiny localhost web server), borrowing the
*concepts* from OpenClaw (cron jobs, skills, signals) rather than the runtime.
Optionally use an LLM as a bounded helper (parse messy homework text, phrase friendly
questions) via a single cheap API call — not an autonomous agent loop.

---

---

## 3. macOS companion (lid detection, popups, menu bar, deployment)

### Lid open/close & wake detection

- **Sleep/wake:** `NSWorkspace` `willSleepNotification` / `didWakeNotification` — the
  reliable, supported API on Sequoia/Tahoe, Apple Silicon included. No entitlements needed.
- **Lock/unlock:** `DistributedNotificationCenter` `"com.apple.screenIsLocked"` /
  `"com.apple.screenIsUnlocked"` — undocumented but stable.
- **Lid state:** no notification exists; poll `ioreg -r -k AppleClamshellState`. In practice
  on an undocked MacBook, **lid close ≈ willSleep and lid open ≈ didWake** — clamshell
  polling only matters with an external display.
- **Hammerspoon `hs.caffeinate.watcher`** delivers all of the above as Lua callbacks in
  one watcher. Hammerspoon 1.1.1 (Feb 2025), min macOS 13, actively maintained.
- **sleepwatcher** (brew) runs `~/.sleep`/`~/.wakeup` scripts — works but frozen software,
  no lock/unlock events.

### Popups / questions (buttons + free-text input)

| Option | Buttons | Free text | Notes |
|---|---|---|---|
| `osascript display dialog` | ≤3 | yes | zero install, zero signing, always works |
| Hammerspoon `hs.dialog.textPrompt` / `hs.chooser` / `hs.webview` | yes | yes | nicest scriptable option; custom HTML cards via webview |
| alerter (brew) | yes | yes (`--reply`) | Swift rewrite, active 2026; non-blocking nudges |
| terminal-notifier | no | no | buttons removed in v2, display-only |
| UNUserNotificationCenter | yes | yes | requires a real .app bundle + notification permission; banners easily missed |

Key insight: for a kid answering a question, a **modal dialog beats a notification**.
Notifications with action buttons require a bundled .app; dialogs don't.

### Menu bar

- **Hammerspoon `hs.menubar`** — menu bar item + dynamic menus in the same process. No extra install.
- **SwiftBar** — actively maintained; a plugin is just a script whose stdout defines the menu. Prefer over xbar.
- **rumps (Python)** — needs shipped Python runtime, pyobjc breakage risk. Worst fit.
- **Native SwiftUI MenuBarExtra** — nicest product, but makes you an app distributor (signing/Gatekeeper friction).

### Scheduling

- **launchd LaunchAgent** (per-user, can show dialogs; a LaunchDaemon cannot):
  `StartCalendarInterval` is cron-like, and **jobs missed during sleep run once on next
  wake (coalesced)** — ideal for "ask after school when the lid opens".
  `WatchPaths` fires on file changes. Manage via `launchctl bootstrap gui/$UID`.
- **Long-running agent with own scheduler** (Hammerspoon `hs.timer`, or a daemon loop):
  timers that fall in a sleep window fire on wake; combines naturally with wake events
  ("on didWake, if 15:00–18:00 and not asked today → ask").

### Deployment to a second Mac (no Apple Developer account)

- Sequoia/Tahoe removed the Control-click→Open Gatekeeper override; unsigned quarantined
  apps need System Settings → "Open Anyway" per version. Annoying on a kid's machine.
- **Gatekeeper only inspects quarantined files.** `git clone`, `curl`, or building on the
  target Mac ⇒ no quarantine ⇒ no Gatekeeper. **Scripts (shell/Python/Lua, plists,
  Hammerspoon/SwiftBar configs) dodge the whole problem** — the signed host apps
  (Hammerspoon, SwiftBar, brew tools) carry the trust; your logic is text config.
- Apple Silicon needs at least ad-hoc signing on native binaries (automatic via linker).
- TCC prompts (Notifications, Accessibility) are one-time per machine regardless.
- Practical channel: **git repo + install.sh** (brew deps + bootstrap LaunchAgent);
  updates = `git pull`. No notarization ever.

### Recommended stack (from this research track)

**Hammerspoon as the single runtime**: `hs.caffeinate.watcher` (wake/sleep/lock),
`hs.menubar` (presence), `hs.dialog`/`hs.chooser`/`hs.webview` (question popups with
free text), `hs.timer` + wake-event logic (scheduling) — all version-controlled Lua
synced via git. Fallback: Python/shell + launchd + `osascript` dialogs + SwiftBar.
Both need no Apple Developer account. Native SwiftUI app only if the script stack's
UX ceiling becomes limiting.

---

## 4. Decisions (answered 2026-08-27)

| Question | Decision |
|---|---|
| Architecture base | **Custom lightweight app** — no OpenClaw/Hermes runtime; borrow their concepts (cron jobs, skills, signals) |
| Runtime stack | **Bun + TypeScript daemon (brains) + Hammerspoon (macOS UI layer)**, talking over localhost |
| Framework | **Effect-TS ecosystem, v4 (RC)** — daemon and frontend both; frontend is **React** + Effect |

### Effect v4 RC facts (verified against npm, 2026-08-27)

- Versions: `effect@4.0.0-rc.112` (`rc` dist-tag), with matching `4.0.0-rc.112` for
  `@effect/platform-bun`, `@effect/ai-openai`, `@effect/sql-sqlite-bun`.
- v4 layout: one `effect` package with `effect/<Module>` subpaths (`Effect`, `Schema`,
  `Cron`, `Layer`, …) plus `effect/unstable/http`, `effect/unstable/httpapi`,
  `effect/unstable/sql`, `effect/unstable/ai`.
- Serving: `HttpApiBuilder.layer(api)` + `HttpRouter.serve(appLayer)` +
  `BunHttpServer.layer({port})` (provides HttpServer, HttpPlatform, Etag, FileSystem, Path).
  `HttpStaticServer.layer({root, spa: true})` serves the React SPA.
- Services: `class Foo extends Context.Service<Foo, Shape>()("Foo") {}` + `Layer.effect(Foo)(make)`.
- **effect-atom moved into Effect itself in v4**: the atom core is
  `effect/unstable/reactivity/Atom` (+ `AsyncResult`), React bindings are
  **`@effect/atom-react@4.0.0-rc.112`** (requires React ≥19.2.7). The old
  `@effect-atom/atom-react` package remains v3-only. Frontend uses
  `Atom.family` + `Atom.make(effect)` with `useAtomValue`/`useAtomRefresh`.
- Bun 1.3 uses isolated installs: packages resolve only inside workspaces
  (scripts must live in a workspace, e.g. `apps/daemon/scripts/`).
| Somtoday access | **Private API** (one-time manual Microsoft SSO login → rotating refresh tokens) **+ iCal token as roster fallback** |
| LLM use | **Conversational buddy** — son can chat with it |
| LLM provider | **OpenAI via existing Codex subscription** — GPT-5.5 Terra by default, bigger model when needed. Note: subscription auth is account-bound (ChatGPT OAuth, e.g. driven through the Codex CLI in exec mode) rather than an API key; verify programmatic use from the daemon during build, with an API key as fallback. |
| Language | **Dutch UI, bilingual chat** (fixed UI text Dutch; chat follows his language) |
| Chat scope | **School data + homework help** (tutor-style; read-only roster/homework tools, no file/shell access) |
| Setup prerequisites | Confirmed available: school name (→ tenant UUID), son's Microsoft login for one-time SSO, access to generate iCal token |

Safety note on the conversational choice: the chat agent gets **read-only tools** over
the local roster/homework store (plus "log homework answer") — never shell, file, or
network tools. That keeps prompt-injection blast radius near zero, unlike adopting a
full agent framework.

---

## 5. Proposed architecture

```
┌─────────────────────────── kid's MacBook ───────────────────────────┐
│                                                                     │
│  Hammerspoon (signed app, our Lua config)          launchd          │
│  ├─ hs.caffeinate.watcher  ── lid open/close ──┐   LaunchAgent      │
│  ├─ hs.menubar (icon, quick actions)           │   keeps daemon     │
│  ├─ hs.dialog / hs.webview (popup questions)   │   alive            │
│  └──────────── localhost HTTP/WS ──────────────┤                    │
│                                                ▼                    │
│  school-buddy daemon (Node/TypeScript, launchd KeepAlive)           │
│  ├─ Somtoday client: OAuth PKCE + rotating refresh tokens           │
│  │    └─ afspraken (roster), studiewijzeritem* (homework)           │
│  ├─ iCal fallback reader (official Somtoday token)                  │
│  ├─ Scheduler ("cron-like jobs"): sync roster, plan question        │
│  │    moments from roster (end of each lesson / end of day)         │
│  ├─ Signal handler: wake events from Hammerspoon → "lesson just     │
│  │    ended & no homework entered → ask"                            │
│  ├─ State store (SQLite or JSON): roster, homework, answers,        │
│  │    asked-log, tokens (tokens in macOS Keychain via `security`)   │
│  ├─ Web UI (localhost): week view roster+homework, ←/→ weeks,       │
│  │    homework entry, chat panel                                    │
│  └─ Chat agent: OpenAI API, Dutch UI/bilingual, tools =             │
│       read roster, read/write homework entries ONLY                 │
└─────────────────────────────────────────────────────────────────────┘

Deployment: git repo + install.sh (installs brew, node, hammerspoon,
bootstraps LaunchAgent, links Hammerspoon config). Updates = git pull.
No Apple Developer account needed anywhere.
```

### Key flows

1. **Roster sync (cron):** daemon refreshes token, pulls `afspraken` + homework
   endpoints for a rolling window (e.g. −1/+3 weeks), diffs into the store.
   On refresh failure → menu bar badge + popup "Log opnieuw in bij Somtoday".
2. **Just-in-time homework prompt:** scheduler derives "moments" from the roster
   (lesson end times). On wake/lid-open, if a lesson ended since last check and no
   homework is recorded for it and Somtoday has none → Hammerspoon popup:
   "Zojuist was [vak]. Heb je huiswerk gekregen?" with text input / "Nee" / "Later".
   Missed moments coalesce (launchd/wake semantics) so closing the lid never loses a prompt.
3. **One-time auth setup:** setup script opens the Somtoday authorize URL (PKCE +
   school UUID), son logs in via Microsoft, we capture the `somtoday://` redirect
   code via a local helper, exchange for tokens, store refresh token in Keychain.
4. **Week page:** menu bar → "Rooster" opens `http://localhost:<port>` with the week
   grid (roster + homework merged from Somtoday and his own entries), ←/→ navigation,
   and the chat panel.

### Next steps

- [x] Scaffold repo (Bun workspaces: daemon, web, shared; Hammerspoon config; install.sh)
- [x] Somtoday client: PKCE flow + rotating token refresh + afspraken/huiswerk fetch
      (untested against the real API — needs the one-time login first)
- [x] One-time SSO capture helper (`apps/daemon: bun run setup "<schoolnaam>"`)
- [x] Scheduler (30m sync, 5m prompt planning) + SQLite store + signal handling
- [x] Hammerspoon: wake/sleep/lock watcher, menubar, popup dialogs (Dutch)
- [x] Week web UI (React + Effect, ←/→ weeks, homework add/toggle, chat panel)
- [ ] Chat agent — currently a stub; wire OpenAI (Codex subscription / API key
      fallback) with read-only roster/homework tools
- [ ] Run the real Somtoday login + verify field mapping of afspraken/huiswerk
      responses (mapping is defensive but written from docs, not live data)
- [ ] Tests (bun test): time helpers, store, prompt planning
- [ ] install.sh + deployment test on second Mac
