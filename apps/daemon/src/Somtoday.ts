import type { HomeworkItem, Lesson, School } from "@school-buddy/shared"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import { keychainGet, keychainSet } from "./Keychain.ts"
import { Store } from "./Store.ts"
import { addDays, mondayOf, toDateOnly } from "./time.ts"

// OAuth constants for the Somtoday student app (see RESEARCH.md §1).
// Note: the old UUID-style client ids were revoked in 2025; the native app id works.
export const AUTH_BASE = "https://inloggen.somtoday.nl"
export const CLIENT_ID = "somtoday-leerling-native"
export const REDIRECT_URI = "somtoday://nl.topicus.somtoday.leerling/oauth/callback"

// Topicus removed the official public school list (servers.somtoday.nl/organisaties.json);
// this community mirror is auto-regenerated from the login page and has the same shape.
export const ORGANISATIES_URL =
  "https://raw.githubusercontent.com/NONtoday/organisaties.json/refs/heads/main/organisaties.json"

const KC_REFRESH = "somtoday.refresh_token"
const KC_API_URL = "somtoday.api_url"

export class SomtodayError extends Data.TaggedError("SomtodayError")<{
  readonly reason: "unauthenticated" | "http" | "network"
  readonly detail: string
}> {}

export interface TokenResponse {
  readonly access_token: string
  readonly refresh_token: string
  readonly somtoday_api_url: string
  readonly expires_in: number
}

// --- PKCE helpers (used by the one-time setup flow) ------------------------

export const generatePkce = (): { verifier: string; challenge: Promise<string> } => {
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  const verifier = Buffer.from(bytes).toString("base64url")
  const challenge = crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(verifier))
    .then((digest) => Buffer.from(digest).toString("base64url"))
  return { verifier, challenge }
}

export const buildAuthorizeUrl = (options: {
  readonly tenantUuid: string
  readonly challenge: string
}): string => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    state: crypto.randomUUID().slice(0, 8),
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    tenant_uuid: options.tenantUuid,
    session: "no_session"
  })
  return `${AUTH_BASE}/oauth2/authorize?${params}`
}

const tokenRequest = (
  body: Record<string, string>
): Effect.Effect<TokenResponse, SomtodayError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${AUTH_BASE}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString()
      })
      if (!res.ok) {
        const text = await res.text()
        throw new SomtodayError({
          reason: res.status === 400 || res.status === 401 ? "unauthenticated" : "http",
          detail: `token endpoint ${res.status}: ${text.slice(0, 300)}`
        })
      }
      return (await res.json()) as TokenResponse
    },
    catch: (e) =>
      e instanceof SomtodayError
        ? e
        : new SomtodayError({ reason: "network", detail: String(e) })
  })

export const exchangeCode = (options: {
  readonly code: string
  readonly verifier: string
}): Effect.Effect<TokenResponse, SomtodayError> =>
  tokenRequest({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code: options.code,
    code_verifier: options.verifier
  })

export const persistTokens = (tokens: TokenResponse): Effect.Effect<void> =>
  Effect.all([
    keychainSet(KC_REFRESH, tokens.refresh_token),
    keychainSet(KC_API_URL, tokens.somtoday_api_url)
  ]).pipe(Effect.asVoid)

// --- Service ---------------------------------------------------------------

export interface SyncResult {
  readonly lessons: number
  readonly homework: number
  readonly changes: number
}

export interface SomtodayShape {
  readonly isAuthenticated: Effect.Effect<boolean>
  /** Sync roster + homework into the store for a rolling window. */
  readonly sync: Effect.Effect<SyncResult, SomtodayError>
  /** Search schools in Somtoday's public organisation list. */
  readonly searchSchools: (query: string) => Effect.Effect<Array<School>, SomtodayError>
  /** Begin the browser connect flow: returns the authorize URL to open. */
  readonly connectStart: (schoolUuid: string) => Effect.Effect<string>
  /** Finish the connect flow with the pasted somtoday:// redirect URL. */
  readonly connectFinish: (redirectUrl: string) => Effect.Effect<void, SomtodayError>
}

export class Somtoday extends Context.Service<Somtoday, SomtodayShape>()("app/Somtoday") {}

interface RestPage {
  readonly items: ReadonlyArray<Record<string, unknown>>
}

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null)
const asNumber = (v: unknown): number | null => (typeof v === "number" ? v : null)

const asObject = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null

const linkId = (item: Record<string, unknown>): string => {
  const links = item["links"]
  if (!Array.isArray(links)) return ""
  const id = asObject(links[0])?.["id"]
  return id === undefined || id === null ? "" : String(id)
}

/**
 * Field shapes verified against the live API (2026-08): `additionalObjects.vak`
 * is often null; `titel` is "<locatie> - <omschrijving> - <docenten>".
 */
