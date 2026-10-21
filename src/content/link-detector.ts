import { emailAddress } from "../core/evidence"
import type { VerificationLinkContext } from "../core/types"
import { detectTargets } from "./detector"

const REQUEST = [
  /\bcheck (?:your )?(?:email|inbox)\b.{0,120}\b(?:activate|confirm|link|verification|verify)\b/i,
  /\b(?:activation|confirmation|verification) link\b.{0,80}\b(?:email|sent|inbox)\b/i,
  /\b(?:sent|emailed)\b.{0,80}\b(?:activation|confirmation|verification)\b.{0,40}\blink\b/i,
  /\bclick\b.{0,60}\blink\b.{0,80}\b(?:activate|confirm|email|verify)\b/i,
]
const COMPLETE =
  /\b(?:account|email) (?:has been |is )?(?:activated|confirmed|verified)\b|\bverification (?:is )?(?:complete|successful)\b/i

function recipient(): string | undefined {
  const explicit = document
    .querySelector("[data-verification-recipient]")
    ?.getAttribute("data-verification-recipient")
  const values = [
    explicit,
    ...[...document.querySelectorAll<HTMLInputElement>('input[type="email"]')]
      .map((input) => input.value)
      .filter(Boolean),
  ]
  return values.flatMap((value) => {
    const address = value ? emailAddress(value) : null
    return address ? [address] : []
  })[0]
}

export function detectVerificationLinkContext(
  startedAt = Date.now(),
): VerificationLinkContext | null {
  if (detectTargets().length > 0) return null
  const segments = [
    ...document.querySelectorAll<HTMLElement>(
      "p, h1, h2, h3, [role='status'], [aria-live]",
    ),
  ]
    .filter((element) => !element.closest("select, option"))
    .map((element) =>
      (element.innerText || element.textContent || "")
        .replace(/\s+/g, " ")
        .slice(0, 4_000),
    )
    .slice(0, 100)
  if (
    segments.some((text) => COMPLETE.test(text)) ||
    !segments.some((text) => REQUEST.some((pattern) => pattern.test(text)))
  )
    return null
  const address = recipient()
  return {
    id: crypto.randomUUID(),
    startedAt,
    hostname: location.hostname,
    ...(address ? { recipient: address } : {}),
  }
}
