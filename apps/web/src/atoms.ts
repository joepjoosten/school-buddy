import * as Atom from "effect/unstable/reactivity/Atom"
import { fetchAiModels, fetchHealth, fetchSettings, fetchWeek } from "./api.ts"

/** Week data per anchor date (memoized per date by Atom.family). */
export const weekAtom = Atom.family((date: string) => Atom.make(fetchWeek(date)))

export const healthAtom = Atom.make(fetchHealth)

export const settingsAtom = Atom.make(fetchSettings)

export const aiModelsAtom = Atom.make(fetchAiModels)

export interface ChatMessage {
  readonly who: "jij" | "buddy"
  readonly text: string
}

/** chat transcript, kept across route switches (browser-session lifetime) */
export const chatMessagesAtom = Atom.make<ReadonlyArray<ChatMessage>>([])
