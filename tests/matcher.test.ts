import { describe, expect, it } from "vitest"

import { extractCandidates } from "../src/core/email-parser"
import {
  matchCandidates,
  matchesWebsite,
  sameOrganization,
} from "../src/core/matcher"
import type { VerificationContext } from "../src/core/types"
import { acceptsPattern, isContext, siteOrigin } from "../src/core/validation"
import { email } from "./fixtures/emails"

const context: VerificationContext = {
  id: "5c5a1b76-dbd9-44be-b621-fc3dbfe558c8",
  hostname: "login.example.com",
  startedAt: 1_800_000_000_000,
  constraints: { length: 6, numeric: true, pattern: "[0-9]{6}" },
}
const now = context.startedAt + 10_000

describe("context-aware matching", () => {
  it("selects a unique site-related code with the expected format", () => {
    expect(
      matchCandidates(
        extractCandidates(email("Verification code: 482193")),
        context,
        now,
      ).kind,
    ).toBe("unique")
  })
  it("never selects a code solely because it is newest", () => {
    const candidates = [
      ...extractCandidates(email("Verification code: 482193")),
      ...extractCandidates(
        email("Verification code: 999999", {
          id: "unrelated",
          sender: "verify@evil.test",
          receivedAt: now,
        }),
      ),
    ]
    const result = matchCandidates(candidates, context, now)
    expect(result.kind === "unique" && result.candidate.code).toBe("482193")
  })
  it("abstains when two distinct recent codes qualify", () => {
    const candidates = [
      ...extractCandidates(email("Verification code: 482193")),
      ...extractCandidates(
        email("Verification code: 999999", { id: "second", receivedAt: now }),
      ),
    ]
    expect(matchCandidates(candidates, context, now).kind).toBe("ambiguous")
  })
  it("treats duplicate messages with the same code as one possibility", () => {
    const candidates = [
      ...extractCandidates(email("Verification code: 482193")),
      ...extractCandidates(
        email("Verification code: 482193", { id: "duplicate" }),
      ),
    ]
    expect(matchCandidates(candidates, context, now).kind).toBe("unique")
  })
  it.each([
    { sender: "verify@example.com.evil.test" },
    { sender: '"Example.com" <verify@evil.test>' },
    { receivedAt: context.startedAt - 16_000 },
    { receivedAt: now + 16_000 },
    { text: "Verification code: 1234" },
    { text: "Verification code: AB12CD" },
  ])("rejects incompatible, stale, and unrelated candidates %j", (override) => {
    expect(
      matchCandidates(
        extractCandidates(email("Verification code: 482193", override)),
        context,
        now,
      ).kind,
    ).toBe("none")
  })
  it("supports case-sensitive alphanumeric fields", () => {
    const alpha = {
      ...context,
      constraints: { length: 10, numeric: false, pattern: "[A-Za-z0-9]{10}" },
    }
    const result = matchCandidates(
      extractCandidates(email("Verification code: UCSIAGUBQQ")),
      alpha,
      now,
    )
    expect(result.kind === "unique" && result.candidate.code).toBe("UCSIAGUBQQ")
  })
  it("uses public and private domain suffixes", () => {
    expect(matchesWebsite("a@auth.example.co.uk", "login.example.co.uk")).toBe(
      true,
    )
    expect(matchesWebsite("a@other.co.uk", "login.example.co.uk")).toBe(false)
    expect(matchesWebsite("a@attacker.github.io", "victim.github.io")).toBe(
      false,
    )
    expect(matchesWebsite("notifications@mlh.com", "my.mlh.com")).toBe(true)
  })
  it("matches site-related codes for short brands with account and recipient evidence", () => {
    const mlhContext: VerificationContext = {
      id: "mlh-context",
      hostname: "my.mlh.com",
      recipient: "alice@gmail.com",
      startedAt: 1_800_000_000_000,
      constraints: { length: 6, numeric: true, pattern: null },
    }
    const candidates = extractCandidates(
      email(
        "Signing in on a diferent device?\nHere’s your one–time code to sign into your account\n\n050151\n",
        {
          sender: "Major League Hacking <notifications@mlh.com>",
          subject: "Signing in on this device?",
          recipients: ["alice@gmail.com"],
          account: "alice@gmail.com",
          receivedAt: mlhContext.startedAt + 5_000,
        },
      ),
    )
    const result = matchCandidates(
      candidates,
      mlhContext,
      mlhContext.startedAt + 10_000,
    )
    expect(result.kind).toBe("unique")
    if (result.kind === "unique") {
      expect(result.candidate.code).toBe("050151")
    }
  })
  it("matches cross-tld organizational senders for mlh.io and www.mlh.com", () => {
    expect(sameOrganization("mlh.io", "www.mlh.com")).toBe(true)
    expect(sameOrganization("auth.mlh.io", "mlh.com")).toBe(true)
    expect(sameOrganization("attacker.com", "mlh.com")).toBe(false)

    const mlhWebContext: VerificationContext = {
      id: "mlh-web-context",
      hostname: "www.mlh.com",
      startedAt: 1_800_000_000_000,
      constraints: { length: 6, numeric: true, pattern: null },
    }
    const candidates = extractCandidates(
      email(
        "Here is your verification code:\n\n050151\n\nMajor League Hacking",
        {
          sender: "Major League Hacking <notifications@mlh.io>",
          subject: "050151 is your one-time code for Major League Hacking",
          recipients: ["user@example.com"],
          account: "user@example.com",
          senderAuthentication: "pass",
          receivedAt: mlhWebContext.startedAt + 5_000,
        },
      ),
    )
    const result = matchCandidates(
      candidates,
      mlhWebContext,
      mlhWebContext.startedAt + 10_000,
    )
    expect(result.kind).toBe("unique")
    if (result.kind === "unique") {
      expect(result.candidate.code).toBe("050151")
    }
  })
})

