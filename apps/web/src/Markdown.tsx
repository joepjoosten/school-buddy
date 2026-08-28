import type { ReactNode } from "react"

/**
 * Minimal Markdown renderer for chat replies. Renders to React elements only
 * (never raw HTML), so model output cannot inject markup. Supports: paragraphs,
 * **bold**, *italic*, `code`, links, -/* and 1. lists, # headings, ``` blocks.
 */

const INLINE = /(\*\*(.+?)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/

const inline = (text: string): ReactNode => {
  const nodes: Array<ReactNode> = []
  let rest = text
  let key = 0
  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (match === null || match.index === undefined) {
      nodes.push(rest)
      break
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index))
    if (match[2] !== undefined) nodes.push(<strong key={key}>{inline(match[2])}</strong>)
    else if (match[3] !== undefined) nodes.push(<em key={key}>{inline(match[3])}</em>)
    else if (match[4] !== undefined) nodes.push(<em key={key}>{inline(match[4])}</em>)
    else if (match[5] !== undefined) nodes.push(<code key={key}>{match[5]}</code>)
    else if (match[6] !== undefined && match[7] !== undefined) {
      nodes.push(
        <a key={key} href={match[7]} target="_blank" rel="noreferrer">
          {match[6]}
        </a>
      )
    }
    rest = rest.slice(match.index + match[0].length)
    key++
  }
  return nodes
}

const UL_ITEM = /^\s*[-*]\s+(.*)$/
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^#{1,4}\s+(.*)$/

export const Markdown = ({ text }: { text: string }) => {
  const lines = text.split("\n")
  const blocks: Array<ReactNode> = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i] ?? ""

    if (line.trim() === "") {
      i++
      continue
    }

    if (line.trim().startsWith("```")) {
      const code: Array<string> = []
      i++
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        code.push(lines[i] ?? "")
        i++
      }
      i++ // closing fence
      blocks.push(<pre key={key++}>{code.join("\n")}</pre>)
      continue
    }

    const ulMatch = UL_ITEM.exec(line)
    const olMatch = OL_ITEM.exec(line)
    if (ulMatch !== null || olMatch !== null) {
      const ordered = olMatch !== null
      const pattern = ordered ? OL_ITEM : UL_ITEM
      const items: Array<ReactNode> = []
      while (i < lines.length) {
        const itemMatch = pattern.exec(lines[i] ?? "")
        if (itemMatch === null) break
        items.push(<li key={items.length}>{inline(itemMatch[1] ?? "")}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>)
      continue
    }

    const headingMatch = HEADING.exec(line)
    if (headingMatch !== null) {
      blocks.push(
        <p key={key++} className="md-heading">
          <strong>{inline(headingMatch[1] ?? "")}</strong>
        </p>
      )
      i++
      continue
    }

    // paragraph: consecutive plain lines, single newlines become line breaks
    const para: Array<ReactNode> = []
    while (i < lines.length) {
      const current = lines[i] ?? ""
      if (
        current.trim() === "" ||
        UL_ITEM.test(current) ||
        OL_ITEM.test(current) ||
        HEADING.test(current) ||
        current.trim().startsWith("```")
      ) break
      if (para.length > 0) para.push(<br key={`b${para.length}`} />)
      para.push(inline(current))
      i++
    }
    blocks.push(<p key={key++}>{para}</p>)
  }

  return <div className="md">{blocks}</div>
}
