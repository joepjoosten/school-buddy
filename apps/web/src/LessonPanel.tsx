import type { HomeworkItem, Lesson, PlanItem, Period } from "@school-buddy/shared"
import { localDay, localTime, stripSubjectPrefix } from "@school-buddy/shared"
import { useEffect, useRef, useState } from "react"
import { fetchPlanForHomework, runEffect } from "./api.ts"

const dutchDate = (day: string): string =>
  new Date(`${day}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long"
  })

/** compact form for the planning columns, e.g. "di 1 sep" */
const shortDate = (day: string): string =>
  new Date(`${day}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short"
  })

const minutesLabel = (m: number): string =>
  m >= 60 ? `${Math.floor(m / 60)}u${m % 60 === 0 ? "" : ` ${m % 60}m`}` : `${m} min`

const periodOf = (lesson: Lesson, periods: ReadonlyArray<Period>): string | null => {
  if (lesson.periodStart !== null) {
    return lesson.periodEnd !== null && lesson.periodEnd !== lesson.periodStart
      ? `${lesson.periodStart}e t/m ${lesson.periodEnd}e uur`
      : `${lesson.periodStart}e uur`
  }
  const match = periods.find((p) => p.start === localTime(lesson.start))
  return match === undefined ? null : `${match.number}e uur`
}

/** Slide-in with everything known about one lesson. */
export const LessonPanel = ({
  lesson,
  homework,
  periods,
  onClose
}: {
  lesson: Lesson
  homework: ReadonlyArray<HomeworkItem>
  periods: ReadonlyArray<Period>
  onClose: () => void
}) => {
  const [plans, setPlans] = useState<Record<string, ReadonlyArray<PlanItem>>>({})
  const closeRef = useRef<HTMLButtonElement>(null)

  // opening with the keyboard should land the focus ring inside the panel
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // the sessions planned for this lesson's homework can fall in other weeks,
  // so they are fetched per homework item rather than taken from the week
  useEffect(() => {
    let cancelled = false
    Promise.all(
      homework.map((h) =>
        runEffect(fetchPlanForHomework(h.id)).then((items) => [h.id, items] as const, () => [h.id, []] as const)
      )
    ).then((entries) => {
      if (!cancelled) setPlans(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [homework])

  const period = periodOf(lesson, periods)

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="lesson-panel" role="dialog" aria-label={lesson.title}>
        <header>
          <div>
            <h2>{lesson.title}</h2>
            <p className="panel-sub">
              {dutchDate(localDay(lesson.start))} · {localTime(lesson.start)}–{localTime(lesson.end)}
              {period !== null && <> · {period}</>}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="panel-close"
            onClick={onClose}
            title="Sluiten"
          >
            ✕
          </button>
        </header>

        <dl className="panel-facts">
          <div><dt>vak</dt><dd>{lesson.subject}</dd></div>
          {lesson.location !== null && lesson.location !== "" && (
            <div><dt>lokaal</dt><dd>{lesson.location}</dd></div>
          )}
          {(lesson.teacherName !== null || (lesson.teacher !== null && lesson.teacher !== "")) && (
            <div>
              <dt>docent</dt>
              <dd>
                {lesson.teacherName ?? lesson.teacher}
                {lesson.teacherName !== null && lesson.teacher !== null && (
                  <span className="panel-abbrev"> ({lesson.teacher})</span>
                )}
              </dd>
            </div>
          )}
          {lesson.cancelled && <div><dt>status</dt><dd>vervallen</dd></div>}
        </dl>

        <h3>Huiswerk & lesstof</h3>
        {homework.length === 0 && <p className="panel-empty">Geen huiswerk voor deze les.</p>}
        {homework.map((h) => (
          <div
            key={h.id}
            className={`panel-hw${h.type === "toets" ? " toets" : ""}${
              h.kind === "info" ? " info" : ""
            }`}
          >
            <div className="panel-hw-head">
              <span className="subject">{h.subjectName}</span>
              {h.type === "toets" && <span className="toets-badge">Toets</span>}
              {h.kind === "info" && <span className="lesstof-badge">Lesstof</span>}
              {h.done && <span className="panel-done">✓ afgerond</span>}
            </div>
            {h.title !== null && <p className="panel-hw-title">{h.title}</p>}
            <p className="panel-hw-desc">{h.description}</p>
            <p className="panel-meta">
              voor {dutchDate(h.dueDate)} · {h.source === "somtoday" ? "uit Somtoday" : "zelf ingevoerd"}
            </p>

            {h.kind !== "info" && <h4>Planning</h4>}
            {h.kind === "info" ? null : (plans[h.id] ?? []).length === 0
              ? <p className="panel-empty">Nog geen sessies ingepland.</p>
              : (
                <ul className="panel-plan">
                  {(plans[h.id] ?? []).map((p) => (
                    <li key={p.id} className={p.done ? "done" : ""}>
                      <span className="panel-plan-day" title={dutchDate(p.day)}>
                        {shortDate(p.day)}
                      </span>
                      <span className="duration">{minutesLabel(p.durationMinutes)}</span>
                      <span className="panel-plan-title">
                        {stripSubjectPrefix(p.title, p.subjectName, p.subject)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        ))}
      </aside>
    </>
  )
}
