import { hasExpired, isTerminal, pollDelay } from "../core/lifecycle"
import type { FlowState, VerificationContext } from "../core/types"
import { isFlowState, isRecord } from "../core/validation"
import { enterTarget } from "./submit"
import { verificationHints } from "./context"
import { fillTarget } from "./autofill"
import { detectTargets, type OtpTarget } from "./detector"
import { runVerificationActions } from "./link-automation"
import { startVerificationLinkController } from "./link-controller"
import { MAX_VERIFICATION_CLICKS } from "../core/types"

const marker = "otp-autofill-controller"
const isolated = globalThis as typeof globalThis & { [marker]?: boolean }

if (!isolated[marker]) {
  isolated[marker] = true
  startController()
}

function startController(): void {
  let target: OtpTarget | null = null
  let context: VerificationContext | null = null
  let pageUrl = location.href
  let timer: ReturnType<typeof setTimeout> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let busy = false
  let stopped = false
  let filled = false
  let permissionPaused = false
  let strictAfter = false
  let requestedAt: number | undefined
  let enterTimer: ReturnType<typeof setTimeout> | undefined
  const submittedForms = new WeakSet<HTMLFormElement>()
  document.addEventListener(
    "submit",
    (event) => {
      if (event.target instanceof HTMLFormElement)
        submittedForms.add(event.target)
    },
    true,
  )

  async function send(message: unknown): Promise<unknown> {
    try {
      return await chrome.runtime.sendMessage(message)
    } catch {
      stopped = true
      clearTimeout(timer)
      return null
    }
  }

  startVerificationLinkController({ send })

  function finish(state: FlowState): void {
    stopped = true
    clearTimeout(enterTimer)
    clearTimeout(timer)
    if (context) void send({ type: "FLOW_EVENT", id: context.id, state })
  }

  function reset(resend = false): void {
    strictAfter = resend
    requestedAt = resend ? Date.now() : undefined
    if (context) finish("cancelled")
    context = null
    target = null
    stopped = false
    filled = false
    attempt = 0
    permissionPaused = false
    clearTimeout(timer)
  }

  function stillCurrent(): boolean {
    const detected = detectTargets()
    return Boolean(
      target &&
      (!context ||
        JSON.stringify(verificationHints(target)) ===
          JSON.stringify({
            ...(context.recipient ? { recipient: context.recipient } : {}),
            ...(context.requestId ? { requestId: context.requestId } : {}),
          })) &&
      pageUrl === location.href &&
      target.inputs.every((input) => input.isConnected) &&
      detected.length === 1 &&
      detected.some(
        (current) =>
          JSON.stringify(current.constraints) ===
            JSON.stringify(target?.constraints) &&
          current.inputs.length === target?.inputs.length &&
          current.inputs.every(
            (input, index) => input === target?.inputs[index],
          ),
      ),
    )
  }

  async function apply(code: string, id: string): Promise<boolean> {
    if (
      !context ||
      id !== context.id ||
      stopped ||
      hasExpired(context.startedAt) ||
      document.visibilityState !== "visible" ||
      !stillCurrent() ||
      !target
    )
      return false
    const result = fillTarget(target, code)
    if (result) {
      filled = true
      clearTimeout(timer)
      await send({ type: "FLOW_EVENT", id, state: "filled" })
      const policy = await send({ type: "AFTER_FILL_POLICY", id })
      if (
        isRecord(policy) &&
        policy.pressEnter === true &&
        typeof policy.enterDelayMs === "number" &&
        Number.isInteger(policy.enterDelayMs) &&
        policy.enterDelayMs >= 0 &&
        policy.enterDelayMs <= 2000
      ) {
        clearTimeout(enterTimer)
        enterTimer = setTimeout(() => {
          void (async () => {
            const current = await send({ type: "AFTER_FILL_POLICY", id })
            if (
              isRecord(current) &&
              current.pressEnter === true &&
              context?.id === id &&
              !stopped &&
              filled &&
              target &&
              !hasExpired(context.startedAt) &&
              document.visibilityState === "visible" &&
              stillCurrent()
            ) {
              const sent = enterTarget(target, code, submittedForms)
              await send({
                type: "AFTER_FILL_RESULT",
                id,
                result: sent ? "sent" : "skipped",
              })
            }
          })().catch(() =>
            send({ type: "AFTER_FILL_RESULT", id, result: "failed" }),
          )
        }, policy.enterDelayMs)
      }
    } else finish("cancelled")
    return result
  }

  async function poll(): Promise<void> {
    if (!context || !target || stopped || filled || busy) return
    if (!stillCurrent() || target.inputs.some((input) => input.value !== ""))
      return finish("cancelled")
    if (hasExpired(context.startedAt)) return finish("timed_out")
    if (document.visibilityState !== "visible") {
      timer = setTimeout(() => void poll(), 5_000)
      return
    }
    busy = true
    const id = context.id
    const result = await send({ type: "POLL", context })
    busy = false
    if (!context || context.id !== id || stopped) {
      if (context && !stopped && !filled) void poll()
      return
    }
    let failed = false
    if (isRecord(result)) {
      if (typeof result.code === "string") await apply(result.code, id)
      if (isFlowState(result.state) && isTerminal(result.state)) stopped = true
      permissionPaused = result.state === "permission_required"
      failed = result.retry === true
    }
    if (!stopped && !filled)
      timer = setTimeout(() => void poll(), pollDelay(attempt++, failed))
  }

  function scan(): void {
    if (pageUrl !== location.href) {
      reset()
      pageUrl = location.href
    }
    if (context) {
      if (
        filled &&
        target?.inputs.some(
          (input) => input.getAttribute("aria-invalid") === "true",
        )
      )
        return finish("failed")
      if (!stillCurrent()) {
        const changedRequest =
          target &&
          context &&
          verificationHints(target).requestId !== context.requestId
        if (changedRequest) {
          strictAfter = true
          requestedAt = Date.now()
        }
        const success = [...document.querySelectorAll("[role='status']")].some(
          (element) =>
            /(?:email|account|verification)\s+(?:is\s+)?(?:verified|complete|successful)/i.test(
              element.textContent ?? "",
            ),
        )
        finish(filled && success ? "completed" : "cancelled")
        context = null
        target = null
        stopped = false
        filled = false
        attempt = 0
      } else return
    }
    const targets = detectTargets()
    if (
      targets.length !== 1 ||
      targets[0]?.inputs.some((input) => input.value !== "")
    )
      return
    target = targets[0] ?? null
    if (!target) return
    const form = target.inputs[0]?.form
    if (form) submittedForms.delete(form)
    context = {
      id: crypto.randomUUID(),
      startedAt: requestedAt ?? Date.now(),
      hostname: location.hostname,
      constraints: target.constraints,
      ...verificationHints(target),
      strictAfter,
    }
    void send({ type: "REGISTER", context }).then(() => poll())
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !isRecord(message)) return
    if (
      message.type === "FILL" &&
      typeof message.id === "string" &&
      typeof message.code === "string"
    ) {
      void apply(message.code, message.id)
        .then((filled) => respond({ filled }))
        .catch(() => respond({ filled: false }))
      return true
    } else if (message.type === "RETRY") {
      reset()
      scan()
      respond({ ok: true })
    } else if (message.type === "STOP") {
      finish("cancelled")
      permissionPaused = true
      respond({ ok: true })
    } else if (message.type === "WAKE") {
      if (permissionPaused) {
        reset()
        scan()
      }
      respond({ ok: true })
    } else if (
      message.type === "ADVANCE_LINK_VERIFICATION" &&
      typeof message.id === "string" &&
      typeof message.maximumClicks === "number" &&
      Number.isInteger(message.maximumClicks) &&
      message.maximumClicks > 0 &&
      message.maximumClicks <= MAX_VERIFICATION_CLICKS
    ) {
      void runVerificationActions(message.maximumClicks, async () => {
        const result = await send({
          type: "LINK_ACTION_PERFORMED",
          id: message.id,
        })
        return isRecord(result) && result.ok === true
      })
        .then(respond)
        .catch(() =>
          respond({
            status: "blocked",
            clicks: 0,
            detail: "The verification page could not be inspected safely.",
          }),
        )
      return true
    }
  })

  new MutationObserver(() => {
    clearTimeout(debounce)
    debounce = setTimeout(scan, 200)
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "disabled",
      "readonly",
      "hidden",
      "aria-invalid",
      "autocomplete",
      "class",
      "style",
      "data-otp-request-id",
      "data-verification-id",
      "data-otp-recipient",
    ],
  })
  document.addEventListener(
    "input",
    (event) => {
      if (
        event.isTrusted &&
        event.target instanceof HTMLInputElement &&
        target?.inputs.includes(event.target)
      )
        finish("cancelled")
    },
    true,
  )
  document.addEventListener(
    "click",
    (event) => {
      const element =
        event.target instanceof Element
          ? event.target.closest("button, a, input[type='button']")
          : null
      if (
        event.isTrusted &&
        element &&
        target &&
        (
          target.inputs[0]?.closest("form") ?? target.inputs[0]?.parentElement
        )?.contains(element) &&
        /(?:resend|send (?:a )?(?:new |another )?code)/i.test(
          element.textContent ?? "",
        )
      ) {
        reset(true)
        setTimeout(scan, 300)
      }
    },
    true,
  )
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (permissionPaused) reset()
      scan()
      if (!busy && !stopped && !filled) {
        clearTimeout(timer)
        void poll()
      }
    }
  })
  window.addEventListener("pagehide", () => finish("cancelled"))
  window.addEventListener("popstate", scan)
  setInterval(scan, 1_000)
  scan()
}
