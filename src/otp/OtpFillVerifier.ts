import type { DetectedGroup } from "./OtpGroupDetector"
import { liveInputs } from "./OtpFillStrategy"
import { normalizeOtpCode } from "./OtpFormatValidator"

export interface FillVerificationResult {
  accepted: boolean
  filledValue: string
  reason?: string
}

export function verifyOtpFill(
  group: DetectedGroup,
  code: string,
): FillVerificationResult {
  const cleanCode = normalizeOtpCode(code)
  const inputs = liveInputs(group.inputs, group.container)
  if (inputs.some((input) => !input.isConnected)) {
    return {
      accepted: false,
      filledValue: "",
      reason: "One or more inputs were disconnected from the DOM during fill",
    }
  }

  const values = inputs.map((input) => input.value)
  const filledValue =
    group.mode === "split" ? values.join("") : (values[0] ?? "")

  if (filledValue.toLowerCase() !== cleanCode.toLowerCase()) {
    return {
      accepted: false,
      filledValue,
      reason: "Filled value does not match the expected code",
    }
  }

  const hasInvalid = inputs.some(
    (input) => input.getAttribute("aria-invalid") === "true",
  )
  if (hasInvalid) {
    return {
      accepted: false,
      filledValue,
      reason: "Input was marked invalid by the host page",
    }
  }

  return {
    accepted: true,
    filledValue,
  }
}
