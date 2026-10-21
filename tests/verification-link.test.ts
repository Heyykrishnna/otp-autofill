import { beforeEach, describe, expect, it, vi } from "vitest"

import { runVerificationActions } from "../src/content/link-automation"
import { detectVerificationLinkContext } from "../src/content/link-detector"
import { showVerificationPrompt } from "../src/content/link-prompt"
import type {
  VerificationLinkCandidate,
  VerificationLinkContext,
} from "../src/core/types"
import {
  eligibleVerificationLinks,
  matchVerificationLinks,
} from "../src/core/verification-link"

const context: VerificationLinkContext = {
  id: "5c5a1b76-dbd9-44be-b621-fc3dbfe558c8",
  hostname: "login.example.com",
  startedAt: 1_800_000_000_000,
  recipient: "alice@example.com",
}
const candidate: VerificationLinkCandidate = {
  id: "message1:link:0",
  messageId: "message1",
  url: "https://login.example.com/verify?token=secret",
  sender: "Example <verify@accounts.example.com>",
  subject: "Verify your email",
  receivedAt: context.startedAt + 5_000,
  recipients: ["alice@example.com"],
}

beforeEach(() => {
  document.body.innerHTML = ""
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
    item: () => null,
    [Symbol.iterator]: () => [new DOMRect(0, 0, 100, 30)].values(),
  })
})

describe("verification link matching", () => {
  it("selects one fresh site-matched link", () => {
    expect(
      matchVerificationLinks([candidate], context, context.startedAt + 10_000),
    ).toMatchObject({ kind: "unique", candidate })
  })

  it.each<Partial<VerificationLinkCandidate>>([
    { url: "https://example.com.evil.test/verify" },
    { sender: "verify@evil.test" },
    { recipients: ["mallory@example.com"] },
    { receivedAt: context.startedAt - 16_000 },
    { senderAuthentication: "fail" },
  ])("rejects unrelated or stale evidence: %j", (override) => {
    expect(
      eligibleVerificationLinks(
        [{ ...candidate, ...override }],
        context,
        context.startedAt + 10_000,
      ),
    ).toEqual([])
  })

  it("requires manual handling for distinct matching links", () => {
    expect(
      matchVerificationLinks(
        [candidate, { ...candidate, id: "second", url: `${candidate.url}2` }],
        context,
        context.startedAt + 10_000,
      ).kind,
    ).toBe("ambiguous")
  })
})

describe("verification request detection", () => {
  it("detects a check-inbox state and its recipient", () => {
    document.body.innerHTML =
      '<main><p>Check your inbox to verify your email using the verification link.</p><input type="email" value="alice@example.com"></main>'
    expect(detectVerificationLinkContext(context.startedAt)).toMatchObject({
      hostname: "localhost",
      recipient: "alice@example.com",
      startedAt: context.startedAt,
    })
  })

  it("does not compete with an OTP field or restart after completion", () => {
    document.body.innerHTML =
      '<p>Check your inbox to verify your email.</p><input autocomplete="one-time-code" maxlength="6">'
    expect(detectVerificationLinkContext()).toBeNull()
    document.body.innerHTML = "<p>Your email has been verified.</p>"
    expect(detectVerificationLinkContext()).toBeNull()
  })

  it("does not combine unrelated text across page controls", () => {
    document.body.innerHTML =
      "<select><option>Email verification link</option></select><h2>Verify your email</h2><p>Enter your details manually.</p>"
    expect(detectVerificationLinkContext()).toBeNull()
  })
})

describe("bounded verification actions", () => {
  it("clicks one allow-listed action and stops at explicit completion", async () => {
    document.body.innerHTML =
      "<p>Complete email verification</p><button>Verify email</button>"
    document.querySelector("button")?.addEventListener("click", () => {
      document.body.innerHTML = "<p>Your email has been verified.</p>"
    })
    await expect(runVerificationActions(6)).resolves.toEqual({
      status: "completed",
      clicks: 1,
    })
  })

  it("abstains from ambiguous and destructive actions", async () => {
    document.body.innerHTML =
      "<p>Complete verification</p><button>Verify email</button><button>Confirm email</button>"
    await expect(runVerificationActions(6)).resolves.toMatchObject({
      status: "blocked",
      clicks: 0,
    })
    document.body.innerHTML =
      "<p>Complete verification</p><button>Delete account</button>"
    await expect(runVerificationActions(6)).resolves.toMatchObject({
      status: "blocked",
      clicks: 0,
    })
  })

  it("requires incomplete controls and sensitive actions to remain manual", async () => {
    document.body.innerHTML =
      '<p>Complete verification</p><form><label><input type="checkbox" required>Accept terms</label><button>Verify email</button></form>'
    await expect(runVerificationActions(6)).resolves.toMatchObject({
      status: "blocked",
      clicks: 0,
    })
    document.body.innerHTML =
      "<p>Verify your email to delete account</p><button>Verify email</button>"
    await expect(runVerificationActions(6)).resolves.toMatchObject({
      status: "blocked",
      clicks: 0,
    })
  })

  it("does not repeat an unchanged action", async () => {
    document.body.innerHTML =
      "<p>Complete verification</p><button>Verify email</button>"
    await expect(runVerificationActions(6)).resolves.toMatchObject({
      status: "blocked",
      clicks: 1,
    })
  })

  it("does not accept hidden success text as the completion base case", async () => {
    document.body.innerHTML =
      "<p hidden>Your email has been verified.</p><p>Verification pending.</p>"
    await expect(runVerificationActions(1)).resolves.toMatchObject({
      status: "blocked",
      clicks: 0,
    })
  })
})

it("isolates prompt details from page scripts", () => {
  void showVerificationPrompt({
    hostname: "login.example.com",
    sender: "<img src=x onerror=alert(1)>",
  })
  const host = document.getElementById("otp-autofill-link-prompt")
  expect(host).not.toBeNull()
  expect(host?.shadowRoot).toBeNull()
  expect(host?.querySelector("img")).toBeNull()
  host?.remove()
})
