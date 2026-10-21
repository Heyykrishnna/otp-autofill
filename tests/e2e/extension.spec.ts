import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  expect,
  test as base,
  type BrowserContext,
  type Worker,
} from "@playwright/test"

import { startCompanion } from "../../src/companion/server"
import { GMAIL_SCOPE } from "../../src/core/types"

interface InboxConfig {
  codes: string[]
  sender?: string
  subject?: string
  delay?: number
  emptyFirst?: boolean
  expired?: boolean
  revoked?: boolean
  temporaryFirst?: boolean
  generation?: number
  body?: string
  authenticated?: boolean
  authenticationDomain?: string
}

const test = base.extend<{
  extension: { context: BrowserContext; worker: Worker; id: string }
}>({
  extension: async ({ playwright }, use, testInfo) => {
    const directory = testInfo.outputPath("extension")
    await mkdir(directory, { recursive: true })
    await cp(path.resolve("build/chrome-mv3-prod"), directory, {
      recursive: true,
    })
    const manifestPath = path.join(directory, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.oauth2 = {
      client_id: "fixture.apps.googleusercontent.com",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    }
    manifest.host_permissions.push(
      "https://login.example.com/*",
      "https://www.mlh.com/*",
      "http://127.0.0.1/*",
    )
    await writeFile(manifestPath, JSON.stringify(manifest))
    const context = await playwright.chromium.launchPersistentContext(
      testInfo.outputPath("profile"),
      {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${directory}`,
          `--load-extension=${directory}`,
        ],
      },
    )
    try {
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"))
      await worker.evaluate(async () => {
        await chrome.storage.local.set({
          settings: {
            connected: true,
            autofill: true,
            pressEnter: false,
            revocationPending: false,
          },
        })
        await chrome.scripting.registerContentScripts([
          {
            id: "fixture-grant",
            matches: ["https://login.example.com/*", "https://www.mlh.com/*"],
            js: ["otp-content.js"],
            runAt: "document_idle",
          },
        ])
      })
      await context.route("https://login.example.com/**", async (route) => {
        const url = new URL(route.request().url())
        const response = await context.request.get(
          `http://localhost:4173${url.pathname}${url.search}`,
        )
        await route.fulfill({ response })
      })
      await context.route("https://www.mlh.com/**", async (route) => {
        const url = new URL(route.request().url())
        const response = await context.request.get(
          `http://localhost:4173${url.pathname}${url.search}`,
        )
        await route.fulfill({ response })
      })
      await use({ context, worker, id: new URL(worker.url()).hostname })
    } finally {
      await context.close()
    }
  },
})

async function inbox(worker: Worker, config: InboxConfig) {
  await worker.evaluate((settings) => {
    let searches = 0
    const prefix = settings.generation ? `m${settings.generation}-` : ""
    chrome.identity.getAuthToken = async () => ({
      token: "fixture-token",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    })
    chrome.identity.removeCachedAuthToken = async () => undefined
    chrome.identity.clearAllCachedAuthTokens = async () => undefined
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (
        !url.startsWith("https://gmail.googleapis.com/") &&
        !url.startsWith("https://oauth2.googleapis.com/")
      )
        throw new Error("Unexpected network request in test")
      if (settings.delay)
        await new Promise((resolve) => setTimeout(resolve, settings.delay))
      if (init?.signal?.aborted)
        throw new DOMException("Cancelled", "AbortError")
      if (settings.revoked) return new Response("{}", { status: 401 })
      if (url.includes("/revoke")) return new Response("{}", { status: 200 })
      if (url.includes("/profile"))
        return new Response(
          JSON.stringify({ emailAddress: "test@example.com" }),
        )
      if (url.includes("/messages?")) {
        searches++
        if (settings.temporaryFirst && searches === 1)
          return new Response("{}", { status: 503 })
        return new Response(
          JSON.stringify({
            messages:
              settings.emptyFirst && searches === 1
                ? []
                : settings.codes.map((_, index) => ({
                    id: `${prefix}message${index}`,
                  })),
          }),
        )
      }
      const index = Number(url.match(/messages\/(?:m\d+-)?message(\d+)/)?.[1])
      const code = settings.codes[index]
      return new Response(
        JSON.stringify({
          id: `${prefix}message${index}`,
          internalDate: String(Date.now() - (settings.expired ? 240_000 : 0)),
          payload: {
            mimeType: "text/plain",
            headers: [
              {
                name: "From",
                value:
                  settings.sender ?? "Example <verify@accounts.example.com>",
              },
              {
                name: "Subject",
                value: settings.subject ?? "Your verification code",
              },
              { name: "Delivered-To", value: "test@example.com" },
              ...(settings.authenticated
                ? [
                    {
                      name: "Authentication-Results",
                      value: `mx.google.com; dmarc=pass header.from=${settings.authenticationDomain ?? "provider.test"}`,
                    },
                  ]
                : []),
            ],
            body: {
              data: btoa(settings.body ?? `Your verification code: ${code}.`)
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, ""),
            },
          },
        }),
      )
    }
  }, config)
}

