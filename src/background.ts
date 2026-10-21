import { companionCall } from "./background/companion"
import { Mailboxes } from "./background/mailboxes"
import { Coordinator } from "./background/coordinator"
import { LinkCoordinator } from "./background/link-coordinator"
import {
  disconnectGmail,
  getToken,
  GmailClient,
  GmailError,
  isConfigured,
} from "./background/gmail"
import { isExtensionUi } from "./background/messages"
import {
  activeTab,
  activateSite,
  syncSiteScripts,
} from "./background/permissions"
import { readSettings, updateSettings } from "./background/settings"
import type { Snapshot } from "./core/types"
import {
  isContext,
  isFlowState,
  isFlowStatus,
  isRecord,
  isVerificationLinkContext,
  siteOrigin,
} from "./core/validation"

const mailboxes = new Mailboxes()
const coordinator = new Coordinator(mailboxes)
const linkCoordinator = new LinkCoordinator(mailboxes)
let disconnecting = false
let authGeneration = 0
let connecting = false
let systemError: string | null = null
let syncing = Promise.resolve()
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  (async () => {
    const values = await chrome.storage.session.get(null)
    await chrome.storage.session.remove(
      Object.keys(values).filter((key) => key.startsWith("flow:")),
    )
  })(),
])

function sync(): Promise<void> {
  syncing = syncing.then(syncSiteScripts, syncSiteScripts)
  return syncing
}

function run(operation: Promise<unknown>): void {
  void operation.catch(() => {
    systemError =
      "A background action could not finish. Reload the extension and recheck site permissions."
  })
}

async function snapshot(): Promise<Snapshot> {
  const tab = await activeTab()
  const origin = siteOrigin(tab?.url)
  const values =
    tab?.id === undefined
      ? {}
      : await chrome.storage.session.get(`flow:${tab.id}`)
  const permissions = await chrome.permissions.getAll()
  const flow: unknown = tab?.id === undefined ? null : values[`flow:${tab.id}`]
  return {
    ...(await new Mailboxes().accounts()),
    systemError,
    configured: isConfigured(),
    settings: await readSettings(),
    flow: isFlowStatus(flow) ? flow : null,
    allowed: Boolean(
      origin && (await chrome.permissions.contains({ origins: [origin] })),
    ),
    origin,
    tabId: tab?.id ?? null,
    sites: (permissions.origins ?? []).filter(
      (value) =>
        siteOrigin(value) === value &&
        ![
          "https://gmail.googleapis.com/*",
          "https://oauth2.googleapis.com/*",
        ].includes(value),
    ),
  }
}

async function stopContent(): Promise<void> {
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [chrome.tabs.sendMessage(tab.id, { type: "STOP" })],
    ),
  )
}

