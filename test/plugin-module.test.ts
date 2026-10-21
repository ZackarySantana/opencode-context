import { expect, test } from "bun:test"
import type { KeymapLayer } from "@opencode/plugin/tui/context"
import tuiPlugin, { currentSessionID } from "../src/tui.js"
import serverPlugin from "../src/index.js"
import { ContextRpc } from "../src/rpc.js"

test("uses the published package name as its V2 plugin ID", () => {
  expect(tuiPlugin.id).toBe("opencode-context-tui")
  expect(serverPlugin.id).toBe(tuiPlugin.id)
  expect("tui" in tuiPlugin).toBe(false)
})

test("registers native /context without a route and cleans up its own dialog", async () => {
  const layers: KeymapLayer[] = []
  let closeDialog: (() => void) | undefined
  const calls: string[] = []
  const api = {
    keymap: { layer: (factory: () => KeymapLayer) => layers.push(factory()) },
    ui: {
      router: { current: () => ({ type: "home" }) },
      dialog: {
        set: ({ size }: { size: string }) => { calls.push(`size:${size}`) },
        show: (_render: () => unknown, onClose?: () => void) => { closeDialog = onClose; calls.push("show") },
        clear: () => { calls.push("clear"); closeDialog?.() },
      },
    },
  }
  const dispose = await tuiPlugin.setup(api as never)
  const command = layers.flatMap((layer) => layer.commands ?? []).find((item) => item.slash?.name === "context")
  expect(command?.palette).toBe(true)
  expect(layers).toHaveLength(1)
  await command?.run()
  expect(calls).toEqual(["show", "size:large"])
  await dispose?.()
  expect(calls).toEqual(["show", "size:large", "clear"])
})

test("does not close another plugin's dialog on unload", async () => {
  let command: KeymapLayer["commands"]
  let onClose: (() => void) | undefined
  let cleared = false
  const dispose = await tuiPlugin.setup({
    keymap: { layer: (factory: () => KeymapLayer) => { command = factory().commands } },
    ui: {
      router: { current: () => ({ type: "home" }) },
      dialog: { show: (_render: unknown, close: () => void) => { onClose = close }, set: () => {}, clear: () => { cleared = true } },
    },
  } as never)
  await command?.[0]?.run()
  onClose?.()
  await dispose?.()
  expect(cleared).toBe(false)
})

test("reads the active session from the V2 router", () => {
  expect(currentSessionID({ ui: { router: { current: () => ({ type: "session", sessionID: "session-1" }) } } } as never)).toBe("session-1")
  expect(currentSessionID({ ui: { router: { current: () => ({ type: "home" }) } } } as never)).toBeUndefined()
})

test("server registers a read-only tool catalog RPC", async () => {
  let tools: (() => Promise<unknown>) | undefined
  await serverPlugin.setup({
    rpc: { register: async (definition: unknown, handlers: { tools: () => Promise<unknown> }) => {
      expect(definition).toBe(ContextRpc)
      tools = handlers.tools
    } },
    tool: { list: async () => [{ id: "read", description: "Read", execute: () => {}, input: {} }] },
  } as never)
  expect(await tools?.()).toEqual([{ id: "read", description: "Read" }])
})
