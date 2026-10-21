import { sameWebsite } from "../core/matcher"

export type VerificationActionResult =
  | { status: "completed"; clicks: number }
  | { status: "failed"; clicks: number; detail: string }
  | { status: "blocked"; clicks: number; detail: string }

const COMPLETE =
  /\b(?:account|email) (?:has been |is )?(?:activated|confirmed|verified)\b|\b(?:activation|confirmation|verification) (?:is )?(?:complete|successful)\b|\bsuccessfully (?:activated|confirmed|verified)\b/i
const FAILED =
  /\b(?:activation|confirmation|verification) (?:has )?failed\b|\b(?:activation|confirmation|verification) link (?:has )?(?:expired|invalid)\b/i
const ACTION =
  /^(?:activate(?: account)?|complete verification|confirm(?: email)?|continue|verify(?: and (?:continue|sign in))?|verify email)$/i
const REJECT =
  /\b(?:back|cancel|delete|later|log out|pay|purchase|remove|resend|reset password|sign out|skip|unsubscribe)\b/i
const DANGEROUS_CONTEXT =
  /\b(?:delete (?:account|profile)|make (?:a )?payment|place (?:the )?order|purchase|reset (?:the )?password|unsubscribe)/i

function pageText(): string {
  return [document.body?.innerText, document.body?.textContent]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 60_000)
}

function roots(): (Document | ShadowRoot)[] {
  const found: (Document | ShadowRoot)[] = [document]
  for (let index = 0; index < found.length; index++)
    for (const element of found[index]?.querySelectorAll("*") ?? [])
      if (element.shadowRoot) found.push(element.shadowRoot)
  return found.slice(0, 32)
}

function visible(element: HTMLElement): boolean {
  const style = getComputedStyle(element)
  return (
    !element.hidden &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  )
}

function label(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return element.value.trim()
  return (element.innerText || element.textContent || "").trim()
}

function visibleStatusText(): string {
  return roots()
    .flatMap((root) => [
      ...root.querySelectorAll<HTMLElement>(
        "p, h1, h2, h3, [role='status'], [aria-live]",
      ),
    ])
    .filter(visible)
    .map(label)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 60_000)
}

function formReady(element: HTMLElement): boolean {
  const form = element.closest("form")
  if (!form) return true
  return ![...form.elements].some((control) => {
    if (
      control instanceof HTMLInputElement &&
      control.required &&
      !["button", "hidden", "submit"].includes(control.type)
    )
      return ["checkbox", "radio"].includes(control.type)
        ? !control.checked
        : !control.value
    return (
      (control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement) &&
      control.required &&
      !control.value
    )
  })
}

function candidates(requireReady = true): HTMLElement[] {
  const context = pageText()
  return roots()
    .flatMap((root) => [
      ...root.querySelectorAll<HTMLElement>(
        'a[href], button, input[type="button"], input[type="submit"]',
      ),
    ])
    .filter((element) => {
      const text = label(element).replace(/\s+/g, " ")
      if (
        !visible(element) ||
        !ACTION.test(text) ||
        REJECT.test(text) ||
        (requireReady && !formReady(element))
      )
        return false
      if (
        /^continue$/i.test(text) &&
        !/\b(?:confirm|verification|verify)\b/i.test(context)
      )
        return false
      if (element instanceof HTMLAnchorElement) {
        try {
          const url = new URL(element.href)
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            sameWebsite(url.hostname, location.hostname)
          )
        } catch {
          return false
        }
      }
      return (
        (element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement) &&
        !element.disabled
      )
    })
}

function pause(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

export async function runVerificationActions(
  maximumClicks: number,
  beforeAction: () => Promise<boolean> = async () => true,
): Promise<VerificationActionResult> {
  const clicked = new WeakSet<HTMLElement>()
  let clickCount = 0
  let emptyScans = 0
  while (clickCount < maximumClicks) {
    const text = pageText()
    const statusText = visibleStatusText()
    if (COMPLETE.test(statusText))
      return { status: "completed", clicks: clickCount }
    if (DANGEROUS_CONTEXT.test(text))
      return {
        status: "blocked",
        clicks: clickCount,
        detail: "The page includes an unrelated sensitive action.",
      }
    if (FAILED.test(statusText))
      return {
        status: "failed",
        clicks: clickCount,
        detail: "The verification page reported an invalid or expired link.",
      }
    const actions = candidates().filter((element) => !clicked.has(element))
    if (actions.length > 1)
      return {
        status: "blocked",
        clicks: clickCount,
        detail: "The verification page has more than one possible action.",
      }
    const action = actions[0]
    if (!action) {
      if (candidates(false).some((element) => !formReady(element)))
        return {
          status: "blocked",
          clicks: clickCount,
          detail: "The verification action requires unfinished form input.",
        }
      if (++emptyScans >= 10)
        return {
          status: "blocked",
          clicks: clickCount,
          detail:
            "No explicit verification completion or safe next action was found.",
        }
      await pause(300)
      continue
    }
    emptyScans = 0
    if (!(await beforeAction()))
      return {
        status: "blocked",
        clicks: clickCount,
        detail: "The verification attempt changed before the next action.",
      }
    clicked.add(action)
    clickCount++
    if (action instanceof HTMLAnchorElement) {
      action.removeAttribute("download")
      action.target = "_self"
    } else if (
      action instanceof HTMLButtonElement ||
      action instanceof HTMLInputElement
    ) {
      action.formTarget = "_self"
      if (action.form) action.form.target = "_self"
    }
    action.click()
    await pause(500)
  }
  return {
    status: "blocked",
    clicks: clickCount,
    detail: "The verification action limit was reached.",
  }
}
