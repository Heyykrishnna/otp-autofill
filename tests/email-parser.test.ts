import { describe, expect, it } from "vitest"

import {
  decodeBase64Url,
  decodeMimeHeader,
  extractCandidates,
  htmlToText,
  parseGmailMessage,
} from "../src/core/email-parser"
import { email, gmailMessage } from "./fixtures/emails"

describe("verification email extraction", () => {
  it.each([
    ["Your verification code is 482193.", "482193"],
    ["Your verification code: 482 193", "482193"],
    ["Your security code: 1234 5678", "12345678"],
    ["Your verification code is UCSIAGUBQQ", "UCSIAGUBQQ"],
    ["Your sign-in code: aB7xQ9", "aB7xQ9"],
    ["482193 is your one-time code", "482193"],
    ["OTP: 0427", "0427"],
    ["Passcode: 482\u00a0193", "482193"],
    ["Your verification code: AB12-cD34", "AB12-cD34"],
  ])("extracts supported format from %s", (text, code) => {
    expect(
      extractCandidates(email(text)).map((candidate) => candidate.code),
    ).toContain(code)
  })

  it.each([
    "Invoice number: 482193",
    "Call 18005551234 on 2026-10-20",
    "Your account number is 482193",
    "Tracking reference: AB12CD34",
    "Your verification code will arrive soon. Invoice number: 482193",
    "Your verification code has been sent to phone: 482193",
    "Use https://example.com/482193 to verify",
    "A verification code is requested. Please continue.",
    "Your verification code expires in 1234 seconds.",
  ])("does not mistake unrelated content for a code: %s", (text) => {
    expect(
      extractCandidates(email(text, { subject: "Account update" })).map(
        (candidate) => candidate.code,
      ),
    ).toEqual([])
  })

  it("keeps distinct possibilities instead of guessing", () => {
    expect(
      extractCandidates(
        email("Your verification code: 482193. Your security code: 987654."),
      ).map((candidate) => candidate.code),
    ).toEqual(["482193", "987654"])
  })

  it("deduplicates plain text and HTML copies of the same code", () => {
    expect(
      extractCandidates(
        email("Verification code: 482193\nVerification code: 482193"),
      ),
    ).toHaveLength(1)
  })
})

describe("Gmail MIME decoding", () => {
  it("decodes MIME encoded header words and declared charsets", () => {
    expect(
      decodeMimeHeader("=?UTF-8?B?WW91ciB2ZXJpZmljYXRpb24gY29kZQ==?="),
    ).toBe("Your verification code")
    expect(decodeMimeHeader("=?UTF-8?Q?Your_verification_code?=")).toBe(
      "Your verification code",
    )
    expect(
      decodeBase64Url(
        Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64url"),
        "iso-8859-1",
      ),
    ).toBe("café")
  })
  it("decodes nested HTML, entities, and base64url UTF-8 without creating DOM nodes", () => {
    const raw = gmailMessage("", {
      payload: {
        mimeType: "multipart/alternative",
        headers: [{ name: "from", value: "verify@example.com" }],
        parts: [
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from(
                "<style>.x{color:red}</style><p>Your verification code: <b>482&nbsp;193</b></p><script>bad()</script>",
              ).toString("base64url"),
            },
          },
        ],
      },
    })
    const parsed = parseGmailMessage(raw)
    expect(parsed?.text).toContain("482 193")
    expect(parsed?.text).not.toContain("bad()")
    expect(parsed && extractCandidates(parsed)[0]?.code).toBe("482193")
    expect(document.querySelector("script")).toBeNull()
  })

  it("ignores attachments and untrusted snippets", () => {
    const parsed = parseGmailMessage(
      gmailMessage("", {
        snippet: "Verification code: 482193",
        payload: {
          parts: [
            {
              mimeType: "text/plain",
              filename: "invoice.txt",
              body: {
                data: Buffer.from("verification code: 482193").toString(
                  "base64url",
                ),
              },
            },
          ],
        },
      }),
    )
    expect(parsed?.text.trim()).toBe("")
  })

  it.each([
    null,
    {},
    { id: "../invalid", internalDate: "42", payload: {} },
    { id: "okay", internalDate: "NaN", payload: {} },
  ])("rejects malformed messages safely", (raw) => {
    expect(parseGmailMessage(raw)).toBeNull()
  })

  it("rejects malformed and oversized encodings", () => {
    expect(decodeBase64Url("%%%")).toBe("")
    expect(decodeBase64Url("x".repeat(1_500_001))).toBe("")
    expect(htmlToText("&#x110000; &#55296; &unknown;")).toBe("")
  })
})