test("fills React state and leaves submission and unrelated inputs untouched", async ({
  extension,
}, testInfo) => {
  await inbox(extension.worker, { codes: ["482193"] })
  const page = await extension.context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("https://login.example.com/")
  await expect
    .poll(async () =>
      extension.worker.evaluate(async () =>
        JSON.stringify(await chrome.storage.session.get(null)),
      ),
    )
    .toContain("filled")
  await expect(page.getByLabel("Email verification code")).toHaveValue("482193")
  await expect(page.getByLabel("React state")).toHaveText("React state: 482193")
  await expect(
    page.getByRole("status", { name: "Verification result" }),
  ).toHaveText("Waiting for manual submission")
  await expect(page.getByPlaceholder("Must stay untouched")).toHaveValue("")
  const storage = await extension.worker.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
  }))
  expect(JSON.stringify(storage)).not.toMatch(
    /482193|fixture-token|Your verification code/,
  )
  expect(errors).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath("filled-form.png"),
    fullPage: true,
  })
})

for (const scenario of [
  { kind: "split", code: "042193", result: "042193" },
  { kind: "indexed", code: "289217", result: "289217" },
  { kind: "alpha", code: "UCSIAGUBQQ", result: "UCSIAGUBQQ" },
  { kind: "alpha", code: "aB7xQ9Kp2Z", result: "aB7xQ9Kp2Z" },
  { kind: "single", code: "482 193", result: "482193" },
]) {
  test(`fills ${scenario.kind} with ${scenario.code}`, async ({
    extension,
  }) => {
    await inbox(extension.worker, { codes: [scenario.code] })
    const page = await extension.context.newPage()
    await page.goto(`https://login.example.com/?scenario=${scenario.kind}`)
    await expect(page.getByLabel("React state")).toHaveText(
      `React state: ${scenario.result}`,
      { timeout: 15_000 },
    )
    await expect(
      page.getByRole("status", { name: "Verification result" }),
    ).toHaveText("Waiting for manual submission")
  })
}

test("fills MLH-style indexed fields from an authenticated sibling domain", async ({
  extension,
}) => {
  await inbox(extension.worker, {
    codes: ["289217"],
    sender: "Major League Hacking <notifications@mlh.io>",
    subject: "Verify Your Identity | Major League Hacking",
    body: "Here's your one-time code to sign into your account: 289217. Sign in using https://transactional.mlh.io/sign-in",
    authenticated: true,
    authenticationDomain: "mlh.io",
  })
  const page = await extension.context.newPage()
  await page.goto(
    "https://www.mlh.com/?scenario=indexed&recipient=test@example.com",
  )
  await expect
    .poll(async () =>
      extension.worker.evaluate(async () =>
        JSON.stringify(await chrome.storage.session.get(null)),
      ),
    )
    .toContain("filled")
  await expect(page.getByLabel("React state")).toHaveText(
    "React state: 289217",
    { timeout: 15_000 },
  )
})

test("detects a form mounted after page load", async ({ extension }) => {
  await inbox(extension.worker, { codes: ["482193"] })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/?scenario=dynamic")
  await page.getByRole("button", { name: "Request code" }).click()
  await expect(page.getByLabel("React state")).toHaveText(
    "React state: 482193",
    { timeout: 15_000 },
  )
})

test("confirms and completes an email verification link in a new tab", async ({
  extension,
}) => {
  await inbox(extension.worker, {
    codes: ["link"],
    body: "Verify your email at https://login.example.com/verify-email?token=fixture",
  })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/?scenario=link")
  await expect(page.locator("#otp-autofill-link-prompt")).toBeAttached({
    timeout: 15_000,
  })
  const verificationPagePromise = extension.context.waitForEvent("page")
  await page.keyboard.press("Enter")
  const verificationPage = await verificationPagePromise
  await expect(verificationPage).toHaveURL(
    "https://login.example.com/verify-email?token=fixture",
  )
  await expect
    .poll(
      async () =>
        extension.worker.evaluate(async () =>
          JSON.stringify(await chrome.storage.session.get(null)),
        ),
      { timeout: 15_000 },
    )
    .toContain('"state":"completed"')
  await expect(verificationPage.getByText("verified successfully")).toBeVisible(
    { timeout: 15_000 },
  )
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible({
    timeout: 15_000,
  })
})

