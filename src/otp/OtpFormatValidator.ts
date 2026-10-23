import { acceptsPattern } from "../core/validation"
import type { FieldConstraints } from "../core/types"

export function normalizeOtpCode(code: string): string {
  return code.trim().replace(/[\s\u00a0\u202f-]+/g, "")
}

export function validateOtpFormat(
  code: string,
  constraints: FieldConstraints,
): string | null {
  const normalized = normalizeOtpCode(code)
  if (normalized.length < 4 || normalized.length > 12) {
    return null
  }
  if (constraints.length !== null && normalized.length !== constraints.length) {
    return null
  }
  if (constraints.maxLength && normalized.length > constraints.maxLength) {
    return null
  }
  if (constraints.numeric && !/^\d+$/.test(normalized)) {
    return null
  }
  if (!acceptsPattern(normalized, constraints.pattern)) {
    return null
  }
  return normalized
}
