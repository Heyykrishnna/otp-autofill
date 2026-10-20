import type { EmailMessage } from "../../src/core/types"

export function email(
  text: string,
  overrides: Partial<EmailMessage> = {},
): EmailMessage {
  return {
    id: "message1",
    receivedAt: 1_800_000_005_000,
    sender: "Example <verify@accounts.example.com>",
    subject: "Your verification code",
    text,
    ...overrides,
  }
}

export function gmailMessage(
  text: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "message1",
    internalDate: "1800000005000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Example <verify@accounts.example.com>" },
        { name: "Subject", value: "Your verification code" },
      ],
      body: { data: Buffer.from(text).toString("base64url") },
    },
    ...overrides,
  }
}
