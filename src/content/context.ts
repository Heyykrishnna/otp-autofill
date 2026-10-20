import { emailAddress, recipientAddresses } from "../core/evidence"
import type { OtpTarget } from "./detector"

export function verificationHints(target: OtpTarget): {
  recipient?: string
  requestId?: string
} {
  const first = target.inputs[0]
  const container =
    first?.closest("form, [role='group'], fieldset") ?? first?.parentElement
  if (!container) return {}
  const explicit = [
    first?.getAttribute("data-otp-recipient"),
    container.getAttribute("data-otp-recipient"),
  ].flatMap((value) => (value && emailAddress(value) ? [value] : []))
  const inputs = [
    ...container.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[autocomplete="username"]',
    ),
  ].flatMap((input) => (emailAddress(input.value) ? [input.value] : []))
  const textHints = (container.textContent ?? "")
    .slice(0, 2000)
    .match(
      /\bsent(?: a)?(?: verification)?(?: code)? to\s+([^\s<>]+@[^\s<>]+)/i,
    )?.[1]
  const visible = textHints
    ? recipientAddresses(textHints.replace(/[.,;:]$/, ""))
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
  const reference = [first, container]
    .flatMap((element) =>
      element
        ? [
            element.getAttribute("data-otp-request-id"),
            element.getAttribute("data-verification-id"),
          ]
        : [],
    )
    .find(
      (value): value is string =>
        typeof value === "string" && /^[a-zA-Z0-9_-]{4,80}$/.test(value),
    )
  return {
    ...(recipients.length === 1 ? { recipient: recipients[0] } : {}),
    ...(reference ? { requestId: reference } : {}),
  }
}
