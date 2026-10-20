import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Coordinator } from "../src/background/coordinator"
import { GmailClient } from "../src/background/gmail"
import { hasExpired, pollDelay } from "../src/core/lifecycle"
import type { VerificationContext } from "../src/core/types"
import { gmailMessage } from "./fixtures/emails"

const context: VerificationContext = {
  id: "5c5a1b76-dbd9-44be-b621-fc3dbfe558c8",
  hostname: "login.example.com",
  startedAt: 1_800_000_000_000,
  constraints: { length: 6, numeric: true, pattern: "[0-9]{6}" },
}
const store = new Map<string, unknown>()
const tabUrl = "https://login.example.com/verify"
let tabActive = true
let settings: Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(context.startedAt + 10_000)
  store.clear()
  tabActive = true
  settings = { connected: true, autofill: true }
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({ settings })),
        set: vi.fn(),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values))
            store.set(key, value)
        }),
        remove: vi.fn(async (key: string) => {
          store.delete(key)
        }),
      },
    },
    tabs: {
      get: vi.fn(async () => ({ active: tabActive, url: tabUrl })),
      sendMessage: vi.fn(async () => ({ filled: true })),
    },
    permissions: { contains: vi.fn(async () => true) },
    identity: { removeCachedAuthToken: vi.fn() },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function clientFor(bodies: unknown[]) {
  const request = vi.fn<typeof fetch>()
  for (const body of bodies)
    request.mockResolvedValueOnce(new Response(JSON.stringify(body)))
  return { client: new GmailClient(async () => "fixture", request), request }
}

describe("verification attempt orchestration", () => {
  it("connects discovery, parsing, matching, and a single fill, without persisting codes", async () => {
    const { client, request } = clientFor([
      { messages: [{ id: "message1" }] },
      gmailMessage("Verification code: 482193"),
    ])
    const coordinator = new Coordinator(client)
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toMatchObject({
      state: "identified",
      code: "482193",
    })
    await coordinator.event(1, "doc1", context.id, "filled")
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
      state: "filled",
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.stringify([...store.values()])).not.toContain("482193")
    expect(store.get("flow:1")).toMatchObject({
      state: "filled",
      candidates: [],
    })
    await coordinator.event(1, "doc1", context.id, "completed")
    expect(store.get("flow:1")).toMatchObject({ state: "completed" })
  })
  it("rejects inactive tabs, wrong origins, and expired flows without reading email", async () => {
    const { client, request } = clientFor([])
    const coordinator = new Coordinator(client)
    expect(
      await coordinator.poll(1, "doc1", tabUrl, {
        ...context,
        hostname: "evil.test",
      }),
    ).toEqual({ state: "permission_required" })
    tabActive = false
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
      state: "permission_required",
    })
    expect(request).not.toHaveBeenCalled()
  })
  it("times out and clears sensitive data", async () => {
    const { client, request } = clientFor([{ messages: [] }])
    const coordinator = new Coordinator(client)
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
      state: "waiting",
    })
    await vi.advanceTimersByTimeAsync(110_001)
    expect(store.get("flow:1")).toMatchObject({
      state: "timed_out",
      candidates: [],
    })
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
      state: "timed_out",
    })
    expect(request).toHaveBeenCalledOnce()
  })
  it("does not continue filling after cancellation during a Gmail request", async () => {
    let deliver: ((response: Response) => void) | undefined
    const request = vi.fn<typeof fetch>().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve
        }),
    )
    const coordinator = new Coordinator(
      new GmailClient(async () => "test", request),
    )
    const pending = coordinator.poll(1, "doc1", tabUrl, context)
    await vi.advanceTimersByTimeAsync(0)
    await coordinator.stop(1)
    if (!deliver) throw new Error("Expected pending Gmail request")
    deliver(new Response(JSON.stringify({ messages: [] })))
    expect(await pending).toEqual({ state: "cancelled" })
    expect(store.get("flow:1")).toMatchObject({ state: "cancelled" })
  })
  it("exposes only metadata for ambiguous codes, and revalidates manual selection", async () => {
    const { client } = clientFor([
      { messages: [{ id: "message1" }, { id: "message2" }] },
      gmailMessage("Verification code: 482193"),
      gmailMessage("Verification code: 987654", { id: "message2" }),
    ])
    const coordinator = new Coordinator(client)
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
      state: "ambiguous",
    })
    expect(JSON.stringify([...store.values()])).not.toMatch(/482193|987654/)
    expect(await coordinator.choose(1, "wrong-flow", "message1:0")).toBe(false)
    expect(await coordinator.choose(1, context.id, "message1:0")).toBe(true)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      { type: "FILL", id: context.id, code: "482193" },
      { documentId: "doc1" },
    )
    expect(store.get("flow:1")).toMatchObject({ state: "filled" })
  })
  it("uses bounded retry delays and expiry", () => {
    expect(hasExpired(context.startedAt, context.startedAt + 120_000)).toBe(
      true,
    )
    expect(hasExpired(context.startedAt, context.startedAt + 10_000)).toBe(
      false,
    )
    expect(pollDelay(100, true)).toBe(20_000)
  })
})

