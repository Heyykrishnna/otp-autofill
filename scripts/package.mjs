import { execFileSync } from "node:child_process"
import { mkdir, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve("build/chrome-mv3-prod")
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
)
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
  .sort()
if (files.some((file) => /(?:^|\/)\.env|\.map$/.test(file)))
  throw new Error("Private or debug artifacts must not be packaged.")
await mkdir("artifacts", { recursive: true })
const archive = path.resolve(`artifacts/otp-autofill-${manifest.version}.zip`)
await rm(archive, { force: true })
execFileSync("zip", ["-X", "-q", archive, ...files], { cwd: root })
process.stdout.write(`Packaged ${files.length} files: ${archive}\n`)
