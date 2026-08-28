import type { Lesson } from "@school-buddy/shared"
import { describe, expect, test } from "bun:test"
import { diffLessons } from "../src/rosterDiff.ts"

const lesson = (over: Partial<Lesson> & { id: string }): Lesson => ({
  subject: "wisb",
  title: "wiskunde B",
  location: "t39",
  teacher: "HER61",
  start: "2026-09-07T13:15:00.000+02:00",
  end: "2026-09-07T14:05:00.000+02:00",
  cancelled: false,
  periodStart: 6,
  periodEnd: 6,
  ...over
})

const window = { from: "2026-09-01", until: "2026-12-01" }

describe("diffLessons", () => {
  test("no changes → empty", () => {
    const a = [lesson({ id: "1" })]
    expect(diffLessons(a, a, window)).toEqual([])
  })

  test("room change is a field-level 'changed'", () => {
    const changes = diffLessons([lesson({ id: "1" })], [lesson({ id: "1", location: "t41" })], window)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe("changed")
    expect(changes[0]!.summary).toContain("lokaal t39 → t41")
  })

  test("disappeared lesson is 'removed'", () => {
    const changes = diffLessons([lesson({ id: "1" })], [], window)
    expect(changes[0]!.kind).toBe("removed")
    expect(changes[0]!.summary).toContain("vervallen")
  })

  test("removed+added same subject same day is 'moved'", () => {
    const before = lesson({ id: "1" })
    const after = lesson({
      id: "2",
      start: "2026-09-07T15:05:00.000+02:00",
      end: "2026-09-07T15:55:00.000+02:00",
      periodStart: 8,
      periodEnd: 8
    })
    const changes = diffLessons([before], [after], window)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe("moved")
    expect(changes[0]!.summary).toContain("6e uur → 8e uur")
  })

  test("a day going from nothing to many lessons is one 'published' event", () => {
    const day = (id: string, h: number) =>
      lesson({ id, start: `2026-10-05T${h}:15:00.000+02:00`, end: `2026-10-05T${h + 1}:05:00.000+02:00` })
    const changes = diffLessons([], [day("a", 8), day("b", 9), day("c", 10), day("d", 11)], window)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe("published")
  })

  test("dates outside the window are ignored", () => {
    const changes = diffLessons([lesson({ id: "1" })], [], { from: "2026-09-08", until: "2026-12-01" })
    expect(changes).toEqual([])
  })
})
