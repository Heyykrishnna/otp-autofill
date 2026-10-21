import { findPotentialOtpInputs } from "./OtpFieldDetector"
import { detectOtpGroups, type DetectedGroup } from "./OtpGroupDetector"
import { validateOtpFormat } from "./OtpFormatValidator"
import { executeOtpFill } from "./OtpFillStrategy"
import { verifyOtpFill, type FillVerificationResult } from "./OtpFillVerifier"

export type { DetectedGroup }
export type { FillVerificationResult }

export function resolveAllOtpGroups(
  root: Document = document,
): DetectedGroup[] {
  const inputs = findPotentialOtpInputs(root)
  return detectOtpGroups(inputs)
}

export function resolveOtpGroup(
  root: Document = document,
): DetectedGroup | null {
  const groups = resolveAllOtpGroups(root)
  if (groups.length === 0) {
    return null
  }
  if (groups.length === 1) {
    return groups[0] ?? null
  }

  const activeElement = root.activeElement
  if (activeElement instanceof HTMLInputElement) {
    const activeGroup = groups.find((g) => g.inputs.includes(activeElement))
    if (activeGroup) {
      return activeGroup
    }
  }

  const emptyGroups = groups.filter((g) =>
    g.inputs.every((input) => input.value.trim() === ""),
  )
  if (emptyGroups.length === 1) {
    return emptyGroups[0] ?? null
  }

  return null
}

export function fillResolvedOtp(
  group: DetectedGroup,
  code: string,
): FillVerificationResult {
  const validated = validateOtpFormat(code, {
    length: group.expectedLength,
    numeric: group.numeric,
    pattern: group.pattern,
  })
  if (!validated) {
    return {
      accepted: false,
      filledValue: "",
      reason: "Code format does not match field constraints",
    }
  }

  const executed = executeOtpFill(group, validated)
  if (!executed) {
    return {
      accepted: false,
      filledValue: "",
      reason: "Fill strategy execution failed",
    }
  }

  return verifyOtpFill(group, validated)
}
