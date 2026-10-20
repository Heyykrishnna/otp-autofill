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
}

export interface Candidate {
  id: string
  messageId: string
  code: string
  sender: string
  receivedAt: number
  confidence: number
  subject: string
}

export interface CandidateSummary {
  id: string
  sender: string
  receivedAt: number
  length: number
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
}

export interface EmailMessage {
  id: string
  receivedAt: number
  sender: string
  subject: string
  text: string
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
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
export const DEFAULT_SETTINGS: Settings = {
  autofill: true,
  connected: false,
  revocationPending: false,
}
