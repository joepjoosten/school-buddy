import {
  ActionResult,
  AiModels,
  AiProvider,
  ChatHistory,
  ChatReply,
  ConnectStartResult,
  Health,
  HomeworkInput,
  HomeworkItem,
  LogsResponse,
  RosterChange,
  School,
  UpdateCheck,
  Settings,
  WeekData
} from "@school-buddy/shared"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly message: string
}> {}

const request = <S extends Schema.Top>(
  schema: S,
  path: string,
  init?: RequestInit
): Effect.Effect<S["Type"], ApiError, S["DecodingServices"]> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(path, init)
      if (!res.ok) throw new Error(`${path}: ${res.status}`)
      return (await res.json()) as unknown
    },
    catch: (e) => new ApiError({ message: String(e) })
  }).pipe(
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError((e) => new ApiError({ message: String(e) }))
      )
    )
  )

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
})

export const fetchWeek = (date?: string) =>
  request(WeekData, date ? `/api/week?date=${date}` : "/api/week")

export const fetchHealth = request(Health, "/api/health")

export const createHomework = (input: typeof HomeworkInput.Type) =>
  request(HomeworkItem, "/api/homework", post(input))

export const setHomeworkDone = (id: string, done: boolean) =>
  request(Schema.Boolean, "/api/homework/done", post({ id, done }))

export const deleteHomework = (id: string) =>
  request(Schema.Boolean, "/api/homework/delete", post({ id }))

export const sendChat = (message: string) =>
  request(ChatReply, "/api/chat", post({ message }))

export const fetchChatHistory = request(ChatHistory, "/api/chat/history")

export const fetchSettings = request(Settings, "/api/settings")

export const saveSettings = (settings: typeof Settings.Type) =>
  request(Settings, "/api/settings", { ...post(settings), method: "PUT" })

export const searchSchools = (q: string) =>
  request(Schema.Array(School), `/api/somtoday/schools?q=${encodeURIComponent(q)}`)

export const connectStart = (uuid: string) =>
  request(ConnectStartResult, "/api/somtoday/connect/start", post({ uuid }))

export const connectFinish = (redirectUrl: string) =>
  request(ActionResult, "/api/somtoday/connect/finish", post({ redirectUrl }))

export const testSomtoday = request(ActionResult, "/api/somtoday/test", { method: "POST" })

export const setAiKey = (provider: typeof AiProvider.Type, key: string) =>
  request(ActionResult, "/api/settings/ai-key", post({ provider, key }))

export const fetchAiModels = request(AiModels, "/api/ai/models")

export const fetchLogs = (minutes: number) =>
  request(LogsResponse, `/api/logs?minutes=${minutes}`)

export const fetchRosterChanges = (limit = 200) =>
  request(Schema.Array(RosterChange), `/api/roster/changes?limit=${limit}`)

export const checkUpdate = request(UpdateCheck, "/api/update/check", { method: "POST" })

export const runUpdate = request(ActionResult, "/api/update/run", { method: "POST" })

/** Run a one-off mutation effect from an event handler. */
export const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect)
