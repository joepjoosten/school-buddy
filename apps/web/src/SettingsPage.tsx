import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { School, Settings } from "@school-buddy/shared"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useState } from "react"
import {
  connectFinish,
  connectStart,
  runEffect,
  saveSettings,
  searchSchools,
  sendChat,
  setOpenAiKey,
  testSomtoday
} from "./api.ts"
import { healthAtom, settingsAtom } from "./atoms.ts"

/** Poll health while a connect attempt is in flight, so the page flips to
 * "gekoppeld" as soon as SomtodayCallback.app finishes the flow. */
const useHealthPolling = (active: boolean, refresh: () => void) => {
  useEffect(() => {
    if (!active) return
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [active, refresh])
}

const SomtodaySection = () => {
  const healthResult = useAtomValue(healthAtom)
  const refreshHealth = useAtomRefresh(healthAtom)
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null

  const [query, setQuery] = useState("")
  const [schools, setSchools] = useState<ReadonlyArray<School>>([])
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null)
  const [redirectUrl, setRedirectUrl] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const runTest = async () => {
    setTesting(true)
    setMessage(null)
    try {
      const result = await runEffect(testSomtoday)
      setMessage(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`)
      refreshHealth()
    } catch (e) {
      setMessage(`❌ ${String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  const connected = health !== null && health.somtoday === "authenticated"
  useHealthPolling(authorizeUrl !== null && !connected, refreshHealth)
  useEffect(() => {
    if (connected && authorizeUrl !== null) {
      setAuthorizeUrl(null)
      setMessage("✅ Somtoday gekoppeld!")
    }
  }, [connected, authorizeUrl])

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim().length < 2) return
    setSchools(await runEffect(searchSchools(query.trim())))
  }

  const start = async (school: School) => {
    // open the tab synchronously, inside the click gesture — a window.open
    // after an await gets popup-blocked (blank page) in Safari and others
    const win = window.open("about:blank", "_blank")
    const result = await runEffect(connectStart(school.uuid))
    setAuthorizeUrl(result.authorizeUrl)
    setMessage(null)
    if (win !== null) win.location.href = result.authorizeUrl
  }

  const finish = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await runEffect(connectFinish(redirectUrl))
    setMessage(result.ok ? "✅ Somtoday gekoppeld!" : `❌ ${result.message}`)
    if (result.ok) {
      setAuthorizeUrl(null)
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
          {health.lastSync !== null && <> Laatste sync: {health.lastSync}</>}{" "}
          <button type="button" onClick={runTest} disabled={testing}>
            {testing ? "Bezig met ophalen…" : "Test ophalen"}
          </button>
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
      {authorizeUrl !== null && (
        <form onSubmit={finish} className="finish">
          <p>
            De inlogpagina is geopend in een nieuw tabblad — niet gebeurd (popup
            geblokkeerd)?{" "}
            <a href={authorizeUrl} target="_blank" rel="noreferrer">
              Open de inlogpagina hier
            </a>
            . Na het inloggen vraagt de browser om <b>SomtodayCallback</b> te openen —
            sta dat toe, dan wordt de koppeling automatisch afgerond. Vraagt de browser
            niets en zie je een foutmelding over een <code>somtoday://</code>-adres?
            Kopieer dan die volledige URL en plak hem hieronder.
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

const AiSection = () => {
  const healthResult = useAtomValue(healthAtom)
  const refreshHealth = useAtomRefresh(healthAtom)
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null

  const settingsResult = useAtomValue(settingsAtom)
  const stored = AsyncResult.isSuccess(settingsResult) ? settingsResult.value : null
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (stored !== null && chatEnabled === null) {
      setChatEnabled(stored.chatEnabled)
      setModel(stored.openAiModel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  if (stored === null || chatEnabled === null || model === null) {
    return <section><h2>AI-chat</h2><p>Laden…</p></section>
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    await runEffect(saveSettings({ ...stored, chatEnabled, openAiModel: model }))
    if (apiKey.trim() !== "") {
      const result = await runEffect(setOpenAiKey(apiKey.trim()))
      setMessage(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`)
      setApiKey("")
    } else {
      setMessage("✅ Opgeslagen")
    }
    refreshHealth()
  }

  const testChat = async () => {
    setMessage("Chat wordt getest…")
    const { reply } = await runEffect(sendChat("Zeg kort hallo tegen me."))
    setMessage(`💬 ${reply}`)
  }

  const statusLabel = health === null
    ? ""
    : health.chat === "ready"
    ? "✅ klaar voor gebruik"
    : health.chat === "no-key"
    ? "⚠️ geen API-sleutel ingesteld"
    : "⏸️ uitgeschakeld"

  return (
    <section>
      <h2>AI-chat</h2>
      <p>Status: {statusLabel}</p>
      <form onSubmit={save} className="settings-form">
        <label className="row">
          <input
            type="checkbox"
            checked={chatEnabled}
            onChange={(e) => setChatEnabled(e.target.checked)}
          />
          Chat en slimme huiswerk-interpretatie aan
        </label>
        <label className="row">
          Model{" "}
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="row">
          OpenAI API-sleutel{" "}
          <input
            type="password"
            placeholder={health?.chat === "no-key" ? "sk-..." : "•••••• (al ingesteld — laat leeg om te houden)"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <div className="row">
          <button type="submit">Opslaan</button>
          {health?.chat === "ready" && (
            <button type="button" onClick={testChat}>Test chat</button>
          )}
        </div>
      </form>
      {message !== null && <p>{message}</p>}
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
    <AiSection />
    <UpdateSection />
  </div>
)
