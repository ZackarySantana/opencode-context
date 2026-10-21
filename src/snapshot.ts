import type { McpServer, ModelInfo, ModelRef, ProviderInfo, SessionMessageInfo, ToolContent } from "@opencode/client"

export type Provenance = "recorded" | "measured" | "estimated" | "unavailable"
export type ContributorCategory = "user" | "assistant" | "reasoning" | "tool" | "file" | "system"

export type TokenUsage = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
}

export type Contributor = {
  id: string
  messageID: string
  category: ContributorCategory
  label: string
  characters: number
  bytes: number
  estimatedTokens: number
}

export type EnvironmentItem = {
  category: "instruction" | "agent" | "skill" | "mcp" | "tool"
  name: string
  detail?: string
}

export type ContextSnapshot = {
  version: 1
  capturedAt: string
  sessionID?: string
  available: boolean
  model?: {
    providerID: string
    providerName?: string
    modelID: string
    modelName?: string
    contextLimit?: number
  }
  usage: TokenUsage
  usageProvenance: "recorded"
  messageCount: { user: number; assistant: number }
  toolCalls: number
  compaction: { count: number; latestBoundary?: string }
  retained: {
    characters: number
    bytes: number
    estimatedTokens: number
    provenance: "estimated"
    contributors: Contributor[]
  }
  utilization?: number
  utilizationProvenance: "estimated" | "unavailable"
  cacheEfficiency?: number
  environment: EnvironmentItem[]
  limitations: string[]
}

type SnapshotInput = {
  sessionID?: string
  messages: ReadonlyArray<SessionMessageInfo>
  retainedMessages?: ReadonlyArray<SessionMessageInfo>
  providers: ReadonlyArray<ProviderInfo>
  models?: ReadonlyArray<ModelInfo>
  model?: ModelRef
  config?: unknown
  agents?: ReadonlyArray<{ id: string; description?: string }>
  skills?: ReadonlyArray<{ id: string; description?: string }>
  mcp?: ReadonlyArray<McpServer>
  tools?: ReadonlyArray<{ id: string; description?: string }>
  capturedAt?: Date
}

export function buildSnapshot(input: SnapshotInput): ContextSnapshot {
  const messages = dedupe(input.messages, (message) => message.id)
  const assistant = messages.filter((message) => message.type === "assistant")
  const selectedModel = input.model ?? assistant.at(-1)?.model
  const model = selectedModel
    ? resolveModel(input.providers, input.models ?? [], selectedModel.providerID, selectedModel.id)
    : undefined
  const usage = assistant.reduce<TokenUsage>((total, message) => {
    if (!message.tokens) return total
    total.input += message.tokens.input
    total.cacheRead += message.tokens.cache.read
    total.cacheWrite += message.tokens.cache.write
    total.output += message.tokens.output
    total.reasoning += message.tokens.reasoning
    return total
  }, emptyUsage())
  const contributors: Contributor[] = []
  const compactions = messages.filter((message) => message.type === "compaction" && message.status === "completed")
  const toolCalls = assistant.reduce((total, message) => total + message.content.filter((part) => part.type === "tool").length, 0)
  for (const message of dedupe(input.retainedMessages ?? messages, (item) => item.id)) {
    contributors.push(...messageContributors(message))
  }

  contributors.sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.id.localeCompare(b.id))
  const retained = contributors.reduce(
    (total, item) => {
      total.characters += item.characters
      total.bytes += item.bytes
      total.estimatedTokens += item.estimatedTokens
      return total
    },
    { characters: 0, bytes: 0, estimatedTokens: 0 },
  )
  const cacheBase = usage.input + usage.cacheRead
  const utilization = model?.contextLimit
    ? Math.min(retained.estimatedTokens / model.contextLimit, 1)
    : undefined

  return {
    version: 1,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    sessionID: input.sessionID,
    available: Boolean(input.sessionID),
    model,
    usage,
    usageProvenance: "recorded",
    messageCount: {
      user: messages.filter((message) => message.type === "user").length,
      assistant: assistant.length,
    },
    toolCalls,
    compaction: {
      count: compactions.length,
      latestBoundary: compactions.at(-1)?.id,
    },
    retained: {
      ...retained,
      provenance: "estimated",
      contributors,
    },
    utilization,
    utilizationProvenance: utilization === undefined ? "unavailable" : "estimated",
    cacheEfficiency: cacheBase > 0 ? usage.cacheRead / cacheBase : undefined,
    environment: environmentItems(input),
    limitations: [
      "Recorded usage comes from assistant messages and is not the retained prompt size.",
      "Retained tokens use a local character approximation and exclude hidden provider payload layers.",
      "Context utilization is an estimate because the exact next provider request is not observable.",
    ],
  }
}

