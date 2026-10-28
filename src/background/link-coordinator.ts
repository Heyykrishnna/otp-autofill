import { extractVerificationLinks } from "../core/email-parser"
import { hasExpired, isTerminal } from "../core/lifecycle"
import { sameWebsite, senderDomain } from "../core/matcher"
import {
  MAX_VERIFICATION_CLICKS,
  MAX_VERIFICATION_NAVIGATIONS,
  type FlowState,
  type FlowStatus,
  type MessageSource,
  type VerificationLinkCandidate,
  type VerificationLinkContext,
} from "../core/types"
import { isRecord, siteOrigin } from "../core/validation"
import {
  eligibleVerificationLinks,
  matchVerificationLinks,
} from "../core/verification-link"
import { GmailError } from "./gmail"
import { Mailboxes } from "./mailboxes"
import { syncSiteScripts } from "./permissions"
import { readSettings } from "./settings"

interface LinkAttempt {
  context: VerificationLinkContext
  documentId: string
  url: string
  status: FlowStatus
  seen: Set<string>
  candidates: VerificationLinkCandidate[]
  controller: AbortController
  busy: boolean
  nextPollAt: number
  cleanup: ReturnType<typeof setTimeout>
  selected?: VerificationLinkCandidate
}

interface LinkAutomation {
  originTabId: number
  originDocumentId: string
  flowId: string
  allowedHostname: string
  visited: Set<string>
  clicks: number
  busy: boolean
  deadline: number
  currentUrl?: string
}

const DETAILS: Partial<Record<FlowState, string>> = {
  waiting: "Looking for a recent email verification link for this site.",
  confirmation_required:
    "A matching verification link needs your confirmation.",
  opening_link: "Opening the verification link in a new tab.",
  verifying: "Following explicit verification actions in the new tab.",
  completed: "Email verification completed. Refreshing the original page.",
  ambiguous:
    "More than one verification link qualifies. Open the intended email manually.",
  failed:
    "Automatic verification stopped. Review the verification tab and continue manually.",
  timed_out: "No reliable verification link was found within two minutes.",
  permission_required:
    "Connect Gmail and approve access to the verification site to continue.",
  cancelled: "Automatic link verification was cancelled.",
}

export class LinkCoordinator {
  private attempts = new Map<number, LinkAttempt>()
  private automations = new Map<number, LinkAutomation>()
  private globalNextPollAt = 0

  constructor(private readonly source: MessageSource = new Mailboxes()) {}

  private async publish(
    tabId: number,
    attempt: LinkAttempt,
    state: FlowState,
    detail = DETAILS[state] ?? "",
  ): Promise<void> {
    if (this.attempts.get(tabId) !== attempt) return
    attempt.status = { ...attempt.status, state, detail, candidates: [] }
    await chrome.storage.session.set({ [`flow:${tabId}`]: attempt.status })
  }

  private clear(attempt: LinkAttempt): void {
    attempt.controller.abort()
    attempt.candidates = []
    attempt.selected = undefined
    attempt.seen.clear()
    clearTimeout(attempt.cleanup)
  }

  private isCurrent(tabId: number, attempt: LinkAttempt): boolean {
    return (
      this.attempts.get(tabId) === attempt &&
      !attempt.controller.signal.aborted &&
      !hasExpired(attempt.context.startedAt) &&
      !isTerminal(attempt.status.state)
    )
  }

  private async authorized(
    tabId: number,
    attempt: LinkAttempt,
    requireActive = false,
  ): Promise<boolean> {
    if (!this.isCurrent(tabId, attempt)) return false
    const settings = await readSettings()
    return (
      (settings.connected || settings.companionEnabled === true) &&
      settings.autofill &&
      (await this.trusted(
        tabId,
        attempt.documentId,
        attempt.url,
        attempt.context,
        requireActive,
      )) &&
      this.isCurrent(tabId, attempt)
    )
  }

  private async trusted(
    tabId: number,
    documentId: string,
    url: string,
    context: VerificationLinkContext,
    requireActive = true,
  ): Promise<boolean> {
    const tab = await chrome.tabs.get(tabId)
    const origin = siteOrigin(url)
    return Boolean(
      documentId &&
      origin &&
      context.hostname === new URL(url).hostname &&
      (!requireActive || tab.active) &&
      // Single-page sites change the tab URL without reloading, while the
      // sender keeps the URL its document loaded at; compare sites instead.
      siteOrigin(tab.url) === origin &&
      (await chrome.permissions.contains({ origins: [origin] })),
    )
  }

