import { describe, expect, it } from "vitest"

import { extractCandidates, parseGmailMessage } from "../src/core/email-parser"
import { matchCandidates } from "../src/core/matcher"
import type { VerificationContext } from "../src/core/types"
import { email, gmailMessage } from "./fixtures/emails"

const context: VerificationContext = {
  id: "5c5a1b76-dbd9-44be-b621-fc3dbfe558c8",
  hostname: "login.example.com",
  startedAt: 1_800_000_000_000,
  constraints: { length: 6, numeric: true, pattern: "[0-9]{6}" },
}
const now = context.startedAt + 10_000

describe("verification email edge cases", () => {
  it("ignores quoted historical codes when a new message contains a current code", () => {
    const codes = extractCandidates(
      email(
        "Verification code: 482193\nOn Tuesday, Sender wrote:\n> Verification code: 999999",
      ),
    )
    expect(codes.map((candidate) => candidate.code)).toEqual(["482193"])
  })
  it("does not mistake a forwarded email's arrival for proof that its code is current", () => {
    const parsed = parseGmailMessage(
      gmailMessage("Forwarded message\nVerification code: 482193", {
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "verify@example.com" },
            { name: "Subject", value: "Fwd: Your verification code" },
          ],
          body: {
            data: Buffer.from("Verification code: 482193").toString(
              "base64url",
            ),
          },
        },
      }),
    )
    if (!parsed) throw new Error("Expected message")
    expect(matchCandidates(extractCandidates(parsed), context, now).kind).toBe(
      "ambiguous",
    )
  })
  it("rejects a code whose explicit lifetime has passed", () => {
    const candidates = extractCandidates(
      email("Verification code: 482193. Expires in 2 seconds."),
    )
    expect(matchCandidates(candidates, context, now).kind).toBe("none")
  })
  it("preserves a real code after an email address while rejecting IDs and phone numbers", () => {
    const codes = extractCandidates(
      email(
        "For person@example.com. Your verification code: 482193. Request ID: 777777. Phone: 5551234567.",
      ),
    )
    expect(codes.map((candidate) => candidate.code)).toEqual(["482193"])
  })
  it("rejects messages from before an explicit resend, without clock-overlap reuse", () => {
    expect(
      matchCandidates(
        extractCandidates(
          email("Verification code: 482193", {
            receivedAt: context.startedAt - 1,
          }),
        ),
        { ...context, strictAfter: true },
        now,
      ).kind,
    ).toBe("none")
  })
})

describe("sender, account and session association", () => {
  const thirdParty = extractCandidates(
    email(
      "Verification code: 482193. Visit https://login.example.com to continue.",
      { sender: "verify@provider.test" },
    ),
  )
  it("asks for confirmation for an unrecognized third-party sender with explicit site evidence", () => {
    expect(matchCandidates(thirdParty, context, now).kind).toBe("ambiguous")
  })
  it("automatically associates authenticated third-party mail addressed to the verified inbox", () => {
    expect(
      matchCandidates(
        thirdParty.map((candidate) => ({
          ...candidate,
          senderAuthentication: "pass",
          account: "alice@gmail.com",
          recipients: ["alice@gmail.com"],
        })),
        context,
        now,
      ).kind,
    ).toBe("unique")
  })
  it("does not trust a website hidden inside an unrelated redirect URL", () => {
    const candidates = extractCandidates(
      email(
        "Verification code: 482193. https://evil.test/redirect?to=https://login.example.com",
        { sender: "verify@provider.test" },
      ),
    )
    expect(matchCandidates(candidates, context, now).kind).toBe("none")
  })
  it("does not infer a website from an authenticated generic delivery provider alone", () => {
    const candidates = extractCandidates(
      email("Verification code: 482193", {
        sender: "verify@provider.test",
        senderAuthentication: "pass",
        account: "alice@gmail.com",
        recipients: ["alice@gmail.com"],
      }),
    )
    expect(matchCandidates(candidates, context, now).kind).toBe("none")
  })
  it("does not collapse equal codes from two separately authorized inboxes", () => {
    const candidates = [
      ...extractCandidates(
        email("Verification code: 482193", { account: "alice@gmail.com" }),
      ),
      ...extractCandidates(
        email("Verification code: 482193", {
          id: "second",
          account: "bob@gmail.com",
        }),
      ),
    ]
    expect(matchCandidates(candidates, context, now).kind).toBe("ambiguous")
    expect(
      matchCandidates(
        candidates,
        { ...context, recipient: "a.lice+login@gmail.com" },
        now,
      ),
    ).toMatchObject({
      kind: "unique",
      candidate: { account: "alice@gmail.com" },
    })
  })
  it("uses request references to separate simultaneous same-provider logins", () => {
    const candidates = [
      ...extractCandidates(
        email("Verification code: 482193. Request ID: login_one"),
      ),
      ...extractCandidates(
        email("Verification code: 987654. Request ID: login_two", {
          id: "second",
        }),
      ),
    ]
    expect(
      matchCandidates(candidates, { ...context, requestId: "login_one" }, now, {
        requireChoice: true,
      }),
    ).toMatchObject({ kind: "unique", candidate: { code: "482193" } })
    expect(
      matchCandidates(candidates, context, now, { requireChoice: true }).kind,
    ).toBe("ambiguous")
  })
  it("keeps explicit expiry, recipient and request checks for manual choices", () => {
    const candidates = extractCandidates(
      email("Verification code: 482193. Request ID: other_request", {
        account: "bob@gmail.com",
      }),
    )
    expect(
      matchCandidates(
        candidates,
        { ...context, recipient: "alice@gmail.com", requestId: "this_request" },
        now,
      ).kind,
    ).toBe("none")
  })
})

