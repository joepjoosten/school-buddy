import type { HomeworkItem, PlanItemInput } from "@school-buddy/shared"
import * as Effect from "effect/Effect"
import { Ai } from "./Ai.ts"
import { Store } from "./Store.ts"
import { addDays, today } from "@school-buddy/shared"

const REMINDER = /^\s*(boek|boeken|schrift|schriften|map|gymkleren|laptop|rekenmachine|atlas|woordenboek|materiaal)\b|\bmee ?nemen\b|\bmeebrengen\b|\bklaarleggen\b|\bbij je hebben\b/i
const WORK = /\bmaken\b|\blezen\b|\bleren\b|\bschrijven\b|opgav|oefen|toets|so\b|proefwerk|verslag|presentatie|samenvatting|po\b/i

/** Rule-based classification, used when AI is unavailable or unsure. */
export const classifyByRules = (h: HomeworkItem): "task" | "reminder" => {
  if (WORK.test(h.description)) return "task"
  if (REMINDER.test(h.description)) return "reminder"
  return "task"
}

const isTest = (h: HomeworkItem): boolean =>
  h.type === "toets" || /\btoets|\bso\b|proefwerk|overhoring|tentamen/i.test(h.description)

/** Rule-based plan used when AI is unavailable. */
const defaultPlan = (
  homework: HomeworkItem,
  days: ReadonlyArray<string>,
  preference: "day-before" | "day-given"
): Array<PlanItemInput> => {
  if (days.length === 0) return []
  const last = days[days.length - 1]!
  const first = days[0]!
  if (isTest(homework) && days.length >= 2) {
    const picks = days.slice(-3)
    return picks.map((day, i) => ({
      day,
      durationMinutes: 20,
      title: `${homework.subject}: leren voor toets (${i + 1}/${picks.length})`
    }))
  }
  return [{
    day: preference === "day-before" ? last : first,
    durationMinutes: 30,
    title: `${homework.subject}: ${homework.description.slice(0, 60)}`
  }]
}

export type PlanOutcome = "planned" | "asked" | "skipped"

/** Plan one homework item: AI proposal, question via chat when unsure, rule fallback without AI. */
export const planHomework = (homework: HomeworkItem): Effect.Effect<PlanOutcome, never, Store | Ai> =>
  Effect.gen(function* () {
    const store = yield* Store
    const ai = yield* Ai
    const currentDay = today()
    // window: today .. the day before the due date
    if (homework.dueDate <= currentDay) {
      yield* store.setPlanningStatus(homework.id, "skipped")
      return "skipped" as const
    }
    const loads = yield* store.dayLoads(currentDay, homework.dueDate)
    const days = loads.map((d) => d.day)
    const settings = yield* store.getSettings

    const proposal = yield* ai.planHomework({
      homework,
      today: currentDay,
      preference: settings.planningPreference,
      days: loads
    })

    if (proposal === null) {
      yield* store.setPlan(homework.id, defaultPlan(homework, days, settings.planningPreference))
      return "planned" as const
    }
    if (proposal.items.length > 0) {
      yield* store.setPlan(homework.id, proposal.items)
      return "planned" as const
    }
    // the model wants to ask first
    yield* store.setPlanningStatus(homework.id, "asked")
    const question = proposal.question ?? "Hoe groot is dit ongeveer, en wanneer wil je eraan werken?"
    yield* store.addChatMessage(
      "assistant",
      `Ik wil **${homework.description}** (${homework.subject}, voor ${homework.dueDate}) inplannen, maar ik twijfel: ${question}\n` +
        `(homeworkId ${homework.id})`
    )
    yield* store.createPrompt({
      kind: "info",
      text: "Ik heb een vraag over je planning — kijk even in de chat 💬"
    })
    return "asked" as const
  })

/**
 * Decide for each new homework item whether it needs planning at all;
 * reminders ("boek meenemen") and info are recorded but never get sessions.
 */
export const classifyNewHomework: Effect.Effect<number, never, Store | Ai> = Effect.gen(function* () {
  const store = yield* Store
  const ai = yield* Ai
  const items = yield* store.unclassifiedHomework
  let classified = 0
  for (const item of items) {
    const viaAi = yield* ai.classifyHomework(item)
    const kind = viaAi === "unknown" ? classifyByRules(item) : viaAi
    yield* store.setHomeworkKind(item.id, kind)
    if (kind !== "task") yield* store.setPlanningStatus(item.id, "skipped")
    classified++
  }
  return classified
})

/** Plan everything that has no planning status yet. */
export const planUnplannedHomework: Effect.Effect<number, never, Store | Ai> = Effect.gen(function* () {
  const store = yield* Store
  yield* classifyNewHomework
  const items = yield* store.unplannedHomework(today())
  let planned = 0
  for (const item of items) {
    const outcome = yield* planHomework(item)
    if (outcome === "planned") planned++
  }
  return planned
})


/** Replan one homework item by id; returns a short Dutch status for the chat. */
export const replanById = (homeworkId: string): Effect.Effect<string, never, Store | Ai> =>
  Effect.gen(function* () {
    const store = yield* Store
    const item = yield* store.getHomework(homeworkId)
    if (item === null) return "geen huiswerk met dat id gevonden."
    if (item.kind !== "task") {
      yield* store.setPlanningStatus(item.id, "skipped")
      return "dit item hoeft niet ingepland te worden."
    }
    const outcome = yield* planHomework(item)
    if (outcome === "skipped") return "niet ingepland (de datum is al geweest)."
    if (outcome === "asked") return "ik heb er een vraag over gesteld."
    const items = yield* store.planItemsForHomework(item.id)
    return `opnieuw ingepland: ${items.map((p) => `${p.day} ${p.durationMinutes} min`).join(", ")}`
  })
