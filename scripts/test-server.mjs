import { createServer } from "node:http"
import { readFile } from "node:fs/promises"

import { build } from "esbuild"

const result = await build({
  entryPoints: ["test-site/main.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
})
const app = result.outputFiles[0]?.contents
if (!app) throw new Error("Test site failed to build")
const html = await readFile("test-site/index.html")
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store")
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'",
  )
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "text/javascript")
    response.end(app)
  } else if (
    request.url === "/" ||
    request.url?.startsWith("/?") ||
    request.url?.startsWith("/verify-email?")
  ) {
    response.setHeader("Content-Type", "text/html")
    response.end(html)
  } else {
    response.statusCode = 404
    response.end("Not found")
  }
})
server.listen(4173, "127.0.0.1", () =>
  process.stdout.write("OTP form laboratory: http://localhost:4173\n"),
)
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)))