  async register(
    tabId: number,
    documentId: string,
    url: string,
    context: VerificationLinkContext,
  ): Promise<{ state: FlowState }> {
    if (
      !(await this.trusted(tabId, documentId, url, context, false)) ||
      hasExpired(context.startedAt)
    )
      return { state: "cancelled" }
    let attempt = this.attempts.get(tabId)
    if (
      !attempt ||
      attempt.context.id !== context.id ||
      attempt.documentId !== documentId ||
      attempt.url !== url
    ) {
      await this.remove(tabId)
      const cleanup = setTimeout(
        () => void this.stop(tabId, "timed_out"),
        Math.max(0, context.startedAt + 120_000 - Date.now()),
      )
      attempt = {
        context,
        documentId,
        url,
        seen: new Set(),
        candidates: [],
        controller: new AbortController(),
        busy: false,
        nextPollAt: 0,
        cleanup,
        status: {
          id: context.id,
          state: "detected",
          hostname: context.hostname,
          startedAt: context.startedAt,
          detail: "Email verification request detected.",
          candidates: [],
        },
      }
      this.attempts.set(tabId, attempt)
      await this.publish(tabId, attempt, "detected")
    }
    return { state: attempt.status.state }
  }

  async poll(
    tabId: number,
    documentId: string,
    url: string,
    context: VerificationLinkContext,
  ): Promise<Record<string, unknown>> {
    if (!(await this.trusted(tabId, documentId, url, context)))
      return { state: "permission_required" }
    const settings = await readSettings()
    if (
      (!settings.connected && !settings.companionEnabled) ||
      !settings.autofill
    )
      return { state: "permission_required" }
    if (hasExpired(context.startedAt)) {
      await this.stop(tabId, "timed_out")
      return { state: "timed_out" }
    }
    await this.register(tabId, documentId, url, context)
    const attempt = this.attempts.get(tabId)
    if (!attempt || attempt.context.id !== context.id)
      return { state: "cancelled" }
    if (attempt.status.state === "confirmation_required" && attempt.selected)
      return {
        state: "confirmation_required",
        prompt: {
          hostname: new URL(attempt.selected.url).hostname,
          sender: senderDomain(attempt.selected.sender) ?? "unknown sender",
        },
      }
    if (
      attempt.busy ||
      Date.now() < Math.max(attempt.nextPollAt, this.globalNextPollAt)
    )
      return { state: attempt.status.state }
    attempt.busy = true
    attempt.nextPollAt = Date.now() + 5_000
    this.globalNextPollAt = Date.now() + 5_000
    const current = attempt
    try {
      await this.publish(tabId, current, "waiting")
      const discovery = await this.source.discover(
        context.startedAt,
        current.seen,
        current.controller.signal,
      )
      if (
        current.controller.signal.aborted ||
        this.attempts.get(tabId) !== current ||
        hasExpired(context.startedAt) ||
        !(await this.trusted(tabId, documentId, url, context))
      )
        return { state: "cancelled" }
      const messages = Array.isArray(discovery) ? discovery : discovery.messages
      current.candidates.push(...messages.flatMap(extractVerificationLinks))
      current.candidates = eligibleVerificationLinks(
        current.candidates,
        context,
        Date.now(),
      ).slice(-24)
      const match = matchVerificationLinks(
        current.candidates,
        context,
        Date.now(),
      )
      if (match.kind === "none") return { state: "waiting" }
      if (match.kind === "ambiguous") {
        await this.publish(tabId, current, "ambiguous")
        return { state: "ambiguous" }
      }
      current.selected = match.candidate
      await this.publish(tabId, current, "confirmation_required")
      return {
        state: "confirmation_required",
        prompt: {
          hostname: new URL(match.candidate.url).hostname,
          sender: senderDomain(match.candidate.sender) ?? "unknown sender",
        },
      }
    } catch (error) {
      if (current.controller.signal.aborted) return { state: "cancelled" }
      if (error instanceof GmailError && error.kind !== "temporary") {
        await this.stop(tabId, "permission_required")
        return { state: "permission_required" }
      }
      current.nextPollAt = Date.now() + 10_000
      this.globalNextPollAt = current.nextPollAt
      return { state: "waiting", retry: true }
    } finally {
      current.busy = false
    }
  }