const mapAfspraak = (item: Record<string, unknown>): Lesson | null => {
  const additional = asObject(item["additionalObjects"]) ?? {}
  const start = asString(item["beginDatumTijd"])
  const end = asString(item["eindDatumTijd"])
  const id = linkId(item)
  if (start === null || end === null || id === "") return null
  const vak = asObject(additional["vak"])
  const titel = asString(item["titel"]) ?? "les"
  const parts = titel.split(" - ")
  const middle = parts.length >= 3 ? parts.slice(1, -1).join(" - ") : titel
  return {
    id,
    subject: asString(vak?.["afkorting"]) ?? middle,
    title: asString(vak?.["naam"]) ?? middle,
    location: asString(item["locatie"]),
    teacher: parts.length >= 3 ? (parts[parts.length - 1] ?? null) : null,
    start,
    end,
    cancelled: false,
    periodStart: asNumber(item["beginLesuur"]),
    periodEnd: asNumber(item["eindLesuur"])
  }
}

/** "vw4.biol1" → "biol": the lesgroep name carries the subject code. */
const subjectFromLesgroep = (lesgroep: unknown): string | null => {
  const naam = asString(asObject(lesgroep)?.["naam"])
  if (naam === null) return null
  const last = naam.split(".").at(-1) ?? naam
  const stripped = last.replace(/\d+$/, "")
  return stripped.length > 0 ? stripped : naam
}

const mapHomework = (item: Record<string, unknown>): HomeworkItem | null => {
  const id = linkId(item)
  const studiewijzerItem = asObject(item["studiewijzerItem"]) ?? {}
  const dueRaw = asString(item["datumTijd"])
  if (id === "" || dueRaw === null) return null
  const onderwerp = asString(studiewijzerItem["onderwerp"])
  const omschrijving = (asString(studiewijzerItem["omschrijving"]) ?? "")
    .replace(/<[^>]+>/g, "")
    .trim()
  const description = omschrijving !== "" ? omschrijving : onderwerp
  if (description === null || description === "") return null
  const huiswerkType = asString(studiewijzerItem["huiswerkType"])
  const prefix = huiswerkType !== null && huiswerkType.includes("TOETS") ? "[TOETS] " : ""
  return {
    id: `somtoday-${id}`,
    subject: subjectFromLesgroep(item["lesgroep"]) ?? onderwerp ?? "onbekend",
    dueDate: dueRaw.slice(0, 10),
    description: `${prefix}${description}`,
    source: "somtoday",
    lessonId: null,
    done: false,
    createdAt: new Date().toISOString(),
    kind: "unknown"
  }
}

