import { createRef, useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { OTPInput } from "input-otp"
import * as Radix from "@radix-ui/react-one-time-password-field"
import { Input as AntInput } from "antd"
import "@mantine/core/styles.css"
import { MantineProvider, PinInput as MantinePin } from "@mantine/core"
import {
  ChakraProvider,
  defaultSystem,
  PinInput as ChakraPin,
} from "@chakra-ui/react"
import { PinInput as ArkPin } from "@ark-ui/react/pin-input"
import { InputOtp as PrimeOtp } from "primereact/inputotp"
import ReactOtpInput from "react-otp-input"
import { MuiOtpInput } from "mui-one-time-password-input"
import VerificationInputModule from "react-verification-input"
import React18OtpModule from "react18-input-otp"
import { PrimeReactProvider } from "@primereact/core/config"
import { createApp, h as vh } from "vue"
import Vue3Otp from "vue3-otp-input"
import { fillTarget } from "../../src/content/autofill"
import { detectTargets } from "../../src/content/detector"

const interop = (m: any) =>
  m && typeof m === "object" && "default" in m ? m.default : m
const VerificationInput = interop(VerificationInputModule)
const React18Otp = interop(React18OtpModule)

const w = window as unknown as Record<string, unknown>
const report = (value: string) => {
  w.__value = value
}

function Controlled({
  render,
}: {
  render: (v: string, set: (v: string) => void) => ReactNode
}) {
  const [value, setValue] = useState("")
  return <>{render(value, (next) => (setValue(next), report(next)))}</>
}

function MlhCode() {
  const [refs] = useState(() =>
    Array.from({ length: 6 }, () => createRef<HTMLInputElement>()),
  )
  const joined = () => refs.map((r) => r.current?.value ?? "").join("")
  const focus = (i: number) => (
    refs[i]?.current?.focus(),
    refs[i]?.current?.select()
  )
  const spread = (start: number, digits: string) => {
    digits
      .slice(0, 6 - start)
      .split("")
      .forEach((d, k) => (refs[start + k]!.current!.value = d))
    report(joined())
    focus(Math.min(start + digits.length, 5))
  }
  useEffect(() => void refs[0]!.current?.focus(), [refs])
  return (
    <div>
      {refs.map((ref, i) => (
        <input
          key={i}
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          id={`otp${i}`}
          name={`otp${i}`}
          aria-label={`Digit ${i + 1} of 6`}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return
            if (/^[0-9]$/.test(e.key)) {
              e.preventDefault()
              refs[i]!.current!.value = e.key
              report(joined())
              if (i < 5) focus(i + 1)
            }
          }}
          onInput={(e) => {
            const t = e.currentTarget,
              d = t.value.replace(/\D/g, "")
            t.value = ""
            if (d) spread(i, d)
            else report(joined())
          }}
          onPaste={(e) => {
            e.preventDefault()
            spread(0, e.clipboardData.getData("text/plain").replace(/\D/g, ""))
          }}
        />
      ))}
    </div>
  )
}

function LumaCode() {
  const [value, setValue] = useState("")
  return (
    <div style={{ display: "flex", gap: 8, position: "relative" }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="slot animated rounded"
          style={{ width: 44, height: 44, border: "1px solid #ccc" }}
        >
          {value[i]}
        </div>
      ))}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        aria-label="Verification code"
        data-1p-ignore="true"
        className="input"
        value={value}
        style={{
          opacity: 0,
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
        onChange={(e) => {
          const n = e.currentTarget.value.replace(/\D/g, "").slice(0, 6)
          setValue(n)
          report(n)
        }}
      />
    </div>
  )
}

