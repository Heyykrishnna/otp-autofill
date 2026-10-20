import { beforeEach, describe, expect, it, vi } from "vitest"

import { activateSite, syncSiteScripts } from "../src/background/permissions"

const send = vi.fn()
const execute = vi.fn()
const register = vi.fn()

beforeEach(() => {
  vi.stubGlobal("chrome", {
    tabs: { sendMessage: send },
    scripting: {
      executeScript: execute,
      getRegisteredContentScripts: vi.fn(async () => []),
      registerContentScripts: register,
    },
    permissions: {
      getAll: vi.fn(async () => ({
        origins: [
          "https://gmail.googleapis.com/*",
          "https://oauth2.googleapis.com/*",
          "https://login.example.com/*",
        ],
      })),
    },
  })
})

describe("permission-scoped detection", () => {
  it("resumes an existing controller when access is enabled again", async () => {
    send.mockResolvedValueOnce({ ok: true })
    await activateSite(1)
    expect(send).toHaveBeenCalledWith(1, { type: "RETRY" })
    expect(execute).not.toHaveBeenCalled()
  })
  it("injects the isolated script if no controller is present", async () => {
    send.mockRejectedValueOnce(new Error("No receiver"))
    await activateSite(1)
    expect(execute).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ["otp-content.js"],
      world: "ISOLATED",
    })
  })
  it("registers only granted websites and excludes Google API hosts", async () => {
    await syncSiteScripts()
    expect(register).toHaveBeenCalledWith([
      expect.objectContaining({
        matches: ["https://login.example.com/*"],
        allFrames: false,
        world: "ISOLATED",
      }),
    ])
  })
})
