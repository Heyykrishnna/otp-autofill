import { hasExpired, pollDelay } from "../core/lifecycle"
import type { VerificationLinkContext } from "../core/types"
import { isRecord } from "../core/validation"
import { detectVerificationLinkContext } from "./link-detector"
import { showVerificationPrompt } from "./link-prompt"

interface LinkControllerOptions {
  send: (message: unknown) => Promise<unknown>
}

export function startVerificationLinkController({
  send,
}: LinkControllerOptions): void {
  let context: VerificationLinkContext | null = null
  let pageUrl = location.href
  let timer: ReturnType<typeof setTimeout> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let busy = false
  let stopped = false
  let prompting = false

  function stop(): void {
    stopped = true
    clearTimeout(timer)
  }

  async function poll(): Promise<void> {
    if (!context || busy || stopped) return
    if (hasExpired(context.startedAt)) {
      stop()
      return
    }
    busy = true
    const id = context.id
    const result = await send({ type: "POLL_LINK", context })
    busy = false
    if (!context || context.id !== id || stopped || !isRecord(result)) return
    if (
      result.state === "confirmation_required" &&
      isRecord(result.prompt) &&
      typeof result.prompt.hostname === "string" &&
      typeof result.prompt.sender === "string" &&
      !prompting
    ) {
      prompting = true
      const approved = await showVerificationPrompt({
        hostname: result.prompt.hostname,
        sender: result.prompt.sender,
      })
      const decision = await send({ type: "LINK_DECISION", id, approved })
      prompting = false
      if (!approved || !isRecord(decision) || decision.ok !== true) stop()
      return
    }
    if (
      ["ambiguous", "cancelled", "permission_required", "timed_out"].includes(
        String(result.state),
      )
    ) {
      stop()
      return
    }
    timer = setTimeout(() => void poll(), pollDelay(attempt++))
  }

  function scan(): void {
    if (pageUrl !== location.href) {
      stop()
      context = null
      stopped = false
      attempt = 0
      pageUrl = location.href
    }
    if (context || stopped) return
    context = detectVerificationLinkContext()
    if (!context) return
    void send({ type: "REGISTER_LINK", context }).then(() => poll())
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !isRecord(message)) return
    if (
      message.type === "LINK_RESULT" &&
      context &&
      message.id === context.id
    ) {
      stop()
      if (message.result === "completed") {
        respond({ ok: true })
        setTimeout(() => location.reload(), 400)
      } else respond({ ok: true })
      return
    }
  })

  new MutationObserver(() => {
    clearTimeout(debounce)
    debounce = setTimeout(scan, 200)
  }).observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener("popstate", scan)
  window.addEventListener("pagehide", stop)
  setInterval(scan, 1_000)
  scan()
}
