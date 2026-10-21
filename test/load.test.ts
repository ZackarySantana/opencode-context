import { expect, test } from "bun:test"
import { loadSnapshot } from "../src/load.js"
import { mockData } from "./helpers.js"

test("loads V2 history pages, retained context, and catalogs at the session location", async () => {
  const { api, history, locations, location } = mockData()
  const cursors: Array<string | undefined> = []
  api.client.message.list = async ({ cursor }) => {
    cursors.push(cursor)
    return cursor ? { data: [{ ...history[0]!, id: "user-2" }], cursor: {} }
      : { data: history, cursor: { next: "page-2" } }
  }
  const snapshot = await loadSnapshot(api as never, "session-1")
  expect(cursors).toEqual([undefined, "page-2"])
  expect(snapshot.messageCount.user).toBe(2)
  expect(snapshot.retained.estimatedTokens).toBe(2)
  expect(snapshot.environment.map((item) => item.category)).toEqual(["agent", "instruction", "mcp", "skill", "tool"])
  expect(locations.length).toBeGreaterThan(0)
  expect(locations.every((value) => value === location)).toBe(true)
  expect(snapshot.limitations).toHaveLength(3)
})

test("falls back to synchronized data and reports API failures", async () => {
  const { api } = mockData()
  api.client.message.list = async () => { throw new Error("offline") }
  api.client.session.context = async () => { throw new Error("offline") }
  api.client.rpc = () => ({ tools: async () => { throw new Error("unavailable") } })
  const snapshot = await loadSnapshot(api as never, "session-1")
  expect(snapshot.messageCount.user).toBe(1)
  expect(snapshot.retained.estimatedTokens).toBe(2)
  expect(snapshot.limitations.join(" ")).toContain("Retained context unavailable")
  expect(snapshot.limitations.join(" ")).toContain("enable the server plugin")
})

test("does not issue requests without an active session", async () => {
  const snapshot = await loadSnapshot({} as never)
  expect(snapshot.available).toBe(false)
  expect(snapshot.retained.estimatedTokens).toBe(0)
})
