import { DEFAULT_SETTINGS, type Settings } from "../core/types"
import { isRecord } from "../core/validation"

export async function readSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get("settings")
  const value: unknown = result.settings
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS }
  return {
    autofill: typeof value.autofill === "boolean" ? value.autofill : true,
    connected: value.connected === true,
    revocationPending: value.revocationPending === true,
  }
}

let writes: Promise<unknown> = Promise.resolve()

export function updateSettings(change: Partial<Settings>): Promise<Settings> {
  const apply = async () => {
    const settings = { ...(await readSettings()), ...change }
    await chrome.storage.local.set({ settings })
    return settings
  }
  const operation = writes.then(apply, apply)
  writes = operation
  return operation
}
