import { beforeEach, describe, expect, it, vi } from "vitest"

import { fillTarget } from "../src/content/autofill"
import { verificationHints } from "../src/content/context"
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
  it("fills explicitly indexed digit fields without maxlength", () => {
    document.body.innerHTML = `<form><h1>Check your email inbox for your login code</h1>${Array.from({ length: 6 }, (_, index) => `<input id="otp${index}" name="otp${index}" aria-label="Digit ${index + 1} of 6" inputmode="numeric" autocomplete="${index === 0 ? "one-time-code" : "off"}" />`).join("")}<input type="hidden" name="challenge-response" /></form>`
    const targets = detectTargets()
    expect(targets).toHaveLength(1)
    const target = targets[0]
    if (!target) throw new Error("Expected indexed split target")
    expect(target.constraints).toEqual({
      length: 6,
      numeric: true,
      pattern: null,
    })
    expect(fillTarget(target, "289217")).toBe(true)
    expect(target.inputs.map((input) => input.value).join("")).toBe("289217")
  })
  it("rejects incomplete indexed digit groups", () => {
    document.body.innerHTML = `<form>${[1, 2, 3, 5, 6].map((position) => `<input aria-label="Digit ${position} of 6" inputmode="numeric" autocomplete="${position === 1 ? "one-time-code" : "off"}" />`).join("")}</form>`
    expect(detectTargets()).toEqual([])
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

it("detects supported OTP fields inside an open shadow root", () => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById("host")
  if (!host) throw new Error("Expected host")
  host.attachShadow({ mode: "open" }).innerHTML =
    '<input aria-label="Verification code" maxlength="6" />'
  const target = detectTargets()[0]
  if (!target) throw new Error("Expected shadow target")
  expect(fillTarget(target, "482193")).toBe(true)
})

it("supports a ten-character split alphanumeric form", () => {
  document.body.innerHTML = `<fieldset aria-label="Verification code">${Array.from({ length: 10 }, () => '<input maxlength="1" />').join("")}</fieldset>`
  const target = detectTargets()[0]
  if (!target) throw new Error("Expected split target")
  expect(fillTarget(target, "UCSIAGUBQQ")).toBe(true)
  expect(target.inputs.map((input) => input.value).join("")).toBe("UCSIAGUBQQ")
})

it("uses explicit recipient and request evidence without treating masked addresses as an account", () => {
  document.body.innerHTML =
    '<form data-otp-recipient="alice+login@gmail.com" data-otp-request-id="request-123"><input name="otp" maxlength="6" /><input type="email" value="bob@gmail.com" /></form>'
  let target = detectTargets()[0]
  if (!target) throw new Error("Expected target")
  expect(verificationHints(target)).toEqual({
    recipient: "alice+login@gmail.com",
    requestId: "request-123",
  })
  document.body.innerHTML =
    '<form><p>We sent a code to a***@gmail.com.</p><input name="otp" maxlength="6" /></form>'
  target = detectTargets()[0]
  if (!target) throw new Error("Expected target")
  expect(verificationHints(target)).toEqual({})
})

it("reads a recipient from a character-count delivery message", () => {
  document.body.innerHTML = `<form><p>We've sent a 6-character code to alice@gmail.com. The code expires shortly.</p>${Array.from({ length: 6 }, (_, index) => `<input aria-label="Digit ${index + 1} of 6" inputmode="numeric" autocomplete="${index === 0 ? "one-time-code" : "off"}" />`).join("")}</form>`
  const target = detectTargets()[0]
  if (!target) throw new Error("Expected indexed target")
  expect(verificationHints(target)).toEqual({ recipient: "alice@gmail.com" })
})

it("sends Enter and validates the form before submitting, without submitting a second time", async () => {
  const { enterTarget } = await import("../src/content/submit")
  document.body.innerHTML =
    '<form><input name="otp" maxlength="6" required pattern="[0-9]{6}" /><button type="submit">Verify</button></form>'
  const target = detectTargets()[0]
  const form = document.querySelector("form")
  if (!target || !form) throw new Error("Expected OTP form")
  const submitted = new WeakSet<HTMLFormElement>()
  const submit = vi.fn((event: Event) => {
    event.preventDefault()
    submitted.add(form)
  })
  form.addEventListener("submit", submit)
  const key = vi.fn()
  target.inputs[0]?.addEventListener("keydown", key)
  expect(fillTarget(target, "482193")).toBe(true)
  expect(enterTarget(target, "482193", submitted)).toBe(true)
  expect(key).toHaveBeenCalledOnce()
  expect(submit).toHaveBeenCalledOnce()
  expect(enterTarget(target, "482193", submitted)).toBe(false)
  expect(submit).toHaveBeenCalledOnce()
})

it("respects prevented Enter, changed values and incomplete forms", async () => {
  const { enterTarget } = await import("../src/content/submit")
  document.body.innerHTML =
    '<form><input name="otp" maxlength="6" /><input type="email" required /><button type="submit">Verify</button></form>'
  const target = detectTargets()[0]
  if (!target) throw new Error("Expected OTP form")
  const submit = vi.fn((event: Event) => event.preventDefault())
  document.querySelector("form")?.addEventListener("submit", submit)
  fillTarget(target, "482193")
  expect(enterTarget(target, "482193", new WeakSet())).toBe(false)
  const email = document.querySelector<HTMLInputElement>('[type="email"]')
  if (!email) throw new Error("Expected email field")
  email.value = "alice@gmail.com"
  target.inputs[0]?.addEventListener("keydown", (event) =>
    event.preventDefault(),
  )
  expect(enterTarget(target, "482193", new WeakSet())).toBe(true)
  expect(submit).not.toHaveBeenCalled()
  expect(enterTarget(target, "987654", new WeakSet())).toBe(false)
})
