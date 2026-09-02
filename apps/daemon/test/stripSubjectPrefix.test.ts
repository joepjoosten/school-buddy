import { stripSubjectPrefix } from "@school-buddy/shared"
import { describe, expect, test } from "bun:test"

describe("stripSubjectPrefix", () => {
  test("removes a subject the planner put in the title", () => {
    expect(stripSubjectPrefix("Biol B2 lezen + opd. 22 t/m 42 maken", "biologie", "biol"))
      .toBe("B2 lezen + opd. 22 t/m 42 maken")
    expect(stripSubjectPrefix("fatl: oef. 2 p. 14", "Franse taal en literatuur", "fatl"))
      .toBe("oef. 2 p. 14")
    expect(stripSubjectPrefix("Wisb - opgaven 6 t/m 9", "wiskunde B", "wisb"))
      .toBe("opgaven 6 t/m 9")
  })

  test("leaves titles without a subject alone", () => {
    expect(stripSubjectPrefix("Microscopie PO deel 1 (1/4)", "biologie", "biol"))
      .toBe("Microscopie PO deel 1 (1/4)")
  })

  test("never strips the whole title", () => {
    expect(stripSubjectPrefix("biol", "biologie", "biol")).toBe("biol")
  })

  test("does not strip a word that merely starts with the subject", () => {
    expect(stripSubjectPrefix("Biologieboek meenemen", "biologie", "biol"))
      .toBe("Biologieboek meenemen")
  })
})
