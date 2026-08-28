import type { HomeworkItem, Lesson, WeekData } from "@school-buddy/shared"
import { useEffect, useState } from "react"

export const DAY_NAMES = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag"]

const PX_PER_HOUR = 60
const MIN_START_HOUR = 8
const MIN_END_HOUR = 16

export const addDays = (dateOnly: string, days: number): string => {
  const d = new Date(`${dateOnly}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const localToday = (): string => {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/** minutes since midnight, from the local-time part of an ISO timestamp */
const minutesOf = (iso: string): number =>
  Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))

const hhmm = (iso: string): string => iso.slice(11, 16)

interface Placed {
  readonly lesson: Lesson
  readonly column: number
  readonly columns: number
}

/** Assign side-by-side columns to overlapping lessons (per cluster). */
const layoutDay = (lessons: ReadonlyArray<Lesson>): Array<Placed> => {
  const sorted = [...lessons].sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
  const placed: Array<Placed> = []
  let cluster: Array<{ lesson: Lesson; column: number }> = []
  let columnEnds: Array<number> = []
  let clusterEnd = -1

  const flush = () => {
    const columns = columnEnds.length
    for (const c of cluster) placed.push({ lesson: c.lesson, column: c.column, columns })
    cluster = []
    columnEnds = []
  }

  for (const lesson of sorted) {
    const start = minutesOf(lesson.start)
    const end = minutesOf(lesson.end)
    if (cluster.length > 0 && start >= clusterEnd) flush()
    let column = columnEnds.findIndex((e) => e <= start)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(end)
    } else {
      columnEnds[column] = end
    }
    cluster.push({ lesson, column })
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return placed
}

const useNow = (): Date => {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

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

export const WeekGrid = ({
  week,
  onToggle
}: {
  week: WeekData
  onToggle: (item: HomeworkItem) => void
}) => {
  const now = useNow()
  const today = localToday()
  const days = DAY_NAMES.map((name, i) => ({ name, date: addDays(week.monday, i) }))

  const starts = week.lessons.map((l) => minutesOf(l.start))
  const ends = week.lessons.map((l) => minutesOf(l.end))
  const startHour = Math.min(MIN_START_HOUR, ...starts.map((m) => Math.floor(m / 60)))
  const endHour = Math.max(MIN_END_HOUR, ...ends.map((m) => Math.ceil(m / 60)))
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const bodyHeight = (endHour - startHour) * PX_PER_HOUR
  const yOf = (minutes: number): number => ((minutes - startHour * 60) / 60) * PX_PER_HOUR

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayIndex = days.findIndex((d) => d.date === today)
  const showNow = todayIndex !== -1 &&
    nowMinutes >= startHour * 60 &&
    nowMinutes <= endHour * 60

  return (
    <>
      <div className="cal">
        <div className="cal-head">
          <div className="cal-gutter-head" />
          {days.map((d) => (
            <div key={d.date} className={`cal-day-head${d.date === today ? " today" : ""}`}>
              {d.name} <small>{d.date.slice(8, 10)}-{d.date.slice(5, 7)}</small>
            </div>
          ))}
        </div>
        <div className="cal-body" style={{ height: bodyHeight }}>
          <div className="cal-gutter">
            {hours.map((h) => (
              <div key={h} className="cal-hour" style={{ top: yOf(h * 60) }}>
                {`${h}`.padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((d, i) => (
            <div
              key={d.date}
              className={`cal-day${d.date === today ? " today" : ""}`}
              style={{ backgroundSize: `100% ${PX_PER_HOUR}px` }}
            >
              {layoutDay(week.lessons.filter((l) => l.start.slice(0, 10) === d.date)).map(
                ({ lesson, column, columns }) => {
                  const top = yOf(minutesOf(lesson.start))
                  const height = Math.max(
                    18,
                    yOf(minutesOf(lesson.end)) - top - 2
                  )
                  return (
                    <div
                      key={lesson.id}
                      className={`cal-lesson${lesson.cancelled ? " cancelled" : ""}${
                        height < 40 ? " compact" : ""
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${100 / columns}% - 4px)`
                      }}
                      title={`${hhmm(lesson.start)}–${hhmm(lesson.end)} ${lesson.title}${
                        lesson.location ? ` (${lesson.location})` : ""
                      }`}
                    >
                      <span className="time">
                        {hhmm(lesson.start)}–{hhmm(lesson.end)}
                      </span>
                      <span className="title">{lesson.title}</span>
                      {lesson.location !== null && lesson.location !== "" && (
                        <span className="loc">{lesson.location}</span>
                      )}
                    </div>
                  )
                }
              )}
              {showNow && i === todayIndex && (
                <div className="cal-now-dot" style={{ top: yOf(nowMinutes) }} />
              )}
            </div>
          ))}
          {showNow && (
            <div className="cal-now" style={{ top: yOf(nowMinutes) }}>
              <span className="cal-now-label">
                {`${now.getHours()}`.padStart(2, "0")}:{`${now.getMinutes()}`.padStart(2, "0")}
              </span>
            </div>
          )}
        </div>
      </div>

      <hr className="cal-divider" />

      <div className="hw-grid">
        <div className="cal-gutter-head hw-label">huiswerk</div>
        {days.map((d) => {
          const items = week.homework.filter((h) => h.dueDate === d.date)
          return (
            <div key={d.date} className={`hw-day${d.date === today ? " today" : ""}`}>
              {items.length === 0 && <p className="empty">—</p>}
              {items.map((h) => (
                <HomeworkCard key={h.id} item={h} onToggle={onToggle} />
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
