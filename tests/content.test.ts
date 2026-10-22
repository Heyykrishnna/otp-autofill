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
  it("detects an accessible single input and emits framework events without submitting", async () => {
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
    expect(await fillTarget(target, "482193")).toBe(true)
    expect(onInput).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      document.querySelector<HTMLInputElement>('[name="search"]')?.value,
    ).toBe("")
    expect(await fillTarget(target, "999999")).toBe(false)
  })
  it("fills six separate fields as one group", async () => {
    document.body.innerHTML = `<form><fieldset aria-label="Verification code">${Array.from({ length: 6 }, (_, index) => `<input aria-label="Digit ${index + 1}" maxlength="1" inputmode="numeric" />`).join("")}</fieldset></form>`
    const targets = detectTargets()
    expect(targets).toHaveLength(1)
    const target = targets[0]
    if (!target) throw new Error("Expected split target")
    expect(await fillTarget(target, "042193")).toBe(true)
    expect(target.inputs.map((input) => input.value).join("")).toBe("042193")
  })
  it("fills explicitly indexed digit fields without maxlength", async () => {
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
    expect(await fillTarget(target, "289217")).toBe(true)
    expect(target.inputs.map((input) => input.value).join("")).toBe("289217")
  })
  it("rejects incomplete indexed digit groups", async () => {
    document.body.innerHTML = `<form>${[1, 2, 3, 5, 6].map((position) => `<input aria-label="Digit ${position} of 6" inputmode="numeric" autocomplete="${position === 1 ? "one-time-code" : "off"}" />`).join("")}</form>`
    expect(detectTargets()).toEqual([])
  })
  it("preserves meaningful case", async () => {
    document.body.innerHTML =
      '<input aria-label="Verification code" maxlength="10" pattern="[A-Za-z0-9]{10}" />'
    const target = detectTargets()[0]
    if (!target) throw new Error("Expected target")
    expect(await fillTarget(target, "aB7xQ9Kp2Z")).toBe(true)
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
  it("detects dynamically mounted fields", async () => {
    expect(detectTargets()).toHaveLength(0)
    document.body.innerHTML =
      '<input aria-label="Security code" maxlength="6" />'
    expect(detectTargets()).toHaveLength(1)
  })
  it("refuses to overwrite typed content or detached fields", async () => {
    document.body.innerHTML = '<input name="otp" value="12" maxlength="6" />'
    const target = detectTargets()[0]
    if (!target) throw new Error("Expected target")
    expect(await fillTarget(target, "482193")).toBe(false)
    target.inputs[0]?.remove()
    expect(await fillTarget(target, "482193")).toBe(false)
  })
})

it("detects supported OTP fields inside an open shadow root", async () => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById("host")
  if (!host) throw new Error("Expected host")
  host.attachShadow({ mode: "open" }).innerHTML =
    '<input aria-label="Verification code" maxlength="6" />'
  const target = detectTargets()[0]
  if (!target) throw new Error("Expected shadow target")
  expect(await fillTarget(target, "482193")).toBe(true)
})

it("supports a ten-character split alphanumeric form", async () => {
  document.body.innerHTML = `<fieldset aria-label="Verification code">${Array.from({ length: 10 }, () => '<input maxlength="1" />').join("")}</fieldset>`
  const target = detectTargets()[0]
  if (!target) throw new Error("Expected split target")
  expect(await fillTarget(target, "UCSIAGUBQQ")).toBe(true)
  expect(target.inputs.map((input) => input.value).join("")).toBe("UCSIAGUBQQ")
})

it("uses explicit recipient and request evidence without treating masked addresses as an account", async () => {
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

it("reads a recipient from a character-count delivery message", async () => {
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
  expect(await fillTarget(target, "482193")).toBe(true)
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
  await fillTarget(target, "482193")
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

it("detects and fills segmented boxes nested in parent divs with code-index IDs and heading signals", async () => {
  document.body.innerHTML = `
    <div class="auth-card">
      <h1>Check your email inbox for your login code</h1>
      <p>We've sent a 6-character code to alice@gmail.com. The code expires shortly, so please enter it soon.</p>
      <div id="otp-container" class="otp-boxes">
        <div class="box-slot"><input id="code-0" maxlength="1" /></div>
        <div class="box-slot"><input id="code-1" maxlength="1" /></div>
        <div class="box-slot"><input id="code-2" maxlength="1" /></div>
        <div class="box-slot"><input id="code-3" maxlength="1" /></div>
        <div class="box-slot"><input id="code-4" maxlength="1" /></div>
        <div class="box-slot"><input id="code-5" maxlength="1" /></div>
      </div>
      <button type="button">Continue</button>
    </div>
  `
  const targets = detectTargets()
  expect(targets).toHaveLength(1)
  const target = targets[0]
  if (!target) throw new Error("Expected segmented target")
  expect(target.inputs).toHaveLength(6)
  expect(target.constraints.length).toBe(6)
  expect(verificationHints(target)).toEqual({
    recipient: "alice@gmail.com",
  })
  expect(await fillTarget(target, "839201")).toBe(true)
  expect(target.inputs.map((input) => input.value).join("")).toBe("839201")
})

it("detects segmented inputs with sequential prefix IDs inside an OTP container", async () => {
  document.body.innerHTML = `
    <div class="verification-wrapper">
      <div class="otp-input-group">
        <input id="otp_0" maxlength="1" />
        <input id="otp_1" maxlength="1" />
        <input id="otp_2" maxlength="1" />
        <input id="otp_3" maxlength="1" />
        <input id="otp_4" maxlength="1" />
        <input id="otp_5" maxlength="1" />
      </div>
    </div>
  `
  const targets = detectTargets()
  expect(targets).toHaveLength(1)
  const target = targets[0]
  if (!target) throw new Error("Expected segmented target")
  expect(target.inputs).toHaveLength(6)
  expect(await fillTarget(target, "123456")).toBe(true)
  expect(target.inputs.map((input) => input.value).join("")).toBe("123456")
})

it("detects segmented inputs with bracket indices and updates React value trackers", async () => {
  document.body.innerHTML = `
    <div class="auth-section">
      <h2>Enter your verification code</h2>
      <div class="inputs-row">
        ${Array.from({ length: 6 }, (_, index) => `<input id="code[${index}]" name="code[${index}]" />`).join("")}
      </div>
    </div>
  `
  const targets = detectTargets()
  expect(targets).toHaveLength(1)
  const target = targets[0]
  if (!target) throw new Error("Expected segmented target")
  expect(target.inputs).toHaveLength(6)
  const trackerValues: string[] = []
  for (const input of target.inputs) {
    Object.defineProperty(input, "_valueTracker", {
      value: {
        setValue: (value: string) => trackerValues.push(value),
      },
      configurable: true,
    })
  }
  expect(await fillTarget(target, "050151")).toBe(true)
  expect(target.inputs.map((input) => input.value).join("")).toBe("050151")
  expect(trackerValues).toHaveLength(6)
})
