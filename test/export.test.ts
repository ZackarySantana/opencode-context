import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { exportPayload, exportStatePath, redact, writeSnapshot } from "../src/export.js"
import { buildSnapshot } from "../src/snapshot.js"

test("redacts likely secrets from exported metadata", () => {
  expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: [REDACTED]")
  expect(redact("api_key=super-secret-value")).toBe("[REDACTED]")

  const snapshot = buildSnapshot({
    sessionID: "session",
    messages: [],
    providers: [],
    config: { instructions: ["api_key=super-secret-value"] },
  })
  expect(exportPayload(snapshot).environment[0]?.name).toBe("[REDACTED]")
})

test("uses the terminal client's state directory for exports", () => {
  expect(exportStatePath({ XDG_STATE_HOME: "/custom/state" })).toBe("/custom/state/opencode")
  expect(exportStatePath({})).toBe(join(homedir(), ".local/state/opencode"))
})

test("writes a private redacted JSON snapshot without session text", async () => {
  const directory = await mkdtemp("/tmp/opencode/context-export-")
  try {
    const snapshot = buildSnapshot({
      sessionID: "session-1", providers: [], config: { instructions: ["api_key=super-secret-value"] },
      messages: [{ id: "user-1", type: "user", time: { created: 1 }, text: "private user content" }],
    })
    const path = await writeSnapshot(directory, snapshot)
    const text = await readFile(path, "utf8")
    expect(JSON.parse(text).environment[0].name).toBe("[REDACTED]")
    expect(text).not.toContain("private user content")
    expect(text).not.toContain("super-secret-value")
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