it("ignores unnamed attachment parts and treats forwarded body markers as manual-only", () => {
  const message = parseGmailMessage(
    gmailMessage("", {
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from(
                "----- Forwarded message -----\nVerification code: 482193",
              ).toString("base64url"),
            },
          },
          {
            mimeType: "text/plain",
            headers: [{ name: "Content-Disposition", value: "attachment" }],
            body: {
              data: Buffer.from("Verification code: 999999").toString(
                "base64url",
              ),
            },
          },
        ],
        headers: [{ name: "From", value: "verify@example.com" }],
      },
    }),
  )
  if (!message) throw new Error("Expected message")
  const candidates = extractCandidates(message)
  expect(candidates.map((candidate) => candidate.code)).toEqual(["482193"])
  expect(matchCandidates(candidates, context, now).kind).toBe("ambiguous")
})

it("does not automatically assign a third-party email that identifies two websites", () => {
  const now = Date.now()
  const candidate = {
    id: "shared:0",
    messageId: "shared",
    sender: "verify@provider.test",
    code: "482193",
    subject: "Verification",
    receivedAt: now,
    confidence: 0.98,
    audiences: ["login.example.com", "other.test"],
    verificationDomains: ["login.example.com", "other.test"],
    senderAuthentication: "pass" as const,
    account: "alice@gmail.com",
    recipients: ["alice@gmail.com"],
  }
  const context = {
    id: crypto.randomUUID(),
    hostname: "login.example.com",
    startedAt: now,
    constraints: { length: 6, numeric: true, pattern: null },
  }
  expect(matchCandidates([candidate], context, now).kind).toBe("ambiguous")
  expect(
    matchCandidates(
      [{ ...candidate, sender: "verify@example.com" }],
      { ...context, requestId: "request-123" },
      now,
    ).kind,
  ).toBe("ambiguous")
})

it("uses Google authentication evidence and real action-link domains, excluding footer and nested redirect targets", () => {
  const body =
    'Verification code: 482193. <a href="https://login.example.com/verify">Continue</a> <a href="https://provider.test/privacy">Privacy</a>'
  const parsed = parseGmailMessage(
    gmailMessage("", {
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "From", value: "verify@provider.test" },
          { name: "Subject", value: "Verification code" },
          { name: "Delivered-To", value: "alice@gmail.com" },
          {
            name: "Authentication-Results",
            value:
              "mx.google.com; dkim=pass header.i=@provider.test; dmarc=pass (p=REJECT) header.from=provider.test",
          },
        ],
        body: { data: Buffer.from(body).toString("base64url") },
      },
    }),
  )
  if (!parsed) throw new Error("Expected message")
  expect(parsed.senderAuthentication).toBe("pass")
  expect(parsed.verificationDomains).toEqual(["login.example.com"])
  expect(
    matchCandidates(
      extractCandidates({ ...parsed, account: "alice@gmail.com" }),
      context,
      now,
    ).kind,
  ).toBe("unique")
  expect(
    matchCandidates(
      extractCandidates({ ...parsed, account: "bob@gmail.com" }),
      context,
      now,
    ).kind,
  ).toBe("ambiguous")
  const redirect = extractCandidates(
    email(
      "Verification code: 482193. Continue at https://redirect.test/?to=https://login.example.com",
      {
        sender: "verify@provider.test",
        senderAuthentication: "pass",
        account: "alice@gmail.com",
        recipients: ["alice@gmail.com"],
      },
    ),
  )
  expect(matchCandidates(redirect, context, now).kind).toBe("none")
})

it.each([
  ["attacker.test; dmarc=pass header.from=provider.test", "unknown"],
  ["mx.google.com; dmarc=pass header.from=other.test", "unknown"],
  [
    "mx.google.com; dmarc=fail header.from=provider.test; dkim=pass header.i=@provider.test",
    "fail",
  ],
  ["mx.google.com; arc=fail; dmarc=pass header.from=provider.test", "fail"],
])(
  "does not promote untrusted or failing authentication headers: %s",
  async (value, expected) => {
    const { senderAuthentication } = await import("../src/core/email-evidence")
    expect(
      senderAuthentication(
        [{ name: "Authentication-Results", value }],
        "verify@provider.test",
      ),
    ).toBe(expected)
  },
)
