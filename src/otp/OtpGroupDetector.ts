import {
  accessibleInputText,
  CONTAINER_SIGNAL,
  EXCLUDED_SIGNAL,
  isConcealedOtpController,
  isEligibleInput,
  OTP_SIGNAL,
  visibleText,
} from "./OtpFieldDetector"

export interface BoxIndex {
  position: number
  prefix: string
}

export interface DetectedGroup {
  inputs: HTMLInputElement[]
  mode: "single" | "split" | "controller"
  container: HTMLElement
  expectedLength: number | null
  maxLength?: number | null
  numeric: boolean
  pattern: string | null
}

export function extractBoxIndex(input: HTMLInputElement): BoxIndex | null {
  const dataSlot =
    input.getAttribute("data-input-otp-slot") ??
    input.getAttribute("data-otp-index") ??
    input.getAttribute("data-slot") ??
    input.getAttribute("data-index")
  if (dataSlot && /^\d{1,2}$/.test(dataSlot)) {
    return { position: Number(dataSlot), prefix: "data-slot" }
  }
  const idMatch = input.id.match(
    /^([a-zA-Z_-]*?(?:otp|code|digit|pin|slot|char|input|box|num|val)?)[_.-]?\[?(\d{1,2})\]?$/i,
  )
  if (idMatch && idMatch[2]) {
    return {
      position: Number(idMatch[2]),
      prefix: (idMatch[1] ?? "").toLowerCase(),
    }
  }
  const nameMatch = input.name.match(
    /^([a-zA-Z_-]*?(?:otp|code|digit|pin|slot|char|input|box|num|val)?)[_.-]?\[?(\d{1,2})\]?$/i,
  )
  if (nameMatch && nameMatch[2]) {
    return {
      position: Number(nameMatch[2]),
      prefix: (nameMatch[1] ?? "").toLowerCase(),
    }
  }
  const ariaMatch = (input.getAttribute("aria-label") ?? "").match(
    /\b(?:digit|character|code|box|slot|input|number)\s+(\d{1,2})\b/i,
  )
  if (ariaMatch && ariaMatch[1]) {
    return { position: Number(ariaMatch[1]), prefix: "aria-label" }
  }
  return null
}

export function indexedDigit(
  input: HTMLInputElement,
): { position: number; total: number } | null {
  const match = accessibleInputText(input).match(
    /\bdigit\s+(\d{1,2})\s+(?:of|\/)\s+(\d{1,2})\b/i,
  )
  if (!match) return null
  const position = Number(match[1])
  const total = Number(match[2])
  return total >= 4 && total <= 12 && position >= 1 && position <= total
    ? { position, total }
    : null
}

export function isBoxCandidate(input: HTMLInputElement): boolean {
  return (
    input.maxLength === 1 ||
    input.size === 1 ||
    extractBoxIndex(input) !== null ||
    indexedDigit(input) !== null
  )
}

export function containerSignalsOtp(container: HTMLElement): boolean {
  const attributes = [
    container.id,
    container.className,
    container.getAttribute("aria-label"),
    container.getAttribute("data-testid"),
    container.getAttribute("role"),
  ]
    .filter(Boolean)
    .join(" ")
  if (CONTAINER_SIGNAL.test(attributes) || OTP_SIGNAL.test(attributes)) {
    return true
  }
  const text = [
    container.querySelector("legend")?.textContent ?? "",
    container.querySelector("label")?.textContent ?? "",
    ...[
      ...container.querySelectorAll(
        "h1, h2, h3, h4, [role='heading'], p, [role='status']",
      ),
    ]
      .slice(0, 10)
      .map((element) => element.textContent ?? ""),
  ]
    .join(" ")
    .slice(0, 2000)
  return OTP_SIGNAL.test(text)
}

function eligibleInputsIn(element: HTMLElement): HTMLInputElement[] {
  return [...element.querySelectorAll("input")].filter(isEligibleInput)
}

export function contextualSignalsOtp(container: HTMLElement): boolean {
  const own = new Set(eligibleInputsIn(container))
  let current: HTMLElement | null = container
  for (let level = 0; current && level < 5; level++) {
    if (current === current.ownerDocument.body) return false
    if (eligibleInputsIn(current).some((input) => !own.has(input))) return false
    if (containerSignalsOtp(current)) return true
    current = current.parentElement
  }
  return false
}

export function findContainerForInputs(
  input: HTMLInputElement,
  allInputs: HTMLInputElement[],
): HTMLElement | null {
  const containers: HTMLElement[] = []
  let current: HTMLElement | null = input.parentElement
  while (
    current &&
    current !== current.ownerDocument.body &&
    containers.length < 8
  ) {
    containers.push(current)
    if (
      ["FORM", "FIELDSET"].includes(current.tagName) ||
      current.getAttribute("role") === "group"
    ) {
      break
    }
    current = current.parentElement
  }
  for (const container of containers) {
    const contained = allInputs.filter((item) => container.contains(item))
    if (contained.length >= 4 && contained.length <= 12) {
      if (contained.every(isBoxCandidate) || contextualSignalsOtp(container)) {
        return container
      }
    }
  }
  return input.closest("fieldset, [role='group'], form") ?? input.parentElement
}

