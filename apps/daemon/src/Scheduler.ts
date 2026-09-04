import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import { planHomeworkPrompts } from "./Buddy.ts"
import { dedupHomework } from "./HomeworkDedup.ts"
import { planUnplannedHomework } from "./Planner.ts"
import { Somtoday } from "./Somtoday.ts"
import { Store } from "./Store.ts"
import { addDays, isNewerVersion, today } from "@school-buddy/shared"
import { fetchLatestVersion } from "./update.ts"
import { VERSION } from "./version.ts"

/**
 * Periodic jobs, kept alive for the lifetime of the daemon. Bun keeps running
 * through sleep; ticks that fall in a sleep window fire on wake, which is
 * exactly the "laptop opened again" moment we care about.
 */

const AUTH_FAILS_KEY = "somtoday.authFails"
const REAUTH_ASKED_KEY = "somtoday.reauthAskedAt"
/** once the student has been told, stay quiet for a day unless it starts working */
const REAUTH_COOLDOWN_MS = 24 * 3600_000

/** Tell the student about roster changes that hit the next ~2 days. */
const notifyRosterChanges = Effect.gen(function* () {
  const store = yield* Store
  const horizon = addDays(today(), 3)
  const changes = yield* store.unnotifiedChanges(horizon)
  if (changes.length === 0) return
  const lines = changes.slice(0, 6).map((c) => `• ${c.summary}`)
  const more = changes.length > 6 ? `\n… en nog ${changes.length - 6} wijzigingen` : ""
  yield* store.createPrompt({
    kind: "info",
    text: `Let op, je rooster is veranderd:\n${lines.join("\n")}${more}`
  })
  yield* store.markChangesNotified(changes.map((c) => c.id))
})

const syncJob = Effect.gen(function* () {
  const somtoday = yield* Somtoday
  const store = yield* Store
  yield* somtoday.sync.pipe(
    Effect.tap((r) =>
      Effect.log(
        `somtoday sync ok: ${r.lessons} lessen, ${r.homework} huiswerk, ${r.changes} wijzigingen`
      ).pipe(
        // it works again: forget the failures and allow a future warning
        Effect.andThen(store.setMeta(AUTH_FAILS_KEY, "0")),
        Effect.andThen(store.setMeta(REAUTH_ASKED_KEY, "")),
        Effect.andThen(notifyRosterChanges),
        Effect.andThen(
          dedupHomework.pipe(
            Effect.tap((n) => (n > 0 ? Effect.log(`merged ${n} duplicate homework item(s)`) : Effect.void))
          )
        ),
        Effect.andThen(planJob)
      )
    ),
    Effect.catchTag("SomtodayError", (error) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(`somtoday sync failed: ${error.reason} ${error.detail}`)
        if (error.reason !== "unauthenticated") return
        // A single failure can be a transient token-rotation hiccup; only ask
        // for a re-login after consecutive failures, and once per open question.
        const fails = Number((yield* store.getMeta(AUTH_FAILS_KEY)) ?? "0") + 1
        yield* store.setMeta(AUTH_FAILS_KEY, String(fails))
        if (fails < 2) return
        // Ask once, not on every failed sync: a dismissed prompt used to let
        // the next failure create a new one, which is a popup every 30 minutes
        // for as long as the login is broken.
        const pending = yield* store.pendingPrompts
        if (pending.some((p) => p.kind === "reauth")) return
        const askedAt = yield* store.getMeta(REAUTH_ASKED_KEY)
        if (
          askedAt !== null && askedAt !== "" &&
          Date.now() - Date.parse(askedAt) < REAUTH_COOLDOWN_MS
        ) return
        yield* store.createPrompt({
          kind: "reauth",
          text: "Ik kan niet meer bij Somtoday. Vraag papa om opnieuw in te loggen " +
            "(⚙️ Instellingen → Somtoday)."
        })
        yield* store.setMeta(REAUTH_ASKED_KEY, new Date().toISOString())
      })
    )
  )
})

const planJob = planUnplannedHomework.pipe(
  Effect.tap((n) => (n > 0 ? Effect.log(`planned ${n} homework item(s)`) : Effect.void))
)

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
  if (!isNewerVersion(VERSION, latest)) return
  // notify once per new version
  const prompted = yield* store.getMeta("update.prompted")
  if (prompted === latest) return
  yield* store.createPrompt({
    kind: "info",
    text:
      `Er is een nieuwe versie van School Buddy (${latest}). ` +
      `Installeer hem via ⚙️ Instellingen → Versie.`
  })
  yield* store.setMeta("update.prompted", latest)
})

export const SchedulerLive = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.all([
      syncJob.pipe(Effect.schedule(Schedule.spaced("30 minutes"))),
      promptJob.pipe(Effect.schedule(Schedule.spaced("5 minutes"))),
      planJob.pipe(Effect.schedule(Schedule.spaced("5 minutes"))),
      updateCheckJob.pipe(Effect.schedule(Schedule.spaced("1 day"))),
      // run everything once at startup, before the first spaced tick
      syncJob,
      promptJob,
      updateCheckJob
    ], { concurrency: "unbounded", discard: true })
  )
)
