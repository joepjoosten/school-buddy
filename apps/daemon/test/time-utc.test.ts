// `bun test` pins TZ=UTC for reproducibility; these helpers are about the
// student's local time, so the school timezone is set explicitly here.
process.env.SCHOOL_BUDDY_TZ = "Europe/Amsterdam"

import {
  addDays,
  dayStartInstant,
  isoWeek,
  localDay,
  localMinutes,
  localTime,
  mondayOf,
  weekBoundsOf
} from "@school-buddy/shared"
import { describe, expect, test } from "bun:test"

describe("UTC instants rendered locally (Europe/Amsterdam)", () => {
  const lesson = "2026-09-01T09:05:00.000Z" // 11:05 local in CEST

  test("localTime shows wall-clock time, not the UTC hour", () => {
    expect(localTime(lesson)).toBe("11:05")
  })

  test("localDay is the student's calendar day", () => {
    expect(localDay(lesson)).toBe("2026-09-01")
    // 23:30 local on 1 Sept is 21:30Z the same day
    expect(localDay("2026-09-01T21:30:00.000Z")).toBe("2026-09-01")
    // 00:30 local on 2 Sept is 22:30Z on 1 Sept — still the 2nd locally
    expect(localDay("2026-09-01T22:30:00.000Z")).toBe("2026-09-02")
  })

  test("localMinutes positions a lesson on the day grid", () => {
    expect(localMinutes(lesson)).toBe(11 * 60 + 5)
  })

  test("dayStartInstant round-trips a local day", () => {
    expect(localDay(dayStartInstant("2026-09-01"))).toBe("2026-09-01")
    // local midnight in CEST is 22:00Z the day before
    expect(dayStartInstant("2026-09-01")).toBe("2026-08-31T22:00:00.000Z")
  })

  test("addDays crosses the DST change correctly", () => {
    expect(addDays("2026-09-01", 1)).toBe("2026-09-02")
    // CEST -> CET happens in the night of 25 October 2026
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26")
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01")
  })
})

describe("ISO weeks", () => {
  test("mondayOf finds the start of the week", () => {
    expect(mondayOf("2026-09-01")).toBe("2026-08-31") // Tuesday -> Monday
    expect(mondayOf("2026-08-31")).toBe("2026-08-31") // Monday maps to itself
    expect(mondayOf("2026-09-06")).toBe("2026-08-31") // Sunday belongs to that week
  })

  test("week numbers follow ISO-8601, including year boundaries", () => {
    expect(isoWeek("2026-09-01")).toEqual({ year: 2026, week: 36 })
    // 1 Jan 2027 is a Friday: still week 53 of 2026
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 })
    // 29 Dec 2025 is a Monday: already week 1 of 2026
    expect(isoWeek("2025-12-29")).toEqual({ year: 2026, week: 1 })
  })

  test("weekBoundsOf spans Monday to the next Monday", () => {
    expect(weekBoundsOf("2026-09-01")).toEqual({
      year: 2026,
      week: 36,
      monday: "2026-08-31",
      nextMonday: "2026-09-07"
    })
  })

  test("week bounds stay correct across the DST switch", () => {
    // CEST -> CET in the night of 25 October 2026
    expect(weekBoundsOf("2026-10-26").monday).toBe("2026-10-26")
    expect(weekBoundsOf("2026-10-25").monday).toBe("2026-10-19")
    expect(weekBoundsOf("2026-10-19").nextMonday).toBe("2026-10-26")
  })
})
