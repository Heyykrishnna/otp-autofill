import { senderAuthentication, verificationDomains } from "./email-evidence"
import {
  audienceDomains,
  currentMessageText,
  explicitExpiry,
  recipientAddresses,
  requestReference,
  withoutHtmlQuotes,
} from "./evidence"
import type { Candidate, EmailMessage, GmailPart } from "./types"
import { isRecord } from "./validation"

const PHRASE =
  /(?:one[ -]?time\s+(?:password|code)|verification\s+code|security\s+code|sign[ -]?in\s+code|login\s+code|authentication\s+code|passcode|\botp\b)/gi
const NEGATIVE =
  /(?:invoice|reference|order|phone|telephone|tracking|account|request|session|challenge)\s*(?:number|id|no\.?|#)?\s*[:#-]?\s*$/i
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

function isAttachment(part: GmailPart): boolean {
  return Boolean(
    part.filename ||
    part.mimeType === "message/rfc822" ||
    part.headers?.some(
      (header) =>
        header.name.toLowerCase() === "content-disposition" &&
        /^attachment\b/i.test(header.value),
    ),
  )
}

function collectText(part: GmailPart, forwarded = false): string {
  if (isAttachment(part)) return ""
  const charset =
    part.headers
      ?.find((header) => header.name.toLowerCase() === "content-type")
      ?.value.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8"
  const own = part.body?.data ? decodeBase64Url(part.body.data, charset) : ""
  const text =
    part.mimeType === "text/html"
      ? htmlToText(forwarded ? own : withoutHtmlQuotes(own))
      : part.mimeType === "text/plain"
        ? own
        : ""
  return [
    text,
    ...(part.parts ?? []).map((child) => collectText(child, forwarded)),
  ]
    .join("\n")
    .slice(0, 1_000_000)
}

function actionLinks(part: GmailPart): string {
  if (isAttachment(part)) return ""
  const raw = withoutHtmlQuotes(
    part.body?.data ? decodeBase64Url(part.body.data) : "",
  )
  const links =
    part.mimeType === "text/html"
      ? [
          ...raw.matchAll(
            /<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
          ),
        ]
          .filter((match) =>
            /\b(?:continue|verify|sign[ -]?in|log[ -]?in|authenticate)\b/i.test(
              htmlToText(match[2] ?? ""),
            ),
          )
          .map((match) => `Continue at ${match[1]}`)
      : []
  return [...links, ...(part.parts ?? []).map(actionLinks)]
    .join("\n")
    .slice(0, 100_000)
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
  const subject = header("subject")
  const unquoted = collectText(payload, true)
  const forwarded =
    /^(?:fwd?|forwarded)\s*:/i.test(subject) ||
    /^[- ]*(?:begin forwarded message|forwarded message)[- :]*$/im.test(
      unquoted,
    )
  const text = forwarded ? unquoted : collectText(payload)
  const rawParts = (part: GmailPart): string => {
    if (isAttachment(part)) return ""
    const raw = part.body?.data ? decodeBase64Url(part.body.data) : ""
    const own = forwarded ? raw : withoutHtmlQuotes(raw)
    const content =
      part.mimeType === "text/html"
        ? `${htmlToText(own)} ${[...own.matchAll(/<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((match) => match[1]).join(" ")}`
        : part.mimeType === "text/plain"
          ? currentMessageText(own)
          : ""
    return [content, ...(part.parts ?? []).map(rawParts)]
      .join("\n")
      .slice(0, 100_000)
  }
  return {
    id: value.id,
    receivedAt,
    sender: header("from"),
    subject,
    text: forwarded ? text : currentMessageText(text),
    recipients: recipientAddresses(
      [header("to"), header("delivered-to"), header("x-original-to")].join(","),
    ),
    audiences: audienceDomains(
      forwarded ? rawParts(payload) : withoutHtmlQuotes(rawParts(payload)),
    ),
    forwarded,
    senderAuthentication: senderAuthentication(
      payload.headers ?? [],
      header("from"),
    ),
    verificationDomains: verificationDomains(
      subject,
      `${forwarded ? unquoted : currentMessageText(text)}\n${actionLinks(payload)}`,
    ),
  }
}

export function extractCandidates(message: EmailMessage): Candidate[] {
  const body = message.forwarded
    ? message.text
    : currentMessageText(message.text)
  const text = `${message.subject}\n${body}`
    .slice(0, 100_000)
    .replace(/[\u00a0\u202f]/g, " ")
  if (
    /\b(?:this|your) (?:verification |security )?code (?:has |is )?expired\b/i.test(
      text,
    )
  )
    return []
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
    if (!nearest || /(?:https?:\/\/|www\.)\S*$|[\w.+-]+@\S*$/i.test(before))
      continue
    if (
      /(?:old|previous|expired|unused)\s+(?:verification\s+)?code\s*[:#-]?\s*$/i.test(
        before,
      )
    )
      continue
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
        account: message.account,
        recipients: message.recipients,
        audiences: message.audiences ?? audienceDomains(body),
        requestId: requestReference(text),
        expiresAt: explicitExpiry(text, message.receivedAt),
        manualOnly: message.forwarded,
        senderAuthentication: message.senderAuthentication,
        verificationDomains:
          message.verificationDomains ??
          verificationDomains(message.subject, body),
      })
  }
  return [...found.values()].slice(0, 8)
}
