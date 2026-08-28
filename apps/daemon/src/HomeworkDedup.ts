import * as Effect from "effect/Effect"
import { Ai } from "./Ai.ts"
import { Store } from "./Store.ts"

/**
 * After a sync: a self-entered homework item may now also exist as a Somtoday
 * item. Confident duplicates are merged (Somtoday version wins, done-status
 * carried over) and the student is told; anything else is asked in the chat.
 */
export const dedupHomework: Effect.Effect<number, never, Store | Ai> = Effect.gen(function* () {
  const store = yield* Store
  const ai = yield* Ai
  const pairs = yield* store.dedupCandidates
  let merged = 0
  for (const { self, somtoday } of pairs) {
    const verdict = yield* ai.judgeSameHomework({ self, somtoday })
    if (verdict === "same") {
      yield* store.mergeHomework(self.id, somtoday.id)
      merged++
      yield* store.createPrompt({
        kind: "info",
        text:
          `Je had zelf "${self.description}" (${self.subject}) ingevoerd — Somtoday heeft dat nu ook staan, ` +
          `dus ik houd alleen de Somtoday-versie: "${somtoday.description}".`
      })
      continue
    }
    if (verdict === "different") {
      yield* store.recordDedupVerdict(self.id, somtoday.id, "different")
      continue
    }
    // unsure: ask the student in the chat, once
    yield* store.recordDedupVerdict(self.id, somtoday.id, "asked")
    yield* store.addChatMessage(
      "assistant",
      `Ik zag misschien dubbel huiswerk. Jij had zelf toegevoegd: **${self.description}** (${self.subject}, ${self.dueDate}). ` +
        `Somtoday heeft: **${somtoday.description}** (${somtoday.subject}, ${somtoday.dueDate}). ` +
        `Is dat hetzelfde huiswerk? Zeg **ja** (dan houd ik alleen de Somtoday-versie) of **nee** (dan blijven ze allebei staan).\n` +
        `(selfId ${self.id}, somtodayId ${somtoday.id})`
    )
    yield* store.createPrompt({
      kind: "info",
      text: "Ik heb een vraag over mogelijk dubbel huiswerk — kijk even in de chat 💬"
    })
  }
  return merged
})