test("does not open a verification link when the user declines", async ({
  extension,
}) => {
  await inbox(extension.worker, {
    codes: ["link"],
    body: "Verify your email at https://login.example.com/verify-email?token=fixture",
  })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/?scenario=link")
  await expect(page.locator("#otp-autofill-link-prompt")).toBeAttached({
    timeout: 15_000,
  })
  const pages = extension.context.pages().length
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Enter")
  await expect(page.locator("#otp-autofill-link-prompt")).toHaveCount(0)
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  expect(extension.context.pages()).toHaveLength(pages)
})

test("waits for a delayed email and recovers from a temporary Gmail error", async ({
  extension,
}) => {
  await inbox(extension.worker, { codes: ["482193"], temporaryFirst: true })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/")
  await expect(page.getByLabel("Email verification code")).toHaveValue(
    "482193",
    { timeout: 20_000 },
  )
})

for (const scenario of [
  { name: "ambiguous", config: { codes: ["482193", "987654"] } },
  {
    name: "unrelated sender",
    config: { codes: ["482193"], sender: "verify@evil.test" },
  },
  { name: "expired email", config: { codes: ["482193"], expired: true } },
  {
    name: "revoked Gmail authorization",
    config: { codes: ["482193"], revoked: true },
  },
]) {
  test(`abstains for ${scenario.name}`, async ({ extension }) => {
    await inbox(extension.worker, scenario.config)
    const page = await extension.context.newPage()
    await page.goto("https://login.example.com/")
    await expect
      .poll(async () =>
        extension.worker.evaluate(async () =>
          JSON.stringify(await chrome.storage.session.get(null)),
        ),
      )
      .toContain(
        scenario.name === "ambiguous"
          ? "ambiguous"
          : scenario.config.revoked
            ? "permission_required"
            : "waiting",
      )
    await expect(page.getByLabel("Email verification code")).toHaveValue("")
  })
}

test("preserves user typing while email retrieval is in flight", async ({
  extension,
}) => {
  await inbox(extension.worker, { codes: ["482193"], delay: 1_000 })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/")
  await page.getByLabel("Email verification code").fill("12")
  await expect
    .poll(async () =>
      extension.worker.evaluate(async () =>
        JSON.stringify(await chrome.storage.session.get(null)),
      ),
    )
    .toContain("cancelled")
  await expect(page.getByLabel("Email verification code")).toHaveValue("12")
})

test("stops stale retrieval when navigation removes the verification form", async ({
  extension,
}) => {
  await inbox(extension.worker, { codes: ["482193"], delay: 1_000 })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/")
  await page.getByLabel("Form scenario").selectOption("negative")
  await expect
    .poll(async () =>
      extension.worker.evaluate(async () =>
        JSON.stringify(await chrome.storage.session.get(null)),
      ),
    )
    .toContain("cancelled")
  await expect(page.getByLabel("Phone number")).toHaveValue("")
  await expect(page.getByLabel("Card security code")).toHaveValue("")
})

