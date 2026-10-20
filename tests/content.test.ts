import { beforeEach, describe, expect, it, vi } from "vitest"

import { fillTarget } from "../src/content/autofill"
import { detectTargets } from "../src/content/detector"

beforeEach(() => {
  document.body.innerHTML = ""
  vi.spyOn(HTMLInputElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => null,
    [Symbol.iterator]: () => [new DOMRect(0, 0, 100, 30)].values(),
  })
})

describe("field detection and autofill", () => {
  it("detects an accessible single input and emits framework events without submitting", () => {
    document.body.innerHTML =
      '<form><label for="code">Verification code</label><input id="code" autocomplete="one-time-code" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" /><input name="search" /></form>'
    const target = detectTargets()[0]
    if (!target) throw new Error("Expected a supported field")
    const onInput = vi.fn()
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    target.inputs[0]?.addEventListener("input", onInput)
    target.inputs[0]?.addEventListener("change", onChange)
    document.querySelector("form")?.addEventListener("submit", onSubmit)
    expect(fillTarget(target, "482193")).toBe(true)
    expect(onInput).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      document.querySelector<HTMLInputElement>('[name="search"]')?.value,
    ).toBe("")
    expect(fillTarget(target, "999999")).toBe(false)
  })
  it("fills six separate fields as one group", () => {
    document.body.innerHTML = `<form><fieldset aria-label="Verification code">${Array.from({ length: 6 }, (_, index) => `<input aria-label="Digit ${index + 1}" maxlength="1" inputmode="numeric" />`).join("")}</fieldset></form>`
    const targets = detectTargets()
    expect(targets).toHaveLength(1)
    const target = targets[0]
    if (!target) throw new Error("Expected split target")
    expect(fillTarget(target, "042193")).toBe(true)
    expect(target.inputs.map((input) => input.value).join("")).toBe("042193")
  })
  it("preserves meaningful case", () => {
    document.body.innerHTML =
      '<input aria-label="Verification code" maxlength="10" pattern="[A-Za-z0-9]{10}" />'
    const target = detectTargets()[0]
    if (!target) throw new Error("Expected target")
    expect(fillTarget(target, "aB7xQ9Kp2Z")).toBe(true)
    expect(target.inputs[0]?.value).toBe("aB7xQ9Kp2Z")
  })
  it.each([
    '<input type="password" autocomplete="one-time-code" />',
    '<input name="phone" inputmode="numeric" maxlength="6" />',
    '<input aria-label="Card security code" maxlength="4" />',
    '<input name="postal-code" maxlength="6" />',
    '<input name="otp" hidden />',
    '<input name="otp" disabled />',
    '<input name="otp" readonly />',
    '<div aria-hidden="true"><input name="otp" /></div>',
    '<input name="otp" style="display:none" />',
  ])("does not target inappropriate fields: %s", (html) => {
    document.body.innerHTML = html
    expect(detectTargets()).toEqual([])
  })
  it("detects dynamically mounted fields", () => {
    expect(detectTargets()).toHaveLength(0)
    document.body.innerHTML =
      '<input aria-label="Security code" maxlength="6" />'
    expect(detectTargets()).toHaveLength(1)
  })
  it("refuses to overwrite typed content or detached fields", () => {
    document.body.innerHTML = '<input name="otp" value="12" maxlength="6" />'
    const target = detectTargets()[0]
    if (!target) throw new Error("Expected target")
    expect(fillTarget(target, "482193")).toBe(false)
    target.inputs[0]?.remove()
    expect(fillTarget(target, "482193")).toBe(false)
  })
})
