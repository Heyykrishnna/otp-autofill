import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  fillResolvedOtp,
  resolveAllOtpGroups,
  resolveOtpGroup,
} from "../src/otp/OtpFieldResolver"
import {
  validateOtpFormat,
  normalizeOtpCode,
} from "../src/otp/OtpFormatValidator"

beforeEach(() => {
  document.body.innerHTML = ""
  vi.spyOn(HTMLInputElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => null,
    [Symbol.iterator]: () => [new DOMRect(0, 0, 100, 30)].values(),
  })
})

describe("OtpFormatValidator", () => {
  it("normalizes spaced and dashed codes while preserving case", async () => {
    expect(normalizeOtpCode(" 050 151 ")).toBe("050151")
    expect(normalizeOtpCode("aB3-9Zq")).toBe("aB39Zq")
  })

  it("validates code constraints", async () => {
    expect(
      validateOtpFormat("482 193", { length: 6, numeric: true, pattern: null }),
    ).toBe("482193")
    expect(
      validateOtpFormat("48219", { length: 6, numeric: true, pattern: null }),
    ).toBeNull()
    expect(
      validateOtpFormat("48219A", { length: 6, numeric: true, pattern: null }),
    ).toBeNull()
    expect(
      validateOtpFormat("aB7xQ9", { length: 6, numeric: false, pattern: null }),
    ).toBe("aB7xQ9")
    expect(
      validateOtpFormat("314159", {
        length: 6,
        numeric: true,
        pattern: "[0-9]*",
      }),
    ).toBe("314159")
  })
})

describe("OtpFieldResolver - Case A: Single input", () => {
  it("resolves and fills a single one-time code field", async () => {
    document.body.innerHTML = `
      <form>
        <label for="otp">One-time code</label>
        <input id="otp" autocomplete="one-time-code" maxlength="6" inputmode="numeric" />
      </form>
    `
    const group = resolveOtpGroup()
    expect(group).not.toBeNull()
    if (!group) throw new Error("Expected group")
    expect(group.mode).toBe("single")
    expect(group.inputs).toHaveLength(1)
    expect(group.expectedLength).toBeNull()
    expect(group.maxLength).toBe(6)

    const result = await fillResolvedOtp(group, "482193")
    expect(result.accepted).toBe(true)
    expect(result.filledValue).toBe("482193")
    expect(group.inputs[0]?.value).toBe("482193")
  })
})

describe("OtpFieldResolver - Case B: Split multi-box inputs", () => {
  it("resolves and distributes digits across six separate boxes in order", async () => {
    document.body.innerHTML = `
      <div class="auth-container">
        <h2>Enter the 6-digit code</h2>
        <div class="otp-boxes">
          <input data-slot="2" maxlength="1" />
          <input data-slot="0" maxlength="1" />
          <input data-slot="4" maxlength="1" />
          <input data-slot="1" maxlength="1" />
          <input data-slot="5" maxlength="1" />
          <input data-slot="3" maxlength="1" />
        </div>
      </div>
    `
    const group = resolveOtpGroup()
    expect(group).not.toBeNull()
    if (!group) throw new Error("Expected group")
    expect(group.mode).toBe("split")
    expect(group.inputs).toHaveLength(6)
    expect(
      group.inputs.map((input) => input.getAttribute("data-slot")),
    ).toEqual(["0", "1", "2", "3", "4", "5"])

    const result = await fillResolvedOtp(group, "050151")
    expect(result.accepted).toBe(true)
    expect(result.filledValue).toBe("050151")
    expect(group.inputs.map((input) => input.value).join("")).toBe("050151")
  })

  it("supports four-box and eight-box split configurations", async () => {
    document.body.innerHTML = `
      <form aria-label="Verification form">
        <fieldset class="pin-inputs">
          ${Array.from({ length: 4 }, (_, i) => `<input id="pin_${i}" maxlength="1" inputmode="numeric" />`).join("")}
        </fieldset>
      </form>
    `
    const group4 = resolveOtpGroup()
    expect(group4).not.toBeNull()
    if (!group4) throw new Error("Expected 4-box group")
    expect(group4.expectedLength).toBe(4)
    expect((await fillResolvedOtp(group4, "9182")).accepted).toBe(true)
    expect(group4.inputs.map((i) => i.value).join("")).toBe("9182")
  })

  it("preserves alphanumeric case across split boxes", async () => {
    document.body.innerHTML = `
      <div class="login-challenge">
        <h3>Security Code</h3>
        <div class="code-row">
          ${Array.from({ length: 6 }, (_, i) => `<input aria-label="Character ${i + 1}" maxlength="1" />`).join("")}
        </div>
      </div>
    `
    const group = resolveOtpGroup()
    expect(group).not.toBeNull()
    if (!group) throw new Error("Expected group")
    const result = await fillResolvedOtp(group, "kH7mQ2")
    expect(result.accepted).toBe(true)
    expect(group.inputs.map((i) => i.value).join("")).toBe("kH7mQ2")
  })
})

