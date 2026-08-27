import type { Prompt, Signal } from "@school-buddy/shared"
import * as Effect from "effect/Effect"
import { Store } from "./Store.ts"

const LAST_CHECK_KEY = "prompts.lastLessonCheck"

/**
 * Core buddy behavior: when the laptop wakes/unlocks (or on demand), look at
 * lessons that ended since the previous check and ask about homework for any
 * lesson that has neither homework recorded nor a prompt already created.
 */
export const planHomeworkPrompts: Effect.Effect<Array<Prompt>, never, Store> = Effect.gen(
  function* () {
    const store = yield* Store
    const now = new Date().toISOString()
    const lastCheck = (yield* store.getMeta(LAST_CHECK_KEY)) ??
      // first run: only look back 8 hours, not into all of history
      new Date(Date.now() - 8 * 3600_000).toISOString()

    const ended = yield* store.lessonsEndedBetween(lastCheck, now)
    const created: Array<Prompt> = []
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
    }

    yield* store.setMeta(LAST_CHECK_KEY, now)
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
