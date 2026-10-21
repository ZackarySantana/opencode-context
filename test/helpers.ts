import type { ConfigEntry, LocationRef, SessionMessageInfo } from "@opencode/client"

export function mockData() {
  const location = { directory: "/session-location" }
  const locations: LocationRef[] = []
  const history: SessionMessageInfo[] = [{ id: "user-1", type: "user", time: { created: 1 }, text: "hello" }]
  const collection = <T>(items: T[] = []) => ({
    sync: async (value: LocationRef) => { locations.push(value) },
    list: () => items,
  })
  const api = {
    location: { directory: "/plugin-location" },
    client: {
      message: { list: async (_input: { cursor?: string }) => ({ data: history, cursor: {} as { next?: string } }) },
      session: { context: async () => history },
      config: { get: async ({ location }: { location: LocationRef }): Promise<ConfigEntry[]> => {
        locations.push(location)
        return [{ type: "document", info: { instructions: ["AGENTS.md"] } }]
      } },
      rpc: () => ({ tools: async (_input: unknown, { location }: { location: LocationRef }) => {
        locations.push(location)
        return [{ id: "read", description: "Read a file" }]
      } }),
    },
    data: {
      session: {
        sync: async (_id: string) => {},
        get: (_id: string) => ({ location, model: undefined }),
        message: { list: (_id: string) => history },
      },
      location: {
        default: () => ({ directory: "/default-location" }),
        provider: collection(), model: collection(),
        agent: collection([{ id: "build", description: "Build" }]),
        skill: collection([{ id: "testing", description: "Testing" }]),
        mcp: { server: collection([{ name: "docs", status: { status: "connected" } }]) },
      },
    },
  }
  return { api, history, locations, location }
}
