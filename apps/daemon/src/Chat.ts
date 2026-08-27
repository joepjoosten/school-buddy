import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

export interface ChatShape {
  readonly send: (message: string) => Effect.Effect<string>
}

export class Chat extends Context.Service<Chat, ChatShape>()("app/Chat") {}

/**
 * Placeholder until the LLM integration lands (OpenAI via the Codex
 * subscription, tools restricted to reading roster/homework).
 */
export const ChatStubLive = Layer.succeed(Chat)({
  send: (message) =>
    Effect.succeed(
      `Ik kan nog niet echt chatten — dat komt binnenkort! Je zei: "${message}"`
    )
})
