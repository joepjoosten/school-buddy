import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { HttpRouter, HttpStaticServer } from "effect/unstable/http"
import { mkdirSync } from "node:fs"
import { ApiLive } from "./ApiLive.ts"
import { ChatStubLive } from "./Chat.ts"
import { SchedulerLive } from "./Scheduler.ts"
import { SomtodayLive } from "./Somtoday.ts"
import { StoreLive } from "./Store.ts"

export const startDaemon = (): void => {
  const port = Number(process.env["SCHOOL_BUDDY_PORT"] ?? 4823)
  const dataDir = `${process.env["HOME"]}/.school-buddy`
  // In a compiled binary the web assets are next to the executable (set by the
  // release installer); in dev they live in the workspace.
  const webDist = process.env["SCHOOL_BUDDY_WEB_DIR"] ??
    new URL("../../web/dist", import.meta.url).pathname

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

  BunRuntime.runMain(
    Layer.launch(MainLive).pipe(
      Effect.tap(() => Effect.log(`school-buddy daemon on http://127.0.0.1:${port}`))
    )
  )
}
