import { beforeEach, describe, expect, it, vi } from "vitest"

import { isExtensionUi } from "../src/background/messages"

beforeEach(() => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "trusted-id",
      getURL: (file: string) => `chrome-extension://trusted-id/${file}`,
    },
  })
})

describe("trusted UI routing", () => {
  it("accepts only the exact popup and options pages, including full-tab settings", () => {
    expect(
      isExtensionUi({
        id: "trusted-id",
        url: "chrome-extension://trusted-id/popup.html",
      }),
    ).toBe(true)
    expect(
      isExtensionUi({
        id: "trusted-id",
        url: "chrome-extension://trusted-id/options.html",
      }),
    ).toBe(true)
  })
  it.each([
    { id: "trusted-id", url: "https://login.example.com/" },
    { id: "different-id", url: "chrome-extension://trusted-id/popup.html" },
    { id: "trusted-id", url: "chrome-extension://trusted-id/popup.html/evil" },
    { id: "trusted-id", url: "chrome-extension://other-id/popup.html" },
    { id: "trusted-id" },
  ])("denies privileged UI routing to untrusted senders: %j", (sender) => {
    expect(isExtensionUi(sender)).toBe(false)
  })
})
