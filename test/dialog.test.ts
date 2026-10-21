import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapLayer } from "@opencode/plugin/tui/context"
import { testRender } from "@opentui/solid"
import type { JSX } from "@opentui/solid"
import { mockData } from "./helpers.js"

test("built modal renders all tabs, refreshes, and releases its event listener and input mode", async () => {
  const path = "../dist/tui.js"
  const { default: plugin }: { default: Plugin.Definition } = await import(path)
  const { api, history } = mockData()
  const layers: KeymapLayer[] = []
  let render: (() => JSX.Element) | undefined
  let listener: ((event: { details: { data: { sessionID: string } } }) => void) | undefined
  let unsubscribed = false
  let popped = false
  let closed = false
  let requests = 0
  api.client.session.context = async () => { requests++; return history }
  const theme = {
    background: { base: "black", raised: { base: "black" } }, border: { base: "gray" },
    text: { base: "white", muted: "gray", action: { primary: { base: "cyan" } }, feedback: { success: { base: "green" }, warning: { base: "yellow" }, error: { base: "red" } } },
  }
  const cleanup = await plugin.setup({
    ...api,
    theme: { surface: () => theme },
    keymap: {
      layer: (factory: () => KeymapLayer) => layers.push(factory()),
      mode: { push: () => () => { popped = true } },
    },
    data: { ...api.data, listen: (fn: typeof listener) => { listener = fn; return () => { unsubscribed = true } } },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "session-1" }) },
      dialog: { show: (fn: () => JSX.Element) => { render = fn }, set: () => {}, clear: () => { closed = true } },
    },
  } as never)
  await layers[0]?.commands?.[0]?.run()
  const view = await testRender(() => render?.(), { width: 110, height: 42 })
  try {
    await view.waitForFrame((frame) => frame.includes("RECORDED INPUT"))
    const commands = layers[1]!.commands!
    const run = (id: string) => commands.find((command) => command.id?.endsWith(id))!.run()
    await run("tab.next")
    await view.waitForFrame((frame) => frame.includes("LARGEST RETAINED CONTRIBUTORS"))
    await run("tab.next")
    await view.waitForFrame((frame) => frame.includes("OBSERVABLE ENVIRONMENT") && frame.includes("tool: read"))
    view.resize(72, 36)
    await view.waitForFrame((frame) => frame.includes("OBSERVABLE ENVIRONMENT"))
    await run("refresh")
    expect(requests).toBeGreaterThanOrEqual(2)
    listener?.({ details: { data: { sessionID: "session-1" } } })
    await Bun.sleep(150)
    await view.flush()
    expect(requests).toBeGreaterThanOrEqual(3)
    await run("close")
    expect(closed).toBe(true)
  } finally {
    await view.dispose()
    await cleanup?.()
  }
  expect(unsubscribed).toBe(true)
  expect(popped).toBe(true)
})
