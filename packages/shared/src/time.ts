import * as DateTime from "effect/DateTime"

/**
 * Time convention: every instant is stored and transported as a UTC ISO
 * string ("2026-09-01T09:05:00.000Z"). Local time exists only for
 * presentation and for calendar days ("2026-09-01"), which are always the
 * student's local day. Convert with the helpers below — never slice an
 * instant string to get a time or a day.
 *
 * The zone is the machine's own zone (the student's laptop), unless
 * SCHOOL_BUDDY_TZ overrides it — handy in tests, which run with TZ=UTC.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined

const zone = (): DateTime.TimeZone => {
  const named = typeof process === "undefined" ? undefined : process?.env?.["SCHOOL_BUDDY_TZ"]
  return named === undefined || named === ""
    ? DateTime.zoneMakeLocal()
    : DateTime.zoneMakeNamedUnsafe(named)
}

const zoned = (iso: string): DateTime.Zoned =>
  DateTime.makeZonedUnsafe(iso, { timeZone: zone() })

/** Local calendar day ("YYYY-MM-DD") of a UTC instant. */
export const localDay = (iso: string): string => DateTime.formatIsoDate(zoned(iso))

/** Local wall-clock time ("HH:MM") of a UTC instant. */
export const localTime = (iso: string): string =>
  DateTime.format(zoned(iso), { hour: "2-digit", minute: "2-digit", hour12: false })

/** Minutes since local midnight of a UTC instant. */
export const localMinutes = (iso: string): number => {
  const parts = DateTime.toParts(zoned(iso))
  return parts.hour * 60 + parts.minute
}

/** Today's local calendar day. */
export const today = (): string => localDay(new Date().toISOString())

/** The instant at local midnight starting the given calendar day. */
export const dayStartInstant = (day: string): string =>
  DateTime.formatIso(
    DateTime.toUtc(
      DateTime.makeZonedUnsafe(`${day}T00:00:00`, { timeZone: zone(), adjustForTimeZone: true })
    )
  )

/** Shift a calendar day by a number of days. */
export const addDays = (day: string, days: number): string =>
  localDay(
    DateTime.formatIso(
      DateTime.toUtc(DateTime.add(zoned(dayStartInstant(day)), { days }))
    )
  )