describe("overlapping and repeated attempts", () => {
  const secondContext = {
    ...context,
    id: "6c5a1b76-dbd9-44be-b621-fc3dbfe558c8",
  }
  it("registers inactive forms without reading Gmail and asks before unbound overlapping logins", async () => {
    const { client, request } = clientFor([
      { messages: [{ id: "message1" }] },
      gmailMessage("Verification code: 482193"),
    ])
    const coordinator = new Coordinator(client)
    tabActive = false
    await coordinator.register(2, "doc2", tabUrl, secondContext)
    expect(request).not.toHaveBeenCalled()
    tabActive = true
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
      state: "ambiguous",
    })
    expect(store.get("flow:1")).toMatchObject({
      candidates: [
        { reason: "Overlapping login attempts: choose the intended email" },
      ],
    })
  })
  it("separates overlapping attempts when the email carries the exact request reference", async () => {
    const { client } = clientFor([
      { messages: [{ id: "message1" }] },
      gmailMessage("Verification code: 482193. Request ID: login_one"),
    ])
    const coordinator = new Coordinator(client)
    await coordinator.register(2, "doc2", tabUrl, {
      ...secondContext,
      requestId: "login_two",
    })
    expect(
      await coordinator.poll(1, "doc1", tabUrl, {
        ...context,
        requestId: "login_one",
      }),
    ).toMatchObject({ state: "identified", code: "482193" })
  })
  it("does not replay a filled code from a delayed duplicate email after resend", async () => {
    const { client } = clientFor([
      { messages: [{ id: "message1" }] },
      gmailMessage("Verification code: 482193"),
      { messages: [{ id: "duplicate" }] },
      gmailMessage("Verification code: 482193", {
        id: "duplicate",
        internalDate: String(context.startedAt + 20_000),
      }),
    ])
    const coordinator = new Coordinator(client)
    await coordinator.poll(1, "doc1", tabUrl, context)
    await coordinator.event(1, "doc1", context.id, "filled")
    await vi.advanceTimersByTimeAsync(10_000)
    expect(
      await coordinator.poll(1, "doc1", tabUrl, {
        ...secondContext,
        startedAt: Date.now(),
        strictAfter: true,
      }),
    ).toEqual({ state: "waiting" })
    expect(JSON.stringify([...store.values()])).not.toContain("482193")
  })
  it("does not let a late registration replace a newer request", async () => {
    const { client, request } = clientFor([])
    const coordinator = new Coordinator(client)
    await coordinator.register(1, "doc1", tabUrl, {
      ...secondContext,
      startedAt: context.startedAt + 5000,
    })
    expect(await coordinator.register(1, "doc1", tabUrl, context)).toEqual({
      state: "cancelled",
    })
    expect(store.get("flow:1")).toMatchObject({ id: secondContext.id })
    expect(request).not.toHaveBeenCalled()
  })
  it("requires a manual choice if another authorized inbox could not be searched", async () => {
    const source = {
      discover: vi.fn(async () => ({
        messages: [
          {
            id: "message1",
            sender: "verify@example.com",
            subject: "Verification",
            text: "Verification code: 482193",
            receivedAt: Date.now(),
            account: "alice@gmail.com",
          },
        ],
        warnings: ["Another inbox is unavailable"],
      })),
    }
    const coordinator = new Coordinator(source)
    expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
      state: "ambiguous",
    })
    expect(store.get("flow:1")).toMatchObject({
      candidates: [
        {
          account: "alice@gmail.com",
          reason: "An inbox could not be searched: confirm a known email",
        },
      ],
    })
  })
})

