import { emailAddress, recipientAddresses } from "../core/evidence"
import type { OtpTarget } from "./detector"
import { visibleText } from "../otp/OtpFieldDetector"

export function verificationHints(target: OtpTarget): {
  recipient?: string
  requestId?: string
} {
  const first = target.inputs[0]
  if (!first) return {}
  const candidateContainers = [
    first.closest(
      "form, [role='group'], fieldset, [role='dialog'], [role='main'], main, section, article",
    ),
    first.closest(
      "[class*='card'], [class*='modal'], [class*='auth'], [class*='login'], [class*='container']",
    ),
    first.parentElement?.parentElement?.parentElement,
    first.parentElement?.parentElement,
    first.parentElement,
    first.ownerDocument.body,
  ].filter((element): element is HTMLElement => Boolean(element))

  const explicit = candidateContainers
    .flatMap((container) => [
      first.getAttribute("data-otp-recipient"),
      container.getAttribute("data-otp-recipient"),
    ])
    .flatMap((value) => (value && emailAddress(value) ? [value] : []))

  const inputs = candidateContainers
    .flatMap((container) => [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[type="email"], input[autocomplete="username"]',
      ),
    ])
    .flatMap((input) => (emailAddress(input.value) ? [input.value] : []))

  const fullText = candidateContainers
    .map(visibleText)
    .join(" ")
    .slice(0, 10_000)

  const textMatch =
    fullText.match(
      /(?:sent|emailed|delivered|texted)(?:\s+(?:you\s+)?a)?(?:\s+\d{1,2}[- ](?:character|digit))?(?:\s+[\w-]{1,20})*\s+to\s+([^\s<>"']+@[^\s<>"']+)/i,
    )?.[1] ??
    fullText.match(
      /\b(?:verification|security|login|sign[ -]?in)?\s*(?:code|otp|passcode)\s+(?:has been |was )?sent\s+to\s+([^\s<>"']+@[^\s<>"']+)/i,
    )?.[1] ??
    fullText.match(
      /\bto\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/i,
    )?.[1]

  const fallbackEmail = !textMatch
    ? candidateContainers
        .slice(0, -1)
        .flatMap((container) => recipientAddresses(visibleText(container)))
        .find((address) => !/[*•]/.test(address))
    : undefined

  const visible = textMatch
    ? recipientAddresses(textMatch.replace(/[.,;:]$/, ""))
    : fallbackEmail
      ? [fallbackEmail]
      : []

  const recipients = [
    ...new Set(
      (explicit.length ? explicit : inputs.length ? inputs : visible)
        .map((value) => emailAddress(value))
        .filter(
          (value): value is string => value !== null && !/[*•]/.test(value),
        ),
    ),
  ]

  const reference = candidateContainers
    .flatMap((element) => [
      first.getAttribute("data-otp-request-id"),
      first.getAttribute("data-verification-id"),
      element.getAttribute("data-otp-request-id"),
      element.getAttribute("data-verification-id"),
    ])
    .find(
      (value): value is string =>
        typeof value === "string" && /^[a-zA-Z0-9_-]{4,80}$/.test(value),
    )

  return {
    ...(recipients.length === 1 ? { recipient: recipients[0] } : {}),
    ...(reference ? { requestId: reference } : {}),
  }
}
