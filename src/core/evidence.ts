export function emailAddress(value: string): string | null {
  const address = (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase()
  return address.length <= 254 &&
    /^[^\s@<>]{1,64}@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(
      address,
    ) &&
    !address.includes("..")
    ? address
    : null
}

export function canonicalEmail(value: string): string | null {
  const address = emailAddress(value)
  if (!address) return null
  const [local, domain] = address.split("@")
  if (!local || !domain) return null
  return ["gmail.com", "googlemail.com"].includes(domain)
    ? `${local.split("+")[0]?.replace(/\./g, "")}@gmail.com`
    : address
}

export function recipientAddresses(value: string): string[] {
  return [
    ...new Set(
      (
        value.slice(0, 8000).match(/[^\s<>(),;:]+@[^\s<>(),;:]+/g) ?? []
      ).flatMap((value) => {
        const address = emailAddress(value)
        return address ? [address] : []
      }),
    ),
  ].slice(0, 20)
}

export function currentMessageText(text: string): string {
  return (
    text
      .split(
        /^On .{0,200}wrote:\s*$|^-{2,}\s*Original Message\s*-*\s*$|^_{5,}\s*$/im,
      )[0]
      ?.split("\n")
      .filter((line) => !/^\s*>/.test(line))
      .join("\n") ?? ""
  )
}

export function withoutHtmlQuotes(html: string): string {
  return (
    html.split(
      /<blockquote\b|<div\b[^<>]*\bclass\s*=\s*["'][^<>"']*\b(?:gmail_quote|yahoo_quoted)\b/i,
    )[0] ?? ""
  )
}

export function audienceDomains(text: string): string[] {
  const found = new Set<string>()
  const add = (value: string) => {
    try {
      const url = new URL(value)
      if (url.protocol === "https:" && !url.username && !url.password)
        found.add(url.hostname.toLowerCase())
    } catch {
      return
    }
  }
  const bounded = text.slice(0, 100_000)
  for (const match of bounded.matchAll(/https?:\/\/[^\s<>"']+/gi))
    add(match[0].replace(/[).,;]+$/, "").replace(/&amp;/gi, "&"))
  const plain = bounded
    .replace(/https?:\/\/[^\s<>"']+/gi, " ")
    .replace(/<[^>]+>/g, " ")
  for (const token of plain.split(/\s+/).slice(0, 10_000)) {
    const domain = token.replace(/^[('"[]+|[)\]'",;:.]+$/g, "")
    if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
      add(`https://${domain}`)
  }
  return [...found].slice(0, 32)
}

export function requestReference(text: string): string | undefined {
  return text.match(
    /\b(?:request|challenge|session|verification)\s+(?:id|reference)\s*[:#=]\s*([a-z0-9_-]{4,80})\b/i,
  )?.[1]
}

export function explicitExpiry(
  text: string,
  receivedAt: number,
): number | undefined {
  const match = text.match(
    /\b(?:expires? in|valid for)\s+(\d{1,4})\s*(seconds?|secs?|minutes?|mins?)\b/i,
  )
  if (!match) return undefined
  const duration =
    Number(match[1]) * (/^m/i.test(match[2] ?? "") ? 60_000 : 1000)
  return duration > 0 && duration <= 3_600_000
    ? receivedAt + duration
    : undefined
}