  async decide(
    tabId: number,
    documentId: string,
    id: string,
    approved: boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    const attempt = this.attempts.get(tabId)
    const inactive = {
      ok: false,
      error: "This verification attempt is no longer active.",
    }
    if (
      !attempt ||
      attempt.context.id !== id ||
      attempt.documentId !== documentId ||
      attempt.status.state !== "confirmation_required" ||
      !attempt.selected ||
      attempt.busy ||
      !this.isCurrent(tabId, attempt)
    )
      return inactive
    const selected = attempt.selected
    const fail = async (state: FlowState, error: string) => {
      if (this.isCurrent(tabId, attempt)) await this.stop(tabId, state)
      return { ok: false, error }
    }
    attempt.busy = true
    try {
      if (!(await this.authorized(tabId, attempt, true))) return inactive
      if (!approved) {
        await this.stop(tabId, "cancelled")
        return { ok: true }
      }
      const targetOrigin = siteOrigin(selected.url)
      if (!targetOrigin)
        return fail(
          "failed",
          "The verification link is not a secure HTTPS URL.",
        )
      if (!(await chrome.permissions.contains({ origins: [targetOrigin] }))) {
        if (!this.isCurrent(tabId, attempt)) return inactive
        let granted = false
        try {
          granted = await chrome.permissions.request({
            origins: [targetOrigin],
          })
        } catch {
          granted = false
        }
        if (!this.isCurrent(tabId, attempt)) return inactive
        if (!granted)
          return fail(
            "permission_required",
            "Site access is required to follow verification actions safely.",
          )
        try {
          await syncSiteScripts()
        } catch {
          return fail(
            "failed",
            "Chrome could not enable the verification site.",
          )
        }
      }
      const target = new URL(selected.url)
      if (!sameWebsite(target.hostname, attempt.context.hostname))
        return fail(
          "failed",
          "The verification link leaves the requested website.",
        )
      if (!(await this.authorized(tabId, attempt, true))) return inactive
      let tab: chrome.tabs.Tab
      try {
        tab = await chrome.tabs.create({
          url: selected.url,
          active: true,
          openerTabId: tabId,
        })
      } catch {
        return fail("failed", "Chrome could not open the verification tab.")
      }
      if (!(await this.authorized(tabId, attempt))) return inactive
      const automationTabId = tab.id
      if (automationTabId === undefined)
        return fail("failed", "Chrome could not open the verification tab.")
      const automation: LinkAutomation = {
        originTabId: tabId,
        originDocumentId: documentId,
        flowId: id,
        allowedHostname: attempt.context.hostname,
        visited: new Set(),
        clicks: 0,
        busy: false,
        deadline: Date.now() + 45_000,
      }
      this.automations.set(automationTabId, automation)
      await this.publish(tabId, attempt, "opening_link")
      if (!this.isCurrent(tabId, attempt)) {
        if (this.automations.get(automationTabId) === automation)
          this.automations.delete(automationTabId)
        return inactive
      }
      attempt.candidates = []
      attempt.selected = undefined
      setTimeout(() => {
        void chrome.tabs
          .get(automationTabId)
          .then((current) => {
            if (current.status === "complete")
              return this.advance(automationTabId)
          })
          .catch(() => false)
      }, 750)
      return { ok: true }
    } finally {
      attempt.busy = false
    }
  }

  async onTabUpdated(
    tabId: number,
    change: { status?: string; url?: string },
    tab: chrome.tabs.Tab,
  ): Promise<void> {
    const automation = this.automations.get(tabId)
    if (!automation) {
      if (
        (change.status === "loading" || change.url) &&
        this.attempts.has(tabId)
      )
        await this.remove(tabId)
      return
    }
    const currentUrl = change.url ?? tab.url
    if (currentUrl) {
      let parsed: URL
      try {
        parsed = new URL(currentUrl)
      } catch {
        await this.failAutomation(tabId)
        return
      }
      if (
        parsed.protocol !== "https:" ||
        !sameWebsite(parsed.hostname, automation.allowedHostname)
      ) {
        await this.failAutomation(tabId)
        return
      }
      if (automation.currentUrl !== parsed.href) {
        if (automation.currentUrl && automation.visited.has(parsed.href)) {
          await this.failAutomation(tabId)
          return
        }
        automation.visited.add(parsed.href)
        automation.currentUrl = parsed.href
      }
      if (automation.visited.size > MAX_VERIFICATION_NAVIGATIONS) {
        await this.failAutomation(tabId)
        return
      }
    }
    if (change.status === "complete") await this.advance(tabId)
  }

