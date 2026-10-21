export const OTP_SIGNAL =
  /(?:\botp\b|one[ -]?time|verification[ _-]?code|security[ _-]?code|passcode|auth(?:entication)?[ _-]?code|login[ _-]?code|sign[ -]?in[ _-]?code|confirmation[ _-]?code|access[ _-]?code|temporary[ _-]?code|\b\d{1,2}[- ](?:character|digit)[ _-]*(?:code|otp)?\b|\b2fa\b|\bmfa\b|\btwo[ -]?factor\b|\bpin[ _-]?code\b|\bsecurity[ _-]?pin\b)/i

export const EXCLUDED_SIGNAL =
  /(?:phone|telephone|postal|zip|credit|card|cvv|cvc|payment|invoice|coupon|promo)/i

export const CONTAINER_SIGNAL =
  /(?:otp|verification|security|login|sign[ -]?in|auth|passcode|code|pin|digit|2fa|mfa)/i

export function accessibleInputText(input: HTMLInputElement): string {
  const labels = [...(input.labels ?? [])].map(
    (label) => label.textContent ?? "",
  )
  const labelledBy = (input.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .flatMap((id) =>
      id ? [input.ownerDocument.getElementById(id)?.textContent ?? ""] : [],
    )
  return [
    input.id,
    input.name,
    input.placeholder,
    input.getAttribute("aria-label"),
    input.getAttribute("data-testid"),
    input.getAttribute("data-cy"),
    ...labels,
    ...labelledBy,
  ]
    .join(" ")
    .slice(0, 1_000)
}

export function isConcealedOtpController(input: HTMLInputElement): boolean {
  return (
    input.hasAttribute("data-input-otp") ||
    input.getAttribute("autocomplete") === "one-time-code" ||
    input.classList.contains("input-otp") ||
    input.id.includes("otp-input")
  )
}

export function isEligibleInput(input: HTMLInputElement): boolean {
  if (!input.isConnected || input.disabled || input.readOnly) {
    return false
  }
  if (input.closest("[hidden], [inert], [aria-hidden='true']")) {
    return false
  }
  const type = input.type.toLowerCase()
  const validTypes = ["text", "tel", "number"]
  if (!validTypes.includes(type)) {
    return false
  }
  const isConcealed = isConcealedOtpController(input)
  const style = input.ownerDocument.defaultView?.getComputedStyle(input)
  if (style) {
    if (style.display === "none" || style.visibility === "hidden") {
      return false
    }
    if (style.opacity === "0" && !isConcealed) {
      return false
    }
  }
  if (!isConcealed && input.getClientRects().length === 0) {
    return false
  }
  const text = accessibleInputText(input)
  if (EXCLUDED_SIGNAL.test(text)) {
    return false
  }
  return true
}

export function findPotentialOtpInputs(
  root: Document = document,
): HTMLInputElement[] {
  const roots: (Document | ShadowRoot)[] = [root]
  for (let index = 0; index < roots.length && index < 20; index++) {
    const current = roots[index]
    if (!current) continue
    const elements = [...current.querySelectorAll("*")].slice(0, 2000)
    for (const element of elements) {
      if (element.shadowRoot && roots.length < 20) {
        roots.push(element.shadowRoot)
      }
    }
  }
  return roots
    .flatMap((current) => [...current.querySelectorAll("input")])
    .slice(0, 500)
    .filter(isEligibleInput)
}
