import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { PlanItem } from "@school-buddy/shared"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { movePlanItem, replanHomework, runEffect, setPlanItemDone } from "./api.ts"
import { today as localToday } from "@school-buddy/shared"
import { planningAtom } from "./atoms.ts"
import { useFreshData } from "./useFreshData.ts"
import { addDays } from "./WeekGrid.tsx"

const DAY_NAMES = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]

const dutchDate = (day: string): string =>
  new Date(`${day}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long"
  })

const minutesLabel = (m: number): string =>
  m >= 60 ? `${Math.floor(m / 60)}u${m % 60 === 0 ? "" : ` ${m % 60}m`}` : `${m} min`

export const PlanningPage = ({ anchor }: { anchor: string }) => {
  const result = useAtomValue(planningAtom(anchor))
  const refresh = useAtomRefresh(planningAtom(anchor))
  const week = AsyncResult.isSuccess(result) ? result.value : null
  const today = localToday()
  useFreshData(refresh)

  if (week === null) return <p className="hint">Planning laden…</p>

  const days = DAY_NAMES.map((name, i) => ({ name, date: addDays(week.monday, i) }))

  const toggle = async (item: PlanItem) => {
    await runEffect(setPlanItemDone(item.id, !item.done))
    refresh()
  }
  const move = async (item: PlanItem, delta: number) => {
    await runEffect(movePlanItem(item.id, addDays(item.day, delta)))
    refresh()
  }
  const replan = async (item: PlanItem) => {
    const r = await runEffect(replanHomework(item.homeworkId))
    window.alert(r.message ?? "")
    refresh()
  }

  return (
    <div className="planning">
      {days.map((d) => {
        const items = week.items.filter((p) => p.day === d.date)
        const total = items.filter((p) => !p.done).reduce((sum, p) => sum + p.durationMinutes, 0)
        return (
          <div key={d.date} className={`plan-day${d.date === today ? " today" : ""}${d.date < today ? " past" : ""}`}>
            <h3>
              {d.name} <small>{d.date.slice(8, 10)}-{d.date.slice(5, 7)}</small>
              {total > 0 && <span className="plan-total">{minutesLabel(total)}</span>}
            </h3>
            {items.length === 0 && <p className="empty">—</p>}
            {items.map((p) => (
              <div key={p.id} className={`plan-item${p.done ? " done" : ""}`}>
                <label>
                  <input type="checkbox" checked={p.done} onChange={() => toggle(p)} />
                  <span className="plan-title">{p.title}</span>
                </label>
                <div className="plan-meta">
                  <span className="subject">{p.subject}</span>
                  <span className="duration">{minutesLabel(p.durationMinutes)}</span>
                  <a
                    className="due"
                    href={`#rooster?date=${p.dueDate}`}
                    title={`${p.subject} — voor ${dutchDate(p.dueDate)}\n\n${p.homeworkDescription}\n\n(klik om die week in het rooster te openen)`}
                  >
                    voor {p.dueDate.slice(8, 10)}-{p.dueDate.slice(5, 7)}
                  </a>
                  <span className="plan-actions">
                    <button type="button" title="dag eerder" onClick={() => move(p, -1)}>◀</button>
                    <button type="button" title="dag later" onClick={() => move(p, 1)}>▶</button>
                    <button type="button" title="opnieuw inplannen" onClick={() => replan(p)}>↻</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