const makeSomtoday = Effect.gen(function* () {
  const store = yield* Store

  // The refresh token is single-use (rotation), so refreshes must never run
  // concurrently, and the short-lived access token is cached to avoid burning
  // a rotation on every request.
  let cachedAuth: { accessToken: string; apiUrl: string; expiresAt: number } | null = null
  const refreshSemaphore = yield* Semaphore.make(1)

  const doRefresh = (refreshToken: string) =>
    tokenRequest({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken
    })

  const refreshAccessToken: Effect.Effect<
    { accessToken: string; apiUrl: string },
    SomtodayError
  > = refreshSemaphore.withPermits(1)(
    Effect.gen(function* () {
      if (cachedAuth !== null && Date.now() < cachedAuth.expiresAt - 60_000) {
        return cachedAuth
      }
      const refreshToken = yield* keychainGet(KC_REFRESH)
      if (refreshToken === null) {
        return yield* new SomtodayError({
          reason: "unauthenticated",
          detail: "no refresh token stored — run the setup flow"
        })
      }
      const tokens = yield* doRefresh(refreshToken).pipe(
        Effect.catchTag("SomtodayError", (error) => {
          if (error.reason !== "unauthenticated") return Effect.fail(error)
          // Another process (or a previous crash mid-rotation) may have
          // rotated the token already — re-read the Keychain and retry once.
          return Effect.gen(function* () {
            yield* Effect.sleep("1 second")
            const latest = yield* keychainGet(KC_REFRESH)
            if (latest === null || latest === refreshToken) {
              return yield* Effect.fail(error)
            }
            return yield* doRefresh(latest)
          })
        })
      )
      // Somtoday rotates refresh tokens: always persist the newest one.
      yield* persistTokens(tokens)
      cachedAuth = {
        accessToken: tokens.access_token,
        apiUrl: tokens.somtoday_api_url,
        expiresAt: Date.now() + tokens.expires_in * 1000
      }
      return cachedAuth
    })
  )

  const PAGE_SIZE = 100
  const MAX_PAGES = 60

  const apiGetPage = (
    auth: { accessToken: string; apiUrl: string },
    path: string,
    params: Record<string, string>,
    start: number
  ): Effect.Effect<RestPage, SomtodayError> =>
    Effect.tryPromise({
      try: async () => {
        const url = `${auth.apiUrl}/rest/v1/${path}?${new URLSearchParams(params)}`
        const res = await fetch(url, {
          headers: {
            authorization: `Bearer ${auth.accessToken}`,
            accept: "application/json",
            range: `items=${start}-${start + PAGE_SIZE - 1}`
          },
          signal: AbortSignal.timeout(30_000)
        })
        if (!res.ok) {
          throw new SomtodayError({
            reason: res.status === 401 ? "unauthenticated" : "http",
            detail: `${path} ${res.status}`
          })
        }
        return (await res.json()) as RestPage
      },
      catch: (e) =>
        e instanceof SomtodayError
          ? e
          : new SomtodayError({ reason: "network", detail: String(e) })
    })

  /** Follow the Range-header pagination until a page comes back short. */
  const apiGetAll = (
    auth: { accessToken: string; apiUrl: string },
    path: string,
    params: Record<string, string>
  ): Effect.Effect<Array<Record<string, unknown>>, SomtodayError> =>
    Effect.gen(function* () {
      const all: Array<Record<string, unknown>> = []
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = yield* apiGetPage(auth, path, params, page * PAGE_SIZE)
        const items = result.items ?? []
        all.push(...items)
        if (items.length < PAGE_SIZE) break
      }
      return all
    })

  const sync: Effect.Effect<SyncResult, SomtodayError> = Effect.gen(function* () {
    const auth = yield* refreshAccessToken
    // rolling window: two weeks back until ~a trimester (16 weeks) ahead
    const from = toDateOnly(addDays(mondayOf(new Date()), -14))
    const to = toDateOnly(addDays(mondayOf(new Date()), 16 * 7))

    const afspraken = yield* apiGetAll(auth, "afspraken", {
      begindatum: from,
      einddatum: to,
      additional: "vak"
    })
    const lessons = afspraken
      .map(mapAfspraak)
      .filter((l): l is Lesson => l !== null)
    const changes = yield* store.reconcileLessons(lessons, from, to)
    if (changes.length > 0) {
      yield* Effect.log(`roster changes: ${changes.map((c) => c.summary).join(" | ")}`)
    }

    const huiswerk = yield* apiGetAll(auth, "studiewijzeritemafspraaktoekenningen", {
      begintNaOfOp: from
    })
    const items = huiswerk
      .map(mapHomework)
      .filter((h): h is HomeworkItem => h !== null)
    yield* store.upsertSomtodayHomework(items)

    yield* store.setMeta("somtoday.lastSync", new Date().toISOString())
    return { lessons: lessons.length, homework: items.length, changes: changes.length }
  }).pipe(
    // a 401 from the API means the cached access token is no longer valid
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (error.reason === "unauthenticated") cachedAuth = null
      })
    )
  )

  // PKCE verifier for an in-flight web connect attempt (daemon-lifetime state)
  let pendingVerifier: string | null = null

  const shape: SomtodayShape = {
    isAuthenticated: keychainGet(KC_REFRESH).pipe(Effect.map((t) => t !== null)),
    sync,

    searchSchools: (query) =>
      Effect.tryPromise({
        try: async () => {
          const res = await fetch(ORGANISATIES_URL)
          if (!res.ok) {
            throw new SomtodayError({ reason: "http", detail: `organisaties ${res.status}` })
          }
          const data = (await res.json()) as Array<{
            instellingen: Array<{ uuid: string; naam: string; plaats: string }>
          }>
          const q = query.toLowerCase()
          return data
            .flatMap((d) => d.instellingen)
            .filter((o) => o.naam.toLowerCase().includes(q))
            .slice(0, 20)
            .map((o) => ({ uuid: o.uuid, naam: o.naam, plaats: o.plaats }))
        },
        catch: (e) =>
          e instanceof SomtodayError
            ? e
            : new SomtodayError({ reason: "network", detail: String(e) })
      }),

    connectStart: (schoolUuid) =>
      Effect.promise(async () => {
        const { verifier, challenge } = generatePkce()
        pendingVerifier = verifier
        return buildAuthorizeUrl({ tenantUuid: schoolUuid, challenge: await challenge })
      }),

    connectFinish: (redirectUrl) =>
      Effect.gen(function* () {
        const verifier = pendingVerifier
        if (verifier === null) {
          return yield* new SomtodayError({
            reason: "unauthenticated",
            detail: "geen lopende koppeling — begin opnieuw bij stap 1"
          })
        }
        const code = yield* Effect.try({
          try: () => new URL(redirectUrl.trim()).searchParams.get("code"),
          catch: () =>
            new SomtodayError({ reason: "unauthenticated", detail: "ongeldige URL" })
        })
        if (code === null) {
          return yield* new SomtodayError({
            reason: "unauthenticated",
            detail: "geen ?code= in de geplakte URL — kopieer de volledige somtoday://-URL"
          })
        }
        const tokens = yield* exchangeCode({ code, verifier })
        yield* persistTokens(tokens)
        pendingVerifier = null
      })
  }
  return shape
})

export const SomtodayLive = Layer.effect(Somtoday)(makeSomtoday)
