import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import { build } from "esbuild"
import { loadEnv } from "vite"

const directory = path.resolve("artifacts/companion")
await mkdir(directory, { recursive: true })
const entry = path.join(directory, "main.mjs")
await build({
  entryPoints: ["src/companion/main.ts"],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
})
const env = { ...loadEnv("production", process.cwd(), ""), ...process.env }
const child = spawn(process.execPath, [entry], { stdio: "inherit", env })
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal))
child.on("exit", (code) => process.exit(code ?? 1))
