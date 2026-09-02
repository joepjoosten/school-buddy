import * as Schema from "effect/Schema"

// --- Roster ---------------------------------------------------------------

export const Lesson = Schema.Struct({
  id: Schema.String,
  /** vak, e.g. "ne", "wi" */
  subject: Schema.String,
  /** display title, e.g. "Nederlands" */
  title: Schema.String,
  location: Schema.NullOr(Schema.String),
  /** abbreviation(s) as they appear in the roster, e.g. "BES61" */
  teacher: Schema.NullOr(Schema.String),
  /** resolved full name(s), when the teacher is known */
  teacherName: Schema.NullOr(Schema.String),
  /** UTC instant (…Z); render with localTime/localDay */
  start: Schema.String,
  /** UTC instant (…Z) */
  end: Schema.String,
  cancelled: Schema.Boolean,
  /** school period numbers ("lesuur"), null when Somtoday doesn't provide them */
  periodStart: Schema.NullOr(Schema.Number),
  periodEnd: Schema.NullOr(Schema.Number)
})
export type Lesson = typeof Lesson.Type

// --- Homework -------------------------------------------------------------

export const HomeworkSource = Schema.Literals(["somtoday", "self"])

/**
 * What kind of homework this is, decided once when it appears:
 * - task: real work that deserves study sessions
 * - reminder: bring/hand in something ("boek meenemen") — no sessions
 * - info: not actionable homework at all
 */
export const HomeworkKind = Schema.Literals(["task", "reminder", "info", "unknown"])
export type HomeworkKind = typeof HomeworkKind.Type

/** Somtoday's huiswerkType: a test, plain homework, or lesson material. */
export const HomeworkType = Schema.Literals(["toets", "huiswerk", "lesstof", "overig"])
export type HomeworkType = typeof HomeworkType.Type
export type HomeworkSource = typeof HomeworkSource.Type

export const HomeworkItem = Schema.Struct({
  id: Schema.String,
  /** short code, e.g. "biol" */
  subject: Schema.String,
  /** full course name, e.g. "biologie"; falls back to the code */
  subjectName: Schema.String,
  /** YYYY-MM-DD the homework is due */
  dueDate: Schema.String,
  description: Schema.String,
  source: HomeworkSource,
  lessonId: Schema.NullOr(Schema.String),
  done: Schema.Boolean,
  /** ISO datetime */
  createdAt: Schema.String,
  kind: HomeworkKind,
  type: HomeworkType
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

export const Vacation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** inclusive local calendar days */
  startDay: Schema.String,
  endDay: Schema.String
})
export type Vacation = typeof Vacation.Type

export const WeekData = Schema.Struct({
  /** ISO year/week the data covers */
  year: Schema.Number,
  week: Schema.Number,
  /** YYYY-MM-DD of the Monday */
  monday: Schema.String,
  lessons: Schema.Array(Lesson),
  homework: Schema.Array(HomeworkItem),
  /** vacations and free days overlapping this week */
  vacations: Schema.Array(Vacation)
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

export const ChatAttachmentInput = Schema.Struct({
  mediaType: Schema.String,
  fileName: Schema.String,
  /** base64 payload without the data: prefix */
  data: Schema.String
})
export type ChatAttachmentInput = typeof ChatAttachmentInput.Type

export const ChatAttachment = Schema.Struct({
  id: Schema.String,
  mediaType: Schema.String,
  fileName: Schema.String
})
export type ChatAttachment = typeof ChatAttachment.Type

export const ChatRequest = Schema.Struct({
  message: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachmentInput))
})
export type ChatRequest = typeof ChatRequest.Type

export const ChatReply = Schema.Struct({
  reply: Schema.String
})

export const ChatMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String,
  /** ISO datetime */
  createdAt: Schema.String,
  attachments: Schema.Array(ChatAttachment)
})
export type ChatMessage = typeof ChatMessage.Type

export const ChatHistory = Schema.Struct({
  /** rolling summary of conversations from earlier days (null when none yet) */
  summary: Schema.NullOr(Schema.String),
  /** recent messages, oldest first */
  messages: Schema.Array(ChatMessage)
})
export type ChatHistory = typeof ChatHistory.Type
export type ChatReply = typeof ChatReply.Type

// --- Planning ---------------------------------------------------------------

