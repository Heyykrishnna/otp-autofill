import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

const script = path.resolve("scripts/sync-local.mjs")
const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function installation() {
  const project = await realpath(
    await mkdtemp(path.join(tmpdir(), "otp-local-sync-")),
  )
  directories.push(project)
  const source = path.join(project, "build/chrome-mv3-prod")
  const destination = path.join(project, "artifacts/installed")
  await mkdir(source, { recursive: true })
  await mkdir(destination, { recursive: true })
  await writeFile(
    path.join(source, "manifest.json"),
    JSON.stringify({
      name: "OTP Autofill",
      manifest_version: 3,
      version: "0.1.0",
    }),
  )
  await writeFile(path.join(source, "popup.html"), "Updated popup")
  await writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify({
      name: "OTP Autofill",
      manifest_version: 3,
      version: "0.0.1",
    }),
  )
  await writeFile(
    path.join(destination, "user-note.txt"),
    "Preserve this original file",
  )
  const id = [
    ...createHash("sha256").update(destination).digest("hex").slice(0, 32),
  ]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join("")
  const env = {
    ...process.env,
    LOCAL_EXTENSION_DIR: destination,
    EXPECTED_EXTENSION_ID: id,
  }
  return { project, destination, env }
}

describe("local Chrome installation synchronization", () => {
  it("updates the existing path and preserves the complete old installation", async () => {
    const { project, destination, env } = await installation()
    const result = execFileSync(process.execPath, [script], {
      cwd: project,
      env,
      encoding: "utf8",
    })
    expect(result).toContain("Verified extension ID:")
    expect(await readFile(path.join(destination, "popup.html"), "utf8")).toBe(
      "Updated popup",
    )
    const backups = await readdir(path.join(project, "artifacts/.backups"))
    expect(backups).toHaveLength(1)
    expect(
      await readFile(
        path.join(
          project,
          "artifacts/.backups",
          backups[0] ?? "",
          "previous/user-note.txt",
        ),
        "utf8",
      ),
    ).toBe("Preserve this original file")
  })
  it("refuses an update that would change the expected extension ID", async () => {
    const { project, destination, env } = await installation()
    expect(() =>
      execFileSync(process.execPath, [script], {
        cwd: project,
        env: {
          ...env,
          EXPECTED_EXTENSION_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        stdio: "pipe",
      }),
    ).toThrow()
    expect(
      await readFile(path.join(destination, "user-note.txt"), "utf8"),
    ).toBe("Preserve this original file")
  })
  it("does not overwrite a different extension", async () => {
    const { project, destination, env } = await installation()
    await writeFile(
      path.join(destination, "manifest.json"),
      JSON.stringify({ name: "A different extension" }),
    )
    expect(() =>
      execFileSync(process.execPath, [script], {
        cwd: project,
        env,
        stdio: "pipe",
      }),
    ).toThrow()
    expect(
      await readFile(path.join(destination, "user-note.txt"), "utf8"),
    ).toBe("Preserve this original file")
  })
})