async function handleUi(message: Record<string, unknown>): Promise<unknown> {
  switch (message.type) {
    case "SNAPSHOT":
      return snapshot()
    case "CONNECT": {
      if (disconnecting || connecting)
        return {
          ok: false,
          error: "Wait for the current connection action to finish.",
        }
      connecting = true
      const generation = ++authGeneration
      try {
        const token = await getToken(true)
        const accountEmail = await new GmailClient().verifyConnection(
          AbortSignal.timeout(15_000),
        )
        if (generation !== authGeneration || disconnecting) {
          await chrome.identity.removeCachedAuthToken({ token })
          return {
            ok: false,
            error: "Connection was cancelled by a newer account action.",
          }
        }
        await updateSettings({
          connected: true,
          revocationPending: false,
          accountEmail,
        })
        const tab = await activeTab()
        if (tab?.id !== undefined)
          await chrome.tabs
            .sendMessage(tab.id, { type: "RETRY" })
            .catch(() => false)
        return { ok: true }
      } finally {
        connecting = false
      }
    }
    case "DISCONNECT": {
      const settings = await readSettings()
      disconnecting = true
      authGeneration++
      try {
        await updateSettings({
          connected: false,
          companionEnabled: false,
          accountEmail: undefined,
        })
        await coordinator.stopAll("permission_required")
        await linkCoordinator.stopAll("permission_required")
        await stopContent()
        let companionRevoked = true
        if (settings.companionEnabled) {
          try {
            companionRevoked =
              (await companionCall({ operation: "disconnect" })).revoked ===
              true
          } catch {
            companionRevoked = false
          }
        }
        const revoked =
          (settings.connected ? await disconnectGmail() : true) &&
          companionRevoked
        await chrome.storage.session.remove("companionSession")
        await updateSettings({ connected: false, revocationPending: !revoked })
        return { ok: true, revoked }
      } finally {
        disconnecting = false
      }
    }
    case "ADD_ACCOUNT": {
      if (
        !(await chrome.permissions.contains({
          origins: ["http://127.0.0.1/*"],
        }))
      )
        return {
          ok: false,
          error: "Approve the local companion connection first.",
        }
      await updateSettings({ companionEnabled: true })
      let value: Record<string, unknown>
      try {
        value = await companionCall({ operation: "authorize" })
      } catch {
        return {
          ok: false,
          error:
            "Start npm run companion with a Desktop OAuth client configured, then retry adding the inbox.",
        }
      }
      const url = typeof value.url === "string" ? new URL(value.url) : null
      if (
        !url ||
        url.origin !== "https://accounts.google.com" ||
        url.pathname !== "/o/oauth2/v2/auth" ||
        url.searchParams.get("response_type") !== "code" ||
        url.searchParams.get("scope") !==
          "https://www.googleapis.com/auth/gmail.readonly"
      )
        return {
          ok: false,
          error:
            "The local companion returned an invalid authorization request.",
        }
      await coordinator.stopAll()
      await linkCoordinator.stopAll()
      await stopContent()
      await chrome.tabs.create({ url: url.href })
      return { ok: true }
    }
    case "REMOVE_ACCOUNT": {
      if (typeof message.id !== "string") return { ok: false }
      await coordinator.stopAll()
      await linkCoordinator.stopAll()
      await stopContent()
      let revoked = true
      if (message.id === "chrome") {
        await updateSettings({ connected: false, accountEmail: undefined })
        revoked = await disconnectGmail()
      } else if (/^[a-f0-9]{32}$/.test(message.id)) {
        revoked =
          (await companionCall({ operation: "remove", id: message.id }))
            .revoked === true
      } else return { ok: false }
      if (!revoked) await updateSettings({ revocationPending: true })
      return { ok: true }
    }
    case "SET_AFTER_FILL": {
      if (
        typeof message.pressEnter !== "boolean" ||
        typeof message.enterDelayMs !== "number" ||
        !Number.isInteger(message.enterDelayMs) ||
        message.enterDelayMs < 0 ||
        message.enterDelayMs > 2000
      )
        return {
          ok: false,
          error: "Choose an Enter delay between 0 and 2000 milliseconds.",
        }
      await updateSettings({
        pressEnter: message.pressEnter,
        enterDelayMs: message.enterDelayMs,
      })
      return { ok: true }
    }
    case "SET_AUTOFILL": {
      if (typeof message.value !== "boolean") return { ok: false }
      await updateSettings({ autofill: message.value })
      if (!message.value) {
        await coordinator.stopAll()
        await linkCoordinator.stopAll()
        await stopContent()
      } else {
        const tab = await activeTab()
        if (tab?.id !== undefined)
          await chrome.tabs
            .sendMessage(tab.id, { type: "RETRY" })
            .catch(() => false)
      }
      return { ok: true }
    }
    case "ENABLE_SITE": {
      const tab = await activeTab()
      const origin = siteOrigin(tab?.url)
      if (
        !origin ||
        tab?.id === undefined ||
        !(await chrome.permissions.contains({ origins: [origin] }))
      )
        return { ok: false, error: "Grant access to the current site first." }
      await sync()
      await activateSite(tab.id)
      return { ok: true }
    }
    case "REMOVE_SITE": {
      if (
        typeof message.origin !== "string" ||
        siteOrigin(message.origin) !== message.origin ||
        [
          "https://gmail.googleapis.com/*",
          "https://oauth2.googleapis.com/*",
        ].includes(message.origin)
      )
        return { ok: false }
      await chrome.permissions.remove({ origins: [message.origin] })
      await coordinator.stopAll()
      await linkCoordinator.stopAll()
      await stopContent()
      await sync()
      return { ok: true }
    }
    case "RETRY_FLOW": {
      const tab = await activeTab()
      if (tab?.id === undefined)
        return { ok: false, error: "Open a supported verification page first." }
      await coordinator.remove(tab.id)
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "RETRY" })
        return { ok: true }
      } catch {
        return {
          ok: false,
          error: "Enable this site and reload its verification page.",
        }
      }
    }
    case "CHOOSE_CANDIDATE": {
      const tab = await activeTab()
      if (
        tab?.id === undefined ||
        typeof message.id !== "string" ||
        typeof message.candidateId !== "string"
      )
        return { ok: false }
      return {
        ok: await coordinator.choose(tab.id, message.id, message.candidateId),
      }
    }
    default:
      return { ok: false, error: "Unsupported action." }
  }
}

