import type { Message, Part, Provider } from "@opencode-ai/sdk/v2"

export type Provenance = "recorded" | "measured" | "estimated" | "unavailable"
export type ContributorCategory = "user" | "assistant" | "reasoning" | "tool" | "file"

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
  messages: ReadonlyArray<Message>
  parts: (messageID: string) => ReadonlyArray<Part>
  providers: ReadonlyArray<Provider>
  config?: unknown
  mcp?: ReadonlyArray<{ name: string; status: string; error?: string }>
  tools?: ReadonlyArray<{ id: string; description?: string }>
  capturedAt?: Date
}

export function buildSnapshot(input: SnapshotInput): ContextSnapshot {
  const messages = dedupe(input.messages, (message) => message.id)
  const assistant = messages.filter((message) => message.role === "assistant")
  const latestAssistant = assistant.at(-1)
  const model = latestAssistant
    ? resolveModel(input.providers, latestAssistant.providerID, latestAssistant.modelID)
    : undefined
  const usage = assistant.reduce<TokenUsage>((total, message) => {
    total.input += message.tokens.input
    total.cacheRead += message.tokens.cache.read
    total.cacheWrite += message.tokens.cache.write
    total.output += message.tokens.output
    total.reasoning += message.tokens.reasoning
    return total
  }, emptyUsage())
  const contributors: Contributor[] = []
  const compactions: Array<{ id: string; boundary?: string }> = []
  let toolCalls = 0

  for (const message of messages) {
    for (const part of dedupe(input.parts(message.id), (item) => item.id)) {
      if (part.type === "compaction") {
        compactions.push({ id: part.id, boundary: part.tail_start_id })
        continue
      }
      if (part.type === "tool") toolCalls += 1
      contributors.push(...partContributors(message.role, part))
    }
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
      user: messages.filter((message) => message.role === "user").length,
      assistant: assistant.length,
    },
    toolCalls,
    compaction: {
      count: compactions.length,
      latestBoundary: compactions.at(-1)?.boundary,
    },
    retained: {
      ...retained,
      provenance: "estimated",
      contributors,
    },
    utilization,
    utilizationProvenance: utilization === undefined ? "unavailable" : "estimated",
    cacheEfficiency: cacheBase > 0 ? usage.cacheRead / cacheBase : undefined,
    environment: environmentItems(input.config, input.mcp, input.tools),
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

function partContributors(role: Message["role"], part: Part): Contributor[] {
  if (part.type === "text" && !part.ignored) {
    return [contributor(part.id, part.messageID, role, role === "user" ? "User message" : "Assistant response", part.text)]
  }
  if (part.type === "reasoning") {
    return [contributor(part.id, part.messageID, "reasoning", "Reasoning", part.text)]
  }
  if (part.type === "tool") {
    const output = part.state.status === "completed" ? part.state.output : part.state.status === "error" ? part.state.error : ""
    const rows = output ? [contributor(part.id, part.messageID, "tool", `Tool output: ${part.tool}`, output)] : []
    if (part.state.status === "completed") {
      rows.push(...part.state.attachments?.map((file) => fileContributor(file, part.messageID)) ?? [])
    }
    return rows
  }
  if (part.type === "file") return [fileContributor(part, part.messageID)]
  if (part.type === "subtask") {
    return [contributor(part.id, part.messageID, "user", `Subtask: ${part.agent}`, part.prompt)]
  }
  return []
}

function fileContributor(part: Extract<Part, { type: "file" }>, messageID: string): Contributor {
  const source = part.source?.text.value ?? ""
  const metadata = [part.filename, part.mime, part.url].filter(Boolean).join(" ")
  return contributor(part.id, messageID, "file", `File attachment: ${part.filename ?? part.mime}`, source || metadata)
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

function resolveModel(providers: ReadonlyArray<Provider>, providerID: string, modelID: string) {
  const provider = providers.find((item) => item.id === providerID)
  const model = provider?.models[modelID]
  return {
    providerID,
    providerName: provider?.name,
    modelID,
    modelName: model?.name,
    contextLimit: model?.limit.context,
  }
}

function environmentItems(
  config: unknown,
  mcp: ReadonlyArray<{ name: string; status: string; error?: string }> = [],
  tools: ReadonlyArray<{ id: string; description?: string }> = [],
) {
  const value = record(config) ? config : {}
  const rows: EnvironmentItem[] = []
  const instructions = Array.isArray(value.instructions) ? value.instructions : []
  for (const instruction of instructions) {
    if (typeof instruction === "string") rows.push({ category: "instruction", name: instruction })
  }
  for (const [name, agent] of entries(value.agent)) {
    rows.push({ category: "agent", name, detail: record(agent) && typeof agent.description === "string" ? agent.description : undefined })
  }
  const skills = record(value.skills) && Array.isArray(value.skills.paths) ? value.skills.paths : []
  for (const skill of skills) {
    if (typeof skill === "string") rows.push({ category: "skill", name: skill })
  }
  for (const item of mcp) rows.push({ category: "mcp", name: item.name, detail: item.error ?? item.status })
  for (const item of tools) rows.push({ category: "tool", name: item.id, detail: item.description })
  return rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
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