test("renders popup and settings without runtime errors", async ({
  extension,
}, testInfo) => {
  await inbox(extension.worker, { codes: [] })
  const page = await extension.context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`chrome-extension://${extension.id}/popup.html`)
  await expect(page.getByRole("heading", { name: "Gmail" })).toBeVisible()
  await expect(page.getByText("Connected · read-only access")).toBeVisible()
  await page.setViewportSize({ width: 390, height: 800 })
  await expect(page.locator("footer")).toContainText("Version")
  await page
    .locator("footer")
    .screenshot({ path: testInfo.outputPath("popup-version.png") })
  await page.screenshot({
    path: testInfo.outputPath("popup.png"),
    fullPage: true,
  })
  await page.goto(`chrome-extension://${extension.id}/options.html`)
  await expect(
    page.getByRole("heading", { name: "Approved sites" }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Disconnect Gmail & revoke access" })
    .click()
  await expect(
    page.getByText("Gmail is disconnected.", { exact: false }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("settings.png"),
    fullPage: true,
  })
  expect(errors).toEqual([])
})

test("resumes on return to a tab after automatic fill is toggled elsewhere", async ({
  extension,
}) => {
  await inbox(extension.worker, { codes: [] })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/")
  await expect
    .poll(
      async () =>
        extension.worker.evaluate(async () =>
          JSON.stringify(await chrome.storage.session.get(null)),
        ),
      { timeout: 15_000 },
    )
    .toContain("waiting")
  const popup = await extension.context.newPage()
  await popup.goto(`chrome-extension://${extension.id}/popup.html`)
  const toggle = popup.getByRole("switch", { name: "Automatic fill" })
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await inbox(extension.worker, { codes: ["482193"] })
  await page.bringToFront()
  await expect(page.getByLabel("Email verification code")).toHaveValue(
    "482193",
    { timeout: 15_000 },
  )
})

test("waits for an email that is absent from the first discovery", async ({
  extension,
}) => {
  await inbox(extension.worker, { codes: ["482193"], emptyFirst: true })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/")
  await expect(page.getByLabel("Email verification code")).toHaveValue(
    "482193",
    { timeout: 15_000 },
  )
})

base(
  "production build without OAuth installs and explains setup",
  async ({ playwright }, testInfo) => {
    const directory = path.resolve("build/chrome-mv3-prod")
    const manifest = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    )
    const context = await playwright.chromium.launchPersistentContext(
      testInfo.outputPath("profile"),
      {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${directory}`,
          `--load-extension=${directory}`,
        ],
      },
    )
    try {
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"))
      const id = new URL(worker.url()).hostname
      const page = await context.newPage()
      await page.goto(`chrome-extension://${id}/popup.html`)
      if (!manifest.oauth2) {
        await expect(
          page.getByText("Google OAuth setup is required for this build.", {
            exact: false,
          }),
        ).toBeVisible()
        await expect(
          page.getByRole("button", { name: "Connect with Google" }),
        ).toBeDisabled()
        await page.goto(`chrome-extension://${id}/options.html`)
        await expect(
          page.getByRole("heading", { name: "Finish Google OAuth setup" }),
        ).toBeVisible()
      } else {
        await expect(
          page.getByRole("button", { name: "Connect with Google" }),
        ).toBeEnabled()
      }
    } finally {
      await context.close()
    }
  },
)

for (const { recipient, partial } of [
  { recipient: "alice@gmail.com", partial: false },
  { recipient: "", partial: false },
  { recipient: "alice@gmail.com", partial: true },
]) {
  test(`searches separately authorized companion inboxes with recipient ${recipient || "unknown"}, incomplete ${partial}`, async ({
    extension,
  }) => {
    let account = 0
    const request: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith("/token"))
        return new Response(
          JSON.stringify({
            access_token: `fixture-account-${++account}`,
            refresh_token: `fixture-refresh-${account}`,
            scope: GMAIL_SCOPE,
            expires_in: 3600,
          }),
        )
      if (url.endsWith("/revoke")) return new Response("{}")
      const token = new Headers(init?.headers).get("Authorization")
      const alice = token === "Bearer fixture-account-1"
      if (url.includes("/profile"))
        return new Response(
          JSON.stringify({
            emailAddress: alice ? "alice@gmail.com" : "bob@gmail.com",
          }),
        )
      if (url.includes("/messages?") && partial && !alice)
        return new Response("{}", { status: 403 })
      if (url.includes("/messages?"))
        return new Response(JSON.stringify({ messages: [{ id: "one" }] }))
      if (url.includes("/messages/one"))
        return new Response(
          JSON.stringify({
            id: "one",
            internalDate: String(Date.now()),
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "From", value: "verify@provider.test" },
                {
                  name: "Delivered-To",
                  value: alice ? "alice@gmail.com" : "bob@gmail.com",
                },
                {
                  name: "Authentication-Results",
                  value: "mx.google.com; dmarc=pass header.from=provider.test",
                },
                { name: "Subject", value: "Your verification code" },
              ],
              body: {
                data: Buffer.from(
                  `Verification code: ${alice ? "482193" : "987654"}. Continue at https://login.example.com`,
                ).toString("base64url"),
              },
            },
          }),
        )
      throw new Error("Unexpected provider request")
    }
    const service = await startCompanion({
      clientId: "desktop.apps.googleusercontent.com",
      extensionId: extension.id,
      port: 0,
      request,
    })
    const rpc = async (operation: string, session: string) => {
      const response = await fetch(`http://127.0.0.1:${service.port}/rpc`, {
        method: "POST",
        headers: {
          Origin: `chrome-extension://${extension.id}`,
          "Content-Type": "application/json",
          Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify({ operation }),
      })
      return (await response.json()) as { url?: string }
    }
    try {
      const response = await fetch(`http://127.0.0.1:${service.port}/pair`, {
        method: "POST",
        headers: {
          Origin: `chrome-extension://${extension.id}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
      const { session } = (await response.json()) as { session: string }
      for (let index = 0; index < 2; index++) {
        const authorization = await rpc("authorize", session)
        const url = new URL(authorization.url ?? "")
        const callback = new URL(url.searchParams.get("redirect_uri") ?? "")
        callback.search = new URLSearchParams({
          state: url.searchParams.get("state") ?? "",
          code: "fixture-code",
        }).toString()
        expect((await fetch(callback)).ok).toBe(true)
      }
      await extension.worker.evaluate(async (port) => {
        const request = globalThis.fetch
        globalThis.fetch = (input, init) =>
          request(
            typeof input === "string"
              ? input.replace(
                  "http://127.0.0.1:43127/",
                  `http://127.0.0.1:${port}/`,
                )
              : input,
            init,
          )
        await chrome.storage.local.set({
          settings: {
            connected: false,
            companionEnabled: true,
            autofill: true,
            pressEnter: false,
          },
        })
      }, service.port)
      const page = await extension.context.newPage()
      await page.goto(
        `https://login.example.com/?recipient=${encodeURIComponent(recipient)}`,
      )
      if (recipient && !partial)
        await expect(page.getByLabel("Email verification code")).toHaveValue(
          "482193",
          { timeout: 15_000 },
        )
      else {
        await expect
          .poll(
            async () =>
              extension.worker.evaluate(async () =>
                JSON.stringify(await chrome.storage.session.get(null)),
              ),
            { timeout: 15_000 },
          )
          .toContain("ambiguous")
        await expect(page.getByLabel("Email verification code")).toHaveValue("")
        if (partial)
          await expect
            .poll(() =>
              extension.worker.evaluate(async () =>
                JSON.stringify(await chrome.storage.session.get(null)),
              ),
            )
            .toContain("An inbox could not be searched")
      }
      const state = await extension.worker.evaluate(async () =>
        JSON.stringify(await chrome.storage.session.get(null)),
      )
      expect(state).not.toMatch(/fixture-account|fixture-refresh|482193|987654/)
    } finally {
      await service.close()
    }
  })
}

