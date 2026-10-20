import assert from "node:assert/strict"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { build } from "esbuild"
import { loadEnv } from "vite"

import { createManifest } from "../manifest.config.mjs"

const output = path.resolve("build/chrome-mv3-prod")
const manifestPath = path.join(output, "manifest.json")
const pkg = JSON.parse(await readFile("package.json", "utf8"))
const env = { ...loadEnv("production", process.cwd(), ""), ...process.env }
const manifest = createManifest({
  version: pkg.version,
  clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  publicKey: env.CRX_PUBLIC_KEY,
})
assert.equal(manifest.manifest_version, 3)
assert.equal(manifest.content_scripts, undefined)
assert.equal(manifest.externally_connectable, undefined)
assert.equal(manifest.host_permissions.includes("<all_urls>"), false)
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
await mkdir(path.join(output, "icons"), { recursive: true })
for (const size of [16, 32, 48, 128])
  await copyFile(
    `assets/icon-${size}.png`,
    path.join(output, `icons/${size}.png`),
  )
await build({
  entryPoints: ["src/content/index.ts"],
  bundle: true,
  outfile: path.join(output, "otp-content.js"),
  format: "iife",
  target: "chrome120",
  minify: true,
  legalComments: "none",
})
await build({
  entryPoints: ["src/background.ts"],
  bundle: true,
  outfile: path.join(output, "background.js"),
  format: "esm",
  target: "chrome120",
  minify: true,
  legalComments: "none",
})
process.stdout.write(
  `Extension built at ${output}\nGoogle OAuth: ${manifest.oauth2 ? "configured" : "not configured; Gmail connection is disabled"}\n`,
)
