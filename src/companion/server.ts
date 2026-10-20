import { randomBytes, timingSafeEqual } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"

import { GmailError } from "../background/gmail"
import { isRecord } from "../core/validation"
import { AccountVault } from "./oauth"

export interface CompanionOptions {
  clientId: string
  clientSecret?: string
  extensionId: string
  port?: number
  request?: typeof fetch
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  })
  response.end(JSON.stringify(body))
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"] !== "application/json")
    throw new Error("Expected JSON.")
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 32_768) throw new Error("Request too large.")
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

export async function startCompanion(
  options: CompanionOptions,
): Promise<{ port: number; close: () => Promise<void> }> {
  if (!/^[a-p]{32}$/.test(options.extensionId))
    throw new Error(
      "EXPECTED_EXTENSION_ID must identify the extension allowed to use the companion.",
    )
  const origin = `chrome-extension://${options.extensionId}`
  const vault = new AccountVault(
    options.clientId,
    options.clientSecret,
    options.request,
  )
  let pairing: Buffer | undefined
  let pairingExpiry = 0
  let port = 0
  const callbacks = new Set<Server>()
  const authorize = async (): Promise<string> => {
    if (callbacks.size >= 3)
      throw new Error("Finish the pending account connection first.")
    let state = ""
    let completed = false
    let successful = false
    const callback = createServer((request, response) => {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      )
      response.setHeader("Referrer-Policy", "no-referrer")
      response.setHeader("Cache-Control", "no-store")
      const host = `127.0.0.1:${(callback.address() as AddressInfo).port}`
      if (request.headers.host !== host || request.method !== "GET") {
        response.writeHead(403)
        response.end()
        return
      }
      const url = new URL(request.url ?? "/", `http://${host}`)
      if (url.pathname === "/complete" && completed) {
        response.setHeader("Content-Type", "text/html; charset=utf-8")
        response.end(
          `<html lang="en"><meta charset="utf-8"><title>OTP Autofill</title><h1>${successful ? "Account connected" : "Account was not connected"}</h1><p>Close this tab and return to OTP Autofill settings.${successful ? "" : " Retry the connection if you want to authorize this inbox."}</p></html>`,
        )
        response.once("finish", () => {
          callback.close()
          callbacks.delete(callback)
          clearTimeout(deadline)
        })
        return
      }
      if (
        url.pathname !== "/oauth/callback" ||
        completed ||
        url.searchParams.get("state") !== state
      ) {
        response.writeHead(400)
        response.end("Invalid authorization request.")
        return
      }
      completed = true
      void (async () => {
        try {
          if (url.searchParams.has("error"))
            throw new Error("Authorization declined.")
          await vault.complete(state, url.searchParams.get("code") ?? "")
          successful = true
        } catch {
          vault.cancel(state)
        }
        response.writeHead(303, { Location: "/complete" })
        response.end()
      })()
    })
    callbacks.add(callback)
    const deadline = setTimeout(() => {
      vault.cancel(state)
      callback.close()
      callbacks.delete(callback)
    }, 180_000)
    deadline.unref()
    try {
      const callbackPort = await listen(callback, 0)
      const authorization = vault.begin(
        `http://127.0.0.1:${callbackPort}/oauth/callback`,
      )
      state = authorization.state
      return authorization.url
    } catch (error) {
      clearTimeout(deadline)
      callback.close()
      callbacks.delete(callback)
      throw error
    }
  }
  const server = createServer((request, response) => {
    void (async () => {
      if (
        request.headers.host !== `127.0.0.1:${port}` ||
        request.headers.origin !== origin
      ) {
        reply(response, 403, { error: "Unapproved caller." })
        return
      }
      response.setHeader("Access-Control-Allow-Origin", origin)
      response.setHeader("Vary", "Origin")
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "300",
        })
        response.end()
        return
      }
      if (request.method !== "POST") {
        reply(response, 405, { error: "POST required." })
        return
      }
      if (request.url === "/pair") {
        if (!pairing || pairingExpiry <= Date.now()) {
          pairing = randomBytes(32)
          pairingExpiry = Date.now() + 43_200_000
        }
        await body(request)
        reply(response, 200, { session: pairing.toString("hex") })
        return
      }
      const token = request.headers.authorization?.replace(/^Bearer /, "") ?? ""
      const provided = /^[a-f0-9]{64}$/.test(token)
        ? Buffer.from(token, "hex")
        : Buffer.alloc(0)
      if (
        !pairing ||
        pairingExpiry <= Date.now() ||
        provided.length !== pairing.length ||
        !timingSafeEqual(provided, pairing)
      ) {
        reply(response, 401, { error: "Pair this extension again." })
        return
      }
      if (request.url !== "/rpc") {
        reply(response, 404, { error: "Unknown operation." })
        return
      }
      const input = await body(request)
      if (!isRecord(input)) {
        reply(response, 400, { error: "Invalid request." })
        return
      }
      switch (input.operation) {
        case "accounts":
          reply(response, 200, { accounts: vault.list() })
          return
        case "authorize":
          reply(response, 200, { url: await authorize() })
          return
        case "remove": {
          if (typeof input.id !== "string") {
            reply(response, 400, { error: "Invalid inbox." })
            return
          }
          reply(response, 200, { revoked: await vault.remove(input.id) })
          return
        }
        case "disconnect":
          reply(response, 200, { revoked: await vault.clear() })
          return
        case "discover": {
          if (
            typeof input.id !== "string" ||
            typeof input.startedAt !== "number" ||
            !Number.isFinite(input.startedAt) ||
            input.startedAt > Date.now() + 1000 ||
            Date.now() - input.startedAt >= 120_000 ||
            !Array.isArray(input.seen) ||
            input.seen.length > 200 ||
            !input.seen.every(
              (id: unknown) =>
                typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id),
            )
          ) {
            reply(response, 400, { error: "Invalid or expired attempt." })
            return
          }
          const controller = new AbortController()
          const abort = () => {
            if (!response.writableEnded) controller.abort()
          }
          response.once("close", abort)
          try {
            const seen = new Set<string>(input.seen)
            const messages = await vault.discover(
              input.id,
              input.startedAt,
              seen,
              AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
            )
            reply(response, 200, { messages, seen: [...seen].slice(-200) })
          } finally {
            response.removeListener("close", abort)
          }
          return
        }
        default:
          reply(response, 400, { error: "Unsupported operation." })
      }
    })().catch((error: unknown) => {
      if (!response.headersSent)
        reply(
          response,
          error instanceof GmailError && error.kind === "temporary" ? 503 : 400,
          {
            error:
              error instanceof GmailError
                ? "Inbox access failed. Reconnect this account or try again shortly."
                : "The companion could not complete this request. Check configuration and retry.",
          },
        )
      else response.end()
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 5000
  port = await listen(server, options.port ?? 43127)
  return {
    port,
    close: async () => {
      pairing = undefined
      for (const callback of callbacks) callback.close()
      callbacks.clear()
      await vault.clear()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
