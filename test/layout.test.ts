import { expect, test } from "bun:test"
import { narrowLayout } from "../src/tui.js"

test("uses stacked content for narrow terminals", () => {
  expect(narrowLayout(80)).toBe(true)
  expect(narrowLayout(119)).toBe(true)
  expect(narrowLayout(120)).toBe(false)
})
