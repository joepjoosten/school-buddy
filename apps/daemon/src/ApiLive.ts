import type { ChatAttachment } from "@school-buddy/shared"
import { isNewerVersion, localDay, today, weekBoundsOf } from "@school-buddy/shared"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Ai, PROVIDERS } from "./Ai.ts"
import { saveAttachment } from "./Attachments.ts"
import { Api } from "./Api.ts"
import { onSignal } from "./Buddy.ts"
import { keychainDelete, keychainSet } from "./Keychain.ts"
import { dedupHomework } from "./HomeworkDedup.ts"
import { planHomework } from "./Planner.ts"
import { collectRecentLogs } from "./logs.ts"
import { fetchLatestVersion, startDetachedUpdate } from "./update.ts"
import { Somtoday } from "./Somtoday.ts"
import { Store } from "./Store.ts"
import { VERSION } from "./version.ts"

const RoosterLive = HttpApiBuilder.group(Api, "rooster", (handlers) =>
  handlers
    .handle("week", ({ query }) =>
      Effect.gen(function* () {
        const store = yield* Store
        const date = query.date ?? today()
        return yield* store.weekData(date)
      }))
    .handle("changes", ({ query }) =>
      Effect.gen(function* () {
        const store = yield* Store
        const limit = Math.min(500, Math.max(1, Number(query.limit ?? "100") || 100))
        return yield* store.recentChanges(limit)
      })))

const HomeworkLive = HttpApiBuilder.group(Api, "homework", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const store = yield* Store
        return yield* store.createHomework(payload, "self")
      }))
    .handle("setDone", ({ payload }) =>
      Effect.gen(function* () {
        const store = yield* Store
        return yield* store.setHomeworkDone(payload.id, payload.done)
      }))
    .handle("remove", ({ payload }) =>
      Store.pipe(Effect.flatMap((store) => store.deleteHomework(payload.id)))))

const PlanningLive = HttpApiBuilder.group(Api, "planning", (handlers) =>
  handlers
    .handle("week", ({ query }) =>
      Effect.gen(function* () {
        const store = yield* Store
        const bounds = weekBoundsOf(query.date ?? today())
        const items = yield* store.planItemsBetween(bounds.monday, bounds.nextMonday)
        return { monday: bounds.monday, items }
      }))
    .handle("setDone", ({ payload }) =>
      Store.pipe(Effect.flatMap((store) => store.setPlanItemDone(payload.id, payload.done))))
    .handle("move", ({ payload }) =>
      Store.pipe(Effect.flatMap((store) => store.movePlanItem(payload.id, payload.day))))
    .handle("replan", ({ payload }) =>
      Effect.gen(function* () {
        const store = yield* Store
        const homework = yield* store.getHomework(payload.homeworkId)
        if (homework === null) return { ok: false, message: "Huiswerk niet gevonden" }
        const outcome = yield* planHomework(homework)
        return {
          ok: true,
          message: outcome === "planned"
            ? "Opnieuw ingepland"
            : outcome === "asked"
            ? "De buddy heeft een vraag gesteld in de chat"
            : "Niet ingepland (inleverdatum is al geweest)"
        }
      })))

const PromptsLive = HttpApiBuilder.group(Api, "prompts", (handlers) =>
  handlers
    .handle("pending", () => Store.pipe(Effect.flatMap((store) => store.pendingPrompts)))
    .handle("answer", ({ payload }) =>
      Effect.gen(function* () {
        const store = yield* Store
        const prompt = yield* store.getPrompt(payload.id)
        const updated = yield* store.answerPrompt(payload)
        // A free-text answer to a homework check becomes a homework entry,
        // due at the next lesson of that subject (or tomorrow as fallback).
        const answerText = payload.answer ?? null
        if (
          updated &&
          prompt !== null &&
          prompt.status === "pending" &&
          prompt.kind === "homework-check" &&
          !payload.dismissed &&
          answerText !== null &&
          answerText.trim().length > 0
        ) {
          const answer = answerText.trim()
          const now = new Date()
          const week = yield* store.weekData(today())
          // compare as instants: stored lesson times carry a local offset
          const upcoming = week.lessons.filter((l) => new Date(l.start) > now)
          const ai = yield* Ai
          const interpreted = yield* ai.interpretHomework({
            answer,
            subject: prompt.subject,
            upcoming
          })
          if (interpreted !== null) {
            yield* store.createHomework(
              { ...interpreted, lessonId: prompt.lessonId },
              "self"
            )
          } else {
            // naive fallback: raw text, due at the next lesson of the subject
            const next = prompt.subject === null
              ? null
              : yield* store.nextLessonForSubject(prompt.subject, now.toISOString())
            const fallback = new Date(now.getTime() + 24 * 3600_000)
            yield* store.createHomework(
              {
                subject: prompt.subject ?? "onbekend",
                dueDate: next !== null ? localDay(next.start) : localDay(fallback.toISOString()),
                description: answer,
                lessonId: prompt.lessonId
              },
              "self"
            )
          }
        }
        return updated
      })))

