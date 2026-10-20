import { extractCandidates } from "../core/email-parser"
import { hasExpired, isTerminal } from "../core/lifecycle"
import {
  eligibleCandidates,
  matchCandidates,
  senderDomain,
} from "../core/matcher"
import type {
  Candidate,
  FlowState,
  FlowStatus,
  VerificationContext,
} from "../core/types"
import { isRecord, siteOrigin } from "../core/validation"
import { GmailClient, GmailError } from "./gmail"
import { readSettings, updateSettings } from "./settings"

interface Attempt {
  context: VerificationContext
  documentId: string
  url: string
  status: FlowStatus
  seen: Set<string>
  candidates: Candidate[]
  controller: AbortController
  busy: boolean
  nextPollAt: number
  cleanup: ReturnType<typeof setTimeout>
}

const DETAILS: Partial<Record<FlowState, string>> = {
  waiting: "Looking for a recent verification email from this site's domain.",
  filled: "Code filled. Submit the form to continue.",
  completed: "The page reports that verification is complete.",
  failed: "The page marked the code invalid. Request a new code and try again.",
  timed_out:
    "No reliable match within two minutes. Request a new code and try again.",
  permission_required:
    "Connect Gmail or check this site's permission to continue.",
  cancelled:
    "Attempt stopped. Typed content and changes to the page are preserved.",
  ambiguous:
    "More than one code qualifies, or confidence is limited. Choose an email below or enter the code yourself.",
}

export class Coordinator {
  private attempts = new Map<number, Attempt>()
  private globalNextPollAt = 0

  constructor(private readonly gmail = new GmailClient()) {}

  async publish(
    tabId: number,
    attempt: Attempt,
    state: FlowState,
    detail = DETAILS[state] ?? "",
  ): Promise<void> {
    attempt.status = {
      ...attempt.status,
      state,
      detail,
      candidates:
        state === "ambiguous"
          ? eligibleCandidates(
              attempt.candidates,
              attempt.context,
              Date.now(),
            ).map((candidate) => ({
              id: candidate.id,
              sender: senderDomain(candidate.sender) ?? "Unknown sender",
              receivedAt: candidate.receivedAt,
              length: candidate.code.length,
            }))
          : [],
    }
    await chrome.storage.session.set({ [`flow:${tabId}`]: attempt.status })
  }

  private clearSensitive(attempt: Attempt): void {
    attempt.controller.abort()
    attempt.candidates = []
    attempt.seen.clear()
    clearTimeout(attempt.cleanup)
  }

  async stop(tabId: number, state: FlowState = "cancelled"): Promise<void> {
    const attempt = this.attempts.get(tabId)
    if (!attempt) return
    this.clearSensitive(attempt)
    await this.publish(tabId, attempt, state)
  }

  async remove(tabId: number): Promise<void> {
    await this.stop(tabId)
    this.attempts.delete(tabId)
    await chrome.storage.session.remove(`flow:${tabId}`)
  }

  async stopAll(state: FlowState = "cancelled"): Promise<void> {
    await Promise.all(
      [...this.attempts.keys()].map((id) => this.stop(id, state)),
    )
  }

  async event(
    tabId: number,
    documentId: string,
    id: string,
    state: FlowState,
  ): Promise<void> {
    const attempt = this.attempts.get(tabId)
    if (
      !attempt ||
      attempt.context.id !== id ||
      attempt.documentId !== documentId
    )
      return
    if (
      !["filled", "completed", "failed", "cancelled", "timed_out"].includes(
        state,
      )
    )
      return
    if (isTerminal(attempt.status.state)) return
    if (
      ["completed", "failed"].includes(state) &&
      attempt.status.state !== "filled"
    )
      return
    if (state === "filled" && attempt.status.state !== "identified") return
    if (state === "filled" || isTerminal(state)) this.clearSensitive(attempt)
    await this.publish(tabId, attempt, state)
  }

  private async trusted(
    tabId: number,
    documentId: string,
    url: string,
    context: VerificationContext,
  ): Promise<boolean> {
    const tab = await chrome.tabs.get(tabId)
    const origin = siteOrigin(url)
    return Boolean(
      documentId &&
      origin &&
      context.hostname === new URL(url).hostname &&
      tab.active &&
      tab.url === url &&
      (await chrome.permissions.contains({ origins: [origin] })),
    )
  }

