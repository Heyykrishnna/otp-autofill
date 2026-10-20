import { Coordinator } from "./background/coordinator"
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
  siteOrigin,
} from "./core/validation"

const coordinator = new Coordinator()
let disconnecting = false
let authGeneration = 0
let connecting = false
let systemError: string | null = null
let syncing = Promise.resolve()
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.clear(),
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
        await new GmailClient().verifyConnection(AbortSignal.timeout(15_000))
        if (generation !== authGeneration || disconnecting) {
          await chrome.identity.removeCachedAuthToken({ token })
          return {
            ok: false,
            error: "Connection was cancelled by a newer account action.",
          }
        }
        await updateSettings({ connected: true, revocationPending: false })
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
      disconnecting = true
      authGeneration++
      try {
        await updateSettings({ connected: false })
        await coordinator.stopAll("permission_required")
        await stopContent()
        const revoked = await disconnectGmail()
        await updateSettings({ connected: false, revocationPending: !revoked })
        return { ok: true, revoked }
      } finally {
        disconnecting = false
      }
    }
    case "SET_AUTOFILL": {
      if (typeof message.value !== "boolean") return { ok: false }
      await updateSettings({ autofill: message.value })
      if (!message.value) {
        await coordinator.stopAll()
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
  run(ready.then(() => coordinator.remove(tabId)))
})
chrome.tabs.onActivated.addListener(({ tabId }) => {
  run(
    ready.then(() =>
      chrome.tabs.sendMessage(tabId, { type: "WAKE" }).catch(() => false),
    ),
  )
})
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" || change.url)
    run(ready.then(() => coordinator.remove(tabId)))
})
chrome.permissions.onAdded.addListener(() => {
  run(sync())
})
chrome.permissions.onRemoved.addListener(() => {
  run(
    ready.then(async () => {
      await coordinator.stopAll("permission_required")
      await stopContent()
      await sync()
    }),
  )
})
chrome.runtime.onInstalled.addListener(() => {
  run(sync())
})

export {}
