import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { HomeworkItem } from "@school-buddy/shared"
import { defaultSettings, parseLestijden } from "@school-buddy/shared"
import * as Cause from "effect/Cause"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useState } from "react"
import { createHomework, runEffect, setHomeworkDone } from "./api.ts"
import { healthAtom, settingsAtom, weekAtom } from "./atoms.ts"
import { ChangesPage } from "./ChangesPage.tsx"
import { ChatPage } from "./ChatPage.tsx"
import { LogsPage } from "./LogsPage.tsx"
import { SettingsPage } from "./SettingsPage.tsx"
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

const AddHomework = ({ date, onAdded }: { date: string; onAdded: () => void }) => {
  const [subject, setSubject] = useState("")
  const [dueDate, setDueDate] = useState(date)
  const [description, setDescription] = useState("")
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject || !description) return
    await runEffect(createHomework({ subject, dueDate, description, lessonId: null }))
    setSubject("")
    setDescription("")
    onAdded()
  }
  return (
    <form className="add-homework" onSubmit={submit}>
      <strong>Huiswerk toevoegen</strong>
      <input placeholder="vak" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <input
        placeholder="wat moet je doen?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button type="submit">+</button>
    </form>
  )
}

export const App = () => {
  const { route, params } = useHashRoute()
  const [anchor, setAnchor] = useState<string>(new Date().toISOString().slice(0, 10))
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

  const toggle = async (item: HomeworkItem) => {
    await runEffect(setHomeworkDone(item.id, !item.done))
    refresh()
  }

  // week navigation always lands on the rooster view, also from other pages
  const navigate = (update: (anchor: string) => string) => {
    setAnchor(update)
    if (route !== "") window.location.hash = ""
  }

  return (
    <div className="app">
      <header>
        <h1>🎒 School Buddy</h1>
        <nav>
          <button onClick={() => navigate((a) => addDays(a, -7))}>← vorige</button>
          <button onClick={() => navigate(() => new Date().toISOString().slice(0, 10))}>
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
        {health &&
          health.version !== "dev" &&
          health.latestVersion !== null &&
          health.latestVersion !== health.version && (
            <span className="warn">⬆️ Update beschikbaar ({health.latestVersion})</span>
          )}
        {health && <span className="version">{health.version}</span>}
        <span className="pages">
          <a className={`page-link${route === "" ? " active" : ""}`} href="#">📅 rooster</a>
          <a className={`page-link${route === "#chat" ? " active" : ""}`} href="#chat">💬 chat</a>
          <a
            className={`page-link${route === "#instellingen" ? " active" : ""}`}
            href="#instellingen"
          >
            ⚙️ instellingen
          </a>
        </span>
      </header>
      {error !== null && <p className="error">Kan de daemon niet bereiken: {error}</p>}
      {route === "#instellingen" && <SettingsPage />}
      {route === "#chat" && <ChatPage initialQuestion={params.get("q")} />}
      {route === "#logs" && <LogsPage />}
      {route === "#wijzigingen" && <ChangesPage />}
      {!["#instellingen", "#chat", "#logs", "#wijzigingen"].includes(route) && week && (
        <main className="rooster">
          <WeekGrid week={week} periods={periods} onToggle={toggle} />
          <AddHomework date={anchor} onAdded={refresh} />
        </main>
      )}
    </div>
  )
}
