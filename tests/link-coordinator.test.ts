import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LinkCoordinator } from "../src/background/link-coordinator"
import type { FlowStatus, VerificationLinkContext } from "../src/core/types"

const originUrl = "https://login.example.com/verify"
const states: FlowStatus[] = []
const createTab = vi.fn<() => Promise<chrome.tabs.Tab>>()
const sendTabMessage =
  vi.fn<() => Promise<{ clicks: number; status: string }>>()
const context: VerificationLinkContext = {
  id: "5c5a1b76-dbd9-44be-b621-fc3dbfe558c8",
  hostname: "login.example.com",
  startedAt: 1_800_000_000_000,
}

function tab(id: number): chrome.tabs.Tab {
  return {
    id,
    active: true,
    autoDiscardable: true,
    discarded: false,
    frozen: false,
    groupId: -1,
    highlighted: true,
    incognito: false,
    index: 0,
    pinned: false,
    selected: true,
    windowId: 1,
    status: "complete",
    url: originUrl,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(context.startedAt + 1000)
  states.splice(0)
  createTab.mockReset().mockResolvedValue(tab(2))
  sendTabMessage
    .mockReset()
    .mockResolvedValue({ clicks: 0, status: "completed" })
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({
          settings: { connected: true, autofill: true },
        })),
      },
      session: {
        set: vi.fn(async (values: Record<string, FlowStatus>) => {
          states.push(...Object.values(values))
        }),
        remove: vi.fn(async () => undefined),
      },
    },
    permissions: { contains: vi.fn(async () => true) },
    tabs: {
      get: vi.fn(async (id: number) => tab(id)),
      create: createTab,
      sendMessage: sendTabMessage,
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function waitingForApproval(): Promise<LinkCoordinator> {
  const coordinator = new LinkCoordinator({
    discover: async () => [
      {
        id: "message1",
        sender: "verify@example.com",
        subject: "Verify your email",
        text: "Verify your email at https://login.example.com/verify?token=fixture",
        receivedAt: context.startedAt,
      },
    ],
  })
  expect(await coordinator.poll(1, "doc1", originUrl, context)).toMatchObject({
    state: "confirmation_required",
  })
  return coordinator
}

describe("verification-link cancellation and delivery", () => {
  it("does not start automation when cancelled while opening its approved tab", async () => {
    const coordinator = await waitingForApproval()
    let created: ((value: chrome.tabs.Tab) => void) | undefined
    createTab.mockReturnValueOnce(
      new Promise<chrome.tabs.Tab>((resolve) => {
        created = resolve
      }),
    )
    const decision = coordinator.decide(1, "doc1", context.id, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(chrome.tabs.create).toHaveBeenCalledOnce()
    await coordinator.stopAll()
    if (!created) throw new Error("Expected pending tab creation")
    created(tab(2))
    expect(await decision).toMatchObject({ ok: false })
    await vi.advanceTimersByTimeAsync(1000)
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(coordinator.recordAction(2, context.id)).toBe(false)
    expect(states.at(-1)?.state).toBe("cancelled")
  })

  it("serializes approval so repeated decisions open only one tab", async () => {
    const coordinator = await waitingForApproval()
    const first = coordinator.decide(1, "doc1", context.id, true)
    expect(await coordinator.decide(1, "doc1", context.id, true)).toMatchObject(
      {
        ok: false,
      },
    )
    expect(await first).toEqual({ ok: true })
    expect(chrome.tabs.create).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(750)
    expect(states.at(-1)?.state).toBe("completed")
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2)
  })

  it("does not restore completion after cancellation during an in-flight action", async () => {
    const coordinator = await waitingForApproval()
    let complete:
      ((value: { clicks: number; status: string }) => void) | undefined
    sendTabMessage.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    expect(await coordinator.decide(1, "doc1", context.id, true)).toEqual({
      ok: true,
    })
    await vi.advanceTimersByTimeAsync(750)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledOnce()
    await coordinator.stopAll()
    if (!complete) throw new Error("Expected pending verification action")
    complete({ clicks: 0, status: "completed" })
    await vi.advanceTimersByTimeAsync(0)
    expect(states.at(-1)?.state).toBe("cancelled")
    expect(chrome.tabs.sendMessage).toHaveBeenCalledOnce()
    expect(coordinator.recordAction(2, context.id)).toBe(false)
  })
})