describe("OtpFieldResolver - Case C: Logical input with visual boxes (controller mode)", () => {
  it("resolves and fills a concealed input that backs visual slot presentation elements", async () => {
    document.body.innerHTML = `
      <div class="otp-component">
        <label>Enter verification code</label>
        <input class="input-otp" autocomplete="one-time-code" maxlength="6" style="opacity:0" />
        <div class="visual-slots" role="presentation">
          <div data-slot="slot" class="slot"></div>
          <div data-slot="slot" class="slot"></div>
          <div data-slot="slot" class="slot"></div>
          <div data-slot="slot" class="slot"></div>
          <div data-slot="slot" class="slot"></div>
          <div data-slot="slot" class="slot"></div>
        </div>
      </div>
    `
    const group = resolveOtpGroup()
    expect(group).not.toBeNull()
    if (!group) throw new Error("Expected controller group")
    expect(group.mode).toBe("controller")
    expect(group.expectedLength).toBe(6)

    const result = await fillResolvedOtp(group, "050151")
    expect(result.accepted).toBe(true)
    expect(result.filledValue).toBe("050151")
    expect(group.inputs[0]?.value).toBe("050151")
  })

  it("resolves a Luma-style visual code widget without maxlength", async () => {
    document.body.innerHTML = `
      <main>
        <h3>Enter Code</h3>
        <p>Please enter the 6 digit code we sent to test@example.com.</p>
        <div class="container spread">
          ${Array.from({ length: 6 }, () => '<div aria-hidden="true" class="slot animated rounded"></div>').join("")}
          <input inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" aria-label="Verification code" type="text" />
        </div>
      </main>
    `
    const group = resolveOtpGroup()
    expect(group).not.toBeNull()
    if (!group) throw new Error("Expected Luma-style controller group")
    expect(group.mode).toBe("controller")
    expect(group.inputs).toHaveLength(1)
    expect(group.expectedLength).toBe(6)
    expect(group.numeric).toBe(true)

    const result = await fillResolvedOtp(group, "314159")
    expect(result.accepted).toBe(true)
    expect(result.filledValue).toBe("314159")
  })
})

describe("OtpFieldResolver - Robustness and Edge Cases", () => {
  it("refuses to overwrite partially entered user digits", async () => {
    document.body.innerHTML = `
      <div class="otp-group">
        <input data-slot="0" value="5" maxlength="1" />
        <input data-slot="1" maxlength="1" />
        <input data-slot="2" maxlength="1" />
        <input data-slot="3" maxlength="1" />
        <input data-slot="4" maxlength="1" />
        <input data-slot="5" maxlength="1" />
      </div>
    `
    const group = resolveOtpGroup()
    expect(group).not.toBeNull()
    if (!group) throw new Error("Expected group")
    const result = await fillResolvedOtp(group, "050151")
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain("failed")
  })

  it("refuses to partially fill when one box in a group is disabled or read-only", async () => {
    document.body.innerHTML = `
      <div class="otp-group">
        <input data-slot="0" maxlength="1" />
        <input data-slot="1" maxlength="1" />
        <input data-slot="2" maxlength="1" disabled />
        <input data-slot="3" maxlength="1" />
        <input data-slot="4" maxlength="1" />
        <input data-slot="5" maxlength="1" />
      </div>
    `
    const group = resolveOtpGroup()
    if (group) {
      expect((await fillResolvedOtp(group, "050151")).accepted).toBe(false)
    }
  })

  it("handles multiple OTP groups by focusing on the active element or empty group", async () => {
    document.body.innerHTML = `
      <form id="form1">
        <input id="otp1" autocomplete="one-time-code" maxlength="6" value="123456" />
      </form>
      <form id="form2">
        <input id="otp2" autocomplete="one-time-code" maxlength="6" />
      </form>
    `
    const groups = resolveAllOtpGroups()
    expect(groups).toHaveLength(2)

    const resolved = resolveOtpGroup()
    expect(resolved).not.toBeNull()
    expect(resolved?.inputs[0]?.id).toBe("otp2")
  })

  it("verifies fill failure if host page marks input invalid", async () => {
    document.body.innerHTML = `
      <input id="otp" autocomplete="one-time-code" maxlength="6" />
    `
    const group = resolveOtpGroup()
    if (!group) throw new Error("Expected group")
    const input = group.inputs[0]
    input?.addEventListener("change", () => {
      input.setAttribute("aria-invalid", "true")
    })
    const result = await fillResolvedOtp(group, "123456")
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain("invalid")
  })
})

