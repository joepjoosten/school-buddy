import { compareVersions, isNewerVersion } from "@school-buddy/shared"
import { describe, expect, test } from "bun:test"

describe("version comparison", () => {
  test("orders releases numerically, not lexically", () => {
    expect(compareVersions("v0.9.0", "v0.10.0")).toBeLessThan(0)
    expect(compareVersions("v0.17.1", "v0.17.0")).toBeGreaterThan(0)
    expect(compareVersions("v0.17.0", "v0.17.0")).toBe(0)
    expect(compareVersions("v1.0.0", "v0.99.9")).toBeGreaterThan(0)
  })

  test("a stale older 'latest' is not an update", () => {
    // the reported case: running v0.17.1 with v0.17.0 still stored
    expect(isNewerVersion("v0.17.1", "v0.17.0")).toBe(false)
    expect(isNewerVersion("v0.17.0", "v0.17.1")).toBe(true)
    expect(isNewerVersion("v0.17.1", "v0.17.1")).toBe(false)
  })

  test("dev installs and unknown latest never claim an update", () => {
    expect(isNewerVersion("dev", "v9.9.9")).toBe(false)
    expect(isNewerVersion("v0.17.1", null)).toBe(false)
  })
})
