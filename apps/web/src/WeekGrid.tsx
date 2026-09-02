import type { HomeworkItem, Lesson, Period, WeekData } from "@school-buddy/shared"
import { localDay, localMinutes, localTime, today as localToday } from "@school-buddy/shared"
import { useEffect, useState } from "react"
import { LessonPanel } from "./LessonPanel.tsx"

export const DAY_NAMES = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag"]

const PX_PER_HOUR = 60
const MIN_START_HOUR = 8
const MIN_END_HOUR = 16

export const addDays = (dateOnly: string, days: number): string => {
  const d = new Date(`${dateOnly}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** lesson instants are UTC; the grid is drawn in the student's local time */
const minutesOf = (iso: string): number => localMinutes(iso)

const hhmm = (iso: string): string => localTime(iso)

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
  onToggle,
  onDelete
}: {
  item: HomeworkItem
  onToggle: (item: HomeworkItem) => void
  onDelete: (item: HomeworkItem) => void
}) => (
  <div
    className={`homework${item.done ? " done" : ""}${item.kind === "reminder" ? " reminder" : ""}${
      item.type === "toets" ? " toets" : ""
    }`}
  >
    <div className="hw-head">
      <span className="subject" title={`${item.subjectName} (${item.subject})`}>
        {item.kind === "reminder" && <span title="meenemen — geen leertijd nodig">🎒 </span>}
        {item.subjectName}
      </span>
      {item.type === "toets" && <span className="toets-badge">Toets</span>}
      <span className="hw-actions">
        <span
          className="source"
          title={item.source === "somtoday" ? "uit Somtoday" : "zelf ingevoerd"}
        >
          {item.source === "somtoday" ? "S" : "✍️"}
        </span>
        <input
          type="checkbox"
          className="tick"
          checked={item.done}
          onChange={() => onToggle(item)}
          title={item.done ? "weer openzetten" : "afvinken"}
        />
        <button
          type="button"
          className="hw-delete"
          title="Verwijderen"
          onClick={() => {
            if (window.confirm(`"${item.description}" verwijderen?`)) onDelete(item)
          }}
        >
          ✕
        </button>
      </span>
    </div>
    <p className="desc">{item.description}</p>
  </div>
)

const periodLabel = (lesson: Lesson, periods: ReadonlyArray<Period>): string | null => {
  const start = lesson.periodStart
  const end = lesson.periodEnd
  if (start !== null) {
    return end !== null && end !== start ? `${start}e-${end}e` : `${start}e`
  }
  // fallback: match the configured lestijden on the start time
  const match = periods.find((p) => p.start === hhmm(lesson.start))
  return match === undefined ? null : `${match.number}e`
}

export const WeekGrid = ({
  week,
  periods,
  onToggle,
  onDelete
}: {
  week: WeekData
  periods: ReadonlyArray<Period>
  onToggle: (item: HomeworkItem) => void
  onDelete: (item: HomeworkItem) => void
}) => {
  const now = useNow()
  const today = localToday()
  const [selected, setSelected] = useState<Lesson | null>(null)
  const days = DAY_NAMES.map((name, i) => ({ name, date: addDays(week.monday, i) }))
  const vacationOn = (day: string): string | null =>
    week.vacations.find((v) => day >= v.startDay && day <= v.endDay)?.name ?? null
  /** a lesson is a test moment when a "toets" item is due that day for that subject */
  const testFor = (lesson: Lesson): string | null =>
    week.homework.find((h) =>
      h.type === "toets" && h.dueDate === localDay(lesson.start) && h.subject === lesson.subject
    )?.description ?? null

  const hhmmMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const starts = [...week.lessons.map((l) => minutesOf(l.start)), ...periods.map((p) => hhmmMinutes(p.start))]
  const ends = [...week.lessons.map((l) => minutesOf(l.end)), ...periods.map((p) => hhmmMinutes(p.end))]
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

  /** homework shown with a lesson: linked to it, or same subject and day */
  const homeworkFor = (lesson: Lesson): Array<HomeworkItem> =>
    week.homework.filter((h) =>
      h.lessonId === lesson.id ||
      (h.subject === lesson.subject && h.dueDate === localDay(lesson.start))
    )

  return (
    <>
      {selected !== null && (
        <LessonPanel
          lesson={selected}
          homework={homeworkFor(selected)}
          periods={periods}
          onClose={() => setSelected(null)}
        />
      )}
      <div className="cal">
        <div className="cal-head">
          <div className="cal-gutter-head" />
          {days.map((d) => (
            <div
              key={d.date}
              className={`cal-day-head${d.date === today ? " today" : ""}${
                vacationOn(d.date) !== null ? " vacation" : ""
              }`}
            >
              {d.name} <small>{d.date.slice(8, 10)}-{d.date.slice(5, 7)}</small>
            </div>
          ))}
        </div>
        {week.vacations.length > 0 && (
          <div className="cal-allday">
            <div className="cal-allday-label">hele dag</div>
            {days.map((d) => {
              const name = vacationOn(d.date)
              return (
                <div key={d.date} className={`cal-allday-cell${d.date === today ? " today" : ""}`}>
                  {name !== null && <span className="allday-chip" title={name}>🌴 {name}</span>}
                </div>
              )
            })}
          </div>
        )}
        <div className="cal-body" style={{ height: bodyHeight }}>
          <div className="cal-gutter">
            {hours.map((h) => (
              <div key={h} className="cal-hour" style={{ top: yOf(h * 60) }}>
                {`${h}`.padStart(2, "0")}:00
              </div>
            ))}
            {periods.map((p) => (
              <div
                key={p.number}
                className="cal-period"
                style={{
                  top: yOf(hhmmMinutes(p.start)),
                  height: yOf(hhmmMinutes(p.end)) - yOf(hhmmMinutes(p.start))
                }}
                title={`${p.number}e lesuur ${p.start}–${p.end}`}
              >
                {p.number}e
              </div>
            ))}
            {showNow && (
              <div className="cal-now-label" style={{ top: yOf(nowMinutes) }}>
                {`${now.getHours()}`.padStart(2, "0")}:{`${now.getMinutes()}`.padStart(2, "0")}
              </div>
            )}
          </div>
          {days.map((d, i) => (
            <div
              key={d.date}
              className={`cal-day${d.date === today ? " today" : ""}${
                vacationOn(d.date) !== null ? " vacation" : ""
              }`}
              style={{ backgroundSize: `100% ${PX_PER_HOUR}px` }}
            >
              {layoutDay(week.lessons.filter((l) => localDay(l.start) === d.date)).map(
                ({ lesson, column, columns }) => {
                  const top = yOf(minutesOf(lesson.start))
                  const height = Math.max(
                    18,
                    yOf(minutesOf(lesson.end)) - top - 2
                  )
                  const test = testFor(lesson)
                  return (
                    <div
                      key={lesson.id}
                      className={`cal-lesson${lesson.cancelled ? " cancelled" : ""}${
                        height < 40 ? " compact" : ""
                      }${test !== null ? " test" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelected(lesson)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          setSelected(lesson)
                        }
                      }}
                      style={{
                        top,
                        height,
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${100 / columns}% - 4px)`
                      }}
                      title={`${hhmm(lesson.start)}–${hhmm(lesson.end)} ${lesson.title}${
                        lesson.location ? ` (${lesson.location})` : ""
                      }${lesson.teacherName !== null ? `\n${lesson.teacherName}` : ""}${
                        test !== null ? `\n\n📕 Toets: ${test}` : ""
                      }`}
                    >
                      {test !== null && <span className="test-dot" title={`Toets: ${test}`} />}
                      <span className="pill">
                        {periodLabel(lesson, periods) !== null && (
                          <span className="period">{periodLabel(lesson, periods)}</span>
                        )}
                        {hhmm(lesson.start).replace(/^0/, "")}
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
                <div className="cal-now" style={{ top: yOf(nowMinutes) }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <hr className="cal-divider" />

      <div className="hw-grid">
        <div className="cal-gutter-head hw-label">huiswerk</div>
        {days.map((d) => {
          const items = week.homework.filter((h) => h.dueDate === d.date)
          const vacation = vacationOn(d.date)
          return (
            <div
              key={d.date}
              className={`hw-day${d.date === today ? " today" : ""}${vacation !== null ? " vacation" : ""}`}
            >
              {items.length === 0 && <p className="empty">{vacation !== null ? "🌴" : "—"}</p>}
              {items.map((h) => (
                <HomeworkCard key={h.id} item={h} onToggle={onToggle} onDelete={onDelete} />
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
