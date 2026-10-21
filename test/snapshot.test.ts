import { describe, expect, test } from "bun:test"
import type { ModelInfo, ProviderInfo, SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client"
import { buildSnapshot, estimateTokens } from "../src/snapshot.js"

export const user: SessionMessageUser = {
  id: "user-1", type: "user", time: { created: 1 }, text: "a".repeat(200),
}
export const assistant: SessionMessageAssistant = {
  id: "assistant-1", type: "assistant", time: { created: 2 }, agent: "build",
  model: { providerID: "provider", id: "model" },
  tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 300, write: 40 } },
  content: [
    { type: "reasoning", text: "b".repeat(40) },
    { type: "tool", id: "tool-1", name: "read", time: { created: 2 },
      state: { status: "completed", input: {}, content: [{ type: "text", text: "c".repeat(80) }] } },
  ],
}
export const providers: ProviderInfo[] = [{ id: "provider", name: "Provider", activation: "enabled", package: "example" }]
export const models: ModelInfo[] = [{
  id: "model", modelID: "upstream-model", providerID: "provider", name: "Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [], time: { released: 0 }, cost: [], status: "active", enabled: true,
  limit: { context: 1_000, output: 100 },
}]

describe("buildSnapshot", () => {
  test("separates recorded usage from estimated retained content", () => {
    const compaction: SessionMessageInfo = {
      id: "compact-1", type: "compaction", time: { created: 3 }, status: "completed", reason: "auto", summary: "summary",
    }
    const snapshot = buildSnapshot({
      sessionID: "session-1", messages: [user, assistant, assistant, compaction],
      retainedMessages: [user, assistant], providers, models, capturedAt: new Date("2026-01-01T00:00:00Z"),
    })
    expect(snapshot.usage).toEqual({ input: 100, cacheRead: 300, cacheWrite: 40, output: 20, reasoning: 5 })
    expect(snapshot.messageCount).toEqual({ user: 1, assistant: 1 })
    expect(snapshot.toolCalls).toBe(1)
    expect(snapshot.compaction).toEqual({ count: 1, latestBoundary: "compact-1" })
    expect(snapshot.retained.estimatedTokens).toBe(80)
    expect(snapshot.retained.contributors.map((item) => item.category)).toEqual(["user", "tool", "reasoning"])
    expect(snapshot.utilization).toBe(0.08)
    expect(snapshot.cacheEfficiency).toBe(0.75)
    expect(snapshot.usageProvenance).toBe("recorded")
    expect(snapshot.retained.provenance).toBe("estimated")
    expect(snapshot.model?.modelName).toBe("Model")
  })

  test("returns unavailable utilization when model metadata is absent", () => {
    const snapshot = buildSnapshot({ sessionID: "session-1", messages: [user], providers: [] })
    expect(snapshot.utilization).toBeUndefined()
    expect(snapshot.utilizationProvenance).toBe("unavailable")
  })

  test("handles streaming usage, errors, attachments, and checkpoint summaries", () => {
    const messages: SessionMessageInfo[] = [
      { ...user, files: [{ data: "secret-base64-not-counted", mime: "text/plain", name: "note.txt", source: { type: "uri", uri: "file:///note.txt" } }] },
      { ...assistant, tokens: undefined, content: [
        { type: "text", text: "hello" },
        { type: "tool", id: "failed", name: "shell", time: { created: 2 }, state: { status: "error", input: {}, error: { type: "failure", message: "Oops" } } },
        { type: "tool", id: "file", name: "read", time: { created: 2 }, state: { status: "completed", input: {}, content: [{ type: "file", mime: "image/png", uri: "file:///image.png", name: "image.png" }] } },
        { type: "tool", id: "pending", name: "read", time: { created: 2 }, state: { status: "running", input: {}, metadata: {} } },
      ] },
      { id: "checkpoint", type: "compaction", status: "completed", reason: "manual", summary: "kept summary", time: { created: 3 } },
      { id: "failed-compaction", type: "compaction", status: "failed", reason: "auto", error: { type: "failure", message: "Oops" }, time: { created: 4 } },
    ]
    const snapshot = buildSnapshot({ messages, providers, models })
    expect(snapshot.usage.input).toBe(0)
    expect(snapshot.toolCalls).toBe(3)
    expect(snapshot.compaction.count).toBe(1)
    expect(snapshot.retained.contributors.filter((row) => row.category === "file")).toHaveLength(2)
    expect(snapshot.retained.contributors.find((row) => row.label === "Tool output: shell")?.characters).toBe(4)
    expect(snapshot.retained.contributors.find((row) => row.label === "Compaction summary")?.characters).toBe(12)
  })

  test("excludes old history from retained counts and uses the selected model", () => {
    const snapshot = buildSnapshot({ messages: [user, assistant], retainedMessages: [], providers, models, model: { providerID: "provider", id: "new-model" } })
    expect(snapshot.retained.estimatedTokens).toBe(0)
    expect(snapshot.usage.input).toBe(100)
    expect(snapshot.model?.modelID).toBe("new-model")
  })

  test("reads V2 configuration and runtime environment catalogs", () => {
    const snapshot = buildSnapshot({
      messages: [], providers: [],
      config: { instructions: ["AGENTS.md"], agents: { reviewer: { description: "old" } }, skills: ["./skills"] },
      agents: [{ id: "reviewer", description: "Review" }], skills: [{ id: "test", description: "Testing" }],
      mcp: [{ name: "docs", status: { status: "connected" } }, { name: "auth", status: { status: "needs_auth", error: "Sign in" } }],
      tools: [{ id: "read", description: "Read a file" }],
    })
    expect(snapshot.environment).toContainEqual({ category: "instruction", name: "AGENTS.md" })
    expect(snapshot.environment).toContainEqual({ category: "agent", name: "reviewer", detail: "Review" })
    expect(snapshot.environment).toContainEqual({ category: "skill", name: "test", detail: "Testing" })
    expect(snapshot.environment).toContainEqual({ category: "mcp", name: "auth", detail: "Sign in" })
    expect(snapshot.environment).toContainEqual({ category: "tool", name: "read", detail: "Read a file" })
  })
})

test("token approximation is explicit and stable", () => {
  expect(estimateTokens("")).toBe(0)
  expect(estimateTokens("12345")).toBe(2)
})
