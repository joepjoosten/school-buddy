import type { Lesson, RosterChange } from "@school-buddy/shared"

/** A detected change before it gets an id / timestamp in the store. */
export type DetectedChange = Omit<RosterChange, "id" | "detectedAt" | "notified">

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"]
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

export const dayLabel = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number)
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  return `${DAYS[dt.getDay()]} ${dt.getDate()} ${MONTHS[dt.getMonth()]}`
}

const dateOf = (l: Lesson): string => l.start.slice(0, 10)
const timeOf = (iso: string): string => iso.slice(11, 16)

const periodLabel = (l: Lesson): string => {
  if (l.periodStart === null) return timeOf(l.start)
  return l.periodEnd !== null && l.periodEnd !== l.periodStart
    ? `${l.periodStart}e-${l.periodEnd}e uur`
    : `${l.periodStart}e uur`
}

const describe = (l: Lesson): string => `${l.subject} ${dayLabel(dateOf(l))} ${periodLabel(l)}`

const fieldDiffs = (a: Lesson, b: Lesson): Array<string> => {
  const diffs: Array<string> = []
  if (a.start !== b.start || a.end !== b.end) {
    diffs.push(`tijd ${timeOf(a.start)}–${timeOf(a.end)} → ${timeOf(b.start)}–${timeOf(b.end)}`)
  } else if (
    // only a real period change counts; null → value is just data that was
    // missing before (e.g. rows written by an older version)
    a.periodStart !== null && b.periodStart !== null &&
    (a.periodStart !== b.periodStart || a.periodEnd !== b.periodEnd)
  ) {
    diffs.push(`${periodLabel(a)} → ${periodLabel(b)}`)
  }
  if ((a.location ?? "") !== (b.location ?? "")) {
    diffs.push(`lokaal ${a.location || "?"} → ${b.location || "?"}`)
  }
  if ((a.teacher ?? "") !== (b.teacher ?? "")) {
    diffs.push(`docent ${a.teacher || "?"} → ${b.teacher || "?"}`)
  }
  if (a.subject !== b.subject || a.title !== b.title) {
    diffs.push(`les ${a.title} → ${b.title}`)
  }
  if (a.cancelled !== b.cancelled) diffs.push(b.cancelled ? "vervallen" : "gaat toch door")
  return diffs
}

/**
 * Compare the stored lessons with a fresh fetch, restricted to dates in
 * [from, until) — i.e. dates that were already synced before and are not in
 * the past. A day that goes from no lessons to several is reported as a
 * single "published" event rather than one "added" per lesson.
 */
export const diffLessons = (
  previous: ReadonlyArray<Lesson>,
  next: ReadonlyArray<Lesson>,
  window: { readonly from: string; readonly until: string }
): Array<DetectedChange> => {
  const inWindow = (l: Lesson) => dateOf(l) >= window.from && dateOf(l) < window.until
  const prev = new Map(previous.filter(inWindow).map((l) => [l.id, l] as const))
  const curr = new Map(next.filter(inWindow).map((l) => [l.id, l] as const))

  // per-date counts, to recognise freshly published days
  const prevPerDate = new Map<string, number>()
  for (const l of prev.values()) prevPerDate.set(dateOf(l), (prevPerDate.get(dateOf(l)) ?? 0) + 1)
  const currPerDate = new Map<string, number>()
  for (const l of curr.values()) currPerDate.set(dateOf(l), (currPerDate.get(dateOf(l)) ?? 0) + 1)
  const publishedDates = new Set(
    [...currPerDate.entries()]
      .filter(([date, n]) => (prevPerDate.get(date) ?? 0) === 0 && n >= 3)
      .map(([date]) => date)
  )

  const changes: Array<DetectedChange> = []
  const removed: Array<Lesson> = []
  const added: Array<Lesson> = []

  for (const [id, before] of prev) {
    const after = curr.get(id)
    if (after === undefined) {
      removed.push(before)
      continue
    }
    const diffs = fieldDiffs(before, after)
    if (diffs.length > 0) {
      changes.push({
        kind: "changed",
        date: dateOf(after),
        subject: after.subject,
        lessonId: id,
        summary: `${describe(before)}: ${diffs.join(", ")}`,
        before,
        after
      })
    }
  }
  for (const [id, after] of curr) {
    if (!prev.has(id) && !publishedDates.has(dateOf(after))) added.push(after)
  }

  // removed + added with the same subject on the same day → "moved"
  const remaining: Array<Lesson> = []
  for (const before of removed) {
    const i = added.findIndex((a) => a.subject === before.subject && dateOf(a) === dateOf(before))
    if (i === -1) {
      remaining.push(before)
      continue
    }
    const after = added[i]!
    added.splice(i, 1)
    changes.push({
      kind: "moved",
      date: dateOf(after),
      subject: after.subject,
      lessonId: after.id,
      summary: `${describe(before)} → ${periodLabel(after)}${
        after.location && after.location !== before.location ? ` (lokaal ${after.location})` : ""
      }`,
      before,
      after
    })
  }
  for (const before of remaining) {
    changes.push({
      kind: "removed",
      date: dateOf(before),
      subject: before.subject,
      lessonId: before.id,
      summary: `${describe(before)}: vervallen`,
      before,
      after: null
    })
  }
  for (const after of added) {
    changes.push({
      kind: "added",
      date: dateOf(after),
      subject: after.subject,
      lessonId: after.id,
      summary: `${describe(after)}: extra les${after.location ? ` in ${after.location}` : ""}`,
      before: null,
      after
    })
  }
  for (const date of [...publishedDates].sort()) {
    changes.push({
      kind: "published",
      date,
      subject: null,
      lessonId: null,
      summary: `rooster ${dayLabel(date)} gepubliceerd (${currPerDate.get(date)} lessen)`,
      before: null,
      after: null
    })
  }

  return changes.sort((a, b) => a.date.localeCompare(b.date))
}
