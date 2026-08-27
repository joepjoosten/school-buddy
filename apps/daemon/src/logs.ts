/**
 * `school-buddy logs` — show recent lines from the daemon log.
 *
 * The Effect logger prints time-only timestamps like `[13:44:46.015] INFO ...`,
 * so we reconstruct dates relative to now (handling the midnight wrap) and
 * keep continuation lines with the entry they belong to.
 */

const LOG_FILE = `${process.env.HOME}/.school-buddy/daemon.log`
const MAX_BYTES = 5 * 1024 * 1024

const TIMESTAMP = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/

const lineTimestamp = (line: string, now: Date): number | null => {
  const m = TIMESTAMP.exec(line)
  if (m === null) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]))
  // a time "later than now" must be from yesterday (midnight wrap)
  if (d.getTime() > now.getTime() + 60_000) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export const showLogs = async (minutes: number, tail: boolean): Promise<void> => {
  const file = Bun.file(LOG_FILE)
  if (!(await file.exists())) {
    console.error(`Geen logbestand gevonden (${LOG_FILE}). Draait de daemon via launchd?`)
    process.exit(1)
  }

  // only read the tail of a large log
  const size = file.size
  const slice = size > MAX_BYTES ? file.slice(size - MAX_BYTES) : file
  const text = await slice.text()

  const now = new Date()
  const cutoff = now.getTime() - minutes * 60_000

  let include = false
  let shown = 0
  for (const line of text.split("\n")) {
    const ts = lineTimestamp(line, now)
    // continuation lines (no timestamp) belong to the previous entry
    if (ts !== null) include = ts >= cutoff
    if (include && line.length > 0) {
      console.log(line)
      shown++
    }
  }

  if (shown === 0 && !tail) {
    console.log(`Geen logregels in de laatste ${minutes} minuten (${LOG_FILE}).`)
  }

  if (!tail) return

  // follow mode: keep printing whatever gets appended (Ctrl-C to stop)
  console.log(`--- volgen van ${LOG_FILE} (Ctrl-C om te stoppen) ---`)
  let offset = size
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const current = Bun.file(LOG_FILE)
    if (!(await current.exists())) continue
    const currentSize = current.size
    if (currentSize < offset) offset = 0 // log rotated/truncated
    if (currentSize > offset) {
      process.stdout.write(await current.slice(offset, currentSize).text())
      offset = currentSize
    }
  }
}
