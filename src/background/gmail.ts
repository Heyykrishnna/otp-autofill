import { emailAddress } from "../core/evidence"
import { parseGmailMessage } from "../core/email-parser"
import { GMAIL_SCOPE, type EmailMessage } from "../core/types"
import { isRecord } from "../core/validation"

export class GmailError extends Error {
  constructor(
    public readonly kind:
      "configuration" | "authorization" | "temporary" | "permission",
    public readonly retryAfter = 0,
  ) {
    super(kind)
  }
}

export function isConfigured(): boolean {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id
  return (
    typeof clientId === "string" &&
    /^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)
  )
}

export async function getToken(interactive: boolean): Promise<string> {
  if (!isConfigured()) throw new GmailError("configuration")
  try {
    const result = await chrome.identity.getAuthToken({
      interactive,
      enableGranularPermissions: true,
      scopes: [GMAIL_SCOPE],
    })
    if (
      !result.token ||
      (result.grantedScopes && !result.grantedScopes.includes(GMAIL_SCOPE))
    )
      throw new GmailError("permission")
    return result.token
  } catch (error) {
    if (error instanceof GmailError) throw error
    throw new GmailError("authorization")
  }
}

export class GmailClient {
  constructor(
    private readonly tokenProvider = getToken,
    private readonly request: typeof fetch = (input, init) =>
      fetch(input, init),
    private readonly invalidate: (token: string) => Promise<void> = (token) =>
      chrome.identity.removeCachedAuthToken({ token }),
    private readonly mailbox?: string,
  ) {}

  private async json(
    path: string,
    signal: AbortSignal,
    retry = true,
  ): Promise<unknown> {
    const token = await this.tokenProvider(false)
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
    let response: Response
    try {
      response = await this.request(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(this.mailbox ?? "me")}/${path}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          cache: "no-store",
          redirect: "error",
          credentials: "omit",
        },
      )
    } catch {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
      throw new GmailError("temporary")
    }
    if (response.status === 401) {
      await this.invalidate(token)
      if (retry) return this.json(path, signal, false)
      throw new GmailError("authorization")
    }
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get("retry-after"))
      throw new GmailError(
        "temporary",
        Number.isFinite(seconds)
          ? Math.min(Math.max(seconds * 1_000, 5_000), 120_000)
          : 20_000,
      )
    }
    if (response.status === 403) {
      const body: unknown = await response.json().catch(() => null)
      const reason =
        isRecord(body) &&
        isRecord(body.error) &&
        Array.isArray(body.error.errors)
          ? body.error.errors
          : []
      if (
        reason.some(
          (value) =>
            isRecord(value) &&
            ["rateLimitExceeded", "userRateLimitExceeded"].includes(
              String(value.reason),
            ),
        )
      )
        throw new GmailError("temporary", 30_000)
      throw new GmailError("permission")
    }
    if (!response.ok) throw new GmailError("temporary")
    const text = await response.text()
    if (text.length > 2_000_000) throw new GmailError("temporary")
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new GmailError("temporary")
    }
  }

  async verifyConnection(signal: AbortSignal): Promise<string> {
    const profile = await this.json("profile?fields=emailAddress", signal)
    if (!isRecord(profile) || typeof profile.emailAddress !== "string")
      throw new GmailError("authorization")
    const address = emailAddress(profile.emailAddress)
    if (!address || (this.mailbox && address !== this.mailbox))
      throw new GmailError("authorization")
    return address
  }

  async discover(
    startedAt: number,
    seen: Set<string>,
    signal: AbortSignal,
    // Without this, more matches than one page abstains; with it, the newest
    // page is read and the caller is told the search was cut short.
    onTruncated?: () => void,
  ): Promise<EmailMessage[]> {
    const query = `after:${Math.floor((startedAt - 120_000) / 1_000)} -in:spam -in:trash {"verification code" "security code" "one time" "one-time" "signing in" "sign-in" "sign in" "login code" "login" "authentication code" "verify your email" "confirm your email" "verification link" "activation link" passcode otp code verify verification confirm confirmation pin security 2fa "two-factor" "2-step" magic}`
    const params = new URLSearchParams({
      q: query,
      maxResults: "10",
      fields: "messages/id,nextPageToken",
    })
    const list = await this.json(`messages?${params}`, signal)
    if (
      !isRecord(list) ||
      (list.messages !== undefined && !Array.isArray(list.messages))
    )
      throw new GmailError("temporary")
    if (typeof list.nextPageToken === "string") {
      if (!onTruncated) throw new GmailError("temporary", 10_000)
      onTruncated()
    }
    const ids = (Array.isArray(list.messages) ? list.messages : [])
      .flatMap((item: unknown) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        /^[a-zA-Z0-9_-]{1,100}$/.test(item.id) &&
        !seen.has(item.id)
          ? [item.id]
          : [],
      )
      .slice(0, 10)
    const messages: EmailMessage[] = []
    for (let offset = 0; offset < ids.length; offset += 3) {
      const batch = await Promise.all(
        ids.slice(offset, offset + 3).map(async (id) => {
          const raw = await this.json(
            `messages/${encodeURIComponent(id)}?format=full&fields=id,internalDate,payload`,
            signal,
          )
          return { id, message: parseGmailMessage(raw) }
        }),
      )
      for (const result of batch) {
        if (result.message)
          messages.push({
            ...result.message,
            account: result.message.account ?? this.mailbox,
          })
      }
    }
    for (const id of ids) seen.add(id)
    return messages
  }
}

export async function disconnectGmail(): Promise<boolean> {
  let revoked = false
  try {
    const token = await getToken(false)
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
      credentials: "omit",
      redirect: "error",
    })
    revoked = response.ok
  } catch {
    revoked = false
  } finally {
    await chrome.identity.clearAllCachedAuthTokens()
  }
  return revoked
}
