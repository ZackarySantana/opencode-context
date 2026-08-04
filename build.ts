import solidPlugin from "@opentui/solid/bun-plugin"
import { rm } from "node:fs/promises"

await rm("dist", { recursive: true, force: true })

const declarations = Bun.spawn(["bunx", "tsc", "-p", "tsconfig.build.json"], {
  stdout: "inherit",
  stderr: "inherit",
})

const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  splitting: true,
  sourcemap: "external",
  packages: "external",
  plugins: [solidPlugin],
  naming: {
    entry: "[name].js",
    chunk: "chunks/[name]-[hash].[ext]",
  },
})

const declarationExit = await declarations.exited
if (declarationExit !== 0 || !result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
