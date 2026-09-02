import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { HomeworkItem } from "@school-buddy/shared"
import { defaultSettings, parseLestijden, today as localToday } from "@school-buddy/shared"
import * as Cause from "effect/Cause"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useState } from "react"
import { deleteHomework, runEffect, setHomeworkDone } from "./api.ts"
import { healthAtom, settingsAtom, weekAtom } from "./atoms.ts"
import { ChangesPage } from "./ChangesPage.tsx"
import { ChatPage } from "./ChatPage.tsx"
import { LogsPage } from "./LogsPage.tsx"
import { PlanningPage } from "./PlanningPage.tsx"
import { SettingsPage } from "./SettingsPage.tsx"
import { useFreshData } from "./useFreshData.ts"
import { addDays, WeekGrid } from "./WeekGrid.tsx"

/** Hash routing with query support: "#chat?q=..." → route "#chat" + params. */
const useHashRoute = (): { route: string; params: URLSearchParams } => {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  const qIndex = hash.indexOf("?")
  return {
    route: qIndex === -1 ? hash : hash.slice(0, qIndex),
    params: new URLSearchParams(qIndex === -1 ? "" : hash.slice(qIndex + 1))
  }
}

const PAGES = [
  { hash: "#", route: "", label: "📅 rooster" },
  { hash: "#planning", route: "#planning", label: "🗓️ planning" },
  { hash: "#chat", route: "#chat", label: "💬 chat" },
  { hash: "#instellingen", route: "#instellingen", label: "⚙️ instellingen" }
]

export const App = () => {
  const { route, params } = useHashRoute()
  const [menuOpen, setMenuOpen] = useState(false)
  const [anchor, setAnchor] = useState<string>(localToday())

  // "#rooster?date=YYYY-MM-DD" (from a planning item) opens that week
  const requestedDate = params.get("date")
  useEffect(() => {
    if (route === "#rooster" && requestedDate !== null) {
      setAnchor(requestedDate)
      history.replaceState(null, "", "#")
    }
  }, [route, requestedDate])
  const weekResult = useAtomValue(weekAtom(anchor))
  const refresh = useAtomRefresh(weekAtom(anchor))
  const healthResult = useAtomValue(healthAtom)

  const week = AsyncResult.isSuccess(weekResult) ? weekResult.value : null
  const error = AsyncResult.isFailure(weekResult)
    ? Cause.pretty(weekResult.cause)
    : null
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null
  const settingsResult = useAtomValue(settingsAtom)
  const periods = parseLestijden(
    AsyncResult.isSuccess(settingsResult) ? settingsResult.value.lestijden : defaultSettings.lestijden
  )

  // close the menu on Escape or when the route changes
  useEffect(() => {
    setMenuOpen(false)
  }, [route])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false)
    }
    const onClick = () => setMenuOpen(false)
    document.addEventListener("keydown", onKey)
    document.addEventListener("click", onClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("click", onClick)
    }
  }, [menuOpen])

  // the buddy can add homework from the chat, so refetch when the rooster
  // is shown again instead of serving the cached week
  const onRoosterPage = !["#instellingen", "#chat", "#logs", "#wijzigingen", "#planning"].includes(route)
  useFreshData(refresh, onRoosterPage)

  const toggle = async (item: HomeworkItem) => {
    await runEffect(setHomeworkDone(item.id, !item.done))
    refresh()
  }
  const remove = async (item: HomeworkItem) => {
    await runEffect(deleteHomework(item.id))
    refresh()
  }

  // week navigation stays on rooster/planning, and returns there from other pages
  const navigate = (update: (anchor: string) => string) => {
    setAnchor(update)
    if (route !== "" && route !== "#planning") window.location.hash = ""
  }

  return (
    <div className="app">
      <header>
        <h1>🎒 School Buddy</h1>
        <nav>
          <button onClick={() => navigate((a) => addDays(a, -7))}>← vorige</button>
          <button onClick={() => navigate(() => localToday())}>
            vandaag
          </button>
          <button onClick={() => navigate((a) => addDays(a, 7))}>volgende →</button>
        </nav>
        {week && (
          <span className="weeklabel">
            week {week.week} · {week.year}
          </span>
        )}
        {health && health.somtoday === "unauthenticated" && (
          <span className="warn">⚠️ Somtoday niet gekoppeld</span>
        )}
        {health && health.updateAvailable && (
          <span className="warn">⬆️ Update beschikbaar ({health.latestVersion})</span>
        )}
        {health && <span className="version">{health.version}</span>}
        <span className={`pages${menuOpen ? " open" : ""}`}>
          <button
            type="button"
            className="hamburger"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((o) => !o)
            }}
          >
            ☰
          </button>
          <span className="page-links">
            {PAGES.map((page) => (
              <a
                key={page.hash}
                className={`page-link${route === page.route ? " active" : ""}`}
                href={page.hash}
                onClick={() => setMenuOpen(false)}
              >
                {page.label}
              </a>
            ))}
          </span>
        </span>
      </header>
      {error !== null && <p className="error">Kan de daemon niet bereiken: {error}</p>}
      {route === "#instellingen" && <SettingsPage />}
      {route === "#chat" && <ChatPage initialQuestion={params.get("q")} />}
      {route === "#logs" && <LogsPage />}
      {route === "#wijzigingen" && <ChangesPage />}
      {route === "#planning" && <PlanningPage anchor={anchor} />}
      {onRoosterPage && week && (
        <main className="rooster">
          <WeekGrid week={week} periods={periods} onToggle={toggle} onDelete={remove} />
        </main>
      )}
    </div>
  )
}
