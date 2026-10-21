export interface VerificationPromptDetails {
  hostname: string
  sender: string
}

export function showVerificationPrompt(
  details: VerificationPromptDetails,
): Promise<boolean> {
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  document.getElementById("otp-autofill-link-prompt")?.remove()
  const host = document.createElement("div")
  host.id = "otp-autofill-link-prompt"
  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 24px; background: rgb(15 23 42 / 52%); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .dialog { width: min(420px, calc(100vw - 48px)); border: 1px solid #dbe3ee; border-radius: 18px; padding: 24px; background: #fff; color: #152033; box-shadow: 0 24px 70px rgb(15 23 42 / 28%); }
    h2 { margin: 0 0 10px; font-size: 21px; line-height: 1.25; }
    p { margin: 0 0 18px; color: #526077; font-size: 14px; line-height: 1.55; }
    strong { color: #152033; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; }
    button { border: 1px solid #cad5e3; border-radius: 10px; padding: 10px 16px; background: #fff; color: #152033; font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; }
    .approve { border-color: #3157d5; background: #3157d5; color: #fff; }
    button:focus-visible { outline: 3px solid #9db4ff; outline-offset: 2px; }
  `
  const backdrop = document.createElement("div")
  backdrop.className = "backdrop"
  const dialog = document.createElement("section")
  dialog.className = "dialog"
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.setAttribute("aria-labelledby", "otp-autofill-link-title")
  dialog.setAttribute("aria-describedby", "otp-autofill-link-description")
  const title = document.createElement("h2")
  title.id = "otp-autofill-link-title"
  title.textContent = "Verify your email now?"
  const copy = document.createElement("p")
  copy.id = "otp-autofill-link-description"
  copy.append(
    "A recent verification email from ",
    Object.assign(document.createElement("strong"), {
      textContent: details.sender,
    }),
    " matches ",
    Object.assign(document.createElement("strong"), {
      textContent: details.hostname,
    }),
    ". OTP Autofill will open it in a new tab and follow only explicit verification actions.",
  )
  const actions = document.createElement("div")
  actions.className = "actions"
  const decline = document.createElement("button")
  decline.type = "button"
  decline.textContent = "Not now"
  const approve = document.createElement("button")
  approve.type = "button"
  approve.className = "approve"
  approve.textContent = "Yes, verify"
  actions.append(decline, approve)
  dialog.append(title, copy, actions)
  backdrop.append(dialog)
  root.append(style, backdrop)
  document.documentElement.append(host)
  return new Promise((resolve) => {
    const finish = (approved: boolean) => {
      host.remove()
      previousFocus?.focus()
      resolve(approved)
    }
    decline.addEventListener(
      "click",
      (event) => {
        if (event.isTrusted) finish(false)
      },
      { once: true },
    )
    approve.addEventListener(
      "click",
      (event) => {
        if (event.isTrusted) finish(true)
      },
      { once: true },
    )
    backdrop.addEventListener("keydown", (event) => {
      if (!event.isTrusted) return
      if (event.key === "Escape") finish(false)
      if (event.key === "Tab") {
        if (event.shiftKey && root.activeElement === decline) {
          event.preventDefault()
          approve.focus()
        } else if (!event.shiftKey && root.activeElement === approve) {
          event.preventDefault()
          decline.focus()
        }
      }
    })
    approve.focus()
  })
}