  private async advance(tabId: number): Promise<void> {
    const automation = this.automations.get(tabId)
    if (!automation || automation.busy) return
    if (
      Date.now() >= automation.deadline ||
      automation.clicks >= MAX_VERIFICATION_CLICKS
    ) {
      await this.failAutomation(tabId)
      return
    }
    const attempt = this.attempts.get(automation.originTabId)
    if (
      !attempt ||
      attempt.context.id !== automation.flowId ||
      !this.isCurrent(automation.originTabId, attempt)
    ) {
      this.automations.delete(tabId)
      return
    }
    automation.busy = true
    try {
      if (
        !(await this.authorized(automation.originTabId, attempt)) ||
        this.automations.get(tabId) !== automation
      ) {
        if (this.automations.get(tabId) === automation)
          this.automations.delete(tabId)
        return
      }
      await this.publish(automation.originTabId, attempt, "verifying")
      if (
        !this.isCurrent(automation.originTabId, attempt) ||
        this.automations.get(tabId) !== automation
      )
        return
      const result: unknown = await chrome.tabs.sendMessage(tabId, {
        type: "ADVANCE_LINK_VERIFICATION",
        id: automation.flowId,
        maximumClicks: MAX_VERIFICATION_CLICKS - automation.clicks,
      })
      if (
        !this.isCurrent(automation.originTabId, attempt) ||
        this.automations.get(tabId) !== automation
      )
        return
      if (!isRecord(result) || typeof result.clicks !== "number") {
        await this.failAutomation(tabId)
        return
      }
      if (result.status === "completed") {
        await this.completeAutomation(tabId)
        return
      }
      await this.failAutomation(
        tabId,
        typeof result.detail === "string" ? result.detail : undefined,
      )
    } catch {
      if (this.automations.has(tabId))
        setTimeout(() => {
          const current = this.automations.get(tabId)
          if (current) {
            current.busy = false
            void this.advance(tabId)
          }
        }, 500)
    }
  }

  recordAction(tabId: number, id: string): boolean {
    const automation = this.automations.get(tabId)
    const attempt = automation
      ? this.attempts.get(automation.originTabId)
      : undefined
    if (
      !automation ||
      !attempt ||
      !this.isCurrent(automation.originTabId, attempt) ||
      attempt.context.id !== automation.flowId ||
      automation.flowId !== id ||
      Date.now() >= automation.deadline ||
      automation.clicks >= MAX_VERIFICATION_CLICKS
    )
      return false
    automation.clicks++
    return true
  }

  private async completeAutomation(tabId: number): Promise<void> {
    const automation = this.automations.get(tabId)
    if (!automation) return
    const attempt = this.attempts.get(automation.originTabId)
    if (
      !attempt ||
      attempt.context.id !== automation.flowId ||
      !(await this.authorized(automation.originTabId, attempt)) ||
      this.automations.get(tabId) !== automation
    )
      return
    this.automations.delete(tabId)
    await this.publish(automation.originTabId, attempt, "completed")
    if (attempt.controller.signal.aborted) return
    await chrome.tabs
      .sendMessage(
        automation.originTabId,
        { type: "LINK_RESULT", id: automation.flowId, result: "completed" },
        { documentId: automation.originDocumentId },
      )
      .catch(() => false)
    this.clear(attempt)
  }

  private async failAutomation(
    tabId: number,
    detail = DETAILS.failed,
  ): Promise<void> {
    const automation = this.automations.get(tabId)
    if (!automation) return
    this.automations.delete(tabId)
    const attempt = this.attempts.get(automation.originTabId)
    if (
      !attempt ||
      attempt.context.id !== automation.flowId ||
      !this.isCurrent(automation.originTabId, attempt)
    )
      return
    await this.publish(automation.originTabId, attempt, "failed", detail)
    if (attempt.controller.signal.aborted) return
    await chrome.tabs
      .sendMessage(
        automation.originTabId,
        { type: "LINK_RESULT", id: automation.flowId, result: "failed" },
        { documentId: automation.originDocumentId },
      )
      .catch(() => false)
    this.clear(attempt)
  }

  async stop(tabId: number, state: FlowState = "cancelled"): Promise<void> {
    const attempt = this.attempts.get(tabId)
    if (!attempt) return
    for (const [automationTabId, automation] of this.automations)
      if (automation.originTabId === tabId)
        this.automations.delete(automationTabId)
    this.clear(attempt)
    await this.publish(tabId, attempt, state)
  }

  async remove(tabId: number): Promise<void> {
    if (this.automations.has(tabId)) {
      await this.failAutomation(tabId)
      return
    }
    await this.stop(tabId)
    this.attempts.delete(tabId)
    await chrome.storage.session.remove(`flow:${tabId}`)
  }

  async stopAll(state: FlowState = "cancelled"): Promise<void> {
    await Promise.all(
      [...this.attempts.keys()].map((id) => this.stop(id, state)),
    )
  }
}
