import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import type {
  AiModels,
  AiProvider,
  ChatHistory,
  ChatStatus,
  HomeworkInput,
  HomeworkItem,
  Lesson,
  Settings
} from "@school-buddy/shared"
import { defaultAiModels } from "@school-buddy/shared"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { Chat, LanguageModel, Tool, Toolkit } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { keychainGet } from "./Keychain.ts"
import { Store } from "./Store.ts"
import { addDays, toDateOnly } from "./time.ts"

export const PROVIDERS: Record<
  AiProvider,
  { readonly apiUrl: string; readonly keyAccount: string; readonly publicModelList: boolean }
> = {
  openai: {
    apiUrl: "https://api.openai.com/v1",
    keyAccount: "openai.api_key",
    publicModelList: false
  },
  openrouter: {
    apiUrl: "https://openrouter.ai/api/v1",
    keyAccount: "openrouter.api_key",
    publicModelList: true
  }
}

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
  /** Is a self-entered item the same assignment as a Somtoday item? */
  readonly judgeSameHomework: (options: {
    readonly self: HomeworkItem
    readonly somtoday: HomeworkItem
  }) => Effect.Effect<"same" | "different" | "unsure">
  readonly status: Effect.Effect<ChatStatus>
  /** Persisted transcript (recent messages) + rolling summary of earlier days. */
  readonly history: Effect.Effect<ChatHistory>
  /** Available models for the configured provider + the model auto-resolution. */
  readonly models: Effect.Effect<AiModels>
}

export class Ai extends Context.Service<Ai, AiShape>()("app/Ai") {}

const CHAT_SUMMARY_KEY = "chat.summary"

const chatSystemPrompt = (summary: string | null): string =>
  `Je bent School Buddy 🎒, het maatje van een middelbare scholier op zijn laptop.
Je helpt met het rooster, huiswerk en planning, en je mag ook gewoon schoolwerk uitleggen (als een tutor).
Antwoord kort, concreet en vriendelijk. Antwoord in de taal waarin de leerling schrijft (meestal Nederlands).
Gebruik de tools om het echte rooster, huiswerk en roosterwijzigingen op te halen, en om huiswerk toe te voegen, af te vinken of te verwijderen; verzin nooit roostergegevens.
Gebruik huiswerk_openstaand om de juiste id's te vinden voordat je afvinkt of verwijdert.
Als je eerder in dit gesprek vroeg of twee huiswerkitems hetzelfde zijn en de leerling antwoordt: gebruik huiswerk_samenvoegen bij "ja" en huiswerk_apart_houden bij "nee" (de id's staan in je vraag).
Vandaag is ${toDateOnly(new Date())}.${
    summary === null
      ? ""
      : `

