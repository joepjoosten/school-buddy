import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import type {
  AiModels,
  AiProvider,
  ChatHistory,
  ChatStatus,
  HomeworkInput,
  HomeworkItem,
  HomeworkKind,
  PlanItemInput,
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
  /** Decide whether a homework item is real work, a reminder, or just info. */
  readonly classifyHomework: (homework: HomeworkItem) => Effect.Effect<HomeworkKind>
  /**
   * Propose plan sessions for a homework item. `question` is set when the
   * model wants to ask the student first; items are then empty.
   */
  readonly planHomework: (options: {
    readonly homework: HomeworkItem
    readonly today: string
    readonly preference: "day-before" | "day-given"
    readonly days: ReadonlyArray<{ day: string; lessons: number; plannedMinutes: number }>
  }) => Effect.Effect<{ items: Array<PlanItemInput>; question: string | null } | null>
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
Elk huiswerkitem krijgt een planning van leersessies (dag + duur); gebruik planning_overzicht, planning_maken, planning_verplaatsen en planning_afvinken als de leerling over zijn planning praat.
Als je eerder in dit gesprek een vraag stelde over de planning van huiswerk en de leerling antwoordt, maak dan de planning met planning_maken (het homeworkId staat in je vraag).
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
    Tool.make("planning_overzicht", {
      description: "Geeft de planning (leersessies per dag, met id's) van vandaag tot 2 weken vooruit.",
      success: Schema.String
    }),
    Tool.make("planning_maken", {
      description:
        "Maakt of vervangt de planning voor een huiswerkitem: een lijst sessies met dag (YYYY-MM-DD), duur in minuten en korte titel. Gebruik dit nadat de leerling je vraag over de planning beantwoord heeft, of als hij een andere planning wil.",
      parameters: Schema.Struct({
        homeworkId: Schema.String,
        items: Schema.Array(Schema.Struct({
          day: Schema.String,
          durationMinutes: Schema.Number,
          title: Schema.String
        }))
      }),
      success: Schema.String
    }),
    Tool.make("planning_verplaatsen", {
      description: "Verplaatst een planningsessie (id) naar een andere dag (YYYY-MM-DD).",
      parameters: Schema.Struct({ id: Schema.String, day: Schema.String }),
      success: Schema.String
    }),
    Tool.make("planning_afvinken", {
      description: "Vinkt een planningsessie af (done=true) of zet hem weer open (done=false).",
      parameters: Schema.Struct({ id: Schema.String, done: Schema.Boolean }),
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
    planning_overzicht: () =>
      store
        .planItemsBetween(toDateOnly(new Date()), toDateOnly(addDays(new Date(), 14)))
        .pipe(
          Effect.map((items) =>
            items.length === 0
              ? "Nog niets ingepland."
              : items
                .map((p) =>
                  `${p.day} ${p.durationMinutes} min ${p.done ? "✅" : "⬜"} ${p.title} [${p.subject}, voor ${p.dueDate}] (id ${p.id})`
                )
                .join("\n")
          )
        ),
    planning_maken: ({ homeworkId, items }) =>
      store
        .setPlan(homeworkId, items)
        .pipe(Effect.map((created) => `Ingepland: ${created.map((p) => `${p.day} ${p.durationMinutes} min`).join(", ")}`)),
    planning_verplaatsen: ({ id, day }) =>
      store.movePlanItem(id, day).pipe(Effect.map(() => `Verplaatst naar ${day}.`)),
    planning_afvinken: ({ id, done }) =>
      store
        .setPlanItemDone(id, done)
        .pipe(Effect.map((ok) => (ok ? (done ? "Afgevinkt ✅" : "Weer open gezet") : "Geen sessie met dat id."))),
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
        // Historical assistant turns need an item id: the OpenAI encoder emits
        // `id: null` otherwise, which OpenRouter's Responses validator rejects.
        const session = yield* Chat.fromPrompt([
          { role: "system", content: chatSystemPrompt(summary) },
          ...today.map((m) =>
            m.role === "assistant"
              ? {
                role: "assistant" as const,
                content: [{
                  type: "text" as const,
                  text: m.content,
                  options: { openai: { itemId: `msg_${m.id.replace(/-/g, "")}` } }
                }]
              }
              : { role: "user" as const, content: m.content }
          )
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

  const Classification = Schema.Struct({
    kind: Schema.Literals(["task", "reminder", "info"]),
    confidence: Schema.Number
  })

  const classifyHomework: AiShape["classifyHomework"] = (homework) =>
    Effect.gen(function* () {
      const settings = yield* store.getSettings
      if (!settings.chatEnabled) return "unknown" as const
      const apiKey = yield* providerKey(settings.aiProvider)
      if (apiKey === null) return "unknown" as const
      const model = yield* resolveModel(settings)
      const run = LanguageModel.generateObject({
        objectName: "classificatie",
        schema: Classification,
        prompt: `Beoordeel wat voor soort huiswerk dit is voor een scholier.

Vak: "${homework.subject}", voor ${homework.dueDate}: "${homework.description}"

- "task": echt werk waar de leerling tijd voor moet inplannen (opgaven maken, lezen, leren voor een toets, verslag/PO schrijven, presentatie voorbereiden).
- "reminder": alleen iets meenemen, meebrengen, klaarleggen of inleveren van iets dat al af is (bv. "boek meenemen", "schrift meenemen", "gymkleren", "laptop opladen"). Hier hoeft geen leertijd voor ingepland te worden.
- "info": geen opdracht, bv. een mededeling of les-informatie.

Let op: een omschrijving met zowel werk als meenemen is "task".`
      })
      const result = yield* run.pipe(
        Effect.provide(providerLayer(settings.aiProvider, model, apiKey)),
        Effect.map((r) => r.value),
        Effect.catchCause((cause) =>
          Effect.logWarning(`classifyHomework failed: ${cause}`).pipe(Effect.map(() => null))
        )
      )
      if (result === null || result.confidence < 0.6) return "unknown" as const
      return result.kind
    })

  const PlanProposal = Schema.Struct({
    items: Schema.Array(Schema.Struct({
      day: Schema.String,
      durationMinutes: Schema.Number,
      title: Schema.String
    })),
    /** ask the student this instead of planning, when genuinely unsure */
    question: Schema.NullOr(Schema.String)
  })

  const planHomework: AiShape["planHomework"] = ({ homework, today, preference, days }) =>
    Effect.gen(function* () {
      const settings = yield* store.getSettings
      if (!settings.chatEnabled) return null
      const apiKey = yield* providerKey(settings.aiProvider)
      if (apiKey === null) return null
      const model = yield* resolveModel(settings)
      const dayList = days
        .map((d) => `- ${d.day}: ${d.lessons} lessen, al ${d.plannedMinutes} min gepland`)
        .join("\n")
      const run = LanguageModel.generateObject({
        objectName: "planning",
        schema: PlanProposal,
        prompt: `Je maakt een leerplanning voor een middelbare scholier (4 vwo).
Vandaag is ${today}. Huiswerk: vak "${homework.subject}", inleveren/af op ${homework.dueDate}: "${homework.description}".
Voorkeur van de leerling voor gewoon huiswerk: ${
          preference === "day-before" ? "de dag vóór de inleverdatum" : "op de dag dat het opgegeven is (zo snel mogelijk)"
        }.

Beschikbare dagen (alleen deze; weekend mag, maar plan dan niet alles op zondag):
${dayList}

Regels:
- Een toets, SO, proefwerk of overhoring ("[TOETS]"): meerdere korte sessies (bv. 3 × 15–25 min) verspreid over de dagen ervoor, de laatste sessie de dag vóór de toets. Herhalen werkt beter dan alles in één keer.
- Gewoon huiswerk (opgaven, lezen, meenemen): één sessie van 15–45 min op de voorkeursdag.
- Grote opdrachten (PO, werkstuk, presentatie): meerdere sessies van 30–60 min.
- Spreid werk over dagen met minder lessen en minder geplande minuten.
- Nooit op of na de inleverdatum plannen.
- Titel: kort en concreet, bv. "Frans woordjes H2 leren (1/3)".
Als je echt niet kunt inschatten wat er nodig is (bv. onduidelijk hoe groot het is), vul dan alleen "question" in met één korte vraag aan de leerling en laat items leeg.`
      })
      const result = yield* run.pipe(
        Effect.provide(providerLayer(settings.aiProvider, model, apiKey)),
        Effect.map((r) => r.value),
        Effect.catchCause((cause) =>
          Effect.logWarning(`planHomework failed: ${cause}`).pipe(Effect.map(() => null))
        )
      )
      if (result === null) return null
      const allowed = new Set(days.map((d) => d.day))
      const items = result.items
        .filter((i) => allowed.has(i.day) && i.durationMinutes >= 5 && i.durationMinutes <= 180)
        .map((i) => ({ ...i, durationMinutes: Math.round(i.durationMinutes) }))
      return { items, question: result.question }
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

  const shape: AiShape = {
    chat,
    interpretHomework,
    judgeSameHomework,
    classifyHomework,
    planHomework,
    status,
    models,
    history
  }
  return shape
})

export const AiLive = Layer.effect(Ai)(makeAi)