const SignalsLive = HttpApiBuilder.group(Api, "signals", (handlers) =>
  handlers.handle("emit", ({ payload }) => onSignal(payload)))

const ChatLive = HttpApiBuilder.group(Api, "chat", (handlers) =>
  handlers
    .handle("send", ({ payload }) =>
      Effect.gen(function* () {
        const ai = yield* Ai
        const saved: Array<{ attachment: ChatAttachment; bytes: Uint8Array }> = []
        for (const input of payload.attachments ?? []) {
          const stored = yield* saveAttachment(input)
          if (stored !== null) saved.push(stored)
        }
        const reply = yield* ai.chat(payload.message, saved)
        return { reply }
      }))
    .handle("history", () => Ai.pipe(Effect.flatMap((ai) => ai.history))))

const SettingsLive = HttpApiBuilder.group(Api, "settings", (handlers) =>
  handlers
    .handle("get", () => Store.pipe(Effect.flatMap((store) => store.getSettings)))
    .handle("update", ({ payload }) =>
      Store.pipe(Effect.flatMap((store) => store.setSettings(payload))))
    .handle("setAiKey", ({ payload }) =>
      Effect.gen(function* () {
        const account = PROVIDERS[payload.provider].keyAccount
        const key = payload.key.trim()
        if (key === "") {
          yield* keychainDelete(account)
          return { ok: true, message: "Sleutel verwijderd" }
        }
        yield* keychainSet(account, key)
        return { ok: true, message: "Sleutel opgeslagen in de Keychain" }
      })))

const AiApiLive = HttpApiBuilder.group(Api, "ai", (handlers) =>
  handlers.handle("models", () => Ai.pipe(Effect.flatMap((ai) => ai.models))))

const UpdateApiLive = HttpApiBuilder.group(Api, "update", (handlers) =>
  handlers
    .handle("check", () =>
      Effect.gen(function* () {
        const store = yield* Store
        const latest = yield* Effect.promise(() => fetchLatestVersion())
        if (latest !== null) yield* store.setMeta("update.latest", latest)
        return {
          current: VERSION,
          latest,
          updateAvailable: isNewerVersion(VERSION, latest)
        }
      }))
    .handle("run", () => Effect.sync(() => startDetachedUpdate())))

const LogsApiLive = HttpApiBuilder.group(Api, "logs", (handlers) =>
  handlers.handle("recent", ({ query }) =>
    Effect.promise(() => {
      const minutes = Math.min(1440, Math.max(1, Number(query.minutes ?? "5") || 5))
      return collectRecentLogs(minutes)
    }).pipe(Effect.map(({ file, lines }) => ({ file, lines })))))

const SomtodayApiLive = HttpApiBuilder.group(Api, "somtoday", (handlers) =>
  handlers
    .handle("schools", ({ query }) =>
      Effect.gen(function* () {
        const somtoday = yield* Somtoday
        return yield* somtoday.searchSchools(query.q).pipe(Effect.orDie)
      }))
    .handle("connectStart", ({ payload }) =>
      Effect.gen(function* () {
        const somtoday = yield* Somtoday
        const authorizeUrl = yield* somtoday.connectStart(payload.uuid)
        return { authorizeUrl }
      }))
    .handle("connectFinish", ({ payload }) =>
      Effect.gen(function* () {
        const somtoday = yield* Somtoday
        return yield* somtoday.connectFinish(payload.redirectUrl).pipe(
          Effect.map(() => ({ ok: true, message: null })),
          Effect.catchTag("SomtodayError", (error) =>
            Effect.succeed({ ok: false, message: error.detail }))
        )
      }))
    .handle("test", () =>
      Effect.gen(function* () {
        const somtoday = yield* Somtoday
        return yield* somtoday.sync.pipe(
          Effect.tap(() => dedupHomework),
          Effect.map((result) => ({
            ok: true,
            message:
              `${result.lessons} lessen, ${result.homework} huiswerkitems en ${result.vacations} vakanties opgehaald, ${result.changes} roosterwijzigingen`
          })),
          Effect.catchTag("SomtodayError", (error) =>
            Effect.succeed({ ok: false, message: `${error.reason}: ${error.detail}` }))
        )
      })))

const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("get", () =>
    Effect.gen(function* () {
      const store = yield* Store
      const somtoday = yield* Somtoday
      const authenticated = yield* somtoday.isAuthenticated
      const lastSync = yield* store.getMeta("somtoday.lastSync")
      const latestVersion = yield* store.getMeta("update.latest")
      const ai = yield* Ai
      const chat = yield* ai.status
      return {
        status: "ok" as const,
        somtoday: authenticated ? ("authenticated" as const) : ("unauthenticated" as const),
        chat,
        lastSync,
        version: VERSION,
        latestVersion,
        updateAvailable: isNewerVersion(VERSION, latestVersion)
      }
    })))

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([
    RoosterLive,
    HomeworkLive,
    PlanningLive,
    PromptsLive,
    SignalsLive,
    ChatLive,
    SettingsLive,
    SomtodayApiLive,
    AiApiLive,
    UpdateApiLive,
    LogsApiLive,
    HealthLive
  ])
)
