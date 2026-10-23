import { beforeEach, describe, expect, it, vi } from "vitest"

import { GmailClient, getToken } from "../src/background/gmail"
import { GMAIL_SCOPE } from "../src/core/types"
import { gmailMessage } from "./fixtures/emails"

const removeToken = vi.fn()
beforeEach(() => {
  vi.stubGlobal("chrome", {
    identity: {
      removeCachedAuthToken: removeToken,
      getAuthToken: vi.fn(async () => ({
        token: "test-token",
        grantedScopes: [GMAIL_SCOPE],
      })),
    },
    runtime: {
      getManifest: () => ({
        oauth2: { client_id: "test.apps.googleusercontent.com" },
      }),
    },
  })
})

function reply(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

describe("Gmail integration", () => {
  it("requests only Gmail read-only scope", async () => {
    await expect(getToken(false)).resolves.toBe("test-token")
    expect(chrome.identity.getAuthToken).toHaveBeenCalledWith({
      interactive: false,
      enableGranularPermissions: true,
      scopes: [GMAIL_SCOPE],
    })
  })
  it("discovers bounded messages and does not download the same body twice", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ messages: [{ id: "message1" }] }))
      .mockResolvedValueOnce(reply(gmailMessage("Verification code: 482193")))
      .mockResolvedValueOnce(reply({ messages: [{ id: "message1" }] }))
    const client = new GmailClient(async () => "test-token", request)
    const seen = new Set<string>()
    const first = await client.discover(
      1_800_000_000_000,
      seen,
      new AbortController().signal,
    )
    expect(first[0]?.text).toContain("482193")
    expect(
      await client.discover(
        1_800_000_000_000,
        seen,
        new AbortController().signal,
      ),
    ).toEqual([])
    expect(request).toHaveBeenCalledTimes(3)
    expect(String(request.mock.calls[0]?.[0])).toContain("maxResults=10")
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer test-token",
    })
  })
  it("refreshes an invalid token once and then reports revoked authorization", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(reply({}, 401))
    const client = new GmailClient(async () => "expired", request)
    await expect(
      client.discover(Date.now(), new Set(), new AbortController().signal),
    ).rejects.toMatchObject({ kind: "authorization" })
    expect(request).toHaveBeenCalledTimes(2)
    expect(removeToken).toHaveBeenCalledWith({ token: "expired" })
  })

  it("keeps every body eligible for retry if a later batch fails", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({
          messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }],
        }),
      )
      .mockResolvedValueOnce(
        reply(gmailMessage("Verification code: 482193", { id: "m1" })),
      )
      .mockResolvedValueOnce(
        reply(gmailMessage("Verification code: 987654", { id: "m2" })),
      )
      .mockResolvedValueOnce(
        reply(gmailMessage("Verification code: 123456", { id: "m3" })),
      )
      .mockResolvedValueOnce(reply({}, 503))
    const seen = new Set<string>()
    const client = new GmailClient(async () => "test", request)
    await expect(
      client.discover(Date.now(), seen, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "temporary" })
    expect(seen.size).toBe(0)
  })
  it("honors bounded retry-after for rate limits", async () => {
    const client = new GmailClient(
      async () => "test",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(reply({}, 429, { "Retry-After": "30" })),
    )
    await expect(
      client.discover(Date.now(), new Set(), new AbortController().signal),
    ).rejects.toMatchObject({ kind: "temporary", retryAfter: 30_000 })
  })
  it("distinguishes permission denial from transient quota failure", async () => {
    const forbidden = new GmailClient(
      async () => "test",
      vi.fn<typeof fetch>().mockResolvedValue(reply({}, 403)),
    )
    await expect(
      forbidden.verifyConnection(new AbortController().signal),
    ).rejects.toMatchObject({ kind: "permission" })
    const quota = new GmailClient(
      async () => "test",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          reply(
            { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
            403,
          ),
        ),
    )
    await expect(
      quota.verifyConnection(new AbortController().signal),
    ).rejects.toMatchObject({ kind: "temporary" })
  })
  it("abstains when discovery exceeds the request budget", async () => {
    const client = new GmailClient(
      async () => "test",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          reply({ messages: [{ id: "message1" }], nextPageToken: "more" }),
        ),
    )
    await expect(
      client.discover(Date.now(), new Set(), new AbortController().signal),
    ).rejects.toMatchObject({ kind: "temporary" })
  })
  it("reads the newest page and reports a cut-short search when asked", async () => {
    const client = new GmailClient(
      async () => "test",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          reply({ messages: [{ id: "message1" }], nextPageToken: "more" }),
        )
        .mockResolvedValue(reply({ id: "message1", internalDate: "1" })),
    )
    const truncated = vi.fn()
    await expect(
      client.discover(
        Date.now(),
        new Set(),
        new AbortController().signal,
        truncated,
      ),
    ).resolves.toBeInstanceOf(Array)
    expect(truncated).toHaveBeenCalledOnce()
  })
  it("aborts stale work without returning messages", async () => {
    const controller = new AbortController()
    controller.abort()
    const request = vi.fn<typeof fetch>()
    const client = new GmailClient(async () => "test", request)
    await expect(
      client.discover(Date.now(), new Set(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(request).not.toHaveBeenCalled()
  })
})
