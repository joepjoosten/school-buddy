/**
 * One-time Somtoday login for schools with Microsoft SSO.
 *
 * Preferred path (daemon running + SomtodayCallback.app installed): open the
 * authorize URL, the student logs in via Microsoft, the browser hands the
 * somtoday:// redirect to the callback app, which posts it to the daemon —
 * fully automatic. This CLI then just waits until the daemon reports
 * "authenticated". Fallback: paste the somtoday:// URL here manually.
 */
import * as Effect from "effect/Effect"
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  ORGANISATIES_URL,
  persistTokens
} from "./Somtoday.ts"

const DAEMON = `http://127.0.0.1:${process.env.SCHOOL_BUDDY_PORT ?? 4823}`

interface OrgSchool {
  uuid: string
  naam: string
  plaats: string
}

const pickSchool = async (schoolQuery: string): Promise<OrgSchool> => {
  console.log(`Looking up "${schoolQuery}" in Somtoday's organisation list...`)
  const res = await fetch(ORGANISATIES_URL)
  if (!res.ok) {
    console.error(`Could not fetch organisation list (${res.status})`)
    process.exit(1)
  }
  const data = (await res.json()) as Array<{ instellingen: Array<OrgSchool> }>
  const matches = data
    .flatMap((d) => d.instellingen)
    .filter((o) => o.naam.toLowerCase().includes(schoolQuery.toLowerCase()))
  if (matches.length === 0) {
    console.error(`No school found matching "${schoolQuery}".`)
    process.exit(1)
  }
  matches.forEach((m, i) => console.log(`  [${i}] ${m.naam} (${m.plaats})`))
  const pick = matches.length === 1
    ? 0
    : Number(prompt(`Which school? [0-${matches.length - 1}]`) ?? "0")
  const school = matches[pick]
  if (!school) {
    console.error("Invalid choice.")
    process.exit(1)
  }
  console.log(`Using: ${school.naam} (${school.uuid})`)
  return school
}

const daemonIsRunning = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${DAEMON}/api/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

const daemonIsAuthenticated = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${DAEMON}/api/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return false
    const health = (await res.json()) as { somtoday?: string }
    return health.somtoday === "authenticated"
  } catch {
    return false
  }
}

/** Flow via the daemon: automatic finish through SomtodayCallback.app. */
const setupViaDaemon = async (school: OrgSchool): Promise<void> => {
  const startRes = await fetch(`${DAEMON}/api/somtoday/connect/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uuid: school.uuid })
  })
  const { authorizeUrl } = (await startRes.json()) as { authorizeUrl: string }

  console.log(`\nDe browser wordt geopend. Log in met het Microsoft-schoolaccount.`)
  console.log(`Na het inloggen vraagt de browser om "SomtodayCallback" te openen — sta dat toe.`)
  console.log(`De koppeling wordt dan automatisch afgerond.\n`)
  Bun.spawnSync(["open", authorizeUrl])
  console.log(`(Browser niet geopend? Plak dit zelf:)\n${authorizeUrl}\n`)

  process.stdout.write("Wachten op de koppeling")
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    if (await daemonIsAuthenticated()) {
      console.log(`\n✅ Somtoday is gekoppeld! De daemon synct nu vanzelf.`)
      return
    }
    process.stdout.write(".")
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log(`\nGeen koppeling binnen 5 minuten. Alternatief: plak de somtoday://-URL zelf.`)
  const redirected = prompt("Plak de somtoday://... URL hier:")?.trim()
  if (!redirected) process.exit(1)
  const finishRes = await fetch(`${DAEMON}/api/somtoday/connect/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirectUrl: redirected })
  })
  const result = (await finishRes.json()) as { ok: boolean; message: string | null }
  if (result.ok) console.log("✅ Somtoday is gekoppeld!")
  else {
    console.error(`❌ ${result.message}`)
    process.exit(1)
  }
}

/** Standalone fallback when the daemon is not running: paste-based flow. */
const setupStandalone = async (school: OrgSchool): Promise<void> => {
  const { verifier, challenge } = generatePkce()
  const url = buildAuthorizeUrl({ tenantUuid: school.uuid, challenge: await challenge })

  console.log(`\nOpening the browser. Log in with the Microsoft school account.`)
  console.log(`When the page ends at a failing somtoday:// link, copy that full URL.\n`)
  Bun.spawnSync(["open", url])
  console.log(`(If the browser did not open, paste this in it yourself:)\n${url}\n`)

  const redirected = prompt("Paste the somtoday://... URL here:")?.trim()
  if (!redirected) {
    console.error("No URL pasted.")
    process.exit(1)
  }
  const code = new URL(redirected).searchParams.get("code")
  if (!code) {
    console.error("That URL has no ?code= parameter — copy the complete redirect URL.")
    process.exit(1)
  }

  await Effect.runPromise(
    exchangeCode({ code, verifier }).pipe(
      Effect.tap((tokens) => persistTokens(tokens)),
      Effect.tap((tokens) =>
        Effect.sync(() => {
          console.log(`\n✅ Logged in. API: ${tokens.somtoday_api_url}`)
          console.log("Refresh token stored in the macOS Keychain (service: school-buddy).")
          console.log("The daemon will now sync on its next tick, or restart it.")
        })
      )
    )
  )
}

export const runSetup = async (schoolQuery: string | undefined): Promise<void> => {
  if (!schoolQuery) {
    console.error(`Usage: school-buddy setup "school name"`)
    process.exit(1)
  }
  const school = await pickSchool(schoolQuery)
  if (await daemonIsRunning()) {
    await setupViaDaemon(school)
  } else {
    console.log("(Daemon draait niet — handmatige flow.)")
    await setupStandalone(school)
  }
}
