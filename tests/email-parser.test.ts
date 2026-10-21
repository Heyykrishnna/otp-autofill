import { describe, expect, it } from "vitest"

import {
  decodeBase64Url,
  decodeMimeHeader,
  extractCandidates,
  extractVerificationLinks,
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
    ["314159\nis your Luma sign-in code.", "314159"],
    ["OTP: 0427", "0427"],
    ["Passcode: 482\u00a0193", "482193"],
    ["Your verification code: AB12-cD34", "AB12-cD34"],
    ["Here’s your one-time code to sign into your account\n289217", "289217"],
    ["We've sent a 6-character code to your email: 839201", "839201"],
    ["Your confirmation code is 482193.", "482193"],
    ["Your temporary code: 987654", "987654"],
    ["Your login code is 654321.", "654321"],
    [
      "Signing in on this device?\nClick the link to automatically sign into your account on this device\nSign in\nSigning in on a diferent device?\nHere’s your one–time code to sign into your account\n\n050151\nIf you didn’t request this email, there’s nothing to worry about - you can safely ignore it.",
      "050151",
    ],
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

describe("verification link extraction", () => {
  it("extracts an explicit HTTPS verification link without exposing unrelated links", () => {
    const message = email(
      "Verify your email at https://login.example.com/verify?token=secret. Manage preferences at https://example.com/preferences.",
      { subject: "Verify your email" },
    )
    expect(extractVerificationLinks(message)).toMatchObject([
      { url: "https://login.example.com/verify?token=secret" },
    ])
  })

  it("extracts an action-labelled HTML link and decodes query entities", () => {
    const parsed = parseGmailMessage(
      gmailMessage("", {
        payload: {
          mimeType: "text/html",
          headers: [
            { name: "From", value: "verify@accounts.example.com" },
            { name: "Subject", value: "Confirm your email" },
          ],
          body: {
            data: Buffer.from(
              '<a href="https://login.example.com/verify?a=1&amp;b=2">Confirm email</a><a href="https://example.com/unsubscribe">Unsubscribe</a>',
            ).toString("base64url"),
          },
        },
      }),
    )
    expect(parsed && extractVerificationLinks(parsed)).toMatchObject([
      { url: "https://login.example.com/verify?a=1&b=2" },
    ])
  })

  it("extracts sign-in verification links from device sign-in emails", () => {
    const parsed = parseGmailMessage(
      gmailMessage("", {
        payload: {
          mimeType: "text/html",
          headers: [
            { name: "From", value: "notifications@mlh.com" },
            { name: "Subject", value: "Signing in on this device?" },
          ],
          body: {
            data: Buffer.from(
              '<p>Click the link to automatically sign into your account on this device</p><a href="https://my.mlh.com/users/sign_in?login_token=secret123">Sign in</a>',
            ).toString("base64url"),
          },
        },
      }),
    )
    expect(parsed && extractVerificationLinks(parsed)).toMatchObject([
      { url: "https://my.mlh.com/users/sign_in?login_token=secret123" },
    ])
  })

  it.each([
    "Verify at http://login.example.com/verify?token=secret",
    "Reset password at https://login.example.com/reset?token=secret",
    "Invoice at https://login.example.com/invoice/42",
  ])("rejects unsafe or unrelated links: %s", (text) => {
    expect(
      extractVerificationLinks(email(text, { subject: "Account update" })),
    ).toEqual([])
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
