import { senderAuthentication, verificationDomains } from "./email-evidence"
import {
  audienceDomains,
  currentMessageText,
  explicitExpiry,
  recipientAddresses,
  requestReference,
  withoutHtmlQuotes,
} from "./evidence"
import type {
  Candidate,
  EmailMessage,
  EmailVerificationLink,
  GmailPart,
  VerificationLinkCandidate,
} from "./types"
import { isRecord } from "./validation"

const PHRASE =
  /(?:one[ -]?time\s+(?:password|code|passcode)|(?:verification|security|sign[ -]?in|login|authentication|authorization|confirmation|access|temporary|single[ -]?use|\d{1,2}[- ](?:character|digit))\s+(?:code|passcode)|\blogin[ _-]?code\b|\bpasscode\b|\botp\b)/gi
const NEGATIVE =
  /(?:(?:invoice|order|account|request|session|challenge)\s+(?:number|id|no\.?|#)|tracking(?:\s+(?:number|id|reference|no\.?|#))?|reference|phone(?:\s+number)?|telephone(?:\s+number)?)\s*[:#-]?\s*$/i
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

function htmlTextContent(html: string): string {
  const text: string[] = []
  const lower = html.toLowerCase()
  let cursor = 0
  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor)
    if (opening < 0) {
      text.push(html.slice(cursor))
      break
    }
    text.push(html.slice(cursor, opening), " ")
    if (html.startsWith("<!--", opening)) {
      const end = html.indexOf("-->", opening + 4)
      cursor = end < 0 ? html.length : end + 3
      continue
    }
    const end = html.indexOf(">", opening + 1)
    if (end < 0) break
    const name = html
      .slice(opening + 1, end)
      .match(/^\s*(script|style|head)(?=[\s/>]|$)/i)?.[1]
      ?.toLowerCase()
    cursor = end + 1
    if (!name) continue
    const marker = `</${name}`
    let closing = lower.indexOf(marker, cursor)
    while (closing >= 0 && !/[\s>]/.test(html[closing + marker.length] ?? "")) {
      closing = lower.indexOf(marker, closing + marker.length)
    }
    if (closing < 0) break
    const closingEnd = html.indexOf(">", closing + marker.length)
    if (closingEnd < 0) break
    cursor = closingEnd + 1
  }
  return text.join("")
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
  return htmlTextContent(html.slice(0, 1_000_000))
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

const LINK_ACTION =
  /\b(?:activate|complete|confirm|continue|verify|sign[ -]?in|log[ -]?in)\b.{0,40}\b(?:account|email|registration|verification)?\b|\b(?:account|email|registration)\b.{0,40}\b(?:activate|confirm|verify|sign[ -]?in|log[ -]?in)\b/i
const LINK_NEGATIVE =
  /\b(?:cancel|delete|invoice|manage preferences|order|(?:password\s+reset|reset\s+password)|pay|purchase|receipt|refund|remove|unsubscribe)\b/i

function safeVerificationUrl(value: string): string | null {
  if (value.length > 2_048) return null
  try {
    const url = new URL(value.replace(/&amp;/gi, "&"))
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

function actionLinks(part: GmailPart): EmailVerificationLink[] {
  if (isAttachment(part)) return []
  const raw = withoutHtmlQuotes(
    part.body?.data ? decodeBase64Url(part.body.data) : "",
  )
  const links: EmailVerificationLink[] = []
  if (part.mimeType === "text/html") {
    let opening: { url: string; labelStart: number } | null = null
    for (const tag of raw.matchAll(/<\/?a\b[^<>]*>/gi)) {
      if (/^<\//.test(tag[0])) {
        if (opening) {
          const label = htmlToText(
            raw.slice(opening.labelStart, tag.index),
          ).slice(0, 160)
          if (LINK_ACTION.test(label) && !LINK_NEGATIVE.test(label))
            links.push({ url: opening.url, label })
        }
        opening = null
        continue
      }
      const href = tag[0].match(
        /\bhref\s*=\s*["'](https?:\/\/[^<>"']+)["']/i,
      )?.[1]
      const url = href ? safeVerificationUrl(href) : null
      opening = url ? { url, labelStart: tag.index + tag[0].length } : null
    }
  }
  return [...links, ...(part.parts ?? []).flatMap(actionLinks)].slice(0, 32)
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
        ? `${htmlToText(own)} ${[...own.matchAll(/<a\b[^<>]*\bhref\s*=\s*["'](https?:\/\/[^<>"']+)["']/gi)].map((match) => match[1]).join(" ")}`
        : part.mimeType === "text/plain"
          ? currentMessageText(own)
          : ""
    return [content, ...(part.parts ?? []).map(rawParts)]
      .join("\n")
      .slice(0, 100_000)
  }
  const verificationLinks = actionLinks(payload)
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
      `${forwarded ? unquoted : currentMessageText(text)}\n${verificationLinks.map((link) => `Continue at ${link.url}`).join("\n")}`,
    ),
    verificationLinks,
  }
}

export function extractVerificationLinks(
  message: EmailMessage,
): VerificationLinkCandidate[] {
  const text = `${message.subject}\n${message.text}`.slice(0, 100_000)
  const links = [...(message.verificationLinks ?? [])]
  for (const match of text.matchAll(/https:\/\/[^\s<>"']+/gi)) {
    const url = safeVerificationUrl((match[0] ?? "").replace(/[).,;]+$/, ""))
    const index = match.index
    const context = text.slice(
      Math.max(0, index - 100),
      index + match[0].length + 40,
    )
    const leadIn = text.slice(Math.max(0, index - 60), index)
    const destination = url ? new URL(url) : null
    if (
      url &&
      LINK_ACTION.test(context) &&
      !LINK_NEGATIVE.test(leadIn) &&
      destination &&
      !LINK_NEGATIVE.test(`${destination.pathname} ${destination.search}`)
    )
      links.push({ url, label: context })
  }
  const unique = new Map<string, EmailVerificationLink>()
  for (const link of links) unique.set(link.url, link)
  return [...unique.values()].slice(0, 8).map((link, index) => ({
    id: `${message.id}:link:${index}`,
    messageId: message.id,
    url: link.url,
    sender: message.sender,
    receivedAt: message.receivedAt,
    subject: message.subject,
    account: message.account,
    recipients: message.recipients,
    forwarded: message.forwarded,
    senderAuthentication: message.senderAuthentication,
  }))
}

export function extractCandidates(message: EmailMessage): Candidate[] {
  const body = message.forwarded
    ? message.text
    : currentMessageText(message.text)
  const text = `${message.subject}\n${body}`
    .slice(0, 100_000)
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
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
    const direct =
      nearest.distance <= 45 ||
      /^\s*(?:is|to (?:sign|log) in(?:to)? (?:your|the) account(?: on (?:this|a|another|diferent|different) device)?)?\s*[:#-]?\s*$/i.test(
        nearest.bridge,
      )
    const confidence = direct ? 0.98 : 0.85
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
