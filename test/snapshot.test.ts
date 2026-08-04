import { describe, expect, test } from "bun:test"
import type { Message, Part, Provider } from "@opencode-ai/sdk/v2"
import { buildSnapshot, estimateTokens } from "../src/snapshot.js"

const user: Message = {
  id: "user-1",
  sessionID: "session-1",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
}

const assistant: Message = {
  id: "assistant-1",
  sessionID: "session-1",
  role: "assistant",
  time: { created: 2 },
  parentID: "user-1",
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/work", root: "/work" },
  cost: 0,
  tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 300, write: 40 } },
}

const providers = [{
  id: "provider",
  name: "Provider",
  source: "custom",
  env: [],
  options: {},
  models: {
    model: {
      id: "model",
      providerID: "provider",
      name: "Model",
      family: "model",
      api: { id: "model", url: "https://example.com", npm: "provider" },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 1_000, output: 100 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
  },
}] satisfies Provider[]

describe("buildSnapshot", () => {
  test("separates recorded usage from estimated retained content", () => {
    const parts = new Map<string, Part[]>([
      ["user-1", [{ id: "text-1", sessionID: "session-1", messageID: "user-1", type: "text", text: "a".repeat(200) }]],
      ["assistant-1", [
        { id: "reason-1", sessionID: "session-1", messageID: "assistant-1", type: "reasoning", text: "b".repeat(40), time: { start: 2 } },
        { id: "tool-1", sessionID: "session-1", messageID: "assistant-1", type: "tool", callID: "call-1", tool: "read", state: { status: "completed", input: {}, output: "c".repeat(80), title: "Read", metadata: {}, time: { start: 2, end: 3 } } },
        { id: "compact-1", sessionID: "session-1", messageID: "assistant-1", type: "compaction", auto: true, tail_start_id: "user-1" },
      ]],
    ])
    const snapshot = buildSnapshot({
      sessionID: "session-1",
      messages: [user, assistant, assistant],
      parts: (id) => parts.get(id) ?? [],
      providers,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
    })

    expect(snapshot.usage).toEqual({ input: 100, cacheRead: 300, cacheWrite: 40, output: 20, reasoning: 5 })
    expect(snapshot.messageCount).toEqual({ user: 1, assistant: 1 })
    expect(snapshot.toolCalls).toBe(1)
    expect(snapshot.compaction).toEqual({ count: 1, latestBoundary: "user-1" })
    expect(snapshot.retained.estimatedTokens).toBe(80)
    expect(snapshot.retained.contributors.map((item) => item.category)).toEqual(["user", "tool", "reasoning"])
    expect(snapshot.utilization).toBe(0.08)
    expect(snapshot.cacheEfficiency).toBe(0.75)
    expect(snapshot.usageProvenance).toBe("recorded")
    expect(snapshot.retained.provenance).toBe("estimated")
  })

  test("returns unavailable utilization when model metadata is absent", () => {
    const snapshot = buildSnapshot({ sessionID: "session-1", messages: [user], parts: () => [], providers: [] })
    expect(snapshot.utilization).toBeUndefined()
    expect(snapshot.utilizationProvenance).toBe("unavailable")
  })
})

test("token approximation is explicit and stable", () => {
  expect(estimateTokens("")).toBe(0)
  expect(estimateTokens("12345")).toBe(2)
})