Samenvatting van eerdere gesprekken (voor context, verwijs er alleen naar als het relevant is):
${summary}`
  }`

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

  const toolkit = Toolkit.make(
    Tool.make("rooster_week", {
      description:
        "Haalt het rooster en huiswerk op van de week waarin de gegeven datum (YYYY-MM-DD) valt.",
      parameters: Schema.Struct({ date: Schema.String }),
      success: Schema.String
    }),
    Tool.make("roosterwijzigingen", {
      description:
        "Geeft de recent gedetecteerde roosterwijzigingen (uitval, verplaatsingen, lokaalwissels), nieuwste eerst.",
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
    }),
    Tool.make("huiswerk_openstaand", {
      description:
        "Lijst van openstaand (nog niet afgevinkt) huiswerk met hun id's, van vandaag tot 3 weken vooruit.",
      success: Schema.String
    }),
    Tool.make("huiswerk_afvinken", {
      description: "Markeert een huiswerkitem als gedaan (done=true) of weer als open (done=false).",
      parameters: Schema.Struct({ id: Schema.String, done: Schema.Boolean }),
      success: Schema.String
    }),
    Tool.make("huiswerk_samenvoegen", {
      description:
        "Voegt dubbel huiswerk samen: de zelf ingevoerde versie (selfId) verdwijnt, de Somtoday-versie (somtodayId) blijft. Gebruik dit als de leerling bevestigt dat het hetzelfde huiswerk is.",
      parameters: Schema.Struct({ selfId: Schema.String, somtodayId: Schema.String }),
      success: Schema.String
    }),
    Tool.make("huiswerk_apart_houden", {
      description:
        "Markeert dat een zelf ingevoerd item (selfId) en een Somtoday-item (somtodayId) NIET hetzelfde huiswerk zijn, zodat er niet opnieuw naar gevraagd wordt.",
      parameters: Schema.Struct({ selfId: Schema.String, somtodayId: Schema.String }),
      success: Schema.String
    }),
    Tool.make("huiswerk_verwijderen", {
      description:
        "Verwijdert een huiswerkitem. Alleen gebruiken als de leerling daar duidelijk om vraagt.",
      parameters: Schema.Struct({ id: Schema.String }),
      success: Schema.String
    })
  )

  const handlers = toolkit.toLayer({
    rooster_week: ({ date }) =>
      store.weekData(date).pipe(Effect.map((week) => JSON.stringify(week))),
    roosterwijzigingen: () =>
      store.recentChanges(30).pipe(
        Effect.map((changes) =>
          changes.length === 0
            ? "Geen roosterwijzigingen bekend."
            : changes
              .map((c) => `${c.detectedAt.slice(0, 10)} [${c.kind}] ${c.summary}`)
              .join("\n")
        )
      ),
    huiswerk_toevoegen: (input) =>
      store
        .createHomework({ ...input, lessonId: null }, "self")
        .pipe(Effect.map((item) => `Toegevoegd (id ${item.id}): ${item.subject} — ${item.dueDate}`)),
    huiswerk_openstaand: () =>
      store
        .openHomework(toDateOnly(new Date()), toDateOnly(addDays(new Date(), 21)))
        .pipe(
          Effect.map((items) =>
            items.length === 0
              ? "Geen openstaand huiswerk."
              : items
                .map((h) => `${h.dueDate} ${h.subject}: ${h.description} (id ${h.id})`)
                .join("\n")
          )
        ),
    huiswerk_afvinken: ({ id, done }) =>
      store
        .setHomeworkDone(id, done)
        .pipe(
          Effect.map((ok) =>
            ok ? (done ? "Afgevinkt ✅" : "Weer open gezet") : "Geen huiswerk met dat id gevonden."
          )
        ),
    huiswerk_samenvoegen: ({ selfId, somtodayId }) =>
      store
        .mergeHomework(selfId, somtodayId)
        .pipe(Effect.map((ok) => (ok ? "Samengevoegd — alleen de Somtoday-versie blijft." : "Een van de id's bestaat niet (meer)."))),
    huiswerk_apart_houden: ({ selfId, somtodayId }) =>
      store
        .recordDedupVerdict(selfId, somtodayId, "different")
        .pipe(Effect.map(() => "Genoteerd: dit zijn twee verschillende opdrachten.")),
    huiswerk_verwijderen: ({ id }) =>
      store
        .deleteHomework(id)
        .pipe(Effect.map((ok) => (ok ? "Verwijderd 🗑️" : "Geen huiswerk met dat id gevonden.")))
  })

  const providerLayer = (provider: AiProvider, model: string, apiKey: string) =>
    OpenAiLanguageModel.model(model).pipe(
      Layer.provide(
        OpenAiClient.layer({
          apiKey: Redacted.make(apiKey),
          apiUrl: PROVIDERS[provider].apiUrl
        }).pipe(Layer.provide(FetchHttpClient.layer))
      )
    )

  const providerKey = (provider: AiProvider): Effect.Effect<string | null> =>
    keychainGet(PROVIDERS[provider].keyAccount)

  // model list per provider, cached for an hour
  const modelCache = new Map<AiProvider, { at: number; models: Array<string> }>()

  const listModels = (provider: AiProvider): Effect.Effect<Array<string>> =>
    Effect.gen(function* () {
      const cached = modelCache.get(provider)
      if (cached !== undefined && Date.now() - cached.at < 3600_000) return cached.models
      const key = yield* providerKey(provider)
      if (key === null && !PROVIDERS[provider].publicModelList) return []
      const models = yield* Effect.tryPromise(async () => {
        const res = await fetch(`${PROVIDERS[provider].apiUrl}/models`, {
          headers: key !== null ? { authorization: `Bearer ${key}` } : {},
          signal: AbortSignal.timeout(15_000)
        })
        if (!res.ok) throw new Error(`models ${res.status}`)
        const json = (await res.json()) as { data?: Array<{ id?: string }> }
        return (json.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string")
          .sort()
      }).pipe(Effect.catchCause(() => Effect.succeed([] as Array<string>)))
      if (models.length > 0) modelCache.set(provider, { at: Date.now(), models })
      return models
    })

  /** Explicit model, or the provider default when available, or the first listed. */
  const resolveModel = (settings: Settings): Effect.Effect<string> =>
    Effect.gen(function* () {
      if (settings.aiModel !== null && settings.aiModel.trim() !== "") {
        return settings.aiModel
      }
      const fallback = defaultAiModels[settings.aiProvider]
      const models = yield* listModels(settings.aiProvider)
      if (models.length === 0 || models.includes(fallback)) return fallback
      return models[0] ?? fallback
    })

  const models: Effect.Effect<AiModels> = Effect.gen(function* () {
    const settings = yield* store.getSettings
    const list = yield* listModels(settings.aiProvider)
    const resolvedModel = yield* resolveModel(settings)
    return {
      provider: settings.aiProvider,
      models: list,
      resolvedModel,
      defaultModel: defaultAiModels[settings.aiProvider]
    }
  })

  const status: Effect.Effect<ChatStatus> = Effect.gen(function* () {
    const settings = yield* store.getSettings
    if (!settings.chatEnabled) return "disabled" as const
    const key = yield* providerKey(settings.aiProvider)
    return key === null ? ("no-key" as const) : ("ready" as const)
  })

  /**
   * Fold every message from before today into the rolling summary, so the
   * model keeps the gist of earlier days without the full transcript.
   */
  const compactIfNewDay = Effect.gen(function* () {
    const pending = yield* store.uncompactedChatMessages
    const todayStart = `${toDateOnly(new Date())}T00:00:00`
    const older = pending.filter((m) => m.createdAt.localeCompare(todayStart) < 0)
    if (older.length === 0) return
    const previous = yield* store.getMeta(CHAT_SUMMARY_KEY)
    const transcript = older
      .map((m) => `${m.role === "user" ? "Leerling" : "Buddy"}: ${m.content}`)
      .join("\n")
    const response = yield* LanguageModel.generateText({
      prompt: `Je beheert het geheugen van School Buddy, een chatmaatje voor een scholier.
Maak één beknopte samenvatting (max. 12 zinnen, Nederlands) van wat de leerling en de buddy bespraken:
vragen, afspraken, huiswerk, voorkeuren en lopende onderwerpen. Laat details weg die niet meer relevant zijn.
${previous === null ? "" : `Eerdere samenvatting:\n${previous}\n\n`}Nieuw gesprek:\n${transcript}`
    })
    const summary = response.text.trim()
    if (summary !== "") yield* store.setMeta(CHAT_SUMMARY_KEY, summary)
    const cutoff = older[older.length - 1]!.createdAt
    yield* store.markChatCompacted(cutoff + "\u0000")
  })

  const chat = (message: string): Effect.Effect<string> =>
    Effect.gen(function* () {
      const settings = yield* store.getSettings
      if (!settings.chatEnabled) {
        return "De chat staat uit. Zet hem aan bij ⚙️ Instellingen."
      }
      const apiKey = yield* providerKey(settings.aiProvider)
      if (apiKey === null) {
        return "Er is nog geen API-sleutel ingesteld — vraag papa om die toe te voegen bij ⚙️ Instellingen."
      }
      const model = yield* resolveModel(settings)

      const run = Effect.gen(function* () {
        yield* compactIfNewDay.pipe(
          Effect.catchCause((cause) => Effect.logWarning(`chat compaction failed: ${cause}`))
        )
        const summary = yield* store.getMeta(CHAT_SUMMARY_KEY)
        const today = yield* store.uncompactedChatMessages
        // rebuild the session from persisted history: system + today's turns
        const session = yield* Chat.fromPrompt([
          { role: "system", content: chatSystemPrompt(summary) },
          ...today.map((m) => ({ role: m.role, content: m.content }))
        ])
        const tools = yield* toolkit.pipe(Effect.provide(handlers))
        let response = yield* session.generateText({ prompt: message, toolkit: tools })
        // after tool calls the model may need another round for its final answer
        for (let i = 0; i < 3 && response.text.trim() === ""; i++) {
          response = yield* session.generateText({ prompt: [], toolkit: tools })
        }
        const reply = response.text.trim()
        yield* store.addChatMessage("user", message)
        yield* store.addChatMessage("assistant", reply)
        return reply
      })

      return yield* run.pipe(
        Effect.provide(providerLayer(settings.aiProvider, model, apiKey)),
        Effect.catchCause((cause) =>
          Effect.logWarning(`chat failed: ${cause}`).pipe(
            Effect.map(() =>
              "Er ging iets mis met de chat 😕 — probeer het zo nog eens."
            )
          )
        )
      )
    })

  const SameHomework = Schema.Struct({
    same: Schema.Boolean,
    /** 0..1 */
    confidence: Schema.Number
  })

  const judgeSameHomework: AiShape["judgeSameHomework"] = ({ self, somtoday }) =>
    Effect.gen(function* () {
      const settings = yield* store.getSettings
      if (!settings.chatEnabled) return "unsure" as const
      const apiKey = yield* providerKey(settings.aiProvider)
      if (apiKey === null) return "unsure" as const
      const model = yield* resolveModel(settings)
      const run = LanguageModel.generateObject({
        objectName: "vergelijking",
        schema: SameHomework,
        prompt: `Een leerling voerde zelf huiswerk in, en Somtoday (het schoolsysteem) heeft ook een huiswerkitem.
Beoordeel of dit dezelfde opdracht is. Vakcodes kunnen afwijken (bv. "wi" vs "wisb"), en de leerling schrijft korter of slordiger dan de docent.

Zelf ingevoerd: vak "${self.subject}", datum ${self.dueDate}: "${self.description}"
Somtoday:       vak "${somtoday.subject}", datum ${somtoday.dueDate}: "${somtoday.description}"

Geef same=true als het (vrijwel zeker) dezelfde opdracht is, met een confidence tussen 0 en 1.`
      })
      const verdict = yield* run.pipe(
        Effect.provide(providerLayer(settings.aiProvider, model, apiKey)),
        Effect.map((r) => r.value),
        Effect.catchCause((cause) =>
          Effect.logWarning(`judgeSameHomework failed: ${cause}`).pipe(Effect.map(() => null))
        )
      )
      if (verdict === null || verdict.confidence < 0.7) return "unsure" as const
      return verdict.same ? ("same" as const) : ("different" as const)
    })

  const history: Effect.Effect<ChatHistory> = Effect.gen(function* () {
    const summary = yield* store.getMeta(CHAT_SUMMARY_KEY)
    const messages = yield* store.recentChatMessages(200)
    return { summary, messages }
  })

  const interpretHomework: AiShape["interpretHomework"] = ({ answer, subject, upcoming }) =>
    Effect.gen(function* () {
      const settings = yield* store.getSettings
      if (!settings.chatEnabled) return null
      const apiKey = yield* providerKey(settings.aiProvider)
      if (apiKey === null) return null
      const model = yield* resolveModel(settings)

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
        Effect.provide(providerLayer(settings.aiProvider, model, apiKey)),
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

  const shape: AiShape = { chat, interpretHomework, judgeSameHomework, status, models, history }
  return shape
})

export const AiLive = Layer.effect(Ai)(makeAi)
