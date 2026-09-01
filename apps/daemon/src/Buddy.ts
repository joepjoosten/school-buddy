import type { Prompt, Settings, Signal } from "@school-buddy/shared"
import * as Effect from "effect/Effect"
import { Store } from "./Store.ts"

const LAST_CHECK_KEY = "prompts.lastLessonCheck"
/** never ask about a lesson that ended longer ago than this */
const RECENT_MS = 3 * 3600_000

/** Is `now` inside the quiet window? The window may wrap midnight. */
export const isQuietTime = (settings: Settings, now: Date): boolean => {
  const minutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const start = minutes(settings.quietStart)
  const end = minutes(settings.quietEnd)
  const current = now.getHours() * 60 + now.getMinutes()
  return start <= end
    ? current >= start && current < end
    : current >= start || current < end
}

/**
 * Core buddy behavior: when the laptop wakes/unlocks (or on demand), look at
 * lessons that ended since the previous check and ask about homework for any
 * lesson that has neither homework recorded nor a prompt already created.
 */
export const planHomeworkPrompts: Effect.Effect<Array<Prompt>, never, Store> = Effect.gen(
  function* () {
    const store = yield* Store
    const settings = yield* store.getSettings
    // Disabled or quiet hours: don't ask, and don't advance the check marker,
    // so the questions come later instead of never.
    if (!settings.promptsEnabled || isQuietTime(settings, new Date())) return []
    const now = new Date().toISOString()
    const stored = yield* store.getMeta(LAST_CHECK_KEY)
    const recent = new Date(Date.now() - RECENT_MS).toISOString()
    // never look further back than the recency window, so a closed laptop,
    // quiet hours or a restart can't produce a burst of stale questions
    const lastCheck = stored === null || stored < recent ? recent : stored

    const ended = yield* store.lessonsEndedBetween(lastCheck, now)
    // one open question at a time; leave the marker alone so the remaining
    // lessons are still considered once he has answered
    const pending = yield* store.pendingPrompts
    if (pending.some((p) => p.kind === "homework-check")) return []
    const created: Array<Prompt> = []
    // walk the lessons oldest first; stop at the first question so only one
    // popup appears, and move the marker to just that lesson so the next
    // sweep continues with the following one instead of skipping it
    let marker = now
    for (const lesson of ended) {
      const hasHomework = yield* store.hasHomeworkForLesson(lesson.id)
      const hasPrompt = yield* store.hasPromptForLesson(lesson.id)
      if (hasHomework || hasPrompt) continue
      const prompt = yield* store.createPrompt({
        kind: "homework-check",
        text: `Zojuist was ${lesson.title}. Heb je huiswerk gekregen?`,
        lessonId: lesson.id,
        subject: lesson.subject
      })
      created.push(prompt)
      marker = new Date(lesson.end).toISOString()
      break
    }

    yield* store.setMeta(LAST_CHECK_KEY, marker)
    return created
  }
)

/** Handle a signal from the macOS companion and return all pending prompts. */
export const onSignal = (signal: Signal): Effect.Effect<Array<Prompt>, never, Store> =>
  Effect.gen(function* () {
    const store = yield* Store
    yield* store.recordSignal(signal)
    if (signal.kind === "wake" || signal.kind === "unlock" || signal.kind === "startup") {
      yield* planHomeworkPrompts
    }
    return yield* store.pendingPrompts
  })
