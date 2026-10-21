import type { OtpTarget } from "./detector"
import { fillResolvedOtp } from "../otp/OtpFieldResolver"
import type { DetectedGroup } from "../otp/OtpGroupDetector"

export function fillTarget(target: OtpTarget, code: string): boolean {
  const first = target.inputs[0]
  if (!first) return false
  const container = (first.closest(
    "form, [role='dialog'], [role='main'], main, section, article, [class*='card']",
  ) ??
    first.parentElement ??
    first.ownerDocument.body) as HTMLElement
  const group: DetectedGroup = {
    inputs: target.inputs,
    mode: target.inputs.length > 1 ? "split" : "single",
    container,
    expectedLength: target.constraints.length,
    numeric: target.constraints.numeric,
    pattern: target.constraints.pattern,
  }
  const result = fillResolvedOtp(group, code)
  return result.accepted
}