function vanillaBoxes(
  root: HTMLElement,
  opts: { maxlength: boolean; keydownOnly: boolean },
) {
  root.style.display = "flex"
  const boxes = Array.from({ length: 6 }, () => {
    const input = document.createElement("input")
    input.type = "text"
    input.className = "box"
    input.style.width = "40px"
    if (opts.maxlength) input.maxLength = 1
    root.append(input)
    return input
  })
  const sync = () => report(boxes.map((b) => b.value).join(""))
  boxes.forEach((box, i) => {
    if (opts.keydownOnly) {
      box.addEventListener("keydown", (e) => {
        if (/^\d$/.test(e.key)) {
          e.preventDefault()
          box.value = e.key
          sync()
          boxes[i + 1]?.focus()
        }
      })
      box.addEventListener("input", () => {
        box.value = box.value.replace(/\D/g, "").slice(-1)
        sync()
      })
    } else {
      box.addEventListener("input", () => {
        box.value = box.value.replace(/\D/g, "").slice(-1)
        sync()
        if (box.value) boxes[i + 1]?.focus()
      })
    }
  })
}

const ALNUM = /[^a-z0-9]/gi

function DataBoxes() {
  const [chars, setChars] = useState<string[]>(() => Array(6).fill(""))
  const box = (i: number) =>
    document.querySelectorAll<HTMLInputElement>("input.data-box")[i]
  const fill = (start: number, text: string) => {
    const next = [...chars]
    text.split("").forEach((c, k) => {
      if (start + k < 6) next[start + k] = c
    })
    setChars(next)
    report(next.join(""))
    box(Math.min(start + text.length, 5))?.focus()
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {chars.map((c, i) => (
        <input
          key={i}
          className="data-box"
          type="text"
          value={c}
          style={{ width: 44, height: 44 }}
          onChange={() => {}}
          onInput={(e) => {
            const data = (e.nativeEvent as InputEvent).data
            if (data) fill(i, data.replace(ALNUM, "").toUpperCase().slice(-1))
          }}
          onPaste={(e) => {
            e.preventDefault()
            fill(
              i,
              e.clipboardData.getData("text").replace(ALNUM, "").toUpperCase(),
            )
          }}
        />
      ))}
    </div>
  )
}

function RemountBoxes() {
  const [code, setCode] = useState("")
  const set = (next: string) => {
    setCode(next)
    report(next)
    setTimeout(() =>
      document
        .querySelectorAll<HTMLInputElement>("input.remount-box")
        [Math.min(next.length, 5)]?.focus(),
    )
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={`${i}:${code}`}
          className="remount-box"
          type="text"
          defaultValue={code[i] ?? ""}
          style={{ width: 44, height: 44 }}
          onInput={(e) => {
            const c = e.currentTarget.value.replace(ALNUM, "").slice(-1)
            if (c) set((code.slice(0, i) + c).toUpperCase().slice(0, 6))
          }}
          onPaste={(e) => {
            e.preventDefault()
            set(
              e.clipboardData
                .getData("text")
                .replace(ALNUM, "")
                .toUpperCase()
                .slice(0, 6),
            )
          }}
        />
      ))}
    </div>
  )
}

function beforeInputBoxes(root: HTMLElement) {
  root.style.display = "flex"
  const boxes = Array.from({ length: 6 }, () => {
    const input = document.createElement("input")
    input.type = "text"
    input.style.width = "40px"
    root.append(input)
    return input
  })
  const sync = () => report(boxes.map((b) => b.value).join(""))
  boxes.forEach((box, i) => {
    box.addEventListener("beforeinput", (e) => {
      e.preventDefault()
      const c = (e.data ?? "").replace(ALNUM, "").slice(-1).toUpperCase()
      if (!c) return
      box.value = c
      sync()
      boxes[i + 1]?.focus()
    })
    box.addEventListener("input", () => {
      box.value = ""
    })
    box.addEventListener("paste", (e) => {
      e.preventDefault()
      const text = (e.clipboardData?.getData("text") ?? "").replace(ALNUM, "")
      text
        .toUpperCase()
        .split("")
        .forEach((c, k) => boxes[i + k] && (boxes[i + k]!.value = c))
      sync()
    })
  })
}

