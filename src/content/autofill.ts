import { acceptsPattern } from "../core/validation"
import { isUsable, type OtpTarget } from "./detector"

export function fillTarget(target: OtpTarget, code: string): boolean {
  if (!/^[A-Za-z0-9-]{4,12}$/.test(code)) return false
  const { inputs, constraints } = target
  if (
    inputs.length === 0 ||
    inputs.some((input) => !isUsable(input) || input.value !== "")
  )
    return false
  if (
    (constraints.length !== null && code.length !== constraints.length) ||
    (constraints.numeric && !/^\d+$/.test(code)) ||
    !acceptsPattern(code, constraints.pattern)
  )
    return false
  if (
    inputs.some(
      (input) =>
        input.pattern &&
        !input.checkValidity() &&
        input.validity.patternMismatch,
    )
  )
    return false
  if (inputs.length > 1 && inputs.length !== code.length) return false
  const prototype =
    inputs[0]?.ownerDocument.defaultView?.HTMLInputElement.prototype
  const setter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, "value")?.set
    : undefined
  if (!setter) return false
  for (const [index, input] of inputs.entries()) {
    setter.call(input, inputs.length === 1 ? code : code[index])
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }
  return inputs.every(
    (input, index) =>
      input.value === (inputs.length === 1 ? code : code[index]),
  )
}
