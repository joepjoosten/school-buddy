import * as Effect from "effect/Effect"

const SERVICE = "school-buddy"

const run = (args: Array<string>): Effect.Effect<{ code: number; stdout: string }> =>
  Effect.promise(async () => {
    const proc = Bun.spawn(["security", ...args], { stdout: "pipe", stderr: "ignore" })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    return { code, stdout }
  })

/** Read a secret from the login keychain; null when absent. */
export const keychainGet = (account: string): Effect.Effect<string | null> =>
  run(["find-generic-password", "-s", SERVICE, "-a", account, "-w"]).pipe(
    Effect.map(({ code, stdout }) => (code === 0 ? stdout.trimEnd() : null))
  )

/** Create or update a secret in the login keychain. */
export const keychainSet = (account: string, value: string): Effect.Effect<void> =>
  run(["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value]).pipe(
    Effect.asVoid
  )

export const keychainDelete = (account: string): Effect.Effect<void> =>
  run(["delete-generic-password", "-s", SERVICE, "-a", account]).pipe(Effect.asVoid)