function probeBoxes(
  root: HTMLElement,
  opts: { type?: string; text?: string; scaleFirst?: boolean; count?: number },
) {
  root.innerHTML = opts.text ?? ""
  const row = document.createElement("div")
  row.style.display = "flex"
  row.style.gap = "10px"
  root.append(row)
  const boxes = Array.from({ length: opts.count ?? 6 }, () => {
    const input = document.createElement("input")
    input.type = opts.type ?? "text"
    input.style.cssText = "width:48px;height:48px;text-align:center"
    row.append(input)
    return input
  })
  if (opts.scaleFirst) boxes[0]!.style.transform = "scale(1.08)"
  const sync = () => report(boxes.map((b) => b.value).join(""))
  boxes.forEach((box, i) =>
    box.addEventListener("input", () => {
      box.value = box.value.slice(-1)
      sync()
      if (box.value) boxes[i + 1]?.focus()
    }),
  )
}

function genericSingle(main: string, attrs: string) {
  document.querySelector("main")!.innerHTML = main.replace(
    "{input}",
    `<input ${attrs}>`,
  )
  const input = document.querySelector<HTMLInputElement>("main input")!
  input.addEventListener("input", () => report(input.value))
}

const react: Record<string, () => ReactNode> = {
  "input-otp (shadcn)": () => (
    <OTPInput
      maxLength={6}
      onChange={report}
      render={({ slots }) => (
        <div style={{ display: "flex" }}>
          {slots.map((s, i) => (
            <div
              key={i}
              data-slot="input-otp-slot"
              style={{ width: 40, height: 40 }}
            >
              {s.char}
            </div>
          ))}
        </div>
      )}
    />
  ),
  "radix one-time-password-field": () => (
    <Radix.Root onValueChange={report}>
      {Array.from({ length: 6 }, (_, i) => (
        <Radix.Input key={i} />
      ))}
      <Radix.HiddenInput />
    </Radix.Root>
  ),
  "antd Input.OTP": () => (
    <AntInput.OTP length={6} onInput={(v: string[]) => report(v.join(""))} />
  ),
  "mantine PinInput": () => (
    <MantineProvider>
      <MantinePin length={6} onChange={report} />
    </MantineProvider>
  ),
  "chakra v3 PinInput": () => (
    <ChakraProvider value={defaultSystem}>
      <ChakraPin.Root onValueChange={(d) => report(d.valueAsString)}>
        <ChakraPin.HiddenInput />
        <ChakraPin.Control>
          {Array.from({ length: 6 }, (_, i) => (
            <ChakraPin.Input key={i} index={i} />
          ))}
        </ChakraPin.Control>
      </ChakraPin.Root>
    </ChakraProvider>
  ),
  "ark-ui / zag PinInput": () => (
    <ArkPin.Root onValueChange={(d) => report(d.valueAsString)}>
      <ArkPin.HiddenInput />
      <ArkPin.Control>
        {Array.from({ length: 6 }, (_, i) => (
          <ArkPin.Input key={i} index={i} />
        ))}
      </ArkPin.Control>
    </ArkPin.Root>
  ),
  "primereact InputOtp": () => (
    <PrimeReactProvider>
      <PrimeOtp.Root
        onValueChange={(e: { value: string }) => report(e.value)}
        integerOnly
      >
        {Array.from({ length: 6 }, (_, i) => (
          <PrimeOtp.Text key={i} index={i} />
        ))}
      </PrimeOtp.Root>
    </PrimeReactProvider>
  ),
  "react-otp-input": () => (
    <Controlled
      render={(v, set) => (
        <ReactOtpInput
          value={v}
          onChange={set}
          numInputs={6}
          renderInput={(p) => <input {...p} />}
        />
      )}
    />
  ),
  "mui-one-time-password-input": () => (
    <Controlled
      render={(v, set) => <MuiOtpInput value={v} onChange={set} length={6} />}
    />
  ),
  "react-verification-input": () => (
    <VerificationInput length={6} onChange={report} />
  ),
  "react18-input-otp": () => (
    <Controlled
      render={(v, set) => <React18Otp value={v} onChange={set} numInputs={6} />}
    />
  ),
  "hand-rolled: MLH copy": () => <MlhCode />,
  "hand-rolled: Luma copy": () => <LumaCode />,
  "alnum: React boxes reading InputEvent.data": () => <DataBoxes />,
  "alnum: React boxes remounted per character": () => <RemountBoxes />,
}

