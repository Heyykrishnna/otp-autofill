import type { FieldConstraints } from "../core/types"
import { isEligibleInput } from "../otp/OtpFieldDetector"
import {
  resolveAllOtpGroups,
  type DetectedGroup,
} from "../otp/OtpFieldResolver"

export interface OtpTarget {
  inputs: HTMLInputElement[]
  constraints: FieldConstraints
  group?: DetectedGroup
}

export const isUsable = isEligibleInput

export function detectTargets(root: Document = document): OtpTarget[] {
  const groups = resolveAllOtpGroups(root)
  return groups.map((group) => ({
    inputs: group.inputs,
    constraints: {
      length: group.expectedLength,
      numeric: group.numeric,
      pattern: group.pattern,
    },
    group,
  }))
}
