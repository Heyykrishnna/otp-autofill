import { createHash } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountVault } from "../src/companion/oauth"
import { startCompanion } from "../src/companion/server"
import { GMAIL_SCOPE } from "../src/core/types"
import { gmailMessage } from "./fixtures/emails"

const extensionId = "a".repeat(32)
const origin = `chrome-extension://${extensionId}`
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status })
afterEach(() => vi.restoreAllMocks())

function google() {
  let nextAccount = 0
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url === "https://oauth2.googleapis.com/token") {
      const parameters = new URLSearchParams(String(init?.body))
      const id =
        parameters.get("grant_type") === "refresh_token"
          ? parameters.get("refresh_token")?.replace("refresh", "")
          : String(++nextAccount)
      return json({
        access_token: `token${id}`,
        refresh_token: `refresh${id}`,
        expires_in: 3600,
        scope: GMAIL_SCOPE,
        token_type: "Bearer",
      })
    }
    if (url.endsWith("revoke")) return json({})
    if (url.includes("profile")) {
      const authorization = new Headers(init?.headers).get("Authorization")
      return json({
        emailAddress:
          authorization === "Bearer token1"
            ? "alice@gmail.com"
            : "bob@gmail.com",
      })
    }
    if (url.includes("/messages?"))
      return json({ messages: [{ id: "message1" }] })
    if (url.includes("/messages/message1"))
      return json(
        gmailMessage("Verification code: 482193", {
          internalDate: String(Date.now()),
        }),
      )
    throw new Error("Unexpected provider request")
  })
  return request
}

describe("local OAuth account vault", () => {
  it("uses PKCE, one-time state and a verified profile before retaining an account", async () => {
    const request = google()
    const vault = new AccountVault(
      "desktop.apps.googleusercontent.com",
      "",
      request,
    )
    const authorization = vault.begin("http://127.0.0.1:12345/oauth/callback")
    const url = new URL(authorization.url)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPE)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    await expect(
      vault.complete("wrong_state", "fixture-code"),
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    await vault.complete(authorization.state, "fixture-code")
    const parameters = new URLSearchParams(
      String(request.mock.calls[0]?.[1]?.body),
    )
    const verifier = parameters.get("code_verifier") ?? ""
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      url.searchParams.get("code_challenge"),
    )
    expect(vault.list()).toMatchObject([
      { email: "alice@gmail.com", available: true },
    ])
    expect(JSON.stringify(vault.list())).not.toMatch(/token1|refresh1/)
    await expect(
      vault.complete(authorization.state, "replay"),
    ).rejects.toThrow()
    await vault.clear()
  })
  it("keeps two authorized inboxes separate and addresses Gmail by the verified account", async () => {
    const request = google()
    const vault = new AccountVault(
      "desktop.apps.googleusercontent.com",
      "",
      request,
    )
    for (let index = 0; index < 2; index++) {
      const authorization = vault.begin("http://127.0.0.1:12345/oauth/callback")
      await vault.complete(authorization.state, `code${index}`)
    }
    const accounts = vault.list()
    expect(accounts.map((account) => account.email)).toEqual([
      "alice@gmail.com",
      "bob@gmail.com",
    ])
    const account = accounts[1]
    if (!account) throw new Error("Expected second inbox")
    const messages = await vault.discover(
      account.id,
      Date.now() - 1000,
      new Set(),
      new AbortController().signal,
    )
    expect(messages[0]?.account).toBe("bob@gmail.com")
    expect(
      request.mock.calls.some(([url]) =>
        String(url).includes("users/bob%40gmail.com/messages"),
      ),
    ).toBe(true)
    await vault.remove(account.id)
    expect(vault.list()).toHaveLength(1)
    await expect(
      vault.discover(
        account.id,
        Date.now(),
        new Set(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "authorization" })
    await vault.clear()
  })
})

