import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import { planHomeworkPrompts } from "./Buddy.ts"
import { Somtoday } from "./Somtoday.ts"
import { Store } from "./Store.ts"
import { fetchLatestVersion } from "./update.ts"
import { VERSION } from "./version.ts"

/**
 * Periodic jobs, kept alive for the lifetime of the daemon. Bun keeps running
 * through sleep; ticks that fall in a sleep window fire on wake, which is
 * exactly the "laptop opened again" moment we care about.
 */

const syncJob = Effect.gen(function* () {
  const somtoday = yield* Somtoday
  const store = yield* Store
  yield* somtoday.sync.pipe(
    Effect.tap((r) => Effect.log(`somtoday sync ok: ${r.lessons} lessen, ${r.homework} huiswerk`)),
    Effect.catchTag("SomtodayError", (error) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(`somtoday sync failed: ${error.reason} ${error.detail}`)
        if (error.reason !== "unauthenticated") return
        // Ask for a re-login, but only once per open question.
        const pending = yield* store.pendingPrompts
        if (pending.some((p) => p.kind === "reauth")) return
        yield* store.createPrompt({
          kind: "reauth",
          text: "Ik kan niet meer bij Somtoday. Vraag papa om opnieuw in te loggen."
        })
      })
    )
  )
})

const promptJob = planHomeworkPrompts.pipe(
  Effect.tap((created) =>
    created.length > 0
      ? Effect.log(`created ${created.length} homework prompt(s)`)
      : Effect.void
  )
)

const updateCheckJob = Effect.gen(function* () {
  const store = yield* Store
  const latest = yield* Effect.promise(() => fetchLatestVersion())
  if (latest === null) return
  yield* store.setMeta("update.latest", latest)
  if (latest === VERSION || VERSION === "dev") return
  // notify once per new version
  const prompted = yield* store.getMeta("update.prompted")
  if (prompted === latest) return
  yield* store.createPrompt({
    kind: "info",
    text:
      `Er is een nieuwe versie van School Buddy (${latest}). ` +
      `Installeer hem via het 🎒-menu → "Update installeren".`
  })
  yield* store.setMeta("update.prompted", latest)
})

export const SchedulerLive = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.all([
      syncJob.pipe(Effect.schedule(Schedule.spaced("30 minutes"))),
      promptJob.pipe(Effect.schedule(Schedule.spaced("5 minutes"))),
      updateCheckJob.pipe(Effect.schedule(Schedule.spaced("1 day"))),
      // run everything once at startup, before the first spaced tick
      syncJob,
      promptJob,
      updateCheckJob
    ], { concurrency: "unbounded", discard: true })
  )
)
