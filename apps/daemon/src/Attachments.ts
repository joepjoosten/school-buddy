import type { ChatAttachment, ChatAttachmentInput } from "@school-buddy/shared"
import * as Effect from "effect/Effect"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const ATTACHMENT_DIR = `${process.env["HOME"]}/.school-buddy/attachments`
const MAX_BYTES = 15 * 1024 * 1024

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf"
}

export const isSupported = (mediaType: string): boolean =>
  mediaType.startsWith("image/") || mediaType === "application/pdf"

const pathFor = (id: string, mediaType: string): string =>
  join(ATTACHMENT_DIR, `${id}.${EXTENSIONS[mediaType] ?? "bin"}`)

/** Save an uploaded attachment to disk; returns null when unsupported/too big. */
export const saveAttachment = (
  input: ChatAttachmentInput
): Effect.Effect<{ attachment: ChatAttachment; bytes: Uint8Array } | null> =>
  Effect.sync(() => {
    if (!isSupported(input.mediaType)) return null
    const bytes = Buffer.from(input.data, "base64")
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null
    mkdirSync(ATTACHMENT_DIR, { recursive: true })
    const id = crypto.randomUUID()
    writeFileSync(pathFor(id, input.mediaType), bytes)
    return {
      attachment: { id, mediaType: input.mediaType, fileName: input.fileName },
      bytes: new Uint8Array(bytes)
    }
  })

/** Locate a stored attachment by id (extension is unknown to the caller). */
export const attachmentPath = (id: string): string | null => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  for (const ext of [...new Set(Object.values(EXTENSIONS)), "bin"]) {
    const candidate = join(ATTACHMENT_DIR, `${id}.${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export const readAttachment = (id: string): Uint8Array | null => {
  const path = attachmentPath(id)
  return path === null ? null : new Uint8Array(readFileSync(path))
}
