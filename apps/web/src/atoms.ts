import * as Atom from "effect/unstable/reactivity/Atom"
import { fetchHealth, fetchWeek } from "./api.ts"

/** Week data per anchor date (memoized per date by Atom.family). */
export const weekAtom = Atom.family((date: string) => Atom.make(fetchWeek(date)))

export const healthAtom = Atom.make(fetchHealth)
