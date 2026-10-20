import { getDomain } from "tldts"

import {
  MAX_EMAIL_AGE_MS,
  type Candidate,
  type VerificationContext,
} from "./types"
import { acceptsPattern } from "./validation"

export type MatchResult =
  | { kind: "none" }
  | { kind: "unique"; candidate: Candidate }
  | { kind: "ambiguous"; candidates: Candidate[] }

export function senderDomain(sender: string): string | null {
  const address =
    sender.match(/<([^<>\s]+@[^<>\s]+)>\s*$/)?.[1] ?? sender.trim()
  const domain = address.match(/^[^\s<>@]+@([a-z0-9.-]+)$/i)?.[1]?.toLowerCase()
  return domain && !domain.includes("..") ? domain : null
}

export function matchesWebsite(sender: string, hostname: string): boolean {
  const domain = senderDomain(sender)
  if (!domain) return false
  const expected = getDomain(hostname, { allowPrivateDomains: true })
  return (
    expected !== null &&
    expected === getDomain(domain, { allowPrivateDomains: true })
  )
}

export function eligibleCandidates(
  candidates: Candidate[],
  context: VerificationContext,
  now: number,
): Candidate[] {
  return candidates.filter((candidate) => {
    const age = now - candidate.receivedAt
    return (
      age >= -15_000 &&
      age <= MAX_EMAIL_AGE_MS &&
      candidate.receivedAt >= context.startedAt - 15_000 &&
      candidate.confidence >= 0.85 &&
      matchesWebsite(candidate.sender, context.hostname) &&
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
): MatchResult {
  const eligible = eligibleCandidates(candidates, context, now)
  const byCode = new Map<string, Candidate>()
  for (const candidate of eligible) {
    const previous = byCode.get(candidate.code)
    if (!previous || candidate.receivedAt > previous.receivedAt)
      byCode.set(candidate.code, candidate)
  }
  const unique = [...byCode.values()]
  if (unique.length === 0) return { kind: "none" }
  if (unique.length > 1 || (unique[0]?.confidence ?? 0) < 0.95)
    return { kind: "ambiguous", candidates: unique }
  const candidate = unique[0]
  return candidate ? { kind: "unique", candidate } : { kind: "none" }
}
