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
      }
    })
    if (!res.ok) return null
    return (await res.json()) as Release
  } catch {
    return null
  }
}

/** Latest release tag on GitHub, or null when it cannot be determined. */
export const fetchLatestVersion = async (): Promise<string | null> =>
  (await fetchLatestRelease())?.tag_name ?? null

/** CLI: `school-buddy update [--check]` */
export const runUpdate = async (checkOnly: boolean): Promise<void> => {
  console.log(`Huidige versie: ${VERSION}`)
  const release = await fetchLatestRelease()
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
  const asset = release.assets.find((a) => a.name === `${pkg}.tar.gz`)
  if (!asset) {
    console.error(`Release ${latest} heeft geen asset ${pkg}.tar.gz.`)
    process.exit(1)
  }

  const token = await getToken()
  const tmp = mkdtempSync(join(tmpdir(), "school-buddy-update-"))
  const tarball = join(tmp, `${pkg}.tar.gz`)

  console.log(`Downloaden: ${asset.browser_download_url}`)
  // with a token, download through the API (works on private repos)
  const res = token !== null
    ? await fetch(asset.url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/octet-stream" }
    })
    : await fetch(asset.browser_download_url)
  if (!res.ok) {
    console.error(`Download mislukt (${res.status}).`)
    process.exit(1)
  }
  await Bun.write(tarball, res)

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
