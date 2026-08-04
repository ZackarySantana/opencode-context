import { expect, test } from "bun:test"
import { exportPayload, redact } from "../src/export.js"
import { buildSnapshot } from "../src/snapshot.js"

test("redacts likely secrets from exported metadata", () => {
  expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: [REDACTED]")
  expect(redact("api_key=super-secret-value")).toBe("[REDACTED]")

  const snapshot = buildSnapshot({
    sessionID: "session",
    messages: [],
    parts: () => [],
    providers: [],
    config: { instructions: ["api_key=super-secret-value"] },
  })
  expect(exportPayload(snapshot).environment[0]?.name).toBe("[REDACTED]")
})