export const PlanItem = Schema.Struct({
  id: Schema.String,
  homeworkId: Schema.String,
  /** copied from the homework for display */
  subject: Schema.String,
  subjectName: Schema.String,
  homeworkDescription: Schema.String,
  dueDate: Schema.String,
  /** YYYY-MM-DD; no specific time */
  day: Schema.String,
  durationMinutes: Schema.Number,
  /** short label for this session, e.g. "Frans woordjes leren (1/3)" */
  title: Schema.String,
  done: Schema.Boolean,
  createdAt: Schema.String
})
export type PlanItem = typeof PlanItem.Type

export const PlanItemInput = Schema.Struct({
  day: Schema.String,
  durationMinutes: Schema.Number,
  title: Schema.String
})
export type PlanItemInput = typeof PlanItemInput.Type

export const PlanningWeek = Schema.Struct({
  monday: Schema.String,
  items: Schema.Array(PlanItem)
})
export type PlanningWeek = typeof PlanningWeek.Type

export const PlanningPreference = Schema.Literals(["day-before", "day-given"])
export type PlanningPreference = typeof PlanningPreference.Type

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
  aiModel: Schema.NullOr(Schema.String),
  /**
   * bell schedule ("lestijden"), one period per line: "<nr> HH:MM-HH:MM".
   * Used for period markers on the calendar and as fallback when Somtoday
   * doesn't provide a lesuur. Per install, so per student.
   */
  lestijden: Schema.String,
  /** when regular homework is planned: the day before it's due, or the day it was given */
  planningPreference: PlanningPreference
})
export type Settings = typeof Settings.Type

export const defaultSettings: Settings = {
  promptsEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:30",
  chatEnabled: true,
  aiProvider: "openrouter",
  aiModel: null,
  // Dendron College, regulier rooster bovenbouw (editable in settings)
  lestijden: [
    "1 08:15-09:05",
    "2 09:05-09:55",
    "3 09:55-10:45",
    "4 11:05-11:55",
    "5 11:55-12:45",
    "6 13:15-14:05",
    "7 14:05-14:55",
    "8 15:05-15:55",
    "9 15:55-16:45"
  ].join("\n"),
  planningPreference: "day-before"
}

export interface Period {
  readonly number: number
  /** "HH:MM" */
  readonly start: string
  readonly end: string
}

/** Parse the lestijden setting; malformed lines are skipped. */
export const parseLestijden = (text: string): Array<Period> =>
  text
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      number: Number(m[1]),
      start: (m[2] ?? "").replace(".", ":").padStart(5, "0"),
      end: (m[3] ?? "").replace(".", ":").padStart(5, "0")
    }))

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

// --- Roster changes (detected by diffing each Somtoday sync) ---------------

export const RosterChangeKind = Schema.Literals(["added", "removed", "changed", "moved", "published"])
export type RosterChangeKind = typeof RosterChangeKind.Type

export const RosterChange = Schema.Struct({
  id: Schema.String,
  /** ISO datetime the change was detected */
  detectedAt: Schema.String,
  kind: RosterChangeKind,
  /** YYYY-MM-DD the change applies to */
  date: Schema.String,
  subject: Schema.NullOr(Schema.String),
  lessonId: Schema.NullOr(Schema.String),
  /** human-readable Dutch summary, e.g. "wisb ma 7 sep 6e uur: lokaal t39 → t41" */
  summary: Schema.String,
  before: Schema.NullOr(Lesson),
  after: Schema.NullOr(Lesson),
  /** whether the student has been told about it */
  notified: Schema.Boolean
})
export type RosterChange = typeof RosterChange.Type

// --- Updates ----------------------------------------------------------------

/** Compare "v1.2.3"-style versions: negative when a < b, 0 when equal. */
export const compareVersions = (a: string, b: string): number => {
  const parts = (v: string): Array<number> =>
    v.replace(/^v/, "").split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1))
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

/** Is `latest` genuinely newer than the running `current`? */
export const isNewerVersion = (current: string, latest: string | null): boolean =>
  latest !== null && current !== "dev" && compareVersions(current, latest) < 0

export const UpdateCheck = Schema.Struct({
  current: Schema.String,
  latest: Schema.NullOr(Schema.String),
  updateAvailable: Schema.Boolean
})
export type UpdateCheck = typeof UpdateCheck.Type

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
  latestVersion: Schema.NullOr(Schema.String),
  /** true only when latestVersion is genuinely newer than version */
  updateAvailable: Schema.Boolean
})
export type Health = typeof Health.Type
