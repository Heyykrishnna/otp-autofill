import { spawn } from "node:child_process"
import { watch } from "node:fs"

let building = false
let pending = false
let debounce
function rebuild() {
  if (building) {
    pending = true
    return
  }
  building = true
  const child = spawn("npm", ["run", "build"], { stdio: "inherit" })
  child.on("exit", (code) => {
    building = false
    process.stdout.write(
      code === 0
        ? "Reload the extension in chrome://extensions to use this build.\n"
        : "Build failed. Waiting for changes.\n",
    )
    if (pending) {
      pending = false
      rebuild()
    }
  })
}
function schedule() {
  clearTimeout(debounce)
  debounce = setTimeout(rebuild, 300)
}
watch("src", { recursive: true }, schedule)
watch("assets", { recursive: true }, schedule)
watch("scripts", { recursive: true }, schedule)
watch(".", (_, filename) => {
  if (
    filename &&
    /^(?:\.env.*|package\.json|(?:manifest|postcss)\.config\.mjs|vite\.config\.ts|tsconfig\.json|(?:popup|options)\.html)$/.test(
      filename,
    )
  )
    schedule()
})
rebuild()