export function estimateTokens(text: string) {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4)
}

function messageContributors(message: SessionMessageInfo): Contributor[] {
  const row = (id: string, category: ContributorCategory, label: string, text: string) => contributor(id, message.id, category, label, text)
  if (message.type === "user") {
    return [
      row(`${message.id}:text`, "user", "User message", message.text),
      ...message.files?.map((file, index) => row(`${message.id}:file:${index}`, "file", `File attachment: ${file.name ?? file.mime}`,
        [file.name, file.mime, file.description, file.source.type === "uri" ? file.source.uri : undefined].filter(Boolean).join(" "))) ?? [],
    ]
  }
  if (message.type === "assistant") {
    return message.content.flatMap((part, index): Contributor[] => {
      const id = `${message.id}:${index}`
      if (part.type === "text") return [row(id, "assistant", "Assistant response", part.text)]
      if (part.type === "reasoning") return [row(id, "reasoning", "Reasoning", part.text)]
      const state = part.state
      const content: ToolContent[] = state.status === "completed" || state.status === "error" ? state.content ?? [] : []
      const text = content.filter((item) => item.type === "text").map((item) => item.text).join("\n")
      const output = text || (state.status === "error" ? state.error.message : "")
      return [
        ...output ? [row(id, "tool", `Tool output: ${part.name}`, output)] : [],
        ...content.flatMap((item, fileIndex) => item.type === "file"
          ? [row(`${id}:file:${fileIndex}`, "file", `File attachment: ${item.name ?? item.mime}`, [item.name, item.mime, item.uri].filter(Boolean).join(" "))]
          : []),
      ]
    })
  }
  if (message.type === "compaction" && message.status === "completed") return [row(message.id, "system", "Compaction summary", message.summary)]
  if (message.type === "system" || message.type === "synthetic" || message.type === "skill") return [row(message.id, "system", message.type === "skill" ? `Skill: ${message.name}` : "System message", message.text)]
  if (message.type === "shell" && message.output) return [row(message.id, "tool", "Shell output", message.output.output)]
  return []
}

function contributor(id: string, messageID: string, category: ContributorCategory, label: string, text: string): Contributor {
  return {
    id,
    messageID,
    category,
    label,
    characters: text.length,
    bytes: Buffer.byteLength(text),
    estimatedTokens: estimateTokens(text),
  }
}

function resolveModel(providers: ReadonlyArray<ProviderInfo>, models: ReadonlyArray<ModelInfo>, providerID: string, modelID: string) {
  const provider = providers.find((item) => item.id === providerID)
  const model = models.find((item) => item.providerID === providerID && item.id === modelID)
  return {
    providerID,
    providerName: provider?.name,
    modelID,
    modelName: model?.name,
    contextLimit: model?.limit.context,
  }
}

function environmentItems(input: SnapshotInput) {
  const value = record(input.config) ? input.config : {}
  const rows: EnvironmentItem[] = []
  const instructions = Array.isArray(value.instructions) ? value.instructions : []
  for (const instruction of instructions) {
    if (typeof instruction === "string") rows.push({ category: "instruction", name: instruction })
  }
  for (const [name, agent] of entries(value.agents)) {
    rows.push({ category: "agent", name, detail: record(agent) && typeof agent.description === "string" ? agent.description : undefined })
  }
  const skills = Array.isArray(value.skills) ? value.skills : []
  for (const skill of skills) {
    if (typeof skill === "string") rows.push({ category: "skill", name: skill })
  }
  for (const item of input.agents ?? []) rows.push({ category: "agent", name: item.id, detail: item.description })
  for (const item of input.skills ?? []) rows.push({ category: "skill", name: item.id, detail: item.description })
  for (const item of input.mcp ?? []) rows.push({ category: "mcp", name: item.name, detail: "error" in item.status ? item.status.error : item.status.status })
  for (const item of input.tools ?? []) rows.push({ category: "tool", name: item.id, detail: item.description })
  return dedupe(rows, (item) => `${item.category}:${item.name}`).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

function entries(value: unknown): Array<[string, unknown]> {
  return record(value) ? Object.entries(value) : []
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function dedupe<Value>(values: ReadonlyArray<Value>, key: (value: Value) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function emptyUsage(): TokenUsage {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
}
