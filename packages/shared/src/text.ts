/**
 * The planner is told to leave the course out of a session title, because the
 * UI shows it separately. Sessions planned by earlier versions still carry a
 * prefix like "Biol " or "fatl: ", so it is stripped when rendering.
 */
export const stripSubjectPrefix = (title: string, ...subjects: ReadonlyArray<string>): string => {
  for (const subject of subjects) {
    const s = subject.trim()
    if (s === "") continue
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = new RegExp(`^${escaped}\\s*[:–-]?\\s+`, "i").exec(title)
    if (match !== null && match[0].length < title.length) {
      return title.slice(match[0].length)
    }
  }
  return title
}
