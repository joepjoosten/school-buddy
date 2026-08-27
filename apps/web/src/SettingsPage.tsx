import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { School, Settings } from "@school-buddy/shared"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useState } from "react"
import { connectFinish, connectStart, runEffect, saveSettings, searchSchools } from "./api.ts"
import { healthAtom, settingsAtom } from "./atoms.ts"

const SomtodaySection = () => {
  const healthResult = useAtomValue(healthAtom)
  const refreshHealth = useAtomRefresh(healthAtom)
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null

  const [query, setQuery] = useState("")
  const [schools, setSchools] = useState<ReadonlyArray<School>>([])
  const [started, setStarted] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim().length < 2) return
    setSchools(await runEffect(searchSchools(query.trim())))
  }

  const start = async (school: School) => {
    const { authorizeUrl } = await runEffect(connectStart(school.uuid))
    setStarted(true)
    setMessage(null)
    window.open(authorizeUrl, "_blank")
  }

  const finish = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await runEffect(connectFinish(redirectUrl))
    setMessage(result.ok ? "✅ Somtoday gekoppeld!" : `❌ ${result.message}`)
    if (result.ok) {
      setStarted(false)
      setRedirectUrl("")
      refreshHealth()
    }
  }

  return (
    <section>
      <h2>Somtoday</h2>
      {health && health.somtoday === "authenticated" ? (
        <p>
          ✅ Gekoppeld.
          {health.lastSync !== null && <> Laatste sync: {health.lastSync}</>}
        </p>
      ) : (
        <p>⚠️ Nog niet gekoppeld. Zoek je school en log in met het Microsoft-schoolaccount.</p>
      )}
      <form onSubmit={search} className="row">
        <input
          placeholder="schoolnaam..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit">Zoeken</button>
      </form>
      {schools.length > 0 && (
        <ul className="schools">
          {schools.map((s) => (
            <li key={s.uuid}>
              <button onClick={() => start(s)}>
                {s.naam} <small>({s.plaats})</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {started && (
        <form onSubmit={finish} className="finish">
          <p>
            De inlogpagina is geopend in een nieuw tabblad. Na het inloggen eindigt de
            browser bij een niet-werkende <code>somtoday://</code>-link — kopieer die
            volledige URL en plak hem hieronder.
          </p>
          <div className="row">
            <input
              placeholder="somtoday://..."
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
            />
            <button type="submit">Koppelen</button>
          </div>
        </form>
      )}
      {message !== null && <p>{message}</p>}
    </section>
  )
}

const PromptsSection = () => {
  const settingsResult = useAtomValue(settingsAtom)
  const stored = AsyncResult.isSuccess(settingsResult) ? settingsResult.value : null
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (stored !== null && draft === null) setDraft(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  if (draft === null) return <section><h2>Vragen</h2><p>Laden…</p></section>

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    await runEffect(saveSettings(draft))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section>
      <h2>Vragen</h2>
      <form onSubmit={save} className="settings-form">
        <label className="row">
          <input
            type="checkbox"
            checked={draft.promptsEnabled}
            onChange={(e) => setDraft({ ...draft, promptsEnabled: e.target.checked })}
          />
          Huiswerkvragen stellen na een les
        </label>
        <label className="row">
          Geen vragen tussen{" "}
          <input
            type="time"
            value={draft.quietStart}
            onChange={(e) => setDraft({ ...draft, quietStart: e.target.value })}
          />{" "}
          en{" "}
          <input
            type="time"
            value={draft.quietEnd}
            onChange={(e) => setDraft({ ...draft, quietEnd: e.target.value })}
          />
        </label>
        <div className="row">
          <button type="submit">Opslaan</button>
          {saved && <span>✅ Opgeslagen</span>}
        </div>
      </form>
    </section>
  )
}

const UpdateSection = () => {
  const healthResult = useAtomValue(healthAtom)
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null
  if (health === null) return null
  const updateAvailable = health.version !== "dev" &&
    health.latestVersion !== null &&
    health.latestVersion !== health.version
  return (
    <section>
      <h2>Versie</h2>
      <p>
        Huidige versie: <b>{health.version}</b>
        {health.latestVersion !== null && <> · nieuwste: {health.latestVersion}</>}
      </p>
      {updateAvailable && (
        <p>⬆️ Update beschikbaar — installeer via het 🎒-menu → "Update installeren".</p>
      )}
    </section>
  )
}

export const SettingsPage = () => (
  <div className="settings-page">
    <SomtodaySection />
    <PromptsSection />
    <UpdateSection />
  </div>
)
