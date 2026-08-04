import { expect, test } from "bun:test"
import tuiPlugin from "../src/tui.js"

test("registers native /context without a route", async () => {
  const layers: Array<{ commands?: Array<Record<string, unknown>>; mode?: string; enabled?: () => boolean }> = []
  const routes: unknown[] = []
  const disposers: Array<() => void | Promise<void>> = []
  let size: string | undefined
  let rendered = false
  let renderDialog: (() => unknown) | undefined
  let closeDialog: (() => void) | undefined
  const dialogCalls: string[] = []
  const api = {
    lifecycle: { onDispose: (fn: () => void | Promise<void>) => disposers.push(fn) },
    keymap: { registerLayer: (layer: { commands?: Array<Record<string, unknown>>; mode?: string; enabled?: () => boolean }) => layers.push(layer) },
    route: { current: { name: "home" }, register: (items: unknown[]) => routes.push(...items) },
    mode: { push: () => () => undefined },
    ui: {
      dialog: {
        open: false,
        setSize: (value: string) => { size = value; dialogCalls.push(`size:${value}`) },
        replace: (render: () => unknown, onClose?: () => void) => {
          rendered = true
          renderDialog = render
          closeDialog = onClose
          dialogCalls.push("replace")
        },
        clear: () => undefined,
      },
    },
  }

  await tuiPlugin.tui(api as never, {}, {} as never)
  const command = layers.flatMap((layer) => layer.commands ?? []).find((item) => item.slashName === "context")
  expect(command?.namespace).toBe("palette")
  expect(routes).toEqual([])
  const modalLayer = layers.find((layer) => layer.mode === "modal")
  expect(modalLayer).toBeDefined()
  expect(modalLayer?.enabled?.()).toBe(false)

  ;(command?.run as (() => void) | undefined)?.()
  expect(size).toBe("large")
  expect(rendered).toBe(true)
  expect(dialogCalls).toEqual(["replace", "size:large"])
  expect(typeof renderDialog).toBe("function")
  expect(typeof closeDialog).toBe("function")
  for (const dispose of disposers.reverse()) await dispose()
})
