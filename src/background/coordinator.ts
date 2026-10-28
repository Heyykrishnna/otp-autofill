import { canonicalEmail } from "../core/evidence"
import { extractCandidates } from "../core/email-parser"
import { hasExpired, isTerminal } from "../core/lifecycle"
import {
  candidateReason,
  sameWebsite,
  type MatchPolicy,
  eligibleCandidates,
  matchCandidates,
  senderDomain,
} from "../core/matcher"
import type {
  Candidate,
  FlowState,
  FlowStatus,
  VerificationContext,
  MessageSource,
} from "../core/types"
import { isRecord, siteOrigin } from "../core/validation"
import { GmailError } from "./gmail"
import { Mailboxes } from "./mailboxes"
import { readSettings } from "./settings"

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
  warnings: string[]
  delivery?: {
    fingerprint: string
    messageId: string
    candidateId: string
    chosen: boolean
  }
}

const DETAILS: Partial<Record<FlowState, string>> = {
  waiting:
    "Looking for a recent verification email that matches this site and request.",
  filled:
    "Code filled. Your after-fill setting controls whether Enter is sent.",
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
  private latestRequests = new Map<number, { id: string; startedAt: number }>()
  private fingerprints = new Map<
    string,
    { flow: string; until: number; used: boolean }
  >()
  private salt = crypto.randomUUID()

  constructor(private readonly gmail: MessageSource = new Mailboxes()) {}

  async publish(
    tabId: number,
    attempt: Attempt,
    state: FlowState,
    detail = DETAILS[state] ?? "",
  ): Promise<void> {
    const policy = this.policy(attempt)
    if (this.attempts.get(tabId) !== attempt) return
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
              account: candidate.account,
              reason: candidateReason(candidate, attempt.context, policy),
            }))
          : [],
    }
    await chrome.storage.session.set({ [`flow:${tabId}`]: attempt.status })
  }

  private clearSensitive(attempt: Attempt): void {
    if (
      attempt.delivery &&
      !this.fingerprints.get(attempt.delivery.fingerprint)?.used
    )
      this.fingerprints.delete(attempt.delivery.fingerprint)
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
    this.latestRequests.set(tabId, { id: "", startedAt: Date.now() })
    if (this.latestRequests.size > 512) {
      const first = this.latestRequests.keys().next().value
      if (first !== undefined) this.latestRequests.delete(first)
    }
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
    if (state === "filled") await this.remember(attempt)
    if (state === "filled" || isTerminal(state)) this.clearSensitive(attempt)
    await this.publish(tabId, attempt, state)
  }

  private async trusted(
    tabId: number,
    documentId: string,
    url: string,
    context: VerificationContext,
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
    context: VerificationContext,
  ): Promise<{ state: FlowState }> {
    if (
      !(await this.trusted(tabId, documentId, url, context, false)) ||
      hasExpired(context.startedAt)
    )
      return { state: "cancelled" }
    const latest = this.latestRequests.get(tabId)
    if (
      latest &&
      latest.id !== context.id &&
      context.startedAt < latest.startedAt
    )
      return { state: "cancelled" }
    this.latestRequests.set(tabId, {
      id: context.id,
      startedAt: context.startedAt,
    })
    let attempt = this.attempts.get(tabId)
    if (
      !attempt ||
      attempt.context.id !== context.id ||
      attempt.documentId !== documentId ||
      attempt.url !== url
    ) {
      await this.stop(tabId)
      if (this.latestRequests.get(tabId)?.id !== context.id)
        return { state: "cancelled" }
      const cleanup = setTimeout(
        () => {
          void this.stop(tabId, "timed_out")
        },
        Math.max(0, context.startedAt + 120_000 - Date.now()),
      )
      attempt = {
        context,
        warnings: [],
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
    return { state: attempt.status.state }
  }

  private policy(attempt: Attempt): MatchPolicy {
    const overlaps = [...this.attempts.values()].some(
      (other) =>
        other !== attempt &&
        !isTerminal(other.status.state) &&
        other.status.state !== "filled" &&
        !hasExpired(other.context.startedAt) &&
        sameWebsite(other.context.hostname, attempt.context.hostname) &&
        !(
          other.context.recipient &&
          attempt.context.recipient &&
          canonicalEmail(other.context.recipient) !==
            canonicalEmail(attempt.context.recipient)
        ),
    )
    return {
      requireChoice: overlaps,
      incomplete: attempt.warnings.length > 0,
    }
  }

  private async fingerprint(candidate: Candidate): Promise<string> {
    const bytes = new TextEncoder().encode(
      `${this.salt}|${candidate.account ?? ""}|${senderDomain(candidate.sender)}|${candidate.code}`,
    )
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }

  private async unused(
    attempt: Attempt,
    candidates: Candidate[],
  ): Promise<Candidate[]> {
    for (const [key, value] of this.fingerprints)
      if (value.until <= Date.now()) this.fingerprints.delete(key)
    const stored = await chrome.storage.session.get("consumedMessages")
    const used: unknown = stored.consumedMessages
    const ids = new Set(
      Array.isArray(used)
        ? used
            .filter(
              (item: unknown) =>
                isRecord(item) &&
                typeof item.until === "number" &&
                item.until > Date.now(),
            )
            .map((item: unknown) => (isRecord(item) ? item.messageId : null))
        : [],
    )
    const eligible = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        taken: this.fingerprints.get(await this.fingerprint(candidate)),
      })),
    )
    return eligible
      .filter(
        ({ candidate, taken }) =>
          !ids.has(candidate.messageId) &&
          (!taken || taken.flow === attempt.context.id),
      )
      .map(({ candidate }) => candidate)
  }

  private async reserve(
    attempt: Attempt,
    candidate: Candidate,
    chosen = false,
  ): Promise<boolean> {
    const fingerprint = await this.fingerprint(candidate)
    const previous = this.fingerprints.get(fingerprint)
    if (
      attempt.controller.signal.aborted ||
      (previous &&
        previous.until > Date.now() &&
        previous.flow !== attempt.context.id)
    )
      return false
    if (!previous && this.fingerprints.size >= 128) return false
    this.fingerprints.set(fingerprint, {
      flow: attempt.context.id,
      until: candidate.receivedAt + 180_000,
      used: false,
    })
    attempt.delivery = {
      fingerprint,
      messageId: candidate.messageId,
      candidateId: candidate.id,
      chosen,
    }
    return true
  }

  private async remember(attempt: Attempt): Promise<void> {
    if (!attempt.delivery) return
    const fingerprint = this.fingerprints.get(attempt.delivery.fingerprint)
    if (fingerprint) fingerprint.used = true
    const stored = await chrome.storage.session.get("consumedMessages")
    const values: unknown = stored.consumedMessages
    const used = Array.isArray(values)
      ? values.filter(
          (item: unknown) =>
            isRecord(item) &&
            typeof item.until === "number" &&
            item.until > Date.now(),
        )
      : []
    used.push({
      messageId: attempt.delivery.messageId,
      until: Date.now() + 180_000,
    })
    await chrome.storage.session.set({ consumedMessages: used.slice(-128) })
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
    if (isTerminal(attempt.status.state) || attempt.status.state === "filled")
      return { state: attempt.status.state }
    if (attempt.busy) return { state: attempt.status.state }
    if (attempt.status.state === "identified" && attempt.delivery) {
      const delivery = attempt.delivery
      const candidates = await this.unused(
        attempt,
        eligibleCandidates(attempt.candidates, context, Date.now()),
      )
      if (
        this.attempts.get(tabId) !== attempt ||
        attempt.controller.signal.aborted ||
        attempt.delivery !== delivery ||
        attempt.status.state !== "identified"
      )
        return { state: "cancelled" }
      const candidate = candidates.find(
        (item) => item.id === delivery.candidateId,
      )
      if (candidate) {
        const match = matchCandidates(
          candidates,
          context,
          Date.now(),
          this.policy(attempt),
        )
        if (
          delivery.chosen ||
          (match.kind === "unique" && match.candidate.code === candidate.code)
        )
          return { state: "identified", code: candidate.code }
      }
      this.fingerprints.delete(delivery.fingerprint)
      attempt.delivery = undefined
      await this.publish(
        tabId,
        attempt,
        candidates.length ? "ambiguous" : "waiting",
      )
      if (candidates.length) return { state: "ambiguous" }
    }
    if (Date.now() < Math.max(attempt.nextPollAt, this.globalNextPollAt))
      return { state: attempt.status.state }
    attempt.busy = true
    attempt.nextPollAt = Date.now() + 5_000
    this.globalNextPollAt = Date.now() + 5_000
    const current = attempt
    try {
      await this.publish(tabId, current, "waiting")
      const discovery = await this.gmail.discover(
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
      current.warnings = Array.isArray(discovery) ? [] : discovery.warnings
      const extracted = messages.flatMap(extractCandidates)
      current.candidates.push(...extracted)
      current.candidates = eligibleCandidates(
        current.candidates,
        context,
        Date.now(),
      ).slice(-40)
      current.candidates = await this.unused(current, current.candidates)
      const result = matchCandidates(
        current.candidates,
        context,
        Date.now(),
        this.policy(current),
      )
      if (result.kind === "none") {
        if (current.warnings.length)
          await this.publish(
            tabId,
            current,
            "waiting",
            current.warnings.join(" "),
          )
        return { state: "waiting" }
      }
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
      if (!(await this.reserve(current, result.candidate))) {
        await this.publish(tabId, current, "ambiguous")
        return { state: "ambiguous" }
      }
      await this.publish(
        tabId,
        current,
        "identified",
        "A unique code matches this site and field.",
      )
      if (
        current.controller.signal.aborted ||
        this.attempts.get(tabId) !== current ||
        hasExpired(context.startedAt)
      )
        return { state: "cancelled" }
      const finalMatch = matchCandidates(
        current.candidates,
        context,
        Date.now(),
        this.policy(current),
      )
      if (finalMatch.kind !== "unique") {
        if (current.delivery)
          this.fingerprints.delete(current.delivery.fingerprint)
        current.delivery = undefined
        await this.publish(tabId, current, "ambiguous")
        return { state: "ambiguous" }
      }
      return { state: "identified", code: result.candidate.code }
    } catch (error) {
      if (current.controller.signal.aborted) return { state: "cancelled" }
      if (error instanceof GmailError && error.kind !== "temporary") {
        await this.stop(tabId, "permission_required")
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

  async afterFillResult(
    tabId: number,
    documentId: string,
    id: string,
    result: "sent" | "skipped" | "failed",
  ): Promise<void> {
    const attempt = this.attempts.get(tabId)
    if (
      !attempt ||
      attempt.context.id !== id ||
      attempt.documentId !== documentId ||
      attempt.status.state !== "filled"
    )
      return
    const detail =
      result === "sent"
        ? "Code filled. Enter was sent; the website controls the result."
        : result === "skipped"
          ? "Code filled. Enter was skipped because the form changed, is incomplete or already continued."
          : "Code filled. Enter could not be sent; continue manually."
    await this.publish(tabId, attempt, "filled", detail)
  }

  async afterFillPolicy(
    tabId: number,
    documentId: string,
    id: string,
  ): Promise<{ pressEnter: boolean; enterDelayMs: number }> {
    const disabled = { pressEnter: false, enterDelayMs: 0 }
    const attempt = this.attempts.get(tabId)
    if (
      !attempt ||
      attempt.context.id !== id ||
      attempt.documentId !== documentId ||
      attempt.status.state !== "filled" ||
      hasExpired(attempt.context.startedAt)
    )
      return disabled
    const settings = await readSettings()
    if (
      !settings.autofill ||
      !settings.pressEnter ||
      !(await this.trusted(tabId, documentId, attempt.url, attempt.context))
    )
      return disabled
    if (
      this.attempts.get(tabId) !== attempt ||
      attempt.status.state !== "filled"
    )
      return disabled
    return { pressEnter: true, enterDelayMs: settings.enterDelayMs ?? 150 }
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
    attempt.busy = true
    try {
      const settings = await readSettings()
      if (
        (!settings.connected && !settings.companionEnabled) ||
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
      if (
        !candidate ||
        !(await this.unused(attempt, [candidate])).length ||
        !(await this.reserve(attempt, candidate, true))
      )
        return false
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
      if (this.attempts.get(tabId) !== attempt) return false
      if (!isRecord(result) || result.filled !== true) {
        await this.stop(tabId)
        return false
      }
      await this.event(tabId, attempt.documentId, id, "filled")
      const status = this.attempts.get(tabId)?.status
      return status?.id === id && status.state === "filled"
    } finally {
      attempt.busy = false
    }
  }
}