describe("external input validation", () => {
  it("rejects unexpected content-script data", () => {
    expect(isContext(context)).toBe(true)
    expect(
      isContext({
        ...context,
        constraints: { length: 999, numeric: false, pattern: null },
      }),
    ).toBe(false)
    expect(isContext({ ...context, startedAt: NaN })).toBe(false)
    expect(isContext({ ...context, id: "wrong" })).toBe(false)
  })
  it("supports conservative field patterns without executing page-provided regex", () => {
    expect(acceptsPattern("482193", "[0-9]{6}")).toBe(true)
    expect(acceptsPattern("482193", "^[0-9]{6}$")).toBe(true)
    expect(acceptsPattern("482193", "\\d{4,8}")).toBe(true)
    expect(acceptsPattern("AB12cd", "[A-Z0-9]{6}")).toBe(false)
    expect(acceptsPattern("482193", "(a+)+$")).toBe(false)
    expect(acceptsPattern("482193", "[0-9](a+)+{6}")).toBe(false)
  })
  it("permits secure sites and explicit loopback testing only", () => {
    expect(siteOrigin("https://login.example.com/verify?token=private")).toBe(
      "https://login.example.com/*",
    )
    expect(siteOrigin("http://localhost:4173")).toBe("http://localhost/*")
    expect(siteOrigin("http://example.com")).toBeNull()
    expect(siteOrigin("chrome://extensions")).toBeNull()
    expect(siteOrigin("javascript:alert(1)")).toBeNull()
  })
})

describe("brand mail domains", () => {
  const luma: VerificationContext = { ...context, hostname: "luma.com" }
  const candidate = (sender: string, subject = "Your Luma sign in code") => ({
    id: sender,
    messageId: sender,
    code: "482193",
    sender,
    subject,
    receivedAt: now,
    confidence: 1,
    senderAuthentication: "pass" as const,
  })

  it("autofills when the brand sends from a <brand>-mail domain", () => {
    expect(
      matchCandidates([candidate("Luma <hello@luma-mail.com>")], luma, now)
        .kind,
    ).toBe("unique")
    expect(
      matchCandidates(
        [candidate("Luma <hello@calendar.luma-mail.com>")],
        luma,
        now,
      ).kind,
    ).toBe("unique")
  })

  it("asks first for an unlisted <brand>-mail domain, even with passing DMARC", () => {
    for (const sender of [
      "Luma <code@luma-mail.net>",
      "Luma <code@luma-notifications.com>",
    ])
      expect(matchCandidates([candidate(sender)], luma, now).kind).toBe(
        "ambiguous",
      )
  })

  it("autofills an unlisted <brand>-mail domain only when the email names the exact site", () => {
    expect(
      matchCandidates(
        [
          {
            ...candidate("Luma <code@luma-notifications.com>"),
            verificationDomains: ["luma.com"],
          },
        ],
        luma,
        now,
      ).kind,
    ).toBe("unique")
  })

  it("does not treat other hyphenated domains as the brand", () => {
    for (const sender of [
      "Luma <hello@luma-payments.com>",
      "Luma <hello@notluma-mail.com>",
      "Luma <hello@mail-luma.com>",
    ])
      expect(matchCandidates([candidate(sender)], luma, now).kind).toBe("none")
  })

  it("asks first when the mail domain fails authentication", () => {
    expect(
      matchCandidates(
        [
          {
            ...candidate("Luma <hello@luma-mail.com>"),
            senderAuthentication: "unknown" as const,
          },
        ],
        luma,
        now,
      ).kind,
    ).toBe("ambiguous")
  })
})

describe("field bounds and arrival window", () => {
  const early = (offset: number) =>
    extractCandidates(
      email("Verification code: 482193", {
        receivedAt: context.startedAt - offset,
      }),
    )

  it("accepts an email that arrived inside the lookback window", () => {
    expect(matchCandidates(early(40_000), context, now).kind).toBe("none")
    expect(
      matchCandidates(early(40_000), { ...context, lookbackMs: 60_000 }, now)
        .kind,
    ).toBe("unique")
  })
  it("keeps resends strict even with a lookback window", () => {
    expect(
      matchCandidates(
        early(5_000),
        { ...context, lookbackMs: 60_000, strictAfter: true },
        now,
      ).kind,
    ).toBe("none")
  })
  it("treats a single field's maxlength as an upper bound", () => {
    const bounded = (maxLength: number): VerificationContext => ({
      ...context,
      constraints: { length: null, numeric: true, pattern: null, maxLength },
    })
    const code = extractCandidates(email("Verification code: 482193"))
    expect(matchCandidates(code, bounded(10), now).kind).toBe("unique")
    expect(matchCandidates(code, bounded(4), now).kind).toBe("none")
  })
  it("validates the lookback window and field bound", () => {
    expect(isContext({ ...context, lookbackMs: 120_000 })).toBe(true)
    expect(isContext({ ...context, lookbackMs: 600_000 })).toBe(false)
    expect(
      isContext({
        ...context,
        constraints: { ...context.constraints, maxLength: 40 },
      }),
    ).toBe(false)
  })
})
