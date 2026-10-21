import { Plugin } from "@opencode/plugin"
import { ContextRpc } from "./rpc.js"

export default Plugin.define({
  id: "opencode-context-tui",
  async setup(ctx) {
    await ctx.rpc.register(ContextRpc, {
      tools: async () => (await ctx.tool.list()).map(({ id, description }) => ({ id, description })),
    })
  },
})
