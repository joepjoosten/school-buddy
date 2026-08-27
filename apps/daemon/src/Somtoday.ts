import type { HomeworkItem, Lesson, School } from "@school-buddy/shared"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
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

export interface SomtodayShape {
  readonly isAuthenticated: Effect.Effect<boolean>
  /** Sync roster + homework into the store for a rolling window. */
  readonly sync: Effect.Effect<void, SomtodayError>
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

const mapAfspraak = (item: Record<string, unknown>): Lesson | null => {
  const additional = (item["additionalObjects"] ?? {}) as Record<string, unknown>
  const start = asString(item["beginDatumTijd"])
  const end = asString(item["eindDatumTijd"])
  const id = item["links"] !== undefined
    ? String(((item["links"] as Array<Record<string, unknown>>)[0] ?? {})["id"] ?? "")
    : ""
  if (start === null || end === null || id === "") return null
  const subject = asString(additional["vak"] !== undefined
    ? ((additional["vak"] as Record<string, unknown>)["afkorting"] ?? null)
    : null) ?? asString(item["titel"]) ?? "les"
  return {
    id,
    subject,
    title: asString(item["titel"]) ?? subject,
    location: asString(item["locatie"]),
    teacher: asString(additional["docentAfkortingen"]),
    start,
    end,
    cancelled: false
  }
}

const mapHomework = (item: Record<string, unknown>): HomeworkItem | null => {
  const id = item["links"] !== undefined
    ? String(((item["links"] as Array<Record<string, unknown>>)[0] ?? {})["id"] ?? "")
    : ""
  const studiewijzerItem = (item["studiewijzerItem"] ?? {}) as Record<string, unknown>
  const dueRaw = asString(item["datumTijd"])
  if (id === "" || dueRaw === null) return null
  const description = (asString(studiewijzerItem["omschrijving"]) ?? "")
    .replace(/<[^>]+>/g, "")
    .trim()
  if (description === "") return null
  return {
    id: `somtoday-${id}`,
    subject: asString(studiewijzerItem["onderwerp"]) ?? "onbekend",
    dueDate: dueRaw.slice(0, 10),
    description,
    source: "somtoday",
    lessonId: null,
    done: false,
    createdAt: new Date().toISOString()
  }
}

const makeSomtoday = Effect.gen(function* () {
  const store = yield* Store

  const refreshAccessToken: Effect.Effect<
    { accessToken: string; apiUrl: string },
    SomtodayError
  > = Effect.gen(function* () {
    const refreshToken = yield* keychainGet(KC_REFRESH)
    if (refreshToken === null) {
      return yield* new SomtodayError({
        reason: "unauthenticated",
        detail: "no refresh token stored — run the setup flow"
      })
    }
    const tokens = yield* tokenRequest({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken
    })
    // Somtoday rotates refresh tokens: always persist the newest one.
    yield* persistTokens(tokens)
    return { accessToken: tokens.access_token, apiUrl: tokens.somtoday_api_url }
  })

  const apiGet = (
    auth: { accessToken: string; apiUrl: string },
    path: string,
    params: Record<string, string>
  ): Effect.Effect<RestPage, SomtodayError> =>
    Effect.tryPromise({
      try: async () => {
        const url = `${auth.apiUrl}/rest/v1/${path}?${new URLSearchParams(params)}`
        const res = await fetch(url, {
          headers: {
            authorization: `Bearer ${auth.accessToken}`,
            accept: "application/json",
            range: "items=0-100"
          }
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

  const sync: Effect.Effect<void, SomtodayError> = Effect.gen(function* () {
    const auth = yield* refreshAccessToken
    // rolling window: last week's Monday until 3 weeks ahead
    const from = toDateOnly(addDays(mondayOf(new Date()), -7))
    const to = toDateOnly(addDays(mondayOf(new Date()), 28))

    const afspraken = yield* apiGet(auth, "afspraken", {
      begindatum: from,
      einddatum: to,
      additional: "vak"
    })
    const lessons = afspraken.items
      .map(mapAfspraak)
      .filter((l): l is Lesson => l !== null)
    yield* store.replaceLessons(lessons, from, to)

    const huiswerk = yield* apiGet(auth, "studiewijzeritemafspraaktoekenningen", {
      begintNaOfOp: from
    })
    const items = huiswerk.items
      .map(mapHomework)
      .filter((h): h is HomeworkItem => h !== null)
    yield* store.upsertSomtodayHomework(items)

    yield* store.setMeta("somtoday.lastSync", new Date().toISOString())
  })

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
