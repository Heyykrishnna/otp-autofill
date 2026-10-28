import { detectOtpGroups, type DetectedGroup } from "./OtpGroupDetector"
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

export function liveInputs(
  inputs: HTMLInputElement[],
  container: HTMLElement | null,
): HTMLInputElement[] {
  if (inputs.every((input) => input.isConnected) || !container?.isConnected) {
    return inputs
  }
  const groups = detectOtpGroups(
    [...container.querySelectorAll("input")].filter(isEligibleInput),
  ).filter((group) => group.inputs.length === inputs.length)
  return groups.length === 1 ? (groups[0]?.inputs ?? inputs) : inputs
}

function splitValue(inputs: HTMLInputElement[]): string {
  return inputs.map((input) => input.value).join("")
}

async function pasteSplitOtp(
  inputs: HTMLInputElement[],
  container: HTMLElement | null,
  code: string,
  canContinue: () => boolean,
): Promise<boolean> {
  const first = inputs[0]
  const view = first?.ownerDocument.defaultView
  if (!first || !view?.DataTransfer || !view.ClipboardEvent) {
    return false
  }
  const clipboardData = new view.DataTransfer()
  clipboardData.setData("text/plain", code)
  first.focus({ preventScroll: true })
  if (!canContinue() || !isEligibleInput(first) || first.value.trim() !== "")
    return false
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

function insertText(
  input: HTMLInputElement,
  text: string,
  canContinue: () => boolean,
): boolean {
  const view = input.ownerDocument.defaultView ?? window
  const insert = { data: text, inputType: "insertText", composed: true }
  input.focus({ preventScroll: true })
  if (!canContinue() || !isEligibleInput(input) || input.value.trim() !== "")
    return false
  const accepted = input.dispatchEvent(
    new view.InputEvent("beforeinput", {
      ...insert,
      bubbles: true,
      cancelable: true,
    }),
  )
  if (!accepted) {
    return true
  }
  if (!canContinue() || !isEligibleInput(input) || input.value.trim() !== "")
    return false
  setNativeValue(input, text)
  input.dispatchEvent(
    new view.InputEvent("input", { ...insert, bubbles: true }),
  )
  if (input.isConnected)
    input.dispatchEvent(new view.Event("change", { bubbles: true }))
  return true
}

export async function fillSplitOtpGroup(
  inputs: HTMLInputElement[],
  code: string,
  container: HTMLElement | null = null,
  canContinue: () => boolean = () => true,
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

  if (!canContinue()) return false
  if (await pasteSplitOtp(inputs, container, cleanCode, canContinue)) {
    return canContinue()
  }

  for (let index = 0; index < characters.length; index++) {
    const current = liveInputs(inputs, container)
    if (
      !canContinue() ||
      current.some(
        (input, position) =>
          !isEligibleInput(input) ||
          (position < index
            ? input.value !== characters[position]
            : input.value.trim() !== ""),
      )
    )
      return false
    const input = current[index]
    const char = characters[index]
    if (!input || !char || !input.isConnected) {
      return false
    }
    if (!insertText(input, char, canContinue)) return false
    await nextTask()
  }

  return canContinue()
}

export function fillSingleOrControllerOtp(
  input: HTMLInputElement,
  code: string,
  canContinue: () => boolean = () => true,
): boolean {
  if (!input.isConnected || input.disabled || input.readOnly) {
    return false
  }
  if (input.value.trim() !== "") {
    return false
  }
  const cleanCode = normalizeOtpCode(code)
  return insertText(input, cleanCode, canContinue)
}

export async function executeOtpFill(
  group: DetectedGroup,
  code: string,
  canContinue: () => boolean = () => true,
): Promise<boolean> {
  if (!canContinue()) return false
  if (group.mode === "split") {
    return fillSplitOtpGroup(group.inputs, code, group.container, canContinue)
  }
  const primary = group.inputs[0]
  if (!primary) {
    return false
  }
  return fillSingleOrControllerOtp(primary, code, canContinue)
}
