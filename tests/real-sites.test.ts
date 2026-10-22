import { act, createElement as h, createRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { fillTarget } from "../src/content/autofill"
import { detectTargets } from "../src/content/detector"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

beforeEach(() => {
  document.body.innerHTML = ""
  vi.spyOn(HTMLInputElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => null,
    [Symbol.iterator]: () => [new DOMRect(0, 0, 100, 30)].values(),
  })
})

function mount(node: ReturnType<typeof h>) {
  const host = document.createElement("div")
  document.body.append(host)
  act(() => createRoot(host).render(node))
}

// Mirrors luma.com's code input: one transparent input over six aria-hidden slots.
function LumaCode({ onCode }: { onCode: (code: string) => void }) {
  const [value, setValue] = useState("")
  return h("div", { className: "container" }, [
    ...Array.from({ length: 6 }, (_, index) =>
      h(
        "div",
        { key: index, "aria-hidden": "true", className: "slot animated" },
        value[index] ?? null,
      ),
    ),
    h("input", {
      key: "input",
      type: "text",
      inputMode: "numeric",
      pattern: "[0-9]*",
      autoComplete: "one-time-code",
      "data-1p-ignore": true,
      "data-form-type": "other",
      "aria-label": "Verification code",
      className: "input",
      style: { opacity: 0, position: "absolute" },
      value,
      onChange: (event: { currentTarget: HTMLInputElement }) => {
        const next = event.currentTarget.value.replace(/\D/g, "").slice(0, 6)
        setValue(next)
        if (next.length === 6) onCode(next)
      },
    }),
  ])
}

// Mirrors mlh.com's uncontrolled six-box input, which redistributes each input event.
function MlhCode({ onCode }: { onCode: (code: string) => void }) {
  const [refs] = useState(() =>
    Array.from({ length: 6 }, () => createRef<HTMLInputElement>()),
  )
  const joined = () => refs.map((ref) => ref.current?.value ?? "").join("")
  const focus = (index: number) => {
    refs[index]?.current?.focus()
    refs[index]?.current?.select()
  }
  const spread = (start: number, digits: string) => {
    digits
      .slice(0, refs.length - start)
      .split("")
      .forEach((digit, offset) => {
        refs[start + offset]!.current!.value = digit
      })
    onCode(joined())
    focus(Math.min(start + digits.length, refs.length - 1))
  }
  return h(
    "div",
    null,
    refs.map((ref, index) =>
      h("input", {
        key: index,
        ref,
        type: "text",
        inputMode: "numeric",
        autoComplete: index === 0 ? "one-time-code" : "off",
        id: `otp${index}`,
        name: `otp${index}`,
        "aria-label": `Digit ${index + 1} of 6`,
        onInput: (event: { currentTarget: HTMLInputElement }) => {
          const input = event.currentTarget
          const digits = input.value.replace(/\D/g, "")
          input.value = ""
          if (digits) spread(index, digits)
          else onCode(joined())
        },
      }),
    ),
  )
}

describe("real-site OTP widgets", () => {
  it("fills Luma's hidden input behind six visual slots", async () => {
    const codes: string[] = []
    mount(
      h("div", null, [
        h("h2", { key: "title" }, "Enter Code"),
        h(LumaCode, { key: "code", onCode: (code) => codes.push(code) }),
      ]),
    )
    const targets = detectTargets()
    expect(targets.map((target) => target.group?.mode)).toEqual(["controller"])
    await act(async () => {
      expect(await fillTarget(targets[0]!, "482193")).toBe(true)
    })
    expect(codes).toEqual(["482193"])
  })

  it("fills MLH's six uncontrolled boxes in order", async () => {
    let code = ""
    mount(
      h("div", null, [
        h("h1", { key: "title" }, "Check your email inbox for your login code"),
        h(
          "form",
          { key: "form" },
          h(MlhCode, { onCode: (next) => (code = next) }),
        ),
      ]),
    )
    const targets = detectTargets()
    expect(targets.map((target) => target.inputs.length)).toEqual([6])
    await act(async () => {
      expect(await fillTarget(targets[0]!, "482193")).toBe(true)
    })
    expect(code).toBe("482193")
  })
})