const vanilla: Record<string, (root: HTMLElement) => void> = {
  "general: single field, maxlength longer than code": () =>
    genericSingle(
      "<h2>Check your email</h2><p>Enter the code we sent to your email.</p><form>{input}<button>Continue</button></form>",
      'type="text" name="code" maxlength="10"',
    ),
  "general: single field named token, generic text": () =>
    genericSingle(
      "<div><div>Check your inbox</div><div>We emailed you a code</div><form>{input}<button>Submit</button></form></div>",
      'type="text" name="token" placeholder="Enter code"',
    ),
  "general: single number field": () =>
    genericSingle(
      "<h2>Confirm it is you</h2><p>Type the code from the email.</p><form>{input}<button>Continue</button></form>",
      'type="number" id="code-input"',
    ),
  "general: password-masked boxes": (root) =>
    probeBoxes(root, { type: "password" }),
  "general: generic 'enter the code' text in divs": (root) => {
    document.querySelector("main")!.innerHTML =
      '<div class="screen"><div class="title">Almost there</div><div class="sub">Enter the code we emailed you</div><div id="slot"></div><button>Verify</button></div>'
    probeBoxes(document.getElementById("slot")!, {})
  },
  "general: focused box scaled up": (root) =>
    probeBoxes(root, { scaleFirst: true }),
  "general: 4-box PIN": (root) => probeBoxes(root, { count: 4 }),
  "alnum: beforeinput-only boxes": beforeInputBoxes,
  "vue3-otp-input": (root) => {
    createApp({
      render: () =>
        vh(Vue3Otp, {
          numInputs: 6,
          inputType: "tel",
          onOnChange: report,
          "onUpdate:value": report,
        }),
    }).mount(root)
  },
  "hand-rolled: maxlength=1 boxes": (root) =>
    vanillaBoxes(root, { maxlength: true, keydownOnly: false }),
  "hand-rolled: plain boxes, no hints": (root) =>
    vanillaBoxes(root, { maxlength: false, keydownOnly: false }),
  "hand-rolled: keydown-only boxes": (root) =>
    vanillaBoxes(root, { maxlength: true, keydownOnly: true }),
  "hand-rolled: single 'Code' field": (root) => {
    root.innerHTML = `<label for="c">Code</label><input id="c" name="code" type="text">`
    root
      .querySelector("input")!
      .addEventListener("input", (e) =>
        report((e.target as HTMLInputElement).value),
      )
  },
  "hand-rolled: 3-dash-3 boxes": (root) => {
    const left = document.createElement("div"),
      right = document.createElement("div")
    left.style.display = right.style.display = "inline-flex"
    root.style.display = "flex"
    root.append(
      left,
      Object.assign(document.createElement("span"), { textContent: "-" }),
      right,
    )
    const boxes: HTMLInputElement[] = []
    for (const side of [left, right])
      for (let i = 0; i < 3; i++) {
        const b = Object.assign(document.createElement("input"), {
          type: "text",
          maxLength: 1,
          className: "d",
        })
        b.style.width = "40px"
        side.append(b)
        boxes.push(b)
      }
    boxes.forEach((b, i) =>
      b.addEventListener("input", () => {
        report(boxes.map((x) => x.value).join(""))
        if (b.value) boxes[i + 1]?.focus()
      }),
    )
  },
  "hand-rolled: type=number boxes": (root) => {
    root.style.display = "flex"
    const boxes = Array.from({ length: 6 }, () => {
      const b = Object.assign(document.createElement("input"), {
        type: "number",
      })
      b.style.width = "48px"
      root.append(b)
      return b
    })
    boxes.forEach((b, i) =>
      b.addEventListener("input", () => {
        b.value = b.value.slice(-1)
        report(boxes.map((x) => x.value).join(""))
        if (b.value) boxes[i + 1]?.focus()
      }),
    )
  },
}