describe("loopback companion protocol", () => {
  it("rejects webpages, unpaired callers and incorrect OAuth state, and exposes no tokens", async () => {
    const request = google()
    const service = await startCompanion({
      clientId: "desktop.apps.googleusercontent.com",
      extensionId,
      port: 0,
      request,
    })
    const base = `http://127.0.0.1:${service.port}`
    const call = async (
      path: string,
      value: unknown,
      session?: string,
      caller = origin,
    ) =>
      fetch(`${base}/${path}`, {
        method: "POST",
        headers: {
          Origin: caller,
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session}` } : {}),
        },
        body: JSON.stringify(value),
      })
    try {
      expect(
        (await call("pair", {}, undefined, "https://evil.test")).status,
      ).toBe(403)
      expect((await call("rpc", { operation: "accounts" })).status).toBe(401)
      const pairing = (await (await call("pair", {})).json()) as {
        session: string
      }
      const authorization = (await (
        await call("rpc", { operation: "authorize" }, pairing.session)
      ).json()) as { url: string }
      const url = new URL(authorization.url)
      const callback = new URL(url.searchParams.get("redirect_uri") ?? "")
      const bad = new URL(callback)
      bad.search = new URLSearchParams({
        state: "wrong",
        code: "fixture",
      }).toString()
      expect((await fetch(bad)).status).toBe(400)
      expect(request).not.toHaveBeenCalled()
      callback.search = new URLSearchParams({
        state: url.searchParams.get("state") ?? "",
        code: "fixture",
      }).toString()
      const completed = await fetch(callback)
      expect(await completed.text()).toContain("Account connected")
      const accounts = await (
        await call("rpc", { operation: "accounts" }, pairing.session)
      ).text()
      expect(accounts).toContain("alice@gmail.com")
      expect(accounts).not.toMatch(/token1|refresh1|access_token/)
      expect(
        (
          await call(
            "rpc",
            {
              operation: "discover",
              id: "missing",
              startedAt: Date.now() - 180_000,
              seen: [],
            },
            pairing.session,
          )
        ).status,
      ).toBe(400)
    } finally {
      await service.close()
    }
  })
})

it("rejects missing scope and an expired state without retaining an inbox", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    json({ access_token: "fixture-token", expires_in: 3600, scope: "email" }),
  )
  const vault = new AccountVault(
    "desktop.apps.googleusercontent.com",
    "",
    request,
  )
  const first = vault.begin("http://127.0.0.1:12345/oauth/callback")
  await expect(vault.complete(first.state, "fixture")).rejects.toMatchObject({
    kind: "permission",
  })
  expect(vault.list()).toEqual([])
  const second = vault.begin("http://127.0.0.1:12345/oauth/callback")
  const now = Date.now()
  vi.spyOn(Date, "now").mockReturnValue(now + 180_001)
  await expect(vault.complete(second.state, "fixture")).rejects.toThrow(
    /expired/,
  )
  expect(request).toHaveBeenCalledTimes(2)
})

it("refreshes an expiring account once across concurrent reads and keeps tokens out of listings", async () => {
  const request = google()
  const vault = new AccountVault(
    "desktop.apps.googleusercontent.com",
    "",
    request,
  )
  const authorization = vault.begin("http://127.0.0.1:12345/oauth/callback")
  await vault.complete(authorization.state, "fixture")
  const account = vault.list()[0]
  if (!account) throw new Error("Expected inbox")
  const now = Date.now()
  vi.spyOn(Date, "now").mockReturnValue(now + 3_590_000)
  await Promise.all([
    vault.discover(
      account.id,
      Date.now(),
      new Set(),
      new AbortController().signal,
    ),
    vault.discover(
      account.id,
      Date.now(),
      new Set(),
      new AbortController().signal,
    ),
  ])
  const exchanges = request.mock.calls.filter(([url]) =>
    String(url).endsWith("/token"),
  )
  expect(exchanges).toHaveLength(2)
  expect(
    new URLSearchParams(String(exchanges[1]?.[1]?.body)).get("grant_type"),
  ).toBe("refresh_token")
  expect(JSON.stringify(vault.list())).not.toContain("refresh1")
  await vault.clear()
})

it("does not retain credentials when disconnect races with an authorization exchange", async () => {
  const provider = google()
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const request = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).endsWith("/token")) await gate
    return provider(input, init)
  })
  const vault = new AccountVault(
    "desktop.apps.googleusercontent.com",
    "",
    request,
  )
  const authorization = vault.begin("http://127.0.0.1:12345/oauth/callback")
  const pending = vault.complete(authorization.state, "fixture-code")
  await vault.clear()
  if (!release) throw new Error("Expected authorization gate")
  release()
  await expect(pending).rejects.toThrow("cancelled")
  expect(vault.list()).toEqual([])
  expect(
    provider.mock.calls.some(([url]) => String(url).endsWith("/revoke")),
  ).toBe(true)
})