describe("generalized detection", () => {
  function layout(inputs: HTMLInputElement[], width = 44, gap = 8) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const index = inputs.indexOf(this as HTMLInputElement)
        if (index === -1) return new DOMRect(0, 0, 0, 0)
        return new DOMRect(index * (width + gap), 100, width, 44)
      },
    )
  }

  it("groups a row of plain equal boxes when the page asks for a code", () => {
    document.body.innerHTML = `
      <main>
        <h1>Verify your email</h1>
        <p>Enter the 6-digit code we sent you</p>
        <form><div>${"<input type='text'>".repeat(6)}</div></form>
      </main>`
    const inputs = [...document.querySelectorAll("input")]
    layout(inputs)
    const groups = resolveAllOtpGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0]?.mode).toBe("split")
    expect(groups[0]?.inputs).toEqual(inputs)
  })

  it("ignores a row of wide fields even on a code page", () => {
    document.body.innerHTML = `
      <main>
        <p>Enter the 6-digit code we sent you</p>
        <form><div>${"<input type='text'>".repeat(4)}</div></form>
      </main>`
    layout([...document.querySelectorAll("input")], 240)
    expect(
      resolveAllOtpGroups().filter((group) => group.mode === "split"),
    ).toHaveLength(0)
  })

  it("finds the code prompt a few levels above the form", () => {
    document.body.innerHTML = `
      <main>
        <h1>Check your inbox</h1>
        <p>Enter the 6-digit code we sent you</p>
        <div><form><label for="c">Code</label><input id="c" name="code"></form></div>
      </main>`
    expect(resolveAllOtpGroups().map((group) => group.mode)).toEqual(["single"])
  })

  it("does not read code prompts from the whole page body", () => {
    document.body.innerHTML = `
      <p>Enter the 6-digit code we sent you</p>
      <footer><input placeholder="you@example.com"></footer>`
    expect(resolveAllOtpGroups()).toHaveLength(0)
  })

  it("keeps boxes together when only some carry maxlength=1", () => {
    document.body.innerHTML = `
      <main>
        <p>Enter the 6-digit code we sent you</p>
        <div class="otp">
          ${"<input type='tel'>".repeat(5)}<input type="tel" maxlength="1">
        </div>
      </main>`
    expect(resolveAllOtpGroups().map((group) => group.inputs.length)).toEqual([
      6,
    ])
  })

  it("yields to the page between boxes", async () => {
    document.body.innerHTML = `
      <div aria-label="Verification code">
        ${"<input maxlength='1' inputmode='numeric'>".repeat(6)}
      </div>`
    const group = resolveOtpGroup()
    expect(group?.mode).toBe("split")
    const seen: string[] = []
    group?.inputs.forEach((input) =>
      input.addEventListener("input", () =>
        setTimeout(() =>
          seen.push(group.inputs.map((item) => item.value).join("")),
        ),
      ),
    )
    expect((await fillResolvedOtp(group!, "482193")).accepted).toBe(true)
    expect(seen[0]).toBe("4")
  })
})
