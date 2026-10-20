import { emailAddress } from "../core/evidence"
import type { EmailMessage, MailboxAccount } from "../core/types"
import { isRecord } from "../core/validation"
import { GmailError } from "./gmail"

const ADDRESS = "http://127.0.0.1:43127"

export async function companionCall(
  input: Record<string, unknown>,
  signal = AbortSignal.timeout(10_000),
): Promise<Record<string, unknown>> {
  const request = async (
    path: string,
    body: Record<string, unknown>,
    session?: string,
  ): Promise<Response> => {
    try {
      return await fetch(`${ADDRESS}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      })
    } catch {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
      throw new GmailError("temporary")
    }
  }
  const cached = await chrome.storage.session.get("companionSession")
  let session: unknown = cached.companionSession
  for (let attempt = 0; attempt < 2; attempt++) {
    if (typeof session !== "string" || !/^[a-f0-9]{64}$/.test(session)) {
      const response = await request("pair", {})
      const value: unknown = await response.json()
      if (
        !response.ok ||
        !isRecord(value) ||
        typeof value.session !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.session)
      )
        throw new GmailError("permission")
      session = value.session
      await chrome.storage.session.set({ companionSession: session })
    }
    const response = await request(
      "rpc",
      input,
      typeof session === "string" ? session : undefined,
    )
    if (response.status === 401) {
      await chrome.storage.session.remove("companionSession")
      session = undefined
      continue
    }
    if (!response.ok)
      throw new GmailError(response.status >= 500 ? "temporary" : "permission")
    const text = await response.text()
    if (text.length > 12_000_000) throw new GmailError("temporary")
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) throw new GmailError("temporary")
    return value
  }
  throw new GmailError("authorization")
}

export async function companionAccounts(): Promise<MailboxAccount[]> {
  const result = await companionCall(
    { operation: "accounts" },
    AbortSignal.timeout(2000),
  )
  if (!Array.isArray(result.accounts) || result.accounts.length > 5)
    throw new GmailError("temporary")
  return result.accounts.map((value: unknown) => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.id) ||
      typeof value.email !== "string" ||
      !emailAddress(value.email) ||
      typeof value.available !== "boolean"
    )
      throw new GmailError("temporary")
    return {
      id: value.id,
      email: value.email,
      available: value.available,
      source: "companion",
    }
  })
}

export async function companionDiscover(
  account: MailboxAccount,
  startedAt: number,
  seen: Set<string>,
  signal: AbortSignal,
): Promise<EmailMessage[]> {
  const result = await companionCall(
    {
      operation: "discover",
      id: account.id,
      startedAt,
      seen: [...seen].slice(-200),
    },
    AbortSignal.any([signal, AbortSignal.timeout(28_000)]),
  )
  if (
    !Array.isArray(result.messages) ||
    result.messages.length > 10 ||
    !Array.isArray(result.seen) ||
    result.seen.length > 200 ||
    !result.seen.every(
      (id: unknown) =>
        typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id),
    )
  )
    throw new GmailError("temporary")
  const messages = result.messages.map((value: unknown): EmailMessage => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ||
      typeof value.receivedAt !== "number" ||
      !Number.isFinite(value.receivedAt) ||
      typeof value.sender !== "string" ||
      value.sender.length > 500 ||
      typeof value.subject !== "string" ||
      value.subject.length > 500 ||
      typeof value.text !== "string" ||
      value.text.length > 1_000_000 ||
      value.account !== account.email
    )
      throw new GmailError("temporary")
    const strings = (input: unknown, limit: number): string[] =>
      Array.isArray(input)
        ? input
            .slice(0, limit)
            .filter(
              (entry): entry is string =>
                typeof entry === "string" && entry.length <= 254,
            )
        : []
    return {
      id: value.id,
      receivedAt: value.receivedAt,
      sender: value.sender,
      subject: value.subject,
      text: value.text,
      account: account.email,
      recipients: strings(value.recipients, 20),
      audiences: strings(value.audiences, 32),
      forwarded: value.forwarded === true,
      senderAuthentication:
        value.senderAuthentication === "pass" ||
        value.senderAuthentication === "fail"
          ? value.senderAuthentication
          : "unknown",
      verificationDomains: strings(value.verificationDomains, 16),
    }
  })
  for (const id of result.seen) seen.add(id)
  return messages
}
