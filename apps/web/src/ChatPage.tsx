import { useAtom, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useRef, useState } from "react"
import { runEffect, sendChat } from "./api.ts"
import { chatMessagesAtom, healthAtom } from "./atoms.ts"

export const ChatPage = () => {
  const [messages, setMessages] = useAtom(chatMessagesAtom)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const healthResult = useAtomValue(healthAtom)
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, busy])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const message = input.trim()
    if (message === "" || busy) return
    setInput("")
    setMessages((m) => [...m, { who: "jij", text: message }])
    setBusy(true)
    try {
      const { reply } = await runEffect(sendChat(message))
      setMessages((m) => [...m, { who: "buddy", text: reply }])
    } catch (error) {
      setMessages((m) => [...m, { who: "buddy", text: `Er ging iets mis: ${String(error)}` }])
    } finally {
      setBusy(false)
    }
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
        {messages.length === 0 && (
          <p className="empty">
            Vraag je buddy iets over je rooster of huiswerk — bijvoorbeeld
            "wat heb ik morgen?" of "help me met mijn wiskundehuiswerk".
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.who}`}>
            {m.text}
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
