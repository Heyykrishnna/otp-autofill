import { audienceDomains, emailAddress } from "./evidence"
import type { GmailPart } from "./types"

export function senderAuthentication(
  headers: NonNullable<GmailPart["headers"]>,
  sender: string,
): "pass" | "fail" | "unknown" {
  const results = headers.find(
    (header) => header.name.toLowerCase() === "authentication-results",
  )?.value
  if (
    !results ||
    results.length > 16_000 ||
    !/^\s*mx\.google\.com\s*;/i.test(results)
  )
    return "unknown"
  const segments = results
    .replace(/\([^)]*\)/g, " ")
    .split(";")
    .slice(1)
  if (
    segments.some((segment) =>
      /^\s*(?:dmarc|arc)\s*=\s*(?:fail|temperror|permerror)\b/i.test(segment),
    )
  )
    return "fail"
  const domain = emailAddress(sender)?.split("@")[1]
  const dmarc = segments.find((segment) =>
    /^\s*dmarc\s*=\s*pass\b/i.test(segment),
  )
  const from = dmarc
    ?.match(/\bheader\.from\s*=\s*([a-z0-9.-]+)/i)?.[1]
    ?.toLowerCase()
  return domain && from === domain ? "pass" : "unknown"
}

export function verificationDomains(subject: string, text: string): string[] {
  const found = new Set(audienceDomains(subject))
  const bounded = text
    .slice(0, 100_000)
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
      try {
        const parsed = new URL(url.replace(/[),;]+$/, ""))
        return parsed.protocol === "https:" &&
          !parsed.username &&
          !parsed.password
          ? parsed.origin
          : " "
      } catch {
        return " "
      }
    })
  const patterns = [
    /\b(?:visit|continue (?:at|on|to)|sign[ -]?in (?:at|to|into)|log[ -]?in (?:at|to|into)|verify (?:at|on)|authenticate (?:at|on)|code for)\s+(?:https:\/\/)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63})\b/gi,
    /\b((?:[a-z0-9-]+\.)+[a-z]{2,63})(?:'s)?\s+(?:verification|sign[ -]?in|login|security)\s+code\b/gi,
  ]
  for (const pattern of patterns)
    for (const match of bounded.matchAll(pattern))
      for (const domain of audienceDomains(match[1] ?? "")) found.add(domain)
  return [...found].slice(0, 16)
}
