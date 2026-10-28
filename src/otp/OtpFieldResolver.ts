import { findPotentialOtpInputs } from "./OtpFieldDetector"
import { detectOtpGroups, type DetectedGroup } from "./OtpGroupDetector"
import { validateOtpFormat } from "./OtpFormatValidator"
import { executeOtpFill, nextTask } from "./OtpFillStrategy"
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

export async function fillResolvedOtp(
  group: DetectedGroup,
  code: string,
  canContinue: () => boolean = () => true,
): Promise<FillVerificationResult> {
  const validated = validateOtpFormat(code, {
    length: group.expectedLength,
    maxLength: group.maxLength ?? null,
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

  const executed = await executeOtpFill(group, validated, canContinue)
  if (!executed) {
    return {
      accepted: false,
      filledValue: "",
      reason: "Fill strategy execution failed",
    }
  }

  await nextTask()
  if (!canContinue()) {
    return { accepted: false, filledValue: "", reason: "Fill was cancelled" }
  }
  return verifyOtpFill(group, validated)
}
