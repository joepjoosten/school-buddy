import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "./Api.ts"
import { onSignal } from "./Buddy.ts"
import { Chat } from "./Chat.ts"
import { Somtoday } from "./Somtoday.ts"
import { Store } from "./Store.ts"
import { toDateOnly } from "./time.ts"
import { VERSION } from "./version.ts"

const RoosterLive = HttpApiBuilder.group(Api, "rooster", (handlers) =>
  handlers.handle("week", ({ query }) =>
    Effect.gen(function* () {
      const store = yield* Store
      const date = query.date ?? toDateOnly(new Date())
      return yield* store.weekData(date)
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
        if (
          updated &&
          prompt !== null &&
          prompt.status === "pending" &&
          prompt.kind === "homework-check" &&
          !payload.dismissed &&
          payload.answer !== null &&
          payload.answer.trim().length > 0
        ) {
          const now = new Date()
          const next = prompt.subject === null
            ? null
            : yield* store.nextLessonForSubject(prompt.subject, now.toISOString())
          const fallback = new Date(now.getTime() + 24 * 3600_000)
          yield* store.createHomework(
            {
              subject: prompt.subject ?? "onbekend",
              dueDate: next !== null ? next.start.slice(0, 10) : toDateOnly(fallback),
              description: payload.answer.trim(),
              lessonId: prompt.lessonId
            },
            "self"
          )
        }
        return updated
      })))

const SignalsLive = HttpApiBuilder.group(Api, "signals", (handlers) =>
  handlers.handle("emit", ({ payload }) => onSignal(payload)))

const ChatLive = HttpApiBuilder.group(Api, "chat", (handlers) =>
  handlers.handle("send", ({ payload }) =>
    Effect.gen(function* () {
      const chat = yield* Chat
      const reply = yield* chat.send(payload.message)
      return { reply }
    })))

const SettingsLive = HttpApiBuilder.group(Api, "settings", (handlers) =>
  handlers
    .handle("get", () => Store.pipe(Effect.flatMap((store) => store.getSettings)))
    .handle("update", ({ payload }) =>
      Store.pipe(Effect.flatMap((store) => store.setSettings(payload)))))

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
      })))

const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("get", () =>
    Effect.gen(function* () {
      const store = yield* Store
      const somtoday = yield* Somtoday
      const authenticated = yield* somtoday.isAuthenticated
      const lastSync = yield* store.getMeta("somtoday.lastSync")
      const latestVersion = yield* store.getMeta("update.latest")
      return {
        status: "ok" as const,
        somtoday: authenticated ? ("authenticated" as const) : ("unauthenticated" as const),
        lastSync,
        version: VERSION,
        latestVersion
      }
    })))

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([
    RoosterLive,
    HomeworkLive,
    PromptsLive,
    SignalsLive,
    ChatLive,
    SettingsLive,
    SomtodayApiLive,
    HealthLive
  ])
)
