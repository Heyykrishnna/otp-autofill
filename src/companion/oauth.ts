import { createHash, randomBytes } from "node:crypto"

import { GmailClient, GmailError } from "../background/gmail"
import {
  GMAIL_SCOPE,
  type MailboxAccount,
  type EmailMessage,
} from "../core/types"
import { isRecord } from "../core/validation"

interface Authorization {
  verifier: string
  redirect: string
  expiresAt: number
}
interface AuthorizedAccount {
  email: string
  token: string
  refreshToken?: string
  expiresAt: number
  available: boolean
  refresh?: Promise<string>
}

export class AccountVault {
  private pending = new Map<string, Authorization>()
  private accounts = new Map<string, AuthorizedAccount>()
  private generation = 0

  constructor(
    private readonly clientId: string,
    private readonly clientSecret = "",
    private readonly request: typeof fetch = fetch,
  ) {}

  begin(redirect: string): { state: string; url: string } {
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(this.clientId))
      throw new Error(
        "Configure a Desktop OAuth client before adding accounts.",
      )
    if (this.accounts.size >= 5)
      throw new Error(
        "Disconnect an account before adding another. The limit is five inboxes.",
      )
    for (const [state, value] of this.pending)
      if (value.expiresAt <= Date.now()) this.pending.delete(state)
    if (this.pending.size >= 3)
      throw new Error(
        "Finish or cancel the pending account authorizations first.",
      )
    const verifier = randomBytes(48).toString("base64url")
    const state = randomBytes(32).toString("base64url")
    this.pending.set(state, {
      verifier,
      redirect,
      expiresAt: Date.now() + 180_000,
    })
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: GMAIL_SCOPE,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "select_account consent",
    }).toString()
    return { state, url: url.href }
  }

  cancel(state: string): void {
    this.pending.delete(state)
  }

  private async revoke(token: string): Promise<boolean> {
    try {
      const response = await this.request(
        "https://oauth2.googleapis.com/revoke",
        {
          method: "POST",
          body: new URLSearchParams({ token }),
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.timeout(10_000),
        },
      )
      return response.ok
    } catch {
      return false
    }
  }

  private async exchange(
    values: Record<string, string>,
  ): Promise<{ token: string; expiresAt: number; refreshToken?: string }> {
    const body = new URLSearchParams({
      ...values,
      client_id: this.clientId,
      ...(this.clientSecret ? { client_secret: this.clientSecret } : {}),
    })
    const response = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body,
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok)
      throw new GmailError(
        response.status >= 500 || response.status === 429
          ? "temporary"
          : "authorization",
      )
    const value: unknown = await response.json()
    if (
      !isRecord(value) ||
      typeof value.access_token !== "string" ||
      !value.access_token ||
      value.access_token.length > 8192 ||
      typeof value.expires_in !== "number" ||
      value.expires_in <= 0 ||
      value.expires_in > 86400 ||
      (value.token_type !== undefined &&
        String(value.token_type).toLowerCase() !== "bearer")
    )
      throw new GmailError("permission")
    if (
      (values.grant_type === "authorization_code" ||
        value.scope !== undefined) &&
      (typeof value.scope !== "string" ||
        !value.scope.split(" ").includes(GMAIL_SCOPE))
    ) {
      await this.revoke(value.access_token)
      throw new GmailError("permission")
    }
    return {
      token: value.access_token,
      expiresAt: Date.now() + value.expires_in * 1000,
      ...(typeof value.refresh_token === "string" &&
      value.refresh_token.length <= 8192
        ? { refreshToken: value.refresh_token }
        : {}),
    }
  }

  async complete(state: string, code: string): Promise<void> {
    const pending = this.pending.get(state)
    this.pending.delete(state)
    if (
      !pending ||
      pending.expiresAt <= Date.now() ||
      !code ||
      code.length > 4096
    )
      throw new Error("Authorization expired or did not match this request.")
    const generation = this.generation
    const token = await this.exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirect,
    })
    let adopted = false
    try {
      const email = await new GmailClient(
        async () => token.token,
        this.request,
        async () => undefined,
      ).verifyConnection(AbortSignal.timeout(10_000))
      if (generation !== this.generation)
        throw new Error("Authorization was cancelled.")
      const existing = [...this.accounts.entries()].find(
        ([, account]) => account.email === email,
      )
      if (!existing && this.accounts.size >= 5)
        throw new Error("The inbox limit was reached.")
      this.accounts.set(existing?.[0] ?? randomBytes(16).toString("hex"), {
        ...token,
        refreshToken: token.refreshToken ?? existing?.[1].refreshToken,
        email,
        available: true,
      })
      adopted = true
    } finally {
      if (!adopted) {
        await this.revoke(token.refreshToken ?? token.token)
        token.token = ""
        token.refreshToken = undefined
      }
    }
  }

  list(): MailboxAccount[] {
    return [...this.accounts].map(([id, account]) => ({
      id,
      email: account.email,
      source: "companion",
      available:
        account.available &&
        (account.expiresAt > Date.now() || Boolean(account.refreshToken)),
    }))
  }

  private async token(account: AuthorizedAccount): Promise<string> {
    if (!account.available) throw new GmailError("authorization")
    if (account.expiresAt > Date.now() + 30_000) return account.token
    if (!account.refreshToken) {
      account.available = false
      throw new GmailError("authorization")
    }
    if (account.refresh) return account.refresh
    account.refresh = (async () => {
      try {
        const result = await this.exchange({
          grant_type: "refresh_token",
          refresh_token: account.refreshToken ?? "",
        })
        if (!account.available) {
          await this.revoke(result.refreshToken ?? result.token)
          throw new GmailError("authorization")
        }
        account.token = result.token
        account.expiresAt = result.expiresAt
        if (result.refreshToken) account.refreshToken = result.refreshToken
        return result.token
      } catch (error) {
        if (error instanceof GmailError && error.kind !== "temporary")
          account.available = false
        throw error
      } finally {
        account.refresh = undefined
      }
    })()
    return account.refresh
  }

  async discover(
    id: string,
    startedAt: number,
    seen: Set<string>,
    signal: AbortSignal,
  ): Promise<EmailMessage[]> {
    const account = this.accounts.get(id)
    if (!account) throw new GmailError("authorization")
    const generation = this.generation
    const client = new GmailClient(
      () => this.token(account),
      this.request,
      async () => {
        account.expiresAt = 0
      },
      account.email,
    )
    let messages: EmailMessage[]
    try {
      messages = await client.discover(startedAt, seen, signal)
    } catch (error) {
      if (error instanceof GmailError && error.kind !== "temporary")
        account.available = false
      throw error
    }
    if (
      generation !== this.generation ||
      this.accounts.get(id) !== account ||
      signal.aborted
    )
      throw new DOMException("Cancelled", "AbortError")
    return messages.map((message) => ({ ...message, account: account.email }))
  }

  async remove(id: string): Promise<boolean> {
    const account = this.accounts.get(id)
    if (!account) return true
    this.accounts.delete(id)
    account.available = false
    const token = account.refreshToken ?? account.token
    account.token = ""
    account.refreshToken = undefined
    return this.revoke(token)
  }

  async clear(): Promise<boolean> {
    this.generation++
    this.pending.clear()
    return (
      await Promise.all([...this.accounts.keys()].map((id) => this.remove(id)))
    ).every(Boolean)
  }
}
