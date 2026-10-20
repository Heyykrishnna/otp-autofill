import type { FlowState, FlowStatus, VerificationContext } from "./types"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isFlowState(value: unknown): value is FlowState {
  return (
    typeof value === "string" &&
    [
      "idle",
      "detected",
      "waiting",
      "candidate_found",
      "identified",
      "filled",
      "completed",
      "failed",
      "timed_out",
      "permission_required",
      "ambiguous",
      "cancelled",
    ].includes(value)
  )
}

export function isFlowStatus(value: unknown): value is FlowStatus {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFlowState(value.state) &&
    typeof value.hostname === "string" &&
    typeof value.startedAt === "number" &&
    typeof value.detail === "string" &&
    Array.isArray(value.candidates) &&
    value.candidates.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.sender === "string" &&
        typeof item.receivedAt === "number" &&
        typeof item.length === "number",
    )
  )
}

export function isContext(value: unknown): value is VerificationContext {
  if (!isRecord(value) || !isRecord(value.constraints)) return false
  const field = value.constraints
  return (
    typeof value.id === "string" &&
    /^[a-f0-9-]{36}$/.test(value.id) &&
    typeof value.startedAt === "number" &&
    Number.isFinite(value.startedAt) &&
    typeof value.hostname === "string" &&
    value.hostname.length <= 253 &&
    (field.length === null ||
      (Number.isInteger(field.length) &&
        Number(field.length) >= 4 &&
        Number(field.length) <= 12)) &&
    typeof field.numeric === "boolean" &&
    (field.pattern === null ||
      (typeof field.pattern === "string" && field.pattern.length <= 120))
  )
}

export function siteOrigin(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return `${url.protocol}//${url.hostname}/*`
    }
    return null
  } catch {
    return null
  }
}

export function acceptsPattern(code: string, pattern: string | null): boolean {
  if (!pattern) return true
  pattern = pattern.replace(/^\^/, "").replace(/\$$/, "")
  if (
    !/^\^?(?:\[0-9\]|\\d|\[A-Za-z0-9\]|\[a-zA-Z0-9\]|\[A-Z0-9\]|\[A-Za-z\]|\[a-zA-Z\]|\[A-Z\])(?:\+|\{\d{1,2}(?:,\d{0,2})?\})\$?$/.test(
      pattern,
    )
  )
    return false
  const numeric = /^\[0-9\]|^\\d/.test(pattern)
  const alphanumeric = /^\[A-Za-z0-9\]|^\[a-zA-Z0-9\]|^\[A-Z0-9\]/.test(pattern)
  const uppercase = pattern.startsWith("[A-Z0-9]")
  const letters =
    pattern.startsWith("[A-Za-z]") ||
    pattern.startsWith("[a-zA-Z]") ||
    pattern.startsWith("[A-Z]")
  const quantifier = pattern.match(/\{(\d{1,2})(?:,(\d{0,2}))?\}\$?$/)
  if (!numeric && !alphanumeric && !letters) return false
  if (numeric && !/^\d+$/.test(code)) return false
  if ((alphanumeric || letters) && !/^[a-zA-Z0-9]+$/.test(code)) return false
  if (letters && !/^[A-Za-z]+$/.test(code)) return false
  if ((uppercase || pattern.startsWith("[A-Z]")) && code !== code.toUpperCase())
    return false
  if (!quantifier) return /\+\$?$/.test(pattern)
  const minimum = Number(quantifier[1])
  const maximum =
    quantifier[2] === undefined
      ? minimum
      : quantifier[2] === ""
        ? 12
        : Number(quantifier[2])
  return code.length >= minimum && code.length <= maximum
}
