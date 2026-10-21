import { isRecord, siteOrigin } from "../core/validation"

export const CONTENT_SCRIPT_FILE = "otp-content.js"

async function sendOrInject(
  tabId: number,
  type: "RETRY" | "WAKE",
): Promise<void> {
  const resumed = await chrome.tabs.sendMessage(tabId, { type }).then(
    (result: unknown) => isRecord(result) && result.ok === true,
    () => false,
  )
  if (!resumed)
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
      world: "ISOLATED",
    })
}

export function activateSite(tabId: number): Promise<void> {
  return sendOrInject(tabId, "RETRY")
}

export function wakeSite(tabId: number): Promise<void> {
  return sendOrInject(tabId, "WAKE")
}

export async function syncSiteScripts(): Promise<void> {
  const permissions = await chrome.permissions.getAll()
  const sites = (permissions.origins ?? [])
    .filter((origin) => siteOrigin(origin) === origin)
    .filter(
      (origin) =>
        ![
          "https://gmail.googleapis.com/*",
          "https://oauth2.googleapis.com/*",
        ].includes(origin),
    )
  const registered = await chrome.scripting.getRegisteredContentScripts()
  const current = registered.filter((script) =>
    script.id.startsWith("otp-site-"),
  )
  const signature = (matches: string[]) => [...matches].sort().join(",")
  if (
    current.length === 1 &&
    signature(current[0]?.matches ?? []) === signature(sites)
  )
    return
  if (current.length > 0)
    await chrome.scripting.unregisterContentScripts({
      ids: current.map((script) => script.id),
    })
  if (sites.length > 0)
    await chrome.scripting.registerContentScripts([
      {
        id: "otp-site-grants",
        matches: sites,
        js: [CONTENT_SCRIPT_FILE],
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true,
        world: "ISOLATED",
      },
    ])
}

export async function activeTab(): Promise<chrome.tabs.Tab | null> {
  return (
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ??
    null
  )
}
