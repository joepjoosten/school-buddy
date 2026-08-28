import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { School, Settings } from "@school-buddy/shared"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useRef, useState } from "react"
import type { AiProvider as AiProviderSchema } from "@school-buddy/shared"
import { parseLestijden } from "@school-buddy/shared"
import {
  checkUpdate,
  connectFinish,
  connectStart,
  runEffect,
  runUpdate,
  saveSettings,
  searchSchools,
  sendChat,
  setAiKey,
  testSomtoday
} from "./api.ts"
import { aiModelsAtom, healthAtom, settingsAtom } from "./atoms.ts"

type AiProviderType = typeof AiProviderSchema.Type

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

  const modelsResult = useAtomValue(aiModelsAtom)
  const refreshModels = useAtomRefresh(aiModelsAtom)
  const aiModels = AsyncResult.isSuccess(modelsResult) ? modelsResult.value : null

  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null)
  const [provider, setProvider] = useState<AiProviderType | null>(null)
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (stored !== null && chatEnabled === null) {
      setChatEnabled(stored.chatEnabled)
      setProvider(stored.aiProvider)
      setModel(stored.aiModel ?? "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  if (stored === null || chatEnabled === null || provider === null) {
    return <section><h2>AI-chat</h2><p>Laden…</p></section>
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    await runEffect(saveSettings({
      ...stored,
      chatEnabled,
      aiProvider: provider,
      aiModel: model.trim() === "" ? null : model.trim()
    }))
    if (apiKey.trim() !== "") {
      const result = await runEffect(setAiKey(provider, apiKey.trim()))
      setMessage(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`)
      setApiKey("")
    } else {
      setMessage("✅ Opgeslagen")
    }
    refreshHealth()
    refreshModels()
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
          Provider{" "}
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as AiProviderType)
              setModel("")
            }}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label className="row">
          Model{" "}
          <input
            list="ai-models"
            placeholder={aiModels !== null && provider === aiModels.provider
              ? `automatisch (${aiModels.resolvedModel})`
              : "automatisch"}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <datalist id="ai-models">
            {(aiModels !== null && provider === aiModels.provider ? aiModels.models : [])
              .map((id) => <option key={id} value={id} />)}
          </datalist>
        </label>
        <label className="row">
          API-sleutel ({provider === "openrouter" ? "OpenRouter" : "OpenAI"}){" "}
          <input
            type="password"
            placeholder={health?.chat === "no-key"
              ? "sk-..."
              : "•••••• (al ingesteld — laat leeg om te houden)"}
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
      <p className="hint">
        Leeg model = automatisch: de standaard van de provider als die beschikbaar is
        {aiModels !== null ? ` (${aiModels.defaultModel})` : ""}.
      </p>
      {message !== null && <p>{message}</p>}
    </section>
  )
}

const UpdateSection = () => {
  const healthResult = useAtomValue(healthAtom)
  const refreshHealth = useAtomRefresh(healthAtom)
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const versionBeforeUpdate = useRef<string | null>(null)

  // while an update runs, poll until the daemon comes back with a new version
  useEffect(() => {
    if (!updating) return
    const id = setInterval(refreshHealth, 3000)
    return () => clearInterval(id)
  }, [updating, refreshHealth])
  useEffect(() => {
    if (
      updating &&
      health !== null &&
      versionBeforeUpdate.current !== null &&
      health.version !== versionBeforeUpdate.current
    ) {
      setUpdating(false)
      setMessage(`✅ Geüpdatet naar ${health.version}`)
    }
  }, [updating, health])

  if (health === null) return null
  const updateAvailable = health.version !== "dev" &&
    health.latestVersion !== null &&
    health.latestVersion !== health.version

  const check = async () => {
    setChecking(true)
    setMessage(null)
    try {
      const result = await runEffect(checkUpdate)
      setMessage(
        result.latest === null
          ? "❌ Kan GitHub nu niet bereiken — probeer het straks nog eens"
          : result.updateAvailable
          ? `⬆️ Nieuwe versie beschikbaar: ${result.latest}`
          : `✅ Up-to-date (${result.current})`
      )
      refreshHealth()
    } finally {
      setChecking(false)
    }
  }

  const install = async () => {
    versionBeforeUpdate.current = health.version
    const result = await runEffect(runUpdate)
    setMessage(result.ok ? `⏳ ${result.message}` : `❌ ${result.message}`)
    if (result.ok) setUpdating(true)
  }

  return (
    <section>
      <h2>Versie</h2>
      <p>
        Huidige versie: <b>{health.version}</b>
        {health.latestVersion !== null && <> · nieuwste: {health.latestVersion}</>}
      </p>
      <div className="row">
        <button type="button" onClick={check} disabled={checking || updating}>
          {checking ? "Bezig…" : "🔍 Check nu op updates"}
        </button>
        {updateAvailable && (
          <button type="button" onClick={install} disabled={updating}>
            {updating ? "Update loopt…" : `⬆️ Update naar ${health.latestVersion}`}
          </button>
        )}
      </div>
      {message !== null && <p>{message}</p>}
    </section>
  )
}

const LestijdenSection = () => {
  const settingsResult = useAtomValue(settingsAtom)
  const refreshSettings = useAtomRefresh(settingsAtom)
  const stored = AsyncResult.isSuccess(settingsResult) ? settingsResult.value : null
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (stored !== null && text === null) setText(stored.lestijden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])
  if (stored === null || text === null) return <section><h2>Lestijden</h2><p>Laden…</p></section>

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    await runEffect(saveSettings({ ...stored, lestijden: text }))
    refreshSettings()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const parsed = parseLestijden(text)

  return (
    <section>
      <h2>Lestijden</h2>
      <p className="hint">
        Eén lesuur per regel: <code>nummer begin-eind</code>. Somtoday geeft per les zelf het
        lesuur door; deze tabel wordt gebruikt voor de markering op de tijdlijn en als
        de lesuurinformatie ontbreekt. Per leerling in te stellen.
      </p>
      <form onSubmit={save} className="settings-form">
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <div className="row">
          <button type="submit">Opslaan</button>
          <span className="hint">{parsed.length} lesuren herkend</span>
          {saved && <span>✅ Opgeslagen</span>}
        </div>
      </form>
    </section>
  )
}

const DebugSection = () => (
  <section>
    <h2>Debug</h2>
    <p>
      <a href="#logs">🪵 Bekijk daemon-logs</a> — of in de terminal:{" "}
      <code>school-buddy logs --tail</code>
    </p>
    <p>
      <a href="#wijzigingen">🔀 Roosterwijzigingen</a> — alles wat de sync sinds de vorige
      keer anders zag in het rooster.
    </p>
  </section>
)

export const SettingsPage = () => (
  <div className="settings-page">
    <SomtodaySection />
    <PromptsSection />
    <AiSection />
    <LestijdenSection />
    <UpdateSection />
    <DebugSection />
  </div>
)
