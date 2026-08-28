import * as Effect from "effect/Effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { keychainGet } from "./Keychain.ts"
import { VERSION } from "./version.ts"

export const REPO = "joepjoosten/school-buddy"

/**
 * Optional GitHub token, needed while the repo is private. Sources:
 * env GITHUB_TOKEN, or Keychain (service "school-buddy", account "github.token"):
 *   security add-generic-password -s school-buddy -a github.token -w <token>
 */
const getToken = async (): Promise<string | null> =>
  process.env.GITHUB_TOKEN ?? (await Effect.runPromise(keychainGet("github.token")))

interface ReleaseAsset {
  readonly name: string
  /** API url, used with a token (asset downloads on private repos) */
  readonly url: string
  readonly browser_download_url: string
}

interface Release {
  readonly tag_name: string
  readonly assets: ReadonlyArray<ReleaseAsset>
}

const fetchLatestRelease = async (): Promise<Release | null> => {
  try {
    const token = await getToken()
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token !== null ? { authorization: `Bearer ${token}` } : {})
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    return (await res.json()) as Release
  } catch {
    return null
  }
}

/**
 * Download with manual redirect handling. Bun's automatic redirect following
 * hangs on GitHub's release-asset CDN redirect (observed with Bun 1.3), and
 * auth headers must not be forwarded to the CDN host anyway.
 */
export const download = async (
  url: string,
  headers: Record<string, string>
): Promise<Response> => {
  let current = url
  let currentHeaders = headers
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, {
      headers: currentHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(120_000)
    })
    const location = res.headers.get("location")
    if (res.status >= 300 && res.status < 400 && location !== null) {
      current = new URL(location, current).toString()
      currentHeaders = {} // drop auth for the CDN host
      continue
    }
    return res
  }
  throw new Error("te veel redirects")
}

/**
 * Latest tag via the website redirect (github.com/<repo>/releases/latest →
 * /releases/tag/<tag>). Not subject to the API rate limit (60/h per IP),
 * which the daily checks + manual checks from one network can exhaust.
 */
const fetchLatestTagViaRedirect = async (): Promise<string | null> => {
  try {
    const res = await fetch(`https://github.com/${REPO}/releases/latest`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    })
    const location = res.headers.get("location") ?? ""
    const match = /\/releases\/tag\/([^/?#]+)/.exec(location)
    return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/** Latest release tag on GitHub, or null when it cannot be determined. */
export const fetchLatestVersion = async (): Promise<string | null> => {
  const token = await getToken()
  if (token !== null) {
    const viaApi = (await fetchLatestRelease())?.tag_name ?? null
    if (viaApi !== null) return viaApi
  }
  return fetchLatestTagViaRedirect()
}

/**
 * Start the updater as a detached one-shot launchd job, so it survives the
 * daemon restart that the installer performs (a plain child process would be
 * killed together with the daemon's process group at `launchctl bootout`).
 */
export const startDetachedUpdate = (): { ok: boolean; message: string | null } => {
  if (VERSION === "dev") {
    return { ok: false, message: "Development-installatie — gebruik git pull." }
  }
  const log = `${process.env.HOME}/.school-buddy/update.log`
  Bun.spawnSync(["launchctl", "remove", "nl.schoolbuddy.update"], {
    stdout: "ignore",
    stderr: "ignore"
  })
  const res = Bun.spawnSync([
    "launchctl", "submit", "-l", "nl.schoolbuddy.update",
    "-o", log, "-e", log,
    "--", process.execPath, "update"
  ])
  if (res.exitCode !== 0) {
    return { ok: false, message: "Kon de updater niet starten via launchd." }
  }
  return { ok: true, message: "Update gestart — de daemon herstart zodadelijk." }
}

/** CLI: `school-buddy update [--check]` */
export const runUpdate = async (checkOnly: boolean): Promise<void> => {
  console.log(`Huidige versie: ${VERSION}`)
  const token = await getToken()
  // public repo: website redirect + direct download URL, no API calls at all
  const release: Release | null = token !== null
    ? await fetchLatestRelease()
    : await (async () => {
      const tag = await fetchLatestTagViaRedirect()
      return tag === null ? null : { tag_name: tag, assets: [] }
    })()
  if (release === null) {
    console.error(
      "Kan de nieuwste versie niet ophalen van GitHub.\n" +
        "Is de repo privé? Zet dan een (fine-grained, read-only) token in de Keychain:\n" +
        `  security add-generic-password -s school-buddy -a github.token -w <token>`
    )
    process.exit(1)
  }
  const latest = release.tag_name
  console.log(`Nieuwste versie: ${latest}`)
  if (latest === VERSION) {
    console.log("✅ Al up-to-date.")
    return
  }
  if (checkOnly) {
    console.log(`⬆️  Update beschikbaar: ${VERSION} → ${latest}`)
    return
  }
  if (VERSION === "dev") {
    console.log("Dit is een development-installatie — gebruik `git pull`.")
    return
  }

  const arch = process.arch === "arm64" ? "arm64" : "x64"
  const pkg = `school-buddy-${latest}-darwin-${arch}`
  const directUrl = `https://github.com/${REPO}/releases/download/${latest}/${pkg}.tar.gz`
  const asset = release.assets.find((a) => a.name === `${pkg}.tar.gz`)
  if (token !== null && asset === undefined) {
    console.error(`Release ${latest} heeft geen asset ${pkg}.tar.gz.`)
    process.exit(1)
  }

  const tmp = mkdtempSync(join(tmpdir(), "school-buddy-update-"))
  const tarball = join(tmp, `${pkg}.tar.gz`)

  console.log(`Downloaden: ${directUrl}`)
  // with a token, download through the API (works on private repos)
  const res = token !== null && asset !== undefined
    ? await download(asset.url, {
      authorization: `Bearer ${token}`,
      accept: "application/octet-stream"
    })
    : await download(directUrl, {})
  if (!res.ok) {
    console.error(`Download mislukt (${res.status}).`)
    process.exit(1)
  }
  // read fully before writing: Bun.write(path, response) hangs on this stream
  await Bun.write(tarball, await res.arrayBuffer())

  const untar = Bun.spawnSync(["tar", "-xzf", tarball, "-C", tmp])
  if (untar.exitCode !== 0) {
    console.error("Uitpakken mislukt.")
    process.exit(1)
  }

  console.log("Installeren...")
  const install = Bun.spawnSync(["bash", join(tmp, pkg, "install.sh")], {
    stdout: "inherit",
    stderr: "inherit"
  })
  if (install.exitCode !== 0) {
    console.error("Installatie mislukt.")
    process.exit(1)
  }
  console.log(`✅ Geüpdatet naar ${latest}.`)
}
