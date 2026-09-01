import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useEffect, useRef, useState } from "react"
import { fetchChatHistory, runEffect, sendChat } from "./api.ts"
import { localDay, today as localToday } from "@school-buddy/shared"
import { healthAtom } from "./atoms.ts"
import { Markdown } from "./Markdown.tsx"

interface Attachment {
  readonly id?: string
  readonly mediaType: string
  readonly fileName: string
  /** base64, only for not-yet-sent attachments */
  readonly data?: string
}

interface Bubble {
  readonly who: "jij" | "buddy"
  readonly text: string
  readonly day: string
  readonly attachments?: ReadonlyArray<Attachment>
}

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const AttachmentChip = ({
  attachment,
  onRemove
}: {
  attachment: Attachment
  onRemove?: () => void
}) => {
  const src = attachment.id !== undefined
    ? `/api/attachments/${attachment.id}`
    : `data:${attachment.mediaType};base64,${attachment.data ?? ""}`
  const isImage = attachment.mediaType.startsWith("image/")
  return (
    <span className="attachment">
      {isImage
        ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={attachment.fileName} /></a>
        : <a href={src} target="_blank" rel="noreferrer">📄 {attachment.fileName}</a>}
      {onRemove !== undefined && (
        <button type="button" className="attachment-remove" onClick={onRemove} title="verwijderen">✕</button>
      )}
    </span>
  )
}

const dayOf = (iso: string): string => localDay(iso)
const today = (): string => localToday()
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [pending, setPending] = useState<ReadonlyArray<Attachment>>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
    setCameraReady(false)
  }

  const startCamera = async () => {
    setMenuOpen(false)
    setCameraError(null)
    setCameraReady(false)
    try {
      // plain `video: true`: a laptop has no "environment" camera, and that
      // constraint can hand back a device that never produces frames
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      streamRef.current = media
      setStream(media)
    } catch (error) {
      setCameraError(`Camera niet beschikbaar: ${String(error)}`)
    }
  }

  /** attach the stream exactly when the element mounts (a timeout can miss it) */
  const attachVideo = (el: HTMLVideoElement | null) => {
    videoRef.current = el
    if (el !== null && stream !== null && el.srcObject !== stream) {
      el.srcObject = stream
      el.play().catch(() => {
        /* muted autoplay is allowed; ignore transient errors */
      })
    }
  }

  // re-attach if the stream changes while the element is already mounted,
  // and warn when the camera yields no frames (seen on some Firefox setups)
  useEffect(() => {
    const el = videoRef.current
    if (el !== null && stream !== null && el.srcObject !== stream) {
      el.srcObject = stream
      el.play().catch(() => {})
    }
    if (stream === null) return
    const id = setTimeout(() => {
      const video = videoRef.current
      if (video !== null && video.videoWidth === 0) {
        setCameraError(
          "De camera geeft geen beeld. Controleer of een ander programma de camera gebruikt, " +
            "en of de browser toegang heeft (Systeeminstellingen → Privacy → Camera)."
        )
      }
    }, 4000)
    return () => clearTimeout(id)
  }, [stream])

  const takePhoto = () => {
    const video = videoRef.current
    if (video === null || video.videoWidth === 0) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d")?.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85)
    setPending((p) => [...p, {
      mediaType: "image/jpeg",
      fileName: `foto-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.jpg`,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1)
    }])
    stopCamera()
  }

  const addFiles = async (files: FileList | null) => {
    setMenuOpen(false)
    if (files === null) return
    const added: Array<Attachment> = []
    for (const file of Array.from(files)) {
      added.push({ mediaType: file.type || "application/octet-stream", fileName: file.name, data: await readAsBase64(file) })
    }
    setPending((p) => [...p, ...added])
  }

  // stop the camera when leaving the page
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // persisted transcript from the daemon (survives reloads, tabs and restarts)
  useEffect(() => {
    runEffect(fetchChatHistory).then(
      (h) => {
        setSummary(h.summary)
        setMessages(
          h.messages.map((m) => ({
            who: m.role === "user" ? "jij" : "buddy",
            text: m.content,
            day: dayOf(m.createdAt),
            attachments: m.attachments
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

  const ask = async (message: string, attachments: ReadonlyArray<Attachment> = []) => {
    setMessages((m) => [...m, { who: "jij", text: message, day: today(), attachments }])
    setBusy(true)
    try {
      const { reply } = await runEffect(
        sendChat(
          message,
          attachments.map((a) => ({ mediaType: a.mediaType, fileName: a.fileName, data: a.data ?? "" }))
        )
      )
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
    if ((message === "" && pending.length === 0) || busy) return
    const attachments = pending
    setInput("")
    setPending([])
    await ask(message === "" ? "Kijk eens naar deze bijlage." : message, attachments)
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
              {m.attachments !== undefined && m.attachments.length > 0 && (
                <span className="attachments">
                  {m.attachments.map((a, ai) => <AttachmentChip key={ai} attachment={a} />)}
                </span>
              )}
              {m.who === "buddy" ? <Markdown text={m.text} /> : m.text}
            </div>
          </div>
        ))}
        {busy && <div className="bubble buddy typing">…</div>}
        <div ref={bottomRef} />
      </div>
      {stream !== null && (
        <div className="camera">
          <video
            ref={attachVideo}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => setCameraReady(true)}
            onCanPlay={() => setCameraReady(true)}
          />
          <div className="row">
            <button type="button" onClick={takePhoto} disabled={!cameraReady}>
              {cameraReady ? "📸 Foto maken" : "Camera starten…"}
            </button>
            <button type="button" onClick={stopCamera}>Annuleren</button>
          </div>
        </div>
      )}
      {cameraError !== null && <p className="warn">{cameraError}</p>}
      {pending.length > 0 && (
        <div className="attachments pending">
          {pending.map((a, i) => (
            <AttachmentChip
              key={i}
              attachment={a}
              onRemove={() => setPending((p) => p.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
      <form onSubmit={submit} className="chat-input">
        <span className="plus-wrap">
          <button
            type="button"
            className="plus"
            title="Bijlage toevoegen"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ＋
          </button>
          {menuOpen && (
            <span className="plus-menu">
              <button type="button" onClick={() => fileInputRef.current?.click()}>📎 Bestand of foto</button>
              <button type="button" onClick={startCamera}>📷 Foto maken</button>
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(e) => void addFiles(e.target.files)}
          />
        </span>
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
