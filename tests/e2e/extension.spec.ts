import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  expect,
  test as base,
  type BrowserContext,
  type Worker,
} from "@playwright/test"

interface InboxConfig {
  codes: string[]
  sender?: string
  delay?: number
  emptyFirst?: boolean
  expired?: boolean
  revoked?: boolean
  temporaryFirst?: boolean
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
    manifest.host_permissions.push("https://login.example.com/*")
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
            revocationPending: false,
          },
        })
        await chrome.scripting.registerContentScripts([
          {
            id: "fixture-grant",
            matches: ["https://login.example.com/*"],
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
      await use({ context, worker, id: new URL(worker.url()).hostname })
    } finally {
      await context.close()
    }
  },
})

async function inbox(worker: Worker, config: InboxConfig) {
  await worker.evaluate((settings) => {
    let searches = 0
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
                : settings.codes.map((_, index) => ({ id: `message${index}` })),
          }),
        )
      }
      const index = Number(url.match(/messages\/message(\d+)/)?.[1])
      const code = settings.codes[index]
      return new Response(
        JSON.stringify({
          id: `message${index}`,
          internalDate: String(Date.now() - (settings.expired ? 240_000 : 0)),
          payload: {
            mimeType: "text/plain",
            headers: [
              {
                name: "From",
                value:
                  settings.sender ?? "Example <verify@accounts.example.com>",
              },
              { name: "Subject", value: "Your verification code" },
            ],
            body: {
              data: btoa(`Your verification code: ${code}.`)
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
    .poll(async () =>
      extension.worker.evaluate(async () =>
        JSON.stringify(await chrome.storage.session.get(null)),
      ),
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