async function handle(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  await ready
  if (!isRecord(message) || sender.id !== chrome.runtime.id)
    return { ok: false }
  if (isExtensionUi(sender)) return handleUi(message)
  const tabId = sender.tab?.id
  if (
    tabId === undefined ||
    sender.frameId !== 0 ||
    !sender.documentId ||
    !sender.url ||
    !siteOrigin(sender.url)
  )
    return { ok: false }
  if (
    message.type === "REGISTER_LINK" &&
    isVerificationLinkContext(message.context)
  )
    return linkCoordinator.register(
      tabId,
      sender.documentId,
      sender.url,
      message.context,
    )
  if (
    message.type === "POLL_LINK" &&
    isVerificationLinkContext(message.context)
  ) {
    if (disconnecting) return { state: "permission_required" }
    return linkCoordinator.poll(
      tabId,
      sender.documentId,
      sender.url,
      message.context,
    )
  }
  if (
    message.type === "LINK_DECISION" &&
    typeof message.id === "string" &&
    typeof message.approved === "boolean"
  )
    return linkCoordinator.decide(
      tabId,
      sender.documentId,
      message.id,
      message.approved,
    )
  if (
    message.type === "LINK_ACTION_PERFORMED" &&
    typeof message.id === "string"
  )
    return { ok: linkCoordinator.recordAction(tabId, message.id) }
  if (
    message.type === "AFTER_FILL_RESULT" &&
    typeof message.id === "string" &&
    (message.result === "sent" ||
      message.result === "skipped" ||
      message.result === "failed")
  ) {
    await coordinator.afterFillResult(
      tabId,
      sender.documentId,
      message.id,
      message.result,
    )
    return { ok: true }
  }
  if (message.type === "AFTER_FILL_POLICY" && typeof message.id === "string")
    return coordinator.afterFillPolicy(tabId, sender.documentId, message.id)
  if (message.type === "REGISTER" && isContext(message.context))
    return coordinator.register(
      tabId,
      sender.documentId,
      sender.url,
      message.context,
    )
  if (message.type === "POLL" && isContext(message.context)) {
    if (disconnecting) return { state: "permission_required" }
    return coordinator.poll(
      tabId,
      sender.documentId,
      sender.url,
      message.context,
    )
  }
  if (
    message.type === "FLOW_EVENT" &&
    typeof message.id === "string" &&
    isFlowState(message.state) &&
    ["filled", "completed", "failed", "timed_out", "cancelled"].includes(
      message.state,
    )
  ) {
    await coordinator.event(tabId, sender.documentId, message.id, message.state)
    return { ok: true }
  }
  return { ok: false }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  void handle(message, sender)
    .then(respond)
    .catch((error: unknown) => {
      const explanation =
        error instanceof GmailError
          ? error.kind === "configuration"
            ? "Set up the Google OAuth client and rebuild. See the setup guide."
            : error.kind === "temporary"
              ? "Gmail is temporarily unavailable. Try again shortly."
              : "Gmail connection was cancelled, expired, or denied. Connect again to continue."
          : "The action could not finish. Check site permissions, then try again."
      respond({ ok: false, error: explanation })
    })
  return true
})

chrome.tabs.onRemoved.addListener((tabId) => {
  run(
    ready.then(async () => {
      await coordinator.remove(tabId)
      await linkCoordinator.remove(tabId)
    }),
  )
})
chrome.tabs.onActivated.addListener(({ tabId }) => {
  run(
    ready.then(() =>
      chrome.tabs.sendMessage(tabId, { type: "WAKE" }).catch(() => false),
    ),
  )
})
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  run(
    ready.then(async () => {
      if (change.status === "loading" || change.url)
        await coordinator.remove(tabId)
      await linkCoordinator.onTabUpdated(tabId, change, tab)
    }),
  )
})
chrome.permissions.onAdded.addListener(() => {
  run(sync())
})
chrome.permissions.onRemoved.addListener(() => {
  run(
    ready.then(async () => {
      await coordinator.stopAll("permission_required")
      await linkCoordinator.stopAll("permission_required")
      await stopContent()
      await sync()
    }),
  )
})
chrome.runtime.onInstalled.addListener(() => {
  run(sync())
})

export {}
