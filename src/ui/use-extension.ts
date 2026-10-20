import { useCallback, useEffect, useState } from "react"

import type { Snapshot } from "../core/types"
import { isRecord } from "../core/validation"

export function useExtension() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const value: Snapshot = await chrome.runtime.sendMessage({
        type: "SNAPSHOT",
      })
      if (!value || !value.settings) throw new Error("unavailable")
      setSnapshot(value)
    } catch {
      setError(
        "Could not reach the extension. Reload it from chrome://extensions.",
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onChanged = () => {
      void refresh()
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [refresh])

  async function act(message: Record<string, unknown>): Promise<void> {
    setBusy(true)
    setError("")
    try {
      const result: unknown = await chrome.runtime.sendMessage(message)
      if (!isRecord(result) || result.ok !== true)
        throw new Error(
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "This attempt has changed. Refresh and try again.",
        )
      await refresh()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not complete the action. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function enableSite(): Promise<void> {
    if (!snapshot?.origin) return
    setError("")
    try {
      const granted = await chrome.permissions.request({
        origins: [snapshot.origin],
      })
      if (!granted) {
        setError(
          "Site access was declined. You can enable it whenever you're ready.",
        )
        return
      }
      await act({ type: "ENABLE_SITE" })
    } catch {
      setError("Chrome could not grant site access. Try a regular HTTPS tab.")
    }
  }

  return { snapshot, error, busy, act, enableSite }
}
