import { getDomain } from "tldts"

import { canonicalEmail, emailAddress } from "./evidence"
import {
  MAX_EMAIL_AGE_MS,
  type Candidate,
  type VerificationContext,
} from "./types"
import { acceptsPattern } from "./validation"

export interface MatchPolicy {
  requireChoice?: boolean
  incomplete?: boolean
}

export type MatchResult =
  | { kind: "none" }
  | { kind: "unique"; candidate: Candidate }
  | { kind: "ambiguous"; candidates: Candidate[] }

export function senderDomain(sender: string): string | null {
  return emailAddress(sender)?.split("@")[1] ?? null
}

export function sameWebsite(left: string, right: string): boolean {
  const domain = getDomain(left, { allowPrivateDomains: true })
  return (
    domain !== null &&
    domain === getDomain(right, { allowPrivateDomains: true })
  )
}

export function matchesWebsite(sender: string, hostname: string): boolean {
  const domain = senderDomain(sender)
  return domain !== null && sameWebsite(domain, hostname)
}

function senderRelation(
  candidate: Candidate,
  context: VerificationContext,
): "direct" | "inferred" | "confirm" | null {
  if (matchesWebsite(candidate.sender, context.hostname)) return "direct"
  const domains = candidate.verificationDomains ?? []
  const intended = domains.some((domain) =>
    sameWebsite(domain, context.hostname),
  )
  const recipient = candidate.account ? canonicalEmail(candidate.account) : null
  const addressed =
    recipient &&
    candidate.recipients?.some(
      (address) => canonicalEmail(address) === recipient,
    )
  if (
    intended &&
    domains.every((domain) => sameWebsite(domain, context.hostname)) &&
    candidate.senderAuthentication === "pass" &&
    addressed
  )
    return "inferred"
  if (
    intended ||
    candidate.audiences?.some((domain) => sameWebsite(domain, context.hostname))
  )
    return "confirm"
  const brand = getDomain(context.hostname, {
    allowPrivateDomains: true,
  })?.split(".")[0]
  const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/)
  return brand &&
    brand.length >= 5 &&
    words(candidate.subject).includes(brand) &&
    words(candidate.sender.split("<")[0] ?? "").includes(brand)
    ? "confirm"
    : null
}

export function candidateReason(
  candidate: Candidate,
  context: VerificationContext,
  policy: MatchPolicy = {},
): string | undefined {
  if (policy.incomplete)
    return "An inbox could not be searched: confirm a known email"
  if (candidate.senderAuthentication === "fail")
    return "Sender authentication did not pass: confirm the intended email"
  if (candidate.manualOnly)
    return "Forwarded message: confirm the code is current"
  if (
    policy.requireChoice &&
    !(context.requestId && candidate.requestId === context.requestId)
  )
    return "Overlapping login attempts: choose the intended email"
  if (context.requestId && !candidate.requestId)
    return "Request reference unavailable: confirm the intended email"
  if (senderRelation(candidate, context) === "confirm")
    return "Site association is incomplete: confirm the intended email"
  if (candidate.confidence < 0.95) return "Limited extraction confidence"
  return undefined
}

export function eligibleCandidates(
  candidates: Candidate[],
  context: VerificationContext,
  now: number,
): Candidate[] {
  const recipient = context.recipient ? canonicalEmail(context.recipient) : null
  return candidates.filter((candidate) => {
    const age = now - candidate.receivedAt
    const destination = candidate.account
      ? [candidate.account]
      : (candidate.recipients ?? [])
    return (
      age >= -15_000 &&
      age <= MAX_EMAIL_AGE_MS &&
      candidate.receivedAt >=
        context.startedAt - (context.strictAfter ? 0 : 15_000) &&
      (candidate.expiresAt === undefined || candidate.expiresAt > now) &&
      candidate.confidence >= 0.85 &&
      senderRelation(candidate, context) !== null &&
      (!recipient ||
        destination.some((value) => canonicalEmail(value) === recipient)) &&
      (!context.requestId ||
        !candidate.requestId ||
        context.requestId === candidate.requestId) &&
      (context.constraints.length === null ||
        candidate.code.length === context.constraints.length) &&
      (!context.constraints.numeric || /^\d+$/.test(candidate.code)) &&
      acceptsPattern(candidate.code, context.constraints.pattern)
    )
  })
}

export function matchCandidates(
  candidates: Candidate[],
  context: VerificationContext,
  now = Date.now(),
  policy: MatchPolicy = {},
): MatchResult {
  const eligible = eligibleCandidates(candidates, context, now)
  const byCode = new Map<string, Candidate>()
  for (const candidate of eligible) {
    const key = `${candidate.account ?? ""}:${candidate.code}`
    const previous = byCode.get(key)
    if (!previous || candidate.receivedAt > previous.receivedAt)
      byCode.set(key, candidate)
  }
  const unique = [...byCode.values()]
  const first = unique[0]
  if (!first) return { kind: "none" }
  if (unique.length > 1 || candidateReason(first, context, policy))
    return { kind: "ambiguous", candidates: unique }
  return { kind: "unique", candidate: first }
}
