import type { DetectedGroup } from "./OtpGroupDetector"
import { normalizeOtpCode } from "./OtpFormatValidator"

function resetReactValueTracker(
  input: HTMLInputElement,
  previousValue: string,
): void {
  const tracker = (
    input as { _valueTracker?: { setValue: (val: string) => void } }
  )._valueTracker
  if (tracker && typeof tracker.setValue === "function") {
    tracker.setValue(previousValue)
  }
}

function assignInputValue(input: HTMLInputElement, value: string): boolean {
  const previousValue = input.value
  const prototype =
    input.ownerDocument.defaultView?.HTMLInputElement.prototype ??
    HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  if (setter) {
    setter.call(input, value)
  } else {
    input.value = value
  }
  resetReactValueTracker(input, previousValue)
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  return true
}

export function fillSplitOtpGroup(
  inputs: HTMLInputElement[],
  code: string,
): boolean {
  const characters = normalizeOtpCode(code).split("")
  if (inputs.length !== characters.length) {
    return false
  }
  if (
    inputs.some(
      (input) => !input.isConnected || input.disabled || input.readOnly,
    )
  ) {
    return false
  }
  if (inputs.some((input) => input.value.trim() !== "")) {
    return false
  }

  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index]
    const char = characters[index]
    if (!input || !char || !input.isConnected) {
      return false
    }
    input.focus({ preventScroll: true })
    assignInputValue(input, char)
  }

  const last = inputs[inputs.length - 1]
  last?.focus({ preventScroll: true })
  return true
}

export function fillSingleOrControllerOtp(
  input: HTMLInputElement,
  code: string,
): boolean {
  if (!input.isConnected || input.disabled || input.readOnly) {
    return false
  }
  if (input.value.trim() !== "") {
    return false
  }
  const cleanCode = normalizeOtpCode(code)
  input.focus({ preventScroll: true })
  assignInputValue(input, cleanCode)
  return true
}

export function executeOtpFill(group: DetectedGroup, code: string): boolean {
  if (group.mode === "split") {
    return fillSplitOtpGroup(group.inputs, code)
  }
  const primary = group.inputs[0]
  if (!primary) {
    return false
  }
  return fillSingleOrControllerOtp(primary, code)
}
