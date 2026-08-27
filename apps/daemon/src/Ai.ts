import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import type { ChatStatus, HomeworkInput, Lesson } from "@school-buddy/shared"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { Chat, LanguageModel, Tool, Toolkit } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { keychainGet } from "./Keychain.ts"
import { Store } from "./Store.ts"
import { toDateOnly } from "./time.ts"

export const KC_OPENAI_KEY = "openai.api_key"

export interface AiShape {
  /** Chat with the buddy; never fails, returns a friendly Dutch message on problems. */
  readonly chat: (message: string) => Effect.Effect<string>
  /**
   * Interpret a free-text homework answer into a structured entry.
   * Returns null when AI is unavailable or interpretation fails
   * (caller falls back to the naive rule).
   */
  readonly interpretHomework: (options: {
    readonly answer: string
    readonly subject: string | null
    readonly upcoming: ReadonlyArray<Lesson>
  }) => Effect.Effect<HomeworkInput | null>
  readonly status: Effect.Effect<ChatStatus>
}

export class Ai extends Context.Service<Ai, AiShape>()("app/Ai") {}

const chatSystemPrompt = (): string =>
  `Je bent School Buddy 🎒, het maatje van een middelbare scholier op zijn laptop.
Je helpt met het rooster, huiswerk en planning, en je mag ook gewoon schoolwerk uitleggen (als een tutor).
Antwoord kort, concreet en vriendelijk. Antwoord in de taal waarin de leerling schrijft (meestal Nederlands).
Gebruik de tools om het echte rooster en huiswerk op te halen of huiswerk toe te voegen; verzin nooit roostergegevens.
Vandaag is ${toDateOnly(new Date())}.`

const InterpretedHomework = Schema.Struct({
  /** vak-afkorting, bv. "wi", "biol"; null als onbekend */
  subject: Schema.NullOr(Schema.String),
  /** YYYY-MM-DD waarop het af moet zijn */
  dueDate: Schema.String,
  /** korte, opgeschoonde beschrijving van het huiswerk */
  description: Schema.String
})

const makeAi = Effect.gen(function* () {
  const store = yield* Store

  // rolling conversation history for the daemon's lifetime
  const chatSession = yield* Chat.fromPrompt([
    { role: "system", content: chatSystemPrompt() }
  ])

  const toolkit = Toolkit.make(
    Tool.make("rooster_week", {
      description:
        "Haalt het rooster en huiswerk op van de week waarin de gegeven datum (YYYY-MM-DD) valt.",
      parameters: Schema.Struct({ date: Schema.String }),
      success: Schema.String
    }),
    Tool.make("huiswerk_toevoegen", {
      description: "Voegt een huiswerkitem toe voor de leerling.",
      parameters: Schema.Struct({
        subject: Schema.String,
        dueDate: Schema.String,
        description: Schema.String
      }),
      success: Schema.String
    })
  )

  const handlers = toolkit.toLayer({
    rooster_week: ({ date }) =>
      store.weekData(date).pipe(Effect.map((week) => JSON.stringify(week))),
    huiswerk_toevoegen: (input) =>
      store
        .createHomework({ ...input, lessonId: null }, "self")
        .pipe(Effect.map((item) => `Toegevoegd: ${item.subject} — ${item.dueDate}`))
  })

  const providerLayer = (model: string, apiKey: string) =>
    OpenAiLanguageModel.model(model).pipe(
      Layer.provide(
        OpenAiClient.layer({ apiKey: Redacted.make(apiKey) }).pipe(
          Layer.provide(FetchHttpClient.layer)
        )
      )
    )

  const status: Effect.Effect<ChatStatus> = Effect.gen(function* () {
    const settings = yield* store.getSettings
    if (!settings.chatEnabled) return "disabled" as const
    const key = yield* keychainGet(KC_OPENAI_KEY)
    return key === null ? ("no-key" as const) : ("ready" as const)
  })

  const chat = (message: string): Effect.Effect<string> =>
    Effect.gen(function* () {
      const settings = yield* store.getSettings
      if (!settings.chatEnabled) {
        return "De chat staat uit. Zet hem aan bij ⚙️ Instellingen."
      }
      const apiKey = yield* keychainGet(KC_OPENAI_KEY)
      if (apiKey === null) {
        return "Er is nog geen OpenAI-sleutel ingesteld — vraag papa om die toe te voegen bij ⚙️ Instellingen."
      }

      const run = Effect.gen(function* () {
        const tools = yield* toolkit.pipe(Effect.provide(handlers))
        let response = yield* chatSession.generateText({ prompt: message, toolkit: tools })
        // after tool calls the model may need another round for its final answer
        for (let i = 0; i < 3 && response.text.trim() === ""; i++) {
          response = yield* chatSession.generateText({ prompt: [], toolkit: tools })
        }
        return response.text.trim()
      })

      return yield* run.pipe(
        Effect.provide(providerLayer(settings.openAiModel, apiKey)),
        Effect.catchCause((cause) =>
          Effect.logWarning(`chat failed: ${cause}`).pipe(
            Effect.map(() =>
              "Er ging iets mis met de chat 😕 — probeer het zo nog eens."
            )
          )
        )
      )
    })

  const interpretHomework: AiShape["interpretHomework"] = ({ answer, subject, upcoming }) =>
    Effect.gen(function* () {
      const settings = yield* store.getSettings
      if (!settings.chatEnabled) return null
      const apiKey = yield* keychainGet(KC_OPENAI_KEY)
      if (apiKey === null) return null

      const lessonList = upcoming
        .slice(0, 12)
        .map((l) => `- ${l.subject} op ${l.start.slice(0, 10)} om ${l.start.slice(11, 16)}`)
        .join("\n")

      const run = LanguageModel.generateObject({
        objectName: "huiswerk",
        schema: InterpretedHomework,
        prompt: `Een leerling kreeg na de les${subject !== null ? ` ${subject}` : ""} de vraag of er huiswerk is opgegeven en antwoordde:

"${answer}"

Vandaag is ${toDateOnly(new Date())}. Komende lessen:
${lessonList === "" ? "(onbekend)" : lessonList}

Zet dit om naar een gestructureerd huiswerkitem. Kies als dueDate de datum die de leerling noemt,
of anders de eerstvolgende les van het vak, of anders morgen. Maak de beschrijving kort en duidelijk.`
      })

      const result = yield* run.pipe(
        Effect.provide(providerLayer(settings.openAiModel, apiKey)),
        Effect.map((response) => response.value),
        Effect.catchCause((cause) =>
          Effect.logWarning(`interpretHomework failed: ${cause}`).pipe(Effect.map(() => null))
        )
      )
      if (result === null) return null
      return {
        subject: result.subject ?? subject ?? "onbekend",
        dueDate: result.dueDate,
        description: result.description,
        lessonId: null
      }
    })

  const shape: AiShape = { chat, interpretHomework, status }
  return shape
})

export const AiLive = Layer.effect(Ai)(makeAi)
