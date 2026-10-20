import { useCallback, useEffect, useRef, useState } from "react"

import type { Snapshot } from "../core/types"
import { isRecord, isSnapshot } from "../core/validation"

export function useExtension() {
  const refreshing = useRef(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState("")
  const [connectionError, setConnectionError] = useState("")
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const value: unknown = await chrome.runtime.sendMessage({
        type: "SNAPSHOT",
      })
      if (!isSnapshot(value)) {
        setConnectionError(
          "The settings page and background worker are out of sync. Reload OTP Autofill in chrome://extensions, close this page and reopen Settings.",
        )
        return
      }
      setSnapshot(value)
      setConnectionError("")
    } catch {
      setConnectionError(
        "Could not reach the extension. Reload it from chrome://extensions.",
      )
    } finally {
      refreshing.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onChanged = () => {
      void refresh()
    }
    chrome.storage.onChanged.addListener(onChanged)
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      clearInterval(timer)
      chrome.storage.onChanged.removeListener(onChanged)
    }
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

  async function addAccount(): Promise<void> {
    setError("")
    try {
      if (
        !(await chrome.permissions.request({ origins: ["http://127.0.0.1/*"] }))
      ) {
        setError(
          "The local inbox companion needs loopback permission. No additional inbox was connected.",
        )
        return
      }
      await act({ type: "ADD_ACCOUNT" })
    } catch {
      setError(
        "Start the local companion and check its Desktop OAuth configuration before adding an inbox.",
      )
    }
  }

  return {
    snapshot,
    error: error || connectionError,
    busy,
    act,
    enableSite,
    addAccount,
  }
}
