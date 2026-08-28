import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useRef, useState } from "react"
import { fetchChatHistory, runEffect, sendChat } from "./api.ts"
import { healthAtom } from "./atoms.ts"
import { Markdown } from "./Markdown.tsx"

interface Bubble {
  readonly who: "jij" | "buddy"
  readonly text: string
  readonly day: string
}

const dayOf = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`
}
const today = (): string => dayOf(new Date().toISOString())
const dayLabel = (day: string): string =>
  day === today()
    ? "vandaag"
    : new Date(`${day}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })

export const ChatPage = ({ initialQuestion }: { initialQuestion?: string | null }) => {
  const [messages, setMessages] = useState<ReadonlyArray<Bubble>>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const healthResult = useAtomValue(healthAtom)
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null
  const bottomRef = useRef<HTMLDivElement>(null)
  const consumedInitial = useRef(false)

  // persisted transcript from the daemon (survives reloads, tabs and restarts)
  useEffect(() => {
    runEffect(fetchChatHistory).then(
      (h) => {
        setSummary(h.summary)
        setMessages(
          h.messages.map((m) => ({
            who: m.role === "user" ? "jij" : "buddy",
            text: m.content,
            day: dayOf(m.createdAt)
          }))
        )
        setLoaded(true)
      },
      () => setLoaded(true)
    )
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, busy])

  const ask = async (message: string) => {
    setMessages((m) => [...m, { who: "jij", text: message, day: today() }])
    setBusy(true)
    try {
      const { reply } = await runEffect(sendChat(message))
      setMessages((m) => [...m, { who: "buddy", text: reply, day: today() }])
    } catch (error) {
      setMessages((m) => [
        ...m,
        { who: "buddy", text: `Er ging iets mis: ${String(error)}`, day: today() }
      ])
    } finally {
      setBusy(false)
    }
  }

  // a question arriving via #chat?q=... (menu bar quick chat) is sent once,
  // after the history has loaded so it lands at the end of the transcript
  useEffect(() => {
    const question = initialQuestion?.trim()
    if (loaded && question !== undefined && question !== "" && !consumedInitial.current) {
      consumedInitial.current = true
      history.replaceState(null, "", "#chat")
      void ask(question)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, loaded])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const message = input.trim()
    if (message === "" || busy) return
    setInput("")
    await ask(message)
  }

  return (
    <div className="chat-page">
      {health !== null && health.chat !== "ready" && (
        <p className="warn">
          {health.chat === "no-key"
            ? "⚠️ Er is nog geen API-sleutel ingesteld — zie ⚙️ instellingen."
            : "⏸️ De chat staat uit — zie ⚙️ instellingen."}
        </p>
      )}
      <div className="chat-messages">
        {summary !== null && (
          <details className="chat-summary">
            <summary>🧠 Wat je buddy nog weet van eerdere dagen</summary>
            <Markdown text={summary} />
          </details>
        )}
        {loaded && messages.length === 0 && (
          <p className="empty">
            Vraag je buddy iets over je rooster of huiswerk — bijvoorbeeld
            "wat heb ik morgen?" of "help me met mijn wiskundehuiswerk".
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="chat-entry">
            {(i === 0 || messages[i - 1]!.day !== m.day) && (
              <div className="chat-day">{dayLabel(m.day)}</div>
            )}
            <div className={`bubble ${m.who}`}>
              {m.who === "buddy" ? <Markdown text={m.text} /> : m.text}
            </div>
          </div>
        ))}
        {busy && <div className="bubble buddy typing">…</div>}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="chat-input">
        <input
          autoFocus
          placeholder="Typ je vraag..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy}>➤</button>
      </form>
    </div>
  )
}
