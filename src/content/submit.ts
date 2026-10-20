import type { OtpTarget } from "./detector"
import { isUsable } from "./detector"

export function enterTarget(
  target: OtpTarget,
  code: string,
  alreadySubmitted: WeakSet<HTMLFormElement>,
): boolean {
  const inputs = target.inputs
  const last = inputs.at(-1)
  if (
    !last ||
    inputs.some(
      (input, index) =>
        !isUsable(input) ||
        input.value !== (inputs.length === 1 ? code : code[index]),
    )
  )
    return false
  const form = last.form
  if (
    form &&
    (alreadySubmitted.has(form) ||
      form.closest('[aria-busy="true"]') ||
      !form.checkValidity())
  )
    return false
  const root = form ?? last.parentElement
  if (
    root &&
    [...root.querySelectorAll('[role="status"]')].some((element) =>
      /(?:verification|email|account)\s+(?:is\s+)?(?:complete|verified|successful)/i.test(
        element.textContent ?? "",
      ),
    )
  )
    return false
  last.focus({ preventScroll: true })
  const allowed = last.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  )
  last.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      composed: true,
    }),
  )
  if (!allowed || !form || alreadySubmitted.has(form)) return true
  if (
    inputs.some(
      (input, index) =>
        !isUsable(input) ||
        input.value !== (inputs.length === 1 ? code : code[index]) ||
        input.form !== form,
    ) ||
    !form.isConnected ||
    !form.checkValidity()
  )
    return true
  const submitter = [
    ...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button, input[type="submit"], input[type="image"]',
    ),
  ].find((element) => element.form === form && element.type === "submit")
  if (
    submitter &&
    (submitter.disabled || submitter.getAttribute("aria-disabled") === "true")
  )
    return true
  const prototype = form.ownerDocument.defaultView?.HTMLFormElement.prototype
  if (!prototype?.requestSubmit) return true
  prototype.requestSubmit.call(form, submitter)
  return true
}
