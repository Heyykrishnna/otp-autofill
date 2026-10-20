import type { FieldConstraints } from "../core/types"

export interface OtpTarget {
  inputs: HTMLInputElement[]
  constraints: FieldConstraints
}

const OTP_SIGNAL =
  /(?:\botp\b|one[ -]?time|verification[ _-]?code|security[ _-]?code|passcode|auth(?:entication)?[ _-]?code|login[ _-]?code|sign[ -]?in[ _-]?code)/i
const EXCLUDED_SIGNAL =
  /(?:phone|telephone|postal|zip|credit|card|cvv|cvc|payment|invoice|coupon|promo)/i

function accessibleText(input: HTMLInputElement): string {
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
    ...labels,
    ...labelledBy,
  ]
    .join(" ")
    .slice(0, 1_000)
}

export function isUsable(input: HTMLInputElement): boolean {
  const style = input.ownerDocument.defaultView?.getComputedStyle(input)
  return (
    input.isConnected &&
    !input.disabled &&
    !input.readOnly &&
    !input.closest("[hidden], [inert], [aria-hidden='true']") &&
    ["text", "tel", "number"].includes(input.type) &&
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.opacity !== "0" &&
    input.getClientRects().length > 0
  )
}

function numericInput(input: HTMLInputElement): boolean {
  return (
    input.inputMode === "numeric" ||
    input.type === "number" ||
    /^(?:\\d|\[0-9\])/.test(input.pattern)
  )
}

function constraintsFor(inputs: HTMLInputElement[]): FieldConstraints {
  const first = inputs[0]
  if (!first) return { length: null, numeric: false, pattern: null }
  const pattern =
    inputs.length === 1 && first.pattern ? first.pattern.slice(0, 120) : null
  const exactLength = pattern?.match(/\{(\d{1,2})\}\$?$/)?.[1]
  const length =
    inputs.length > 1
      ? inputs.length
      : exactLength
        ? Number(exactLength)
        : first.maxLength >= 4 && first.maxLength <= 12
          ? first.maxLength
          : null
  return { length, numeric: inputs.every(numericInput), pattern }
}

export function detectTargets(root: Document = document): OtpTarget[] {
  const inputs = [...root.querySelectorAll("input")]
    .slice(0, 500)
    .filter(isUsable)
  const targets: OtpTarget[] = []
  const used = new Set<HTMLInputElement>()
  for (const input of inputs) {
    if (used.has(input)) continue
    const ownText = accessibleText(input)
    if (EXCLUDED_SIGNAL.test(ownText)) continue
    if (input.maxLength === 1) {
      const group =
        input.closest("fieldset, [role='group'], form") ?? input.parentElement
      if (!group) continue
      const grouped = inputs.filter(
        (item) =>
          group.contains(item) &&
          item.maxLength === 1 &&
          !EXCLUDED_SIGNAL.test(accessibleText(item)),
      )
      const groupText = `${group.querySelector("legend")?.textContent ?? ""} ${group.getAttribute("aria-label") ?? ""} ${group.querySelector("label")?.textContent ?? ""}`
      if (
        grouped.length >= 4 &&
        grouped.length <= 8 &&
        (grouped.some(
          (item) =>
            OTP_SIGNAL.test(accessibleText(item)) ||
            item.autocomplete === "one-time-code",
        ) ||
          OTP_SIGNAL.test(groupText))
      ) {
        grouped.forEach((item) => used.add(item))
        targets.push({ inputs: grouped, constraints: constraintsFor(grouped) })
      }
      continue
    }
    if (input.autocomplete === "one-time-code" || OTP_SIGNAL.test(ownText)) {
      if (input.maxLength > 0 && (input.maxLength < 4 || input.maxLength > 12))
        continue
      used.add(input)
      targets.push({ inputs: [input], constraints: constraintsFor([input]) })
    }
  }
  return targets
}
