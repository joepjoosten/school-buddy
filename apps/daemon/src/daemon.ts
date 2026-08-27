import { BunHttpServer } from "@effect/platform-bun"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { HttpRouter, HttpStaticServer } from "effect/unstable/http"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { ApiLive } from "./ApiLive.ts"
import { ChatStubLive } from "./Chat.ts"
import { SchedulerLive } from "./Scheduler.ts"
import { SomtodayLive } from "./Somtoday.ts"
import { StoreLive } from "./Store.ts"

/** The daemon as an Effect: launches the server + scheduler and never returns. */
export const daemonEffect = (): Effect.Effect<never> => {
  const port = Number(process.env["SCHOOL_BUDDY_PORT"] ?? 4823)
  const dataDir = `${process.env["HOME"]}/.school-buddy`
  // Web asset resolution: explicit env var → `web/` next to the executable
  // (release install layout) → the dev workspace path. The execPath fallback
  // means a release binary also works when started by hand without env vars.
  const besideExecutable = join(dirname(process.execPath), "web")
  const webDist = process.env["SCHOOL_BUDDY_WEB_DIR"] ??
    (existsSync(join(besideExecutable, "index.html"))
      ? besideExecutable
      : new URL("../../web/dist", import.meta.url).pathname)
  if (!existsSync(join(webDist, "index.html"))) {
    console.warn(`⚠️  Geen web-app gevonden in ${webDist} — de rooster-pagina geeft 404.`)
  }

  // data dir must exist before SQLite opens its file
  mkdirSync(dataDir, { recursive: true })

  const SqlLive = SqliteClient.layer({ filename: `${dataDir}/school-buddy.sqlite` })

  const AppServices = Layer.provideMerge(
    Layer.mergeAll(SomtodayLive, ChatStubLive),
    StoreLive.pipe(Layer.provide(SqlLive))
  )

  const WebLive = HttpStaticServer.layer({
    root: webDist,
    index: "index.html",
    spa: true
  })

  const MainLive = HttpRouter.serve(
    Layer.mergeAll(ApiLive, WebLive)
  ).pipe(
    Layer.provide(BunHttpServer.layer({ port, hostname: "127.0.0.1" })),
    Layer.provide(AppServices),
    Layer.merge(SchedulerLive.pipe(Layer.provide(AppServices)))
  )

  return Layer.launch(MainLive).pipe(
    Effect.tap(() => Effect.log(`school-buddy daemon on http://127.0.0.1:${port}`)),
    Effect.orDie
  )
}
