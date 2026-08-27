// ISO-8601 week helpers (Europe/Amsterdam local time is assumed process-wide;
// the daemon runs on the student's laptop, so local time is school time).

export const toDateOnly = (d: Date): string => {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${y}-${m}-${day}`
}

export const parseDateOnly = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** Monday 00:00 local time of the week containing `date`. */
export const mondayOf = (date: Date): Date => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - dow)
  return d
}

export const addDays = (date: Date, days: number): Date => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** ISO week number + ISO week-year for a date. */
export const isoWeek = (date: Date): { year: number; week: number } => {
  // Thursday of the current week decides the ISO year
  const thursday = addDays(mondayOf(date), 3)
  const year = thursday.getFullYear()
  const jan1 = new Date(year, 0, 1)
  const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return { year, week }
}

export const weekBoundsOf = (dateStr: string): {
  year: number
  week: number
  monday: string
  /** exclusive end: the following Monday */
  nextMonday: string
} => {
  const date = parseDateOnly(dateStr)
  const monday = mondayOf(date)
  const { week, year } = isoWeek(date)
  return {
    year,
    week,
    monday: toDateOnly(monday),
    nextMonday: toDateOnly(addDays(monday, 7))
  }
}
