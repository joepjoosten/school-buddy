import type { RosterChange } from "@school-buddy/shared"
import { useEffect, useState } from "react"
import { fetchRosterChanges, runEffect } from "./api.ts"

const KIND_LABEL: Record<RosterChange["kind"], string> = {
  added: "extra",
  removed: "vervallen",
  changed: "gewijzigd",
  moved: "verplaatst",
  published: "gepubliceerd"
}

const fmt = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getDate()}-${d.getMonth() + 1} ${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`
}

export const ChangesPage = () => {
  const [changes, setChanges] = useState<ReadonlyArray<RosterChange> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = () =>
    runEffect(fetchRosterChanges()).then(setChanges, (e) => setError(String(e)))
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="changes-page">
      <div className="row logs-toolbar">
        <strong>Roosterwijzigingen</strong>
        <span className="hint">
          Gedetecteerd door elke Somtoday-sync te vergelijken met de vorige.
        </span>
        <button type="button" onClick={() => void load()}>Verversen</button>
        <a href="#instellingen">← instellingen</a>
      </div>
      {error !== null && <p className="error">{error}</p>}
      {changes !== null && changes.length === 0 && (
        <p className="hint">Nog geen wijzigingen gedetecteerd.</p>
      )}
      {changes !== null && changes.length > 0 && (
        <table className="changes">
          <thead>
            <tr>
              <th>gedetecteerd</th>
              <th>soort</th>
              <th>dag</th>
              <th>wijziging</th>
              <th>gemeld</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <td>{fmt(c.detectedAt)}</td>
                <td><span className={`kind kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span></td>
                <td>{c.date}</td>
                <td>
                  {c.summary}
                  {open === c.id && (c.before !== null || c.after !== null) && (
                    <pre className="change-json">
                      {JSON.stringify({ before: c.before, after: c.after }, null, 2)}
                    </pre>
                  )}
                </td>
                <td>{c.notified ? "✅" : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
