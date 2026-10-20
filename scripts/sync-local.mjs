import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises"
import path from "node:path"

import { loadEnv } from "vite"

const project = await realpath(process.cwd())
const env = { ...loadEnv("production", project, ""), ...process.env }
assert.match(
  env.EXPECTED_EXTENSION_ID ?? "",
  /^[a-p]{32}$/,
  "Set EXPECTED_EXTENSION_ID to the ID shown in Chrome.",
)
assert.ok(
  env.LOCAL_EXTENSION_DIR,
  "Set LOCAL_EXTENSION_DIR to the already-loaded folder inside artifacts/.",
)
const artifacts = await realpath(path.join(project, "artifacts"))
const destination = await realpath(
  path.resolve(project, env.LOCAL_EXTENSION_DIR),
)
const relative = path.relative(artifacts, destination)
assert.ok(
  relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  "The local extension folder must be inside this project's artifacts directory.",
)
assert.equal(
  (
    await lstat(path.resolve(project, env.LOCAL_EXTENSION_DIR))
  ).isSymbolicLink(),
  false,
  "The installed folder must not be a symbolic link.",
)
const source = path.join(project, "build/chrome-mv3-prod")
const manifest = JSON.parse(
  await readFile(path.join(source, "manifest.json"), "utf8"),
)
const current = JSON.parse(
  await readFile(path.join(destination, "manifest.json"), "utf8"),
)
assert.equal(manifest.name, "OTP Autofill")
assert.equal(
  current.name,
  manifest.name,
  "The selected folder is not an OTP Autofill installation.",
)
assert.equal(manifest.manifest_version, 3)
const identity = manifest.key
  ? Buffer.from(manifest.key, "base64")
  : Buffer.from(destination)
const id = [...createHash("sha256").update(identity).digest("hex").slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
  .join("")
assert.equal(
  id,
  env.EXPECTED_EXTENSION_ID,
  "This update would change the Chrome extension ID. Check the folder and public key before continuing.",
)
const staging = await mkdtemp(path.join(artifacts, ".otp-stage-"))
await mkdir(path.join(artifacts, ".backups"), { recursive: true })
const backup = await mkdtemp(path.join(artifacts, ".backups", "otp-autofill-"))
const previous = path.join(backup, "previous")
let moved = false
try {
  await cp(source, staging, { recursive: true })
  await rename(destination, previous)
  moved = true
  await rename(staging, destination)
} catch (error) {
  if (moved) await rename(previous, destination)
  await rm(staging, { recursive: true, force: true })
  throw error
}
process.stdout.write(
  `Updated local extension: ${destination}\nVerified extension ID: ${id}\nPrevious installation preserved: ${previous}\nReload OTP Autofill in chrome://extensions to activate this build.\n`,
)
