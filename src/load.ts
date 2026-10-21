import type { ConfigEntry, SessionMessageInfo } from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"
import { ContextRpc, type ToolSummary } from "./rpc.js"
import { buildSnapshot } from "./snapshot.js"

export async function loadSnapshot(api: Context, sessionID?: string) {
  if (!sessionID) return buildSnapshot({ messages: [], providers: [] })
  // A plugin instance can outlive a location switch, or observe sessions elsewhere.
  await api.data.session.sync(sessionID).catch(() => {})
  const session = api.data.session.get(sessionID)
  const location = session?.location ?? api.location ?? api.data.location.default()
  const warnings: string[] = []
  const optional = async <T>(request: Promise<T>, fallback: T, label: string): Promise<T> => {
    try {
      return await request
    } catch {
      warnings.push(`${label} unavailable; showing cached data where available.`)
      return fallback
    }
  }
  const [messages, retainedMessages, documents, tools] = await Promise.all([
    optional(loadMessages(api, sessionID), api.data.session.message.list(sessionID), "Session history"),
    optional(api.client.session.context({ sessionID }), undefined as SessionMessageInfo[] | undefined, "Retained context"),
    optional(api.client.config.get({ location }), [] as ConfigEntry[], "Instruction configuration"),
    optional(api.client.rpc(ContextRpc).tools({}, { location }) as Promise<ToolSummary[]>, [], "Available tool catalog (enable the server plugin)"),
    ...[api.data.location.provider, api.data.location.model, api.data.location.agent, api.data.location.skill, api.data.location.mcp.server]
      .map((collection) => optional(collection.sync(location), undefined, "Environment catalog")),
  ])
  const config = { instructions: [] as string[], skills: [] as string[] }
  for (const entry of documents) {
    if (entry.type !== "document") continue
    config.instructions.push(...entry.info.instructions ?? [])
    config.skills.push(...entry.info.skills ?? [])
  }
  const snapshot = buildSnapshot({
    sessionID,
    messages,
    retainedMessages,
    model: session?.model,
    providers: api.data.location.provider.list(location) ?? [],
    models: api.data.location.model.list(location) ?? [],
    agents: api.data.location.agent.list(location) ?? [],
    skills: api.data.location.skill.list(location) ?? [],
    mcp: api.data.location.mcp.server.list(location) ?? [],
    config,
    tools,
  })
  snapshot.limitations.push(...new Set(warnings))
  return snapshot
}

async function loadMessages(api: Context, sessionID: string) {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  do {
    const page = await api.client.message.list({ sessionID, order: "asc", limit: 100, cursor })
    messages.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)
  return messages
}
