#!/usr/bin/env bun
import { startDaemon } from "./daemon.ts"
import { runSetup } from "./setup.ts"
import { runUpdate } from "./update.ts"
import { VERSION } from "./version.ts"

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case undefined:
  case "daemon":
    startDaemon()
    break
  case "setup":
    await runSetup(args[0])
    break
  case "update":
    await runUpdate(args.includes("--check"))
    break
  case "version":
  case "--version":
  case "-v":
    console.log(VERSION)
    break
  default:
    console.error(
      `Unknown command "${command}". Usage: school-buddy [daemon|setup <school>|update [--check]|version]`
    )
    process.exit(1)
}
