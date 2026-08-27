import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { HomeworkItem, Lesson, WeekData } from "@school-buddy/shared"
import * as Cause from "effect/Cause"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useState } from "react"
import { createHomework, runEffect, sendChat, setHomeworkDone } from "./api.ts"
import { healthAtom, weekAtom } from "./atoms.ts"

const DAY_NAMES = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag"]

const addDays = (dateOnly: string, days: number): string => {
  const d = new Date(`${dateOnly}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const hhmm = (iso: string): string => iso.slice(11, 16)

const LessonCard = ({ lesson }: { lesson: Lesson }) => (
  <div className={`lesson${lesson.cancelled ? " cancelled" : ""}`}>
    <span className="time">
      {hhmm(lesson.start)}–{hhmm(lesson.end)}
    </span>
    <span className="title">{lesson.title}</span>
    {lesson.location !== null && <span className="loc">{lesson.location}</span>}
  </div>
)

const HomeworkCard = ({
  item,
  onToggle
}: {
  item: HomeworkItem
  onToggle: (item: HomeworkItem) => void
}) => (
  <label className={`homework${item.done ? " done" : ""}`}>
    <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
    <span className="subject">{item.subject}</span>
    <span className="desc">{item.description}</span>
  </label>
)

const DayColumn = ({
  date,
  name,
  week,
  onToggle
}: {
  date: string
  name: string
  week: WeekData
  onToggle: (item: HomeworkItem) => void
}) => {
  const lessons = week.lessons.filter((l) => l.start.slice(0, 10) === date)
  const homework = week.homework.filter((h) => h.dueDate === date)
  const isToday = date === new Date().toISOString().slice(0, 10)
  return (
    <div className={`day${isToday ? " today" : ""}`}>
      <h3>
        {name} <small>{date.slice(8, 10)}-{date.slice(5, 7)}</small>
      </h3>
      {lessons.length === 0 && <p className="empty">geen lessen</p>}
      {lessons.map((l) => (
        <LessonCard key={l.id} lesson={l} />
      ))}
      {homework.length > 0 && (
        <div className="homework-list">
          <h4>huiswerk</h4>
          {homework.map((h) => (
            <HomeworkCard key={h.id} item={h} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  )
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

const ChatPanel = () => {
  const [messages, setMessages] = useState<Array<{ who: "jij" | "buddy"; text: string }>>([])
  const [input, setInput] = useState("")
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const message = input.trim()
    if (!message) return
    setInput("")
    setMessages((m) => [...m, { who: "jij", text: message }])
    const { reply } = await runEffect(sendChat(message))
    setMessages((m) => [...m, { who: "buddy", text: reply }])
  }
  return (
    <div className="chat">
      <h3>💬 Buddy</h3>
      <div className="messages">
        {messages.map((m, i) => (
          <p key={i} className={m.who}>
            <b>{m.who}:</b> {m.text}
          </p>
        ))}
      </div>
      <form onSubmit={submit}>
        <input
          placeholder="Vraag iets aan je buddy..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit">➤</button>
      </form>
    </div>
  )
}

export const App = () => {
  const [anchor, setAnchor] = useState<string>(new Date().toISOString().slice(0, 10))
  const weekResult = useAtomValue(weekAtom(anchor))
  const refresh = useAtomRefresh(weekAtom(anchor))
  const healthResult = useAtomValue(healthAtom)

  const week = AsyncResult.isSuccess(weekResult) ? weekResult.value : null
  const error = AsyncResult.isFailure(weekResult)
    ? Cause.pretty(weekResult.cause)
    : null
  const health = AsyncResult.isSuccess(healthResult) ? healthResult.value : null

  const toggle = async (item: HomeworkItem) => {
    await runEffect(setHomeworkDone(item.id, !item.done))
    refresh()
  }

  return (
    <div className="app">
      <header>
        <h1>🎒 School Buddy</h1>
        <nav>
          <button onClick={() => setAnchor((a) => addDays(a, -7))}>← vorige</button>
          <button onClick={() => setAnchor(new Date().toISOString().slice(0, 10))}>
            vandaag
          </button>
          <button onClick={() => setAnchor((a) => addDays(a, 7))}>volgende →</button>
        </nav>
        {week && (
          <span className="weeklabel">
            week {week.week} · {week.year}
          </span>
        )}
        {health && health.somtoday === "unauthenticated" && (
          <span className="warn">⚠️ Somtoday niet gekoppeld</span>
        )}
      </header>
      {error !== null && <p className="error">Kan de daemon niet bereiken: {error}</p>}
      {week && (
        <main>
          <div className="week">
            {DAY_NAMES.map((name, i) => (
              <DayColumn
                key={name}
                name={name}
                date={addDays(week.monday, i)}
                week={week}
                onToggle={toggle}
              />
            ))}
          </div>
          <aside>
            <AddHomework date={anchor} onAdded={refresh} />
            <ChatPanel />
          </aside>
        </main>
      )}
    </div>
  )
}