test("starts a strict resend request and refuses a delayed duplicate of the filled code", async ({
  extension,
}) => {
  await inbox(extension.worker, { codes: ["482193"] })
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/")
  await expect(page.getByLabel("Email verification code")).toHaveValue("482193")
  await inbox(extension.worker, { codes: ["987654"], generation: 1 })
  await page.getByRole("button", { name: "Resend code" }).click()
  await expect(page.getByLabel("Email verification code")).toHaveValue(
    "987654",
    { timeout: 15_000 },
  )
  await inbox(extension.worker, { codes: ["987654"], generation: 2 })
  await page.getByRole("button", { name: "Resend code" }).click()
  await expect
    .poll(
      async () =>
        extension.worker.evaluate(async () =>
          JSON.stringify(await chrome.storage.session.get(null)),
        ),
      { timeout: 15_000 },
    )
    .toContain("waiting")
  await expect(page.getByLabel("Email verification code")).toHaveValue("")
})

for (const authenticated of [true, false]) {
  test(`handles third-party sender automatically with authentication ${authenticated}`, async ({
    extension,
  }) => {
    await inbox(extension.worker, {
      codes: ["482193"],
      sender: "verify@provider.test",
      authenticated,
      body: "Verification code: 482193. Continue at https://login.example.com",
    })
    const page = await extension.context.newPage()
    await page.goto("https://login.example.com/")
    if (authenticated)
      await expect(page.getByLabel("Email verification code")).toHaveValue(
        "482193",
      )
    else {
      await expect
        .poll(async () =>
          extension.worker.evaluate(async () =>
            JSON.stringify(await chrome.storage.session.get(null)),
          ),
        )
        .toContain("Site association is incomplete")
      await expect(page.getByLabel("Email verification code")).toHaveValue("")
    }
  })
}

