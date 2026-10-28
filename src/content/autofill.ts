import type { OtpTarget } from "./detector"
import { fillResolvedOtp } from "../otp/OtpFieldResolver"
import type { DetectedGroup } from "../otp/OtpGroupDetector"
import { liveInputs } from "../otp/OtpFillStrategy"

export async function fillTarget(
  target: OtpTarget,
  code: string,
  canContinue: () => boolean = () => true,
): Promise<boolean> {
  const first = target.inputs[0]
  if (!first) return false
  const container = (target.group?.container ??
    first.closest(
      "form, [role='dialog'], [role='main'], main, section, article, [class*='card']",
    ) ??
    first.parentElement ??
    first.ownerDocument.body) as HTMLElement
  const group: DetectedGroup = target.group ?? {
    inputs: target.inputs,
    mode: target.inputs.length > 1 ? "split" : "single",
    container,
    expectedLength: target.constraints.length,
    maxLength: target.constraints.maxLength ?? null,
    numeric: target.constraints.numeric,
    pattern: target.constraints.pattern,
  }
  const result = await fillResolvedOtp(group, code, canContinue)
  if (result.accepted) {
    target.inputs = liveInputs(group.inputs, group.container)
    group.inputs = target.inputs
  }
  return result.accepted
}
