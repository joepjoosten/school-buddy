import * as Schema from "effect/Schema"

// --- Roster ---------------------------------------------------------------

export const Lesson = Schema.Struct({
  id: Schema.String,
  /** vak, e.g. "ne", "wi" */
  subject: Schema.String,
  /** display title, e.g. "Nederlands" */
  title: Schema.String,
  location: Schema.NullOr(Schema.String),
  teacher: Schema.NullOr(Schema.String),
  /** ISO datetime */
  start: Schema.String,
  /** ISO datetime */
  end: Schema.String,
  cancelled: Schema.Boolean
})
export type Lesson = typeof Lesson.Type

// --- Homework -------------------------------------------------------------

export const HomeworkSource = Schema.Literals(["somtoday", "self"])
export type HomeworkSource = typeof HomeworkSource.Type

export const HomeworkItem = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  /** YYYY-MM-DD the homework is due */
  dueDate: Schema.String,
  description: Schema.String,
  source: HomeworkSource,
  lessonId: Schema.NullOr(Schema.String),
  done: Schema.Boolean,
  /** ISO datetime */
  createdAt: Schema.String
})
export type HomeworkItem = typeof HomeworkItem.Type

export const HomeworkInput = Schema.Struct({
  subject: Schema.String,
  dueDate: Schema.String,
  description: Schema.String,
  lessonId: Schema.NullOr(Schema.String)
})
export type HomeworkInput = typeof HomeworkInput.Type

// --- Week view ------------------------------------------------------------

export const WeekData = Schema.Struct({
  /** ISO year/week the data covers */
  year: Schema.Number,
  week: Schema.Number,
  /** YYYY-MM-DD of the Monday */
  monday: Schema.String,
  lessons: Schema.Array(Lesson),
  homework: Schema.Array(HomeworkItem)
})
export type WeekData = typeof WeekData.Type

// --- Prompts (questions the buddy asks) -----------------------------------

export const PromptKind = Schema.Literals(["homework-check", "reauth", "info"])
export type PromptKind = typeof PromptKind.Type

export const PromptStatus = Schema.Literals(["pending", "answered", "dismissed"])
export type PromptStatus = typeof PromptStatus.Type

export const Prompt = Schema.Struct({
  id: Schema.String,
  kind: PromptKind,
  /** Dutch text shown to the student */
  text: Schema.String,
  lessonId: Schema.NullOr(Schema.String),
  subject: Schema.NullOr(Schema.String),
  status: PromptStatus,
  answer: Schema.NullOr(Schema.String),
  /** ISO datetime */
  createdAt: Schema.String
})
export type Prompt = typeof Prompt.Type

export const PromptAnswer = Schema.Struct({
  id: Schema.String,
  /**
   * free text answer; null/absent when dismissed or answered "no homework"
   * (optional because Lua clients cannot encode nil table values)
   */
  answer: Schema.optional(Schema.NullOr(Schema.String)),
  dismissed: Schema.Boolean
})
export type PromptAnswer = typeof PromptAnswer.Type

// --- Signals from the macOS companion (Hammerspoon) -----------------------

export const SignalKind = Schema.Literals(["wake", "sleep", "lock", "unlock", "startup"])
export type SignalKind = typeof SignalKind.Type

export const Signal = Schema.Struct({
  kind: SignalKind,
  /** ISO datetime */
  at: Schema.String
})
export type Signal = typeof Signal.Type

// --- Chat -----------------------------------------------------------------

export const ChatRequest = Schema.Struct({
  message: Schema.String
})
export type ChatRequest = typeof ChatRequest.Type

export const ChatReply = Schema.Struct({
  reply: Schema.String
})
export type ChatReply = typeof ChatReply.Type

// --- Settings -------------------------------------------------------------

export const AiProvider = Schema.Literals(["openai", "openrouter"])
export type AiProvider = typeof AiProvider.Type

/** Default model per provider, used when `aiModel` is null ("automatic"). */
export const defaultAiModels: Record<AiProvider, string> = {
  openai: "gpt-5.5-terra",
  openrouter: "openai/gpt-5.6-terra"
}

export const Settings = Schema.Struct({
  /** whether the buddy asks homework questions at all */
  promptsEnabled: Schema.Boolean,
  /** no questions between quietStart and quietEnd (may wrap midnight), "HH:MM" */
  quietStart: Schema.String,
  quietEnd: Schema.String,
  /** whether the AI chat (and AI homework interpretation) is enabled */
  chatEnabled: Schema.Boolean,
  /** which LLM provider to use */
  aiProvider: AiProvider,
  /** explicit model id; null = automatic (provider default when available) */
  aiModel: Schema.NullOr(Schema.String)
})
export type Settings = typeof Settings.Type

export const defaultSettings: Settings = {
  promptsEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:30",
  chatEnabled: true,
  aiProvider: "openrouter",
  aiModel: null
}

export const AiModels = Schema.Struct({
  provider: AiProvider,
  models: Schema.Array(Schema.String),
  /** the model that will actually be used with the current settings */
  resolvedModel: Schema.String,
  defaultModel: Schema.String
})
export type AiModels = typeof AiModels.Type

// --- Somtoday connect flow (web-based setup) -------------------------------

export const School = Schema.Struct({
  uuid: Schema.String,
  naam: Schema.String,
  plaats: Schema.String
})
export type School = typeof School.Type

export const ConnectStartResult = Schema.Struct({
  authorizeUrl: Schema.String
})
export type ConnectStartResult = typeof ConnectStartResult.Type

export const ActionResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.NullOr(Schema.String)
})
export type ActionResult = typeof ActionResult.Type

// --- Debug logs -----------------------------------------------------------

export const LogsResponse = Schema.Struct({
  file: Schema.String,
  lines: Schema.Array(Schema.String)
})
export type LogsResponse = typeof LogsResponse.Type

// --- Health ---------------------------------------------------------------

export const ChatStatus = Schema.Literals(["ready", "no-key", "disabled"])
export type ChatStatus = typeof ChatStatus.Type

export const Health = Schema.Struct({
  status: Schema.Literals(["ok"]),
  somtoday: Schema.Literals(["authenticated", "unauthenticated"]),
  chat: ChatStatus,
  /** ISO datetime of last successful roster sync, null if never */
  lastSync: Schema.NullOr(Schema.String),
  /** running daemon version ("dev" outside releases) */
  version: Schema.String,
  /** newest release seen on GitHub, null if not checked yet */
  latestVersion: Schema.NullOr(Schema.String)
})
export type Health = typeof Health.Type
