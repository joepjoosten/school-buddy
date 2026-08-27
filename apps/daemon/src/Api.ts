import {
  ActionResult,
  ChatReply,
  ChatRequest,
  ConnectStartResult,
  Health,
  HomeworkInput,
  HomeworkItem,
  Prompt,
  PromptAnswer,
  School,
  Settings,
  Signal,
  WeekData
} from "@school-buddy/shared"
import * as Schema from "effect/Schema"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"

const rooster = HttpApiGroup.make("rooster").add(
  HttpApiEndpoint.get("week", "/api/week", {
    // any date inside the requested week, YYYY-MM-DD; defaults to today
    query: { date: Schema.optional(Schema.String) },
    success: WeekData
  })
)

const homework = HttpApiGroup.make("homework").add(
  HttpApiEndpoint.post("create", "/api/homework", {
    payload: HomeworkInput,
    success: HomeworkItem
  }),
  HttpApiEndpoint.post("setDone", "/api/homework/done", {
    payload: Schema.Struct({ id: Schema.String, done: Schema.Boolean }),
    success: Schema.Boolean
  })
)

const prompts = HttpApiGroup.make("prompts").add(
  HttpApiEndpoint.get("pending", "/api/prompts/pending", {
    success: Schema.Array(Prompt)
  }),
  HttpApiEndpoint.post("answer", "/api/prompts/answer", {
    payload: PromptAnswer,
    success: Schema.Boolean
  })
)

const signals = HttpApiGroup.make("signals").add(
  HttpApiEndpoint.post("emit", "/api/signal", {
    payload: Signal,
    // pending prompts, so the companion can immediately show them
    success: Schema.Array(Prompt)
  })
)

const chat = HttpApiGroup.make("chat").add(
  HttpApiEndpoint.post("send", "/api/chat", {
    payload: ChatRequest,
    success: ChatReply
  })
)

const settings = HttpApiGroup.make("settings").add(
  HttpApiEndpoint.get("get", "/api/settings", {
    success: Settings
  }),
  HttpApiEndpoint.put("update", "/api/settings", {
    payload: Settings,
    success: Settings
  }),
  HttpApiEndpoint.post("setOpenAiKey", "/api/settings/openai-key", {
    // empty string removes the key
    payload: Schema.Struct({ key: Schema.String }),
    success: ActionResult
  })
)

const somtoday = HttpApiGroup.make("somtoday").add(
  HttpApiEndpoint.get("schools", "/api/somtoday/schools", {
    query: { q: Schema.String },
    success: Schema.Array(School)
  }),
  HttpApiEndpoint.post("connectStart", "/api/somtoday/connect/start", {
    payload: Schema.Struct({ uuid: Schema.String }),
    success: ConnectStartResult
  }),
  HttpApiEndpoint.post("connectFinish", "/api/somtoday/connect/finish", {
    payload: Schema.Struct({ redirectUrl: Schema.String }),
    success: ActionResult
  }),
  HttpApiEndpoint.post("test", "/api/somtoday/test", {
    success: ActionResult
  })
)

const health = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("get", "/api/health", {
    success: Health
  })
)

export const Api = HttpApi.make("school-buddy").add(
  rooster,
  homework,
  prompts,
  signals,
  chat,
  settings,
  somtoday,
  health
)
