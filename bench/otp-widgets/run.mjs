import { build } from "esbuild"
import { chromium } from "playwright"

const only = process.argv[2]
const CODE = "482193"

const result = await build({
  entryPoints: [new URL("./widgets.tsx", import.meta.url).pathname],
  bundle: true,
  write: false,
  outdir: "out",
  format: "iife",
  jsx: "automatic",
  logLevel: "error",
  define: {
    "process.env.NODE_ENV": '"production"',
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
})
const file = (ext) =>
  result.outputFiles.find((output) => output.path.endsWith(ext))?.text ?? ""
const html = `<!doctype html><head><style>${file(".css")}</style></head><body></body><script>${file(".js").replace(/<\/script/g, "<\\/script")}</script>`

const timeout = (ms, value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))
const browser = await chromium.launch()
let names
{
  const page = await browser.newPage()
  await page.setContent(html)
  names = await page.evaluate(() => window.WIDGETS)
  await page.close()
}

let passed = 0
let total = 0
for (const name of names) {
  if (only && !name.includes(only)) continue
  total++
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  let detected = "error"
  let value
  try {
    await page.setContent(html)
    await page.evaluate((widget) => window.mountWidget(widget), name)
    await page.waitForTimeout(400)
    const fill = await Promise.race([
      page.evaluate((code) => window.runFill(code), CODE),
      timeout(4000, { shape: "page froze" }),
    ])
    detected = fill.shape
    await page.waitForTimeout(400)
    value = await Promise.race([
      page.evaluate(() => window.__value),
      timeout(2000, "page froze"),
    ])
  } catch (error) {
    errors.push(String(error.message).split("\n")[0])
  }
  const ok = name.startsWith("negative:")
    ? Array.isArray(detected) && detected.length === 0
    : value === CODE
  if (ok) passed++
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} detected=${JSON.stringify(detected)} value=${JSON.stringify(value)}${errors[0] ? `  error=${errors[0].slice(0, 80)}` : ""}`,
  )
  await page.close().catch(() => {})
}
console.log(`\n${passed}/${total} passed`)
await browser.close()
process.exit(passed === total ? 0 : 1)
