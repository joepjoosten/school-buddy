import { useEffect, useRef, useState } from "react"
import { fetchLogs, runEffect } from "./api.ts"

const WINDOWS = [
  { label: "5 min", minutes: 5 },
  { label: "15 min", minutes: 15 },
  { label: "1 uur", minutes: 60 },
  { label: "24 uur", minutes: 1440 }
]

export const LogsPage = () => {
  const [minutes, setMinutes] = useState(5)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [file, setFile] = useState("")
  const [lines, setLines] = useState<ReadonlyArray<string>>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const load = async (window: number) => {
    try {
      const result = await runEffect(fetchLogs(window))
      setFile(result.file)
      setLines(result.lines)
    } catch {
      setLines(["(kan de daemon niet bereiken)"])
    }
  }

  useEffect(() => {
    load(minutes)
    if (!autoRefresh) return
    const id = setInterval(() => load(minutes), 3000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, autoRefresh])

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView()
  }, [lines])

  return (
    <div className="logs-page">
      <div className="row logs-toolbar">
        <span>
          {WINDOWS.map((w) => (
            <button
              key={w.minutes}
              className={w.minutes === minutes ? "active" : ""}
              onClick={() => setMinutes(w.minutes)}
            >
              {w.label}
            </button>
          ))}
        </span>
        <label className="row">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          automatisch verversen
        </label>
        <a href="#instellingen">← instellingen</a>
      </div>
      <pre
        className="logs-output"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {lines.length === 0 ? `(geen logregels in dit venster)\n${file}` : lines.join("\n")}
        <div ref={bottomRef} />
      </pre>
    </div>
  )
}