  async poll(
    tabId: number,
    documentId: string,
    url: string,
    context: VerificationContext,
  ): Promise<{ state: FlowState; code?: string; retry?: boolean }> {
    if (!(await this.trusted(tabId, documentId, url, context)))
      return { state: "permission_required" }
    const settings = await readSettings()
    if (!settings.connected || !settings.autofill)
      return { state: "permission_required" }
    if (hasExpired(context.startedAt)) {
      await this.stop(tabId, "timed_out")
      return { state: "timed_out" }
    }
    let attempt = this.attempts.get(tabId)
    if (
      !attempt ||
      attempt.context.id !== context.id ||
      attempt.documentId !== documentId ||
      attempt.url !== url
    ) {
      await this.stop(tabId)
      const cleanup = setTimeout(
        () => {
          void this.stop(tabId, "timed_out")
        },
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
          detail: "Verification field detected.",
          candidates: [],
        },
      }
      this.attempts.set(tabId, attempt)
      await this.publish(tabId, attempt, "detected")
    }
    if (
      isTerminal(attempt.status.state) ||
      ["filled", "identified"].includes(attempt.status.state)
    )
      return { state: attempt.status.state }
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
      const messages = await this.gmail.discover(
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
      current.candidates.push(...messages.flatMap(extractCandidates))
      current.candidates = eligibleCandidates(
        current.candidates,
        context,
        Date.now(),
      ).slice(-40)
      const result = matchCandidates(current.candidates, context)
      if (result.kind === "none") return { state: "waiting" }
      await this.publish(
        tabId,
        current,
        "candidate_found",
        "A context-matched email was found.",
      )
      if (result.kind === "ambiguous") {
        await this.publish(tabId, current, "ambiguous")
        return { state: "ambiguous" }
      }
      await this.publish(
        tabId,
        current,
        "identified",
        "A unique code matches this site and field.",
      )
      return { state: "identified", code: result.candidate.code }
    } catch (error) {
      if (current.controller.signal.aborted) return { state: "cancelled" }
      if (error instanceof GmailError && error.kind !== "temporary") {
        await updateSettings({ connected: false })
        await this.stopAll("permission_required")
        return { state: "permission_required" }
      }
      current.nextPollAt =
        Date.now() +
        (error instanceof GmailError
          ? Math.max(5_000, error.retryAfter)
          : 10_000)
      this.globalNextPollAt = current.nextPollAt
      await this.publish(
        tabId,
        current,
        "waiting",
        "Gmail is temporarily unavailable. Retrying within this attempt's time limit.",
      )
      return { state: "waiting", retry: true }
    } finally {
      current.busy = false
    }
  }

  async choose(
    tabId: number,
    id: string,
    candidateId: string,
  ): Promise<boolean> {
    const attempt = this.attempts.get(tabId)
    if (
      !attempt ||
      attempt.context.id !== id ||
      attempt.status.state !== "ambiguous" ||
      hasExpired(attempt.context.startedAt) ||
      attempt.busy
    )
      return false
    const settings = await readSettings()
    if (
      !settings.connected ||
      !settings.autofill ||
      !(await this.trusted(
        tabId,
        attempt.documentId,
        attempt.url,
        attempt.context,
      ))
    )
      return false
    const candidate = eligibleCandidates(
      attempt.candidates,
      attempt.context,
      Date.now(),
    ).find((item) => item.id === candidateId)
    if (!candidate) return false
    await this.publish(
      tabId,
      attempt,
      "identified",
      "Filling the email you selected.",
    )
    const result: unknown = await chrome.tabs.sendMessage(
      tabId,
      { type: "FILL", id, code: candidate.code },
      { documentId: attempt.documentId },
    )
    if (!isRecord(result) || result.filled !== true) {
      await this.stop(tabId)
      return false
    }
    this.clearSensitive(attempt)
    await this.publish(tabId, attempt, "filled")
    return true
  }
}
