/**
 * One-time Somtoday login for schools with Microsoft SSO.
 *
 * 1. Looks up the school's tenant UUID in Somtoday's public organisations list.
 * 2. Opens the Somtoday authorize URL in the default browser (PKCE).
 * 3. The student completes the Microsoft login there. The final redirect to
 *    somtoday://... fails in the browser — that is expected. Copy the full
 *    somtoday://... URL from the browser (address bar or network tab) and
 *    paste it here.
 * 4. Exchanges the code and stores the rotating refresh token in the Keychain.
 */
import * as Effect from "effect/Effect"
import { buildAuthorizeUrl, exchangeCode, generatePkce, persistTokens } from "./Somtoday.ts"

export const runSetup = async (schoolQuery: string | undefined): Promise<void> => {
  if (!schoolQuery) {
    console.error(`Usage: school-buddy setup "school name"`)
    process.exit(1)
  }

  console.log(`Looking up "${schoolQuery}" in Somtoday's organisation list...`)
  const res = await fetch("https://servers.somtoday.nl/organisaties.json")
  if (!res.ok) {
    console.error(`Could not fetch organisation list (${res.status})`)
    process.exit(1)
  }
  const data = (await res.json()) as Array<{
    instellingen: Array<{ uuid: string; naam: string; plaats: string }>
  }>
  const orgs = data.flatMap((d) => d.instellingen)
  const matches = orgs.filter((o) =>
    o.naam.toLowerCase().includes(schoolQuery.toLowerCase())
  )

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