for (const pageName of ["popup", "options"]) {
  test(`handles an older worker snapshot in ${pageName} without crashing and recovers after reload`, async ({
    extension,
  }) => {
    const page = await extension.context.newPage()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => {
      Object.defineProperty(chrome.runtime, "sendMessage", {
        configurable: true,
        value: async () => ({
          configured: true,
          settings: {
            connected: true,
            autofill: true,
            revocationPending: false,
          },
          systemError: null,
          flow: null,
          allowed: false,
          origin: null,
          tabId: null,
          sites: [],
        }),
      })
    })
    await page.goto(`chrome-extension://${extension.id}/${pageName}.html`)
    await expect(page.getByRole("alert")).toContainText("out of sync")
    await expect(
      page.getByRole("heading", {
        name: pageName === "popup" ? "Gmail" : "Authorized inboxes",
      }),
    ).toBeVisible()
    await page.evaluate(() => {
      Object.defineProperty(chrome.runtime, "sendMessage", {
        configurable: true,
        value: async () => ({
          configured: true,
          settings: {
            connected: true,
            autofill: true,
            revocationPending: false,
          },
          systemError: null,
          flow: null,
          allowed: false,
          origin: null,
          tabId: null,
          sites: [],
          accounts: [],
          accountError: null,
        }),
      })
    })
    await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 7000 })
    expect(errors).toEqual([])
  })
}

for (const scenario of ["single", "split", "indexed"]) {
  test(`presses Enter once after filling ${scenario} when enabled`, async ({
    extension,
  }) => {
    await inbox(extension.worker, { codes: ["482193"] })
    await extension.worker.evaluate(async () => {
      await chrome.storage.local.set({
        settings: {
          connected: true,
          autofill: true,
          pressEnter: true,
          enterDelayMs: 150,
        },
      })
    })
    const page = await extension.context.newPage()
    await page.goto(`https://login.example.com/?scenario=${scenario}`)
    await expect(
      page.getByRole("status", { name: "Verification result" }),
    ).toContainText("Verification complete")
    await expect(page.getByLabel("React state")).toContainText("482193")
  })
}

test("settings control Enter and cancel a pending Enter without undoing the fill", async ({
  extension,
}) => {
  await inbox(extension.worker, { codes: ["482193"] })
  const settings = await extension.context.newPage()
  await settings.goto(`chrome-extension://${extension.id}/options.html`)
  await expect(
    settings.getByRole("heading", { name: "Automatic matching" }),
  ).toBeVisible()
  await expect(
    settings.getByRole("heading", { name: "Trusted third-party senders" }),
  ).toHaveCount(0)
  const toggle = settings.getByRole("switch", {
    name: "Press Enter after fill",
  })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await settings.getByLabel("Delay before Enter").selectOption("2000")
  await expect(toggle).toBeChecked()
  const page = await extension.context.newPage()
  await page.goto("https://login.example.com/")
  await expect(page.getByLabel("Email verification code")).toHaveValue("482193")
  await extension.worker.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        connected: true,
        autofill: true,
        pressEnter: false,
        enterDelayMs: 2000,
      },
    })
  })
  await page.waitForTimeout(2300)
  await expect(
    page.getByRole("status", { name: "Verification result" }),
  ).toContainText("Waiting for manual submission")
  await expect(page.getByLabel("Email verification code")).toHaveValue("482193")
})

for (const field of ["accounts", "sites", "flow"]) {
  test(`popup handles malformed ${field} without a render crash`, async ({
    extension,
  }) => {
    const page = await extension.context.newPage()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript((field) => {
      const snapshot: Record<string, unknown> = {
        configured: true,
        settings: { connected: true, autofill: true, revocationPending: false },
        systemError: null,
        flow: null,
        allowed: false,
        origin: null,
        tabId: null,
        sites: [],
        accounts: [],
        accountError: null,
      }
      snapshot[field] =
        field === "flow"
          ? {
              state: "ambiguous",
              id: "fixture",
              hostname: "example.com",
              startedAt: Date.now(),
              detail: "fixture",
            }
          : null
      Object.defineProperty(chrome.runtime, "sendMessage", {
        value: async () => snapshot,
      })
    }, field)
    await page.goto(`chrome-extension://${extension.id}/popup.html`)
    await expect(page.getByRole("alert")).toContainText("out of sync")
    await expect(page.getByRole("heading", { name: "Gmail" })).toBeVisible()
    await expect(
      page.getByRole("switch", { name: "Automatic fill" }),
    ).toBeDisabled()
    expect(errors).toEqual([])
  })
}
