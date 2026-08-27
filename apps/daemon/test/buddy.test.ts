import type { Settings } from "@school-buddy/shared"
import { describe, expect, test } from "bun:test"
import { isQuietTime } from "../src/Buddy.ts"

const at = (hh: number, mm: number): Date => new Date(2026, 7, 27, hh, mm)

describe("isQuietTime", () => {
  const wrapping: Settings = { promptsEnabled: true, quietStart: "21:00", quietEnd: "07:30" }

  test("quiet window wrapping midnight", () => {
    expect(isQuietTime(wrapping, at(22, 0))).toBe(true)
    expect(isQuietTime(wrapping, at(2, 0))).toBe(true)
    expect(isQuietTime(wrapping, at(7, 29))).toBe(true)
    expect(isQuietTime(wrapping, at(7, 30))).toBe(false)
    expect(isQuietTime(wrapping, at(12, 0))).toBe(false)
    expect(isQuietTime(wrapping, at(20, 59))).toBe(false)
    expect(isQuietTime(wrapping, at(21, 0))).toBe(true)
  })

  test("quiet window within one day", () => {
    const daytime: Settings = { promptsEnabled: true, quietStart: "12:00", quietEnd: "13:00" }
    expect(isQuietTime(daytime, at(12, 30))).toBe(true)
    expect(isQuietTime(daytime, at(11, 59))).toBe(false)
    expect(isQuietTime(daytime, at(13, 0))).toBe(false)
  })
})
