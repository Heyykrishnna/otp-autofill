import type {
  Discovery,
  EmailMessage,
  MailboxAccount,
  MessageSource,
} from "../core/types"
import { companionAccounts, companionDiscover } from "./companion"
import { GmailClient, GmailError } from "./gmail"
import { readSettings, updateSettings } from "./settings"

export class Mailboxes implements MessageSource {
  async discover(
    startedAt: number,
    seen: Set<string>,
    signal: AbortSignal,
  ): Promise<Discovery> {
    const settings = await readSettings()
    const sources: {
      id: string
      read: (seen: Set<string>) => Promise<EmailMessage[]>
    }[] = []
    const warnings: string[] = []
    if (settings.connected)
      sources.push({
        id: "chrome",
        read: async (localSeen) => {
          let email = settings.accountEmail
          if (!email) {
            email = await new GmailClient().verifyConnection(signal)
            await updateSettings({ accountEmail: email })
          }
          const client = new GmailClient(undefined, undefined, undefined, email)
          const found = await client.discover(
            startedAt,
            localSeen,
            signal,
            () =>
              warnings.push(
                "More recent emails matched than could be checked: confirm the intended email.",
              ),
          )
          return found.map((message) => ({ ...message, account: email }))
        },
      })
    if (settings.companionEnabled) {
      try {
        for (const account of await companionAccounts()) {
          if (!account.available)
            warnings.push(
              "An inbox needs reconnection. Enter the code manually or reconnect it in Settings.",
            )
          else if (
            account.email !== settings.accountEmail ||
            !settings.connected
          )
            sources.push({
              id: account.id,
              read: (localSeen) =>
                companionDiscover(account, startedAt, localSeen, signal),
            })
        }
      } catch {
        warnings.push(
          "The local companion is unavailable. Start it or enter the code manually.",
        )
      }
    }
    if (!sources.length)
      throw new GmailError(warnings.length ? "temporary" : "permission")
    const messages: EmailMessage[] = []
    let completed = 0
    let failure: unknown
    for (let index = 0; index < sources.length; index += 2) {
      const batch = await Promise.allSettled(
        sources.slice(index, index + 2).map(async (source) => {
          const prefix = `${source.id}_`
          const localSeen = new Set(
            [...seen]
              .filter((id) => id.startsWith(prefix))
              .map((id) => id.slice(prefix.length)),
          )
          const found = await source.read(localSeen)
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
          for (const id of localSeen) seen.add(`${prefix}${id}`)
          return found.map((message) => ({
            ...message,
            id: `${prefix}${message.id}`,
          }))
        }),
      )
      for (const [position, result] of batch.entries()) {
        if (result.status === "fulfilled") {
          completed++
          messages.push(...result.value)
        } else {
          failure ??= result.reason
          if (
            sources[index + position]?.id === "chrome" &&
            result.reason instanceof GmailError &&
            result.reason.kind !== "temporary"
          )
            await updateSettings({ connected: false, accountEmail: undefined })
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
          warnings.push(
            "An authorized inbox could not be searched. Reconnect it or choose a known email manually.",
          )
        }
      }
    }
    if (!completed)
      throw failure instanceof GmailError
        ? failure
        : new GmailError("temporary")
    return { messages, warnings: [...new Set(warnings)] }
  }

  async accounts(): Promise<{
    accounts: MailboxAccount[]
    accountError: string | null
  }> {
    const settings = await readSettings()
    const accounts: MailboxAccount[] = settings.connected
      ? [
          {
            id: "chrome",
            email: settings.accountEmail ?? "Chrome profile inbox",
            source: "chrome",
            available: true,
          },
        ]
      : []
    let accountError: string | null = null
    if (settings.companionEnabled) {
      try {
        accounts.push(
          ...(await companionAccounts()).filter(
            (account) =>
              !accounts.some((existing) => existing.email === account.email),
          ),
        )
      } catch {
        accountError =
          "The local inbox companion is unavailable. Run npm run companion and check its OAuth setup."
      }
    }
    return { accounts, accountError }
  }
}