function countVisualOtpSlots(container: HTMLElement): number {
  const all = [
    ...container.querySelectorAll(
      "[data-slot='slot'], [data-slot='input-otp-slot'], [class*='slot'], [class*='otp-box'], [class*='digit-box']",
    ),
  ]
  const leafSlots = all.filter(
    (slot) => !all.some((other) => other !== slot && slot.contains(other)),
  )
  return leafSlots.length
}

function isNumericInput(input: HTMLInputElement): boolean {
  return (
    input.inputMode === "numeric" ||
    input.type === "number" ||
    /^(?:\\d|\[0-9\])/.test(input.pattern)
  )
}

function commonAncestor(inputs: HTMLInputElement[]): HTMLElement {
  let current = inputs[0]?.parentElement ?? null
  while (current && !inputs.every((input) => current?.contains(input)))
    current = current.parentElement
  return current ?? (inputs[0]?.ownerDocument.body as HTMLElement)
}

const FIELD_NAME_SIGNAL = /\b(?:code|otp|token|pin|passcode)\b/i
const WEAK_OTP_TEXT = /\b(?:code|otp|pin|passcode|verif\w*)\b/i
const WEAK_EXCLUDED_TEXT =
  /\b(?:sort[ -]?code|routing|iban|swift|bank|account[ -]?number|date of birth|birthday)\b/i

// Nearby text that only says "code" is enough for a row of equal boxes, which
// almost nothing but a one-time code uses.
export function nearbyTextSignalsOtp(container: HTMLElement): boolean {
  const own = new Set(eligibleInputsIn(container))
  let current: HTMLElement | null = container
  for (let level = 0; current && level < 5; level++) {
    if (current === current.ownerDocument.body) return false
    if (eligibleInputsIn(current).some((input) => !own.has(input))) return false
    const text = visibleText(current).slice(0, 2000)
    if (EXCLUDED_SIGNAL.test(text) || WEAK_EXCLUDED_TEXT.test(text))
      return false
    if (WEAK_OTP_TEXT.test(text)) return true
    current = current.parentElement
  }
  return false
}

function similar(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(2, Math.max(left, right) * 0.15)
}

export function detectBoxRows(
  inputs: HTMLInputElement[],
): HTMLInputElement[][] {
  const boxes = inputs.flatMap((input) => {
    const rect = input.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.width <= rect.height * 4
      ? [{ input, rect }]
      : []
  })
  const rows: (typeof boxes)[] = []
  for (const box of boxes) {
    const row = rows.find((candidate) => {
      // Relative tolerances let a focused box that grows or shifts stay in its row.
      const first = candidate[0]!.rect
      return (
        Math.abs(
          first.top + first.height / 2 - (box.rect.top + box.rect.height / 2),
        ) <=
          first.height * 0.25 &&
        similar(first.width, box.rect.width) &&
        similar(first.height, box.rect.height)
      )
    })
    if (row) row.push(box)
    else rows.push([box])
  }
  return rows.flatMap((row) => {
    row.sort((left, right) => left.rect.left - right.rect.left)
    const runs: (typeof boxes)[] = []
    for (const box of row) {
      const run = runs.at(-1)
      const previous = run?.at(-1)?.rect
      const gap = previous ? box.rect.left - previous.right : -1
      if (run && previous && gap >= -4 && gap <= previous.width * 1.5 + 8)
        run.push(box)
      else runs.push([box])
    }
    return runs
      .filter((run) => run.length >= 4 && run.length <= 12)
      .map((run) => run.map((box) => box.input))
  })
}

