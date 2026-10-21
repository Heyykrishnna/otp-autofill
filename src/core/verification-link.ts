import { canonicalEmail } from "./evidence"
import { matchesWebsite, sameWebsite } from "./matcher"
import {
  MAX_EMAIL_AGE_MS,
  type VerificationLinkCandidate,
  type VerificationLinkContext,
} from "./types"

export type VerificationLinkMatch =
  | { kind: "none" }
  | { kind: "unique"; candidate: VerificationLinkCandidate }
  | { kind: "ambiguous"; candidates: VerificationLinkCandidate[] }

export function eligibleVerificationLinks(
  candidates: VerificationLinkCandidate[],
  context: VerificationLinkContext,
  now: number,
): VerificationLinkCandidate[] {
  const recipient = context.recipient ? canonicalEmail(context.recipient) : null
  return candidates.filter((candidate) => {
    const age = now - candidate.receivedAt
    const destination = candidate.account
      ? [candidate.account]
      : (candidate.recipients ?? [])
    let hostname: string
    try {
      hostname = new URL(candidate.url).hostname
    } catch {
      return false
    }
    const addressed =
      !recipient ||
      destination.some((address) => canonicalEmail(address) === recipient)
    const trustedSender =
      matchesWebsite(candidate.sender, context.hostname) ||
      candidate.senderAuthentication === "pass"
    return (
      age >= -15_000 &&
      age <= MAX_EMAIL_AGE_MS &&
      candidate.receivedAt >= context.startedAt - 15_000 &&
      sameWebsite(hostname, context.hostname) &&
      addressed &&
      candidate.senderAuthentication !== "fail" &&
      trustedSender
    )
  })
}

export function matchVerificationLinks(
  candidates: VerificationLinkCandidate[],
  context: VerificationLinkContext,
  now: number,
): VerificationLinkMatch {
  const eligible = eligibleVerificationLinks(candidates, context, now)
  const distinct = new Map(
    eligible.map((candidate) => [candidate.url, candidate]),
  )
  const values = [...distinct.values()]
  if (values.length === 0) return { kind: "none" }
  if (values.length > 1) return { kind: "ambiguous", candidates: values }
  const candidate = values[0]
  return candidate ? { kind: "unique", candidate } : { kind: "none" }
}
