import type { Candidate, EmailMessage, GmailPart } from "./types"
import { isRecord } from "./validation"

const PHRASE =
  /(?:one[ -]?time\s+(?:password|code)|verification\s+code|security\s+code|sign[ -]?in\s+code|login\s+code|authentication\s+code|passcode|\botp\b)/gi
const NEGATIVE =
  /(?:invoice|reference|order|phone|telephone|tracking|account)\s*(?:number|id|no\.?|#)?\s*[:#-]?\s*$/i
const STOP_WORDS = new Set([
  "verification",
  "security",
  "password",
  "account",
  "expires",
  "minutes",
  "seconds",
  "please",
  "confirm",
  "temporary",
  "continue",
  "requested",
  "following",
  "valid",
  "email",
  "enter",
  "your",
  "code",
  "this",
  "here",
])

export function decodeBase64Url(data: string, charset = "utf-8"): string {
  if (data.length > 1_500_000 || !/^[\w=-]*$/.test(data)) return ""
  try {
    const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"))
    return new TextDecoder(charset, { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    )
  } catch {
    return ""
  }
}

export function decodeMimeHeader(value: string): string {
  return value
    .slice(0, 4_000)
    .replace(/(\?=)\s+(?==\?)/g, "$1")
    .replace(
      /=\?([^?]{1,40})\?([bq])\?([^?]{1,2000})\?=/gi,
      (_, charset: string, encoding: string, payload: string) => {
        if (encoding.toLowerCase() === "b")
          return decodeBase64Url(
            payload.replace(/\+/g, "-").replace(/\//g, "_"),
            charset,
          )
        try {
          const decoded = payload
            .replace(/_/g, " ")
            .replace(/=([\da-f]{2})/gi, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            )
          return new TextDecoder(charset, { fatal: true }).decode(
            Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
          )
        } catch {
          return ""
        }
      },
    )
}

export function htmlToText(html: string): string {
  const entities: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    colon: ":",
  }
  return html
    .slice(0, 1_000_000)
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? " "
      const value =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1))
      return value > 0 &&
        value <= 0x10ffff &&
        !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value)
        : " "
    })
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parsePart(value: unknown, depth = 0): GmailPart | null {
  if (!isRecord(value) || depth > 12) return null
  const part: GmailPart = {}
  if (typeof value.mimeType === "string") part.mimeType = value.mimeType
  if (typeof value.filename === "string") part.filename = value.filename
  if (isRecord(value.body) && typeof value.body.data === "string")
    part.body = { data: value.body.data }
  if (Array.isArray(value.headers))
    part.headers = value.headers.filter(
      (header): header is { name: string; value: string } =>
        isRecord(header) &&
        typeof header.name === "string" &&
        typeof header.value === "string",
    )
  if (Array.isArray(value.parts))
    part.parts = value.parts.slice(0, 30).flatMap((child) => {
      const parsed = parsePart(child, depth + 1)
      return parsed ? [parsed] : []
    })
  return part
}

function collectText(part: GmailPart): string {
  if (part.filename) return ""
  const charset =
    part.headers
      ?.find((header) => header.name.toLowerCase() === "content-type")
      ?.value.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8"
  const own = part.body?.data ? decodeBase64Url(part.body.data, charset) : ""
  const text =
    part.mimeType === "text/html"
      ? htmlToText(own)
      : part.mimeType === "text/plain"
        ? own
        : ""
  return [text, ...(part.parts ?? []).map(collectText)]
    .join("\n")
    .slice(0, 1_000_000)
}

export function parseGmailMessage(value: unknown): EmailMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
  )
    return null
  const receivedAt =
    typeof value.internalDate === "string" ? Number(value.internalDate) : NaN
  const payload = parsePart(value.payload)
  if (!payload || !Number.isFinite(receivedAt)) return null
  const header = (name: string) =>
    decodeMimeHeader(
      payload.headers?.find((item) => item.name.toLowerCase() === name)
        ?.value ?? "",
    ).slice(0, 500)
  return {
    id: value.id,
    receivedAt,
    sender: header("from"),
    subject: header("subject"),
    text: collectText(payload),
  }
}

export function extractCandidates(message: EmailMessage): Candidate[] {
  const text = `${message.subject}\n${message.text}`
    .slice(0, 100_000)
    .replace(/[\u00a0\u202f]/g, " ")
  const phrases = [...text.matchAll(PHRASE)]
  if (phrases.length === 0) return []
  const found = new Map<string, Candidate>()
  const tokens =
    /(?<![\w@./-])(?:\d{3}[ \t]+\d{3}|\d{4}[ \t]+\d{4}|[A-Za-z0-9]{2,6}(?:-[A-Za-z0-9]{2,6}){1,2}|[A-Za-z0-9]{4,12})(?![\w@/-]|\.[A-Za-z0-9])/g
  for (const token of text.matchAll(tokens)) {
    const raw = token[0]
    const code = raw.replace(/[ \t]/g, "")
    const index = token.index
    const before = text.slice(Math.max(0, index - 40), index)
    if (NEGATIVE.test(before) || STOP_WORDS.has(code.toLowerCase())) continue
    if (
      code.length > 12 ||
      (/^\d+$/.test(code)
        ? code.length < 4 || code.length > 8
        : !/^[A-Z0-9]{4,12}$/.test(code) &&
          !/(?=.*[a-zA-Z])(?=.*\d)/.test(code))
    )
      continue
    const nearest = phrases
      .map((phrase) => {
        const end = phrase.index + phrase[0].length
        const afterPhrase = index >= end
        const distance = afterPhrase
          ? index - end
          : phrase.index - (index + raw.length)
        return {
          afterPhrase,
          distance,
          bridge: afterPhrase
            ? text.slice(end, index)
            : text.slice(index + raw.length, phrase.index),
        }
      })
      .filter(
        (phrase) =>
          phrase.distance >= 0 &&
          phrase.distance <= 65 &&
          !/\d|expires?|valid for|invoice|reference|phone|telephone/i.test(
            phrase.bridge,
          ),
      )
      .sort((a, b) => a.distance - b.distance)[0]
    if (!nearest || /https?:|www\.|@/i.test(before)) continue
    if (/^\d{4}$/.test(code) && /(?:year|copyright|©)\s*$/i.test(before))
      continue
    const confidence = nearest.distance <= 24 ? 0.98 : 0.85
    const previous = found.get(code)
    if (!previous || confidence > previous.confidence)
      found.set(code, {
        id: previous?.id ?? `${message.id}:${found.size}`,
        messageId: message.id,
        code,
        sender: message.sender,
        receivedAt: message.receivedAt,
        confidence,
        subject: message.subject,
      })
  }
  return [...found.values()].slice(0, 8)
}