const negatives: Record<string, string> = {
  "negative: promo code field": `<main><h1>Checkout</h1><p>Have a code?</p><form><input type="text" name="code" placeholder="Enter code"><button>Apply</button></form><p>Promo codes cannot be combined.</p></main>`,
  "negative: search field": `<main><h1>Docs</h1><form><input type="text" name="q" placeholder="Search code samples"></form></main>`,
  "negative: ZIP code boxes": `<main><h1>Shipping</h1><p>Enter your ZIP code</p><div style="display:flex;gap:8px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"></div></main>`,
  "negative: sort code boxes": `<main><h1>Bank details</h1><p>Enter your sort code and account number</p><div style="display:flex;gap:8px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"><input type="text" style="width:44px;height:44px"></div></main>`,
  "negative: email + password login": `<main><h1>Sign in</h1><form><label>Email <input type="text" name="email"></label><label>Password <input type="password" name="password"></label><button>Sign in</button></form></main>`,
  "negative: 4-box card number": `<main><h1>Payment</h1><form><label>Card number</label><div style="display:flex;gap:8px">${Array.from({ length: 4 }, (_, i) => `<input type="text" name="card${i}" maxlength="4" style="width:60px">`).join("")}</div></form></main>`,
  "negative: address row": `<main><h1>Shipping</h1><form><div style="display:flex;gap:8px">${["Street", "City", "State", "Country"].map((l) => `<input type="text" placeholder="${l}" style="width:120px">`).join("")}</div></form></main>`,
}

w.WIDGETS = [
  ...Object.keys(react),
  ...Object.keys(vanilla),
  ...Object.keys(negatives),
  "mixed: OTP boxes + footer newsletter",
  "mixed: OTP boxes + search in app wrapper",
]

w.mountWidget = (name: string) => {
  document.body.innerHTML = `<style>.otp-input, [data-scope=inputotp] input, [data-scope=pin-input] input { width: 44px; height: 44px; text-align: center; margin-right: 8px }</style><main><h1>Verify your email</h1><p>Enter the 6-digit code we sent to you@example.com</p><form onsubmit="return false"><div id="slot"></div><button type="submit">Verify</button></form></main>`
  if (negatives[name]) {
    document.body.innerHTML = negatives[name]!
    return
  }
  if (name === "mixed: OTP boxes + search in app wrapper") {
    const main = document.querySelector("main")!
    const app = document.createElement("div")
    main.replaceWith(app)
    app.append(main)
    app.insertAdjacentHTML(
      "beforeend",
      `<section><h2>Search</h2><input name="search" placeholder="Search"></section>`,
    )
    vanillaBoxes(document.getElementById("slot")!, {
      maxlength: true,
      keydownOnly: false,
    })
    return
  }
  if (name.startsWith("mixed:")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<footer><p>Get our newsletter</p><input type="text" placeholder="you@example.com"></footer>`,
    )
    vanillaBoxes(document.getElementById("slot")!, {
      maxlength: true,
      keydownOnly: false,
    })
    return
  }
  const slot = document.getElementById("slot")!
  if (react[name]) createRoot(slot).render(react[name]!())
  else vanilla[name]!(slot)
}

w.runFill = async (code: string) => {
  const targets = detectTargets()
  const shape = targets.map((t) => `${t.group?.mode ?? "?"}x${t.inputs.length}`)
  if (targets.length !== 1) return { shape, accepted: false }
  const accepted = await fillTarget(targets[0]!, code)
  return { shape, accepted }
}
