#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { daemonEffect } from "./daemon.ts"
import { showLogs } from "./logs.ts"
import { runSetup } from "./setup.ts"
import { runUpdate } from "./update.ts"
import { VERSION } from "./version.ts"

const daemon = Command.make("daemon", {}, () => daemonEffect()).pipe(
  Command.withDescription("Start de achtergrond-daemon (rooster-sync, vragen, webpagina)")
)

const setup = Command.make("setup", {
  school: Argument.string("school").pipe(
    Argument.withDescription("Naam van de school (deel van de naam is genoeg)")
  )
}, ({ school }) => Effect.promise(() => runSetup(school))).pipe(
  Command.withDescription("Eenmalig Somtoday koppelen via de Microsoft-login")
)

const update = Command.make("update", {
  check: Flag.boolean("check").pipe(
    Flag.withDescription("Alleen controleren, niet installeren"),
    Flag.withDefault(false)
  )
}, ({ check }) => Effect.promise(() => runUpdate(check))).pipe(
  Command.withDescription("Update naar de nieuwste GitHub-release")
)

const logs = Command.make("logs", {
  minutes: Flag.integer("minutes").pipe(
    Flag.withAlias("m"),
    Flag.withDescription("Hoeveel minuten terugkijken (standaard 5)"),
    Flag.withDefault(5)
  )
}, ({ minutes }) => Effect.promise(() => showLogs(minutes))).pipe(
  Command.withDescription("Toon recente daemon-logs (standaard: laatste 5 minuten)")
)

const version = Command.make("version", {}, () =>
  Effect.sync(() => console.log(VERSION))).pipe(
    Command.withDescription("Toon de huidige versie")
  )

// bare `school-buddy` (how launchd may invoke it) starts the daemon
const root = Command.make("school-buddy", {}, () => daemonEffect()).pipe(
  Command.withDescription("School Buddy — rooster, huiswerk en een maatje op de Mac"),
  Command.withSubcommands([daemon, setup, update, logs, version])
)

BunRuntime.runMain(
  Command.run(root, { version: VERSION }).pipe(
    Effect.provide(BunServices.layer),
    Effect.orDie
  )
)
