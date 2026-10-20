import { describe, expect, it } from "vitest"

import { extractCandidates } from "../src/core/email-parser"
import { matchCandidates, matchesWebsite } from "../src/core/matcher"
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
    expect(matchesWebsite("a@example.com", "localhost")).toBe(false)
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
