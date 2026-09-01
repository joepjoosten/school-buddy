import { describe, expect, test } from "bun:test"
import { htmlToText } from "../src/Somtoday.ts"

describe("Somtoday descriptions are HTML", () => {
  test("decodes numeric entities", () => {
    expect(htmlToText("<p>de foto&#39;s van Crazy 88</p>")).toBe("de foto's van Crazy 88")
    expect(htmlToText("caf&#xe9;")).toBe("café")
  })

  test("decodes named entities", () => {
    expect(htmlToText("wisk &amp; nat &quot;toets&quot;")).toBe('wisk & nat "toets"')
  })

  test("turns block markup into line breaks and bullets", () => {
    expect(htmlToText("<p>een</p><p>twee</p>")).toBe("een\ntwee")
    expect(htmlToText("a<br>b")).toBe("a\nb")
    expect(htmlToText("<ul><li>x</li><li>y</li></ul>")).toBe("• x\n• y")
  })

  test("collapses the blank lines that markup leaves behind", () => {
    expect(htmlToText("<p>een</p><br><br><br><p>twee</p>")).toBe("een\n\ntwee")
  })
})
