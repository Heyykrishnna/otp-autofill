import type { DetectedGroup } from "./OtpGroupDetector"
import { isEligibleInput } from "./OtpFieldDetector"
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
  setNativeValue(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  return true
}

function setNativeValue(input: HTMLInputElement, value: string): void {
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
}

export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Widgets may re-render and replace their boxes after each character, so the
// inputs captured at detection time can go stale mid-fill.
export function liveInputs(
  inputs: HTMLInputElement[],
  container: HTMLElement | null,
): HTMLInputElement[] {
  if (inputs.every((input) => input.isConnected) || !container?.isConnected) {
    return inputs
  }
  const current = [...container.querySelectorAll("input")].filter(
    isEligibleInput,
  )
  return current.length === inputs.length ? current : inputs
}

function splitValue(inputs: HTMLInputElement[]): string {
  return inputs.map((input) => input.value).join("")
}

async function pasteSplitOtp(
  inputs: HTMLInputElement[],
  container: HTMLElement | null,
  code: string,
): Promise<boolean> {
  const first = inputs[0]
  const view = first?.ownerDocument.defaultView
  if (!first || !view?.DataTransfer || !view.ClipboardEvent) {
    return false
  }
  const clipboardData = new view.DataTransfer()
  clipboardData.setData("text/plain", code)
  first.focus({ preventScroll: true })
  first.dispatchEvent(
    new view.ClipboardEvent("paste", {
      clipboardData,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  )
  await nextTask()
  await nextTask()
  return (
    splitValue(liveInputs(inputs, container)).toLowerCase() ===
    code.toLowerCase()
  )
}

// Synthetic key events can't carry keyCode, so widgets that filter keydown by
// keyCode would reject them; send only the input events a real keystroke fires.
function typeCharacter(input: HTMLInputElement, char: string): void {
  const view = input.ownerDocument.defaultView ?? window
  const insert = { data: char, inputType: "insertText", composed: true }
  input.focus({ preventScroll: true })
  const accepted = input.dispatchEvent(
    new view.InputEvent("beforeinput", {
      ...insert,
      bubbles: true,
      cancelable: true,
    }),
  )
  if (!accepted) {
    return
  }
  setNativeValue(input, char)
  input.dispatchEvent(
    new view.InputEvent("input", { ...insert, bubbles: true }),
  )
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

export async function fillSplitOtpGroup(
  inputs: HTMLInputElement[],
  code: string,
  container: HTMLElement | null = null,
): Promise<boolean> {
  const cleanCode = normalizeOtpCode(code)
  const characters = cleanCode.split("")
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

  // Most split widgets spread a pasted code across their boxes themselves.
  if (await pasteSplitOtp(inputs, container, cleanCode)) {
    return true
  }

  for (let index = 0; index < characters.length; index++) {
    const input = liveInputs(inputs, container)[index]
    const char = characters[index]
    if (!input || !char || !input.isConnected) {
      return false
    }
    typeCharacter(input, char)
    await nextTask()
  }

  liveInputs(inputs, container).at(-1)?.focus({ preventScroll: true })
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

export async function executeOtpFill(
  group: DetectedGroup,
  code: string,
): Promise<boolean> {
  if (group.mode === "split") {
    return fillSplitOtpGroup(group.inputs, code, group.container)
  }
  const primary = group.inputs[0]
  if (!primary) {
    return false
  }
  return fillSingleOrControllerOtp(primary, code)
}
