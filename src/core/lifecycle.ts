import { FLOW_TIMEOUT_MS, type FlowState } from "./types"

const TERMINAL = new Set<FlowState>([
  "completed",
  "failed",
  "timed_out",
  "permission_required",
  "cancelled",
])

export function isTerminal(state: FlowState): boolean {
  return TERMINAL.has(state)
}

export function hasExpired(startedAt: number, now = Date.now()): boolean {
  return now - startedAt >= FLOW_TIMEOUT_MS || startedAt > now + 1_000
}

export function pollDelay(attempt: number, failed = false): number {
  return Math.min(
    failed
      ? 5_000 * 2 ** Math.min(attempt, 3)
      : 5_000 + Math.floor(attempt / 4) * 2_500,
    20_000,
  )
}
