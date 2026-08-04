import { expect, test } from "bun:test"

test("published TUI output uses the reactive OpenTUI Solid transform", async () => {
  const output = await Bun.file("dist/tui.js").text()

  expect(output).toContain('from "@opentui/solid"')
  expect(output).toContain("get value()")
  expect(output).toContain('_$setProp(_el$, "maxWidth", "100%")')
  expect(output).toContain('_$setProp(_el$, "overflow", "hidden")')
  expect(output).not.toContain("props.api.ui.Dialog")
  expect(output).not.toContain('from "@opentui/solid/jsx-runtime"')
})
