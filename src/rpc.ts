import { Rpc } from "@opencode/plugin/rpc"

export type ToolSummary = { id: string; description?: string }

export const ContextRpc = Rpc.define({
  id: "opencode-context-tui",
  methods: {
    tools: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, description: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
      },
    },
  },
  events: {},
})
