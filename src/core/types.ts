export type FlowState =
  | "idle"
  | "detected"
  | "waiting"
  | "candidate_found"
  | "identified"
  | "filled"
  | "completed"
  | "failed"
  | "timed_out"
  | "permission_required"
  | "ambiguous"
  | "confirmation_required"
  | "opening_link"
  | "verifying"
  | "cancelled"

export interface FieldConstraints {
  length: number | null
  numeric: boolean
  pattern: string | null
}

export interface VerificationContext {
  id: string
  startedAt: number
  hostname: string
  constraints: FieldConstraints
  recipient?: string
  requestId?: string
  strictAfter?: boolean
}

export interface VerificationLinkContext {
  id: string
  startedAt: number
  hostname: string
  recipient?: string
}

export interface EmailVerificationLink {
  url: string
  label: string
}

export interface VerificationLinkCandidate {
  id: string
  messageId: string
  url: string
  sender: string
  receivedAt: number
  subject: string
  account?: string
  recipients?: string[]
  forwarded?: boolean
  senderAuthentication?: "pass" | "fail" | "unknown"
}

export interface Candidate {
  id: string
  messageId: string
  code: string
  sender: string
  receivedAt: number
  confidence: number
  subject: string
  account?: string
  recipients?: string[]
  audiences?: string[]
  requestId?: string
  expiresAt?: number
  manualOnly?: boolean
  senderAuthentication?: "pass" | "fail" | "unknown"
  verificationDomains?: string[]
}

export interface CandidateSummary {
  id: string
  sender: string
  receivedAt: number
  length: number
  account?: string
  reason?: string
}

export interface FlowStatus {
  id: string
  state: FlowState
  hostname: string
  startedAt: number
  detail: string
  candidates: CandidateSummary[]
}

export interface Settings {
  autofill: boolean
  connected: boolean
  revocationPending: boolean
  accountEmail?: string
  companionEnabled?: boolean
  pressEnter?: boolean
  enterDelayMs?: number
}

export interface MailboxAccount {
  id: string
  email: string
  source: "chrome" | "companion"
  available: boolean
}

export interface MessageSource {
  discover(
    startedAt: number,
    seen: Set<string>,
    signal: AbortSignal,
  ): Promise<EmailMessage[] | Discovery>
}

export interface Discovery {
  messages: EmailMessage[]
  warnings: string[]
}

export interface Snapshot {
  systemError: string | null
  configured: boolean
  settings: Settings
  flow: FlowStatus | null
  allowed: boolean
  origin: string | null
  tabId: number | null
  sites: string[]
  accounts: MailboxAccount[]
  accountError: string | null
}

export interface EmailMessage {
  id: string
  receivedAt: number
  sender: string
  subject: string
  text: string
  account?: string
  recipients?: string[]
  audiences?: string[]
  forwarded?: boolean
  senderAuthentication?: "pass" | "fail" | "unknown"
  verificationDomains?: string[]
  verificationLinks?: EmailVerificationLink[]
}

export interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

export const FLOW_TIMEOUT_MS = 120_000
export const MAX_EMAIL_AGE_MS = 180_000
export const MAX_VERIFICATION_CLICKS = 6
export const MAX_VERIFICATION_NAVIGATIONS = 12
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
export const DEFAULT_SETTINGS: Settings = {
  autofill: true,
  connected: false,
  revocationPending: false,
  pressEnter: true,
  enterDelayMs: 150,
}
