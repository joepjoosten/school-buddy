#!/usr/bin/env bun
import { startDaemon } from "./daemon.ts"
import { runSetup } from "./setup.ts"

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case undefined:
  case "daemon":
    startDaemon()
    break
  case "setup":
    await runSetup(args[0])
    break
  default:
    console.error(`Unknown command "${command}". Usage: school-buddy [daemon|setup <school>]`)
    process.exit(1)
}
