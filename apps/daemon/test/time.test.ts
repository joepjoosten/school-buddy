import { describe, expect, test } from "bun:test"
import { addDays, isoWeek, mondayOf, toDateOnly, weekBoundsOf } from "../src/time.ts"

describe("time helpers", () => {
  test("mondayOf returns the Monday of the week", () => {
    // 2026-08-27 is a Thursday; its Monday is 2026-08-24
    expect(toDateOnly(mondayOf(new Date(2026, 7, 27)))).toBe("2026-08-24")
    // a Monday maps to itself
    expect(toDateOnly(mondayOf(new Date(2026, 7, 24)))).toBe("2026-08-24")
    // a Sunday belongs to the week started the previous Monday
    expect(toDateOnly(mondayOf(new Date(2026, 7, 30)))).toBe("2026-08-24")
  })

  test("isoWeek computes ISO week numbers", () => {
    expect(isoWeek(new Date(2026, 7, 27))).toEqual({ year: 2026, week: 35 })
    // ISO edge: Jan 1st 2027 (Friday) is week 53 of 2026
    expect(isoWeek(new Date(2027, 0, 1))).toEqual({ year: 2026, week: 53 })
    // Dec 29th 2025 (Monday) is week 1 of 2026
    expect(isoWeek(new Date(2025, 11, 29))).toEqual({ year: 2026, week: 1 })
  })

  test("weekBoundsOf returns Monday..nextMonday", () => {
    expect(weekBoundsOf("2026-08-27")).toEqual({
      year: 2026,
      week: 35,
      monday: "2026-08-24",
      nextMonday: "2026-08-31"
    })
  })

  test("addDays crosses month boundaries", () => {
    expect(toDateOnly(addDays(new Date(2026, 7, 31), 1))).toBe("2026-09-01")
  })
})