it("retains consumed message IDs across a worker restart without storing the code", async () => {
  const { client } = clientFor([
    { messages: [{ id: "message1" }] },
    gmailMessage("Verification code: 482193"),
    { messages: [{ id: "message1" }] },
    gmailMessage("Verification code: 482193"),
  ])
  const first = new Coordinator(client)
  await first.poll(1, "doc1", tabUrl, context)
  await first.event(1, "doc1", context.id, "filled")
  const restarted = new Coordinator(client)
  expect(
    await restarted.poll(1, "doc1", tabUrl, {
      ...context,
      id: "6c5a1b76-dbd9-44be-b621-fc3dbfe558c8",
    }),
  ).toEqual({ state: "waiting" })
  expect(JSON.stringify([...store.values()])).not.toContain("482193")
})

it("shows a third-party forwarded candidate without needing a sender mapping", async () => {
  const source = {
    discover: vi.fn(async () => [
      {
        id: "message1",
        sender: "verify@provider.test",
        subject: "Fwd: Verification",
        text: "Verification code: 482193. Continue at https://login.example.com",
        receivedAt: Date.now(),
        forwarded: true,
      },
    ]),
  }
  const coordinator = new Coordinator(source)
  expect(await coordinator.poll(1, "doc1", tabUrl, context)).toEqual({
    state: "ambiguous",
  })
  expect(store.get("flow:1")).toMatchObject({
    candidates: [
      {
        sender: "provider.test",
        reason: "Forwarded message: confirm the code is current",
      },
    ],
  })
})

it("rechecks the Enter policy after filling and rejects disabled, inactive or stale requests", async () => {
  const { client } = clientFor([
    { messages: [{ id: "message1" }] },
    gmailMessage("Verification code: 482193"),
  ])
  const coordinator = new Coordinator(client)
  await coordinator.poll(1, "doc1", tabUrl, context)
  await coordinator.event(1, "doc1", context.id, "filled")
  expect(await coordinator.afterFillPolicy(1, "doc1", context.id)).toEqual({
    pressEnter: true,
    enterDelayMs: 150,
  })
  expect(
    await coordinator.afterFillPolicy(1, "wrong-document", context.id),
  ).toMatchObject({ pressEnter: false })
  settings = { ...settings, pressEnter: false }
  expect(
    await coordinator.afterFillPolicy(1, "doc1", context.id),
  ).toMatchObject({ pressEnter: false })
  settings = { ...settings, pressEnter: true, enterDelayMs: 500 }
  tabActive = false
  expect(
    await coordinator.afterFillPolicy(1, "doc1", context.id),
  ).toMatchObject({ pressEnter: false })
  tabActive = true
  expect(await coordinator.afterFillPolicy(1, "doc1", context.id)).toEqual({
    pressEnter: true,
    enterDelayMs: 500,
  })
  await coordinator.stop(1)
  expect(
    await coordinator.afterFillPolicy(1, "doc1", context.id),
  ).toMatchObject({ pressEnter: false })
})