export function detectOtpGroups(inputs: HTMLInputElement[]): DetectedGroup[] {
  const groups: DetectedGroup[] = []
  const used = new Set<HTMLInputElement>()

  for (const row of detectBoxRows(inputs)) {
    const container = commonAncestor(row)
    if (row.some((item) => EXCLUDED_SIGNAL.test(accessibleInputText(item))))
      continue
    const signalled =
      row.some(
        (item) =>
          OTP_SIGNAL.test(accessibleInputText(item)) ||
          item.autocomplete === "one-time-code" ||
          isBoxCandidate(item),
      ) ||
      contextualSignalsOtp(container) ||
      (row.length <= 8 && nearbyTextSignalsOtp(container))
    if (!signalled) continue
    row.forEach((item) => used.add(item))
    groups.push({
      inputs: row,
      mode: "split",
      container,
      expectedLength: row.length,
      numeric: row.every(isNumericInput),
      pattern: null,
    })
  }

  const ordered = [
    ...inputs.filter(isBoxCandidate),
    ...inputs.filter((input) => !isBoxCandidate(input)),
  ]
  for (const input of ordered) {
    if (used.has(input) || input.type === "password") continue
    const ownText = accessibleInputText(input)
    if (EXCLUDED_SIGNAL.test(ownText)) continue

    const indexed = indexedDigit(input)
    if (isBoxCandidate(input)) {
      const groupContainer = findContainerForInputs(input, inputs)
      if (!groupContainer) continue

      const indexedInputs = indexed
        ? inputs
            .flatMap((item) => {
              const digit = indexedDigit(item)
              return groupContainer.contains(item) &&
                digit?.total === indexed.total &&
                !EXCLUDED_SIGNAL.test(accessibleInputText(item))
                ? [{ input: item, position: digit.position }]
                : []
            })
            .sort((left, right) => left.position - right.position)
        : []

      if (
        indexed &&
        (indexedInputs.length !== indexed.total ||
          indexedInputs.some(
            (item, position) => item.position !== position + 1,
          ))
      ) {
        continue
      }

      let grouped = indexed
        ? indexedInputs.map((item) => item.input)
        : inputs.filter(
            (item) =>
              !used.has(item) &&
              groupContainer.contains(item) &&
              (isBoxCandidate(item) || contextualSignalsOtp(groupContainer)) &&
              !EXCLUDED_SIGNAL.test(accessibleInputText(item)),
          )

      if (grouped.length >= 4 && grouped.length <= 12) {
        const boxIndices = grouped.map((item) => ({
          input: item,
          index: extractBoxIndex(item),
        }))
        const hasPrefixGroup =
          boxIndices.every((item) => item.index !== null) &&
          new Set(boxIndices.map((item) => item.index?.prefix)).size === 1

        if (hasPrefixGroup) {
          grouped = [...boxIndices]
            .sort(
              (left, right) =>
                (left.index?.position ?? 0) - (right.index?.position ?? 0),
            )
            .map((item) => item.input)
        }

        const hasOtpSignal =
          grouped.some(
            (item) =>
              OTP_SIGNAL.test(accessibleInputText(item)) ||
              item.autocomplete === "one-time-code" ||
              isBoxCandidate(item),
          ) ||
          contextualSignalsOtp(groupContainer) ||
          (hasPrefixGroup &&
            /^(?:otp|code|pin|digit)/i.test(boxIndices[0]?.index?.prefix ?? ""))

        if (hasOtpSignal) {
          grouped.forEach((item) => used.add(item))
          groups.push({
            inputs: grouped,
            mode: "split",
            container: groupContainer,
            expectedLength: grouped.length,
            numeric: grouped.every(isNumericInput),
            pattern: null,
          })
          continue
        }
      }
    }

    const container =
      (input.closest(
        "form, [role='dialog'], [role='main'], main, section, article, [class*='card']",
      ) as HTMLElement | null) ??
      input.parentElement ??
      input.ownerDocument.body

    const visualSlots = countVisualOtpSlots(container)
    const isConcealed = isConcealedOtpController(input)
    if (
      visualSlots >= 4 &&
      visualSlots <= 12 &&
      (isConcealed || input.autocomplete === "one-time-code")
    ) {
      used.add(input)
      const expectedLength =
        input.maxLength >= 4 && input.maxLength <= 12
          ? input.maxLength
          : visualSlots
      groups.push({
        inputs: [input],
        mode: "controller",
        container,
        expectedLength,
        numeric: isNumericInput(input),
        pattern: input.pattern || null,
      })
      continue
    }

    if (
      input.autocomplete === "one-time-code" ||
      OTP_SIGNAL.test(ownText) ||
      (contextualSignalsOtp(container) && !EXCLUDED_SIGNAL.test(ownText)) ||
      // A field named for a code, next to text that mentions one.
      (FIELD_NAME_SIGNAL.test(ownText) &&
        !/search/i.test(ownText) &&
        input.parentElement !== null &&
        nearbyTextSignalsOtp(input.parentElement))
    ) {
      if (
        input.maxLength > 0 &&
        (input.maxLength < 4 || input.maxLength > 12)
      ) {
        continue
      }
      const pattern = input.pattern ? input.pattern.slice(0, 120) : null
      const exactLength = pattern?.match(/\{(\d{1,2})\}\$?$/)?.[1]
      const boundedLength =
        input.maxLength >= 4 && input.maxLength <= 12 ? input.maxLength : null
      const controller = visualSlots >= 4
      const expectedLength = exactLength
        ? Number(exactLength)
        : controller
          ? (boundedLength ?? (visualSlots <= 12 ? visualSlots : null))
          : null

      used.add(input)
      groups.push({
        inputs: [input],
        mode: controller ? "controller" : "single",
        container,
        expectedLength,
        maxLength: controller ? null : boundedLength,
        numeric: isNumericInput(input),
        pattern,
      })
    }
  }

  return groups.sort((left, right) =>
    left.inputs[0] &&
    right.inputs[0] &&
    left.inputs[0].compareDocumentPosition(right.inputs[0]) &
      Node.DOCUMENT_POSITION_PRECEDING
      ? 1
      : -1,
  )
}
