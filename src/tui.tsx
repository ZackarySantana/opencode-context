/** @jsxImportSource @opentui/solid */

import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { writeSnapshot } from "./export.js"
import { formatPercent, formatTokens, shorten } from "./format.js"
import { buildSnapshot, type ContextSnapshot, type Contributor, type EnvironmentItem } from "./snapshot.js"

const MODE = "modal"
const tabs = ["Overview", "Content", "Environment"] as const
type Tab = (typeof tabs)[number]
type Color = RGBA | string
type Skin = {
  background: Color
  panel: Color
  border: Color
  activeBorder: Color
  text: Color
  muted: Color
  primary: Color
  success: Color
  warning: Color
  error: Color
}

const commands = {
  open: "opencode-context-tui.open",
  close: "opencode-context-tui.close",
  next: "opencode-context-tui.tab.next",
  previous: "opencode-context-tui.tab.previous",
  down: "opencode-context-tui.row.down",
  up: "opencode-context-tui.row.up",
  refresh: "opencode-context-tui.refresh",
  export: "opencode-context-tui.export",
}

type Controller = {
  close: () => void
  next: () => void
  previous: () => void
  down: () => void
  up: () => void
  refresh: () => Promise<void>
  export: () => Promise<void>
}

export function currentSessionID(api: Pick<TuiPluginApi, "route">) {
  const route = api.route.current
  return route.name === "session" && "params" in route && typeof route.params?.sessionID === "string"
    ? route.params.sessionID
    : undefined
}

export function narrowLayout(width: number) {
  return width < 120
}

function skin(api: TuiPluginApi): Skin {
  const theme = api.theme.current
  return {
    background: theme.background,
    panel: theme.backgroundPanel,
    border: theme.border,
    activeBorder: theme.borderActive,
    text: theme.text,
    muted: theme.textMuted,
    primary: theme.primary,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
  }
}

function ContextDialog(props: { api: TuiPluginApi; sessionID?: string; register: (controller: Controller) => void }) {
  const dimensions = useTerminalDimensions()
  const colors = skin(props.api)
  const [tabIndex, setTabIndex] = createSignal(0)
  const [selected, setSelected] = createSignal(0)
  const [snapshot, setSnapshot] = createSignal(emptySnapshot(props.sessionID))
  const [loading, setLoading] = createSignal(true)
  let generation = 0
  let pending: ReturnType<typeof setTimeout> | undefined

  const tab = () => tabs[tabIndex()] ?? "Overview"
  const rows = createMemo(() => tab() === "Content"
    ? snapshot().retained.contributors
    : tab() === "Environment" ? snapshot().environment : [])
  const move = (amount: number) => setSelected((value) => Math.max(0, Math.min(value + amount, Math.max(rows().length - 1, 0))))
  const switchTab = (amount: number) => {
    setTabIndex((value) => (value + amount + tabs.length) % tabs.length)
    setSelected(0)
  }
  const refresh = async () => {
    const request = ++generation
    setLoading(true)
    const next = await loadSnapshot(props.api, props.sessionID)
    if (request === generation) {
      setSnapshot(next)
      setLoading(false)
    }
  }
  const scheduleRefresh = () => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => void refresh(), 120)
  }
  const exportCurrent = async () => {
    try {
      const path = await writeSnapshot(props.api.state.path.state, snapshot())
      props.api.ui.toast({ variant: "success", title: "Context exported", message: path })
    } catch (error) {
      props.api.ui.toast({ variant: "error", title: "Export failed", message: error instanceof Error ? error.message : String(error) })
    }
  }

  props.register({
    close: () => props.api.ui.dialog.clear(),
    next: () => switchTab(1),
    previous: () => switchTab(-1),
    down: () => move(1),
    up: () => move(-1),
    refresh,
    export: exportCurrent,
  })

  onMount(() => void refresh())
  const disposers = [
    props.api.event.on("message.updated", scheduleRefresh),
    props.api.event.on("message.part.updated", scheduleRefresh),
    props.api.event.on("message.part.removed", scheduleRefresh),
  ]
  onCleanup(() => {
    generation += 1
    if (pending) clearTimeout(pending)
    for (const dispose of disposers) dispose()
  })

  const bodyHeight = () => Math.max(12, Math.min(dimensions().height - 10, 28))

  return (
      <box width="100%" maxWidth="100%" overflow="hidden" flexDirection="column" paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <text fg={colors.text}><b>Current context</b><span style={{ fg: colors.muted }}> {shorten(snapshot().sessionID ?? "no active session", 30)}</span></text>
          <text fg={colors.muted}>{loading() ? "refreshing  " : ""}<span style={{ fg: colors.text }}>esc</span> close</text>
        </box>
        <box flexDirection="row" gap={1} paddingBottom={1}>
          {tabs.map((item, index) => (
            <box border borderColor={index === tabIndex() ? colors.activeBorder : colors.border} paddingLeft={1} paddingRight={1}>
              <text fg={index === tabIndex() ? colors.primary : colors.muted}>{item}</text>
            </box>
          ))}
        </box>
        <box height={bodyHeight()} flexDirection="column">
          {!snapshot().available ? <NoSession colors={colors} /> : tab() === "Overview"
            ? <Overview snapshot={snapshot()} colors={colors} />
            : tab() === "Content"
              ? <Content rows={snapshot().retained.contributors} selected={selected()} colors={colors} height={bodyHeight()} />
              : <Environment rows={snapshot().environment} selected={selected()} colors={colors} height={bodyHeight()} />}
        </box>
        <box paddingTop={1}><text fg={colors.muted}><span style={{ fg: colors.text }}>h/l</span> tabs  <span style={{ fg: colors.text }}>j/k</span> rows  <span style={{ fg: colors.text }}>r</span> refresh  <span style={{ fg: colors.text }}>e</span> export</text></box>
      </box>
  )
}

function Overview(props: { snapshot: ContextSnapshot; colors: Skin }) {
  const model = () => props.snapshot.model
  const modelLabel = () => model() ? `${model()?.providerName ?? model()?.providerID}/${model()?.modelName ?? model()?.modelID}` : "unavailable"
  const recordedInput = () => props.snapshot.usage.input + props.snapshot.usage.cacheRead + props.snapshot.usage.cacheWrite
  return (
    <box flexDirection="column" gap={1}>
      <box border borderColor={props.colors.border} backgroundColor={props.colors.panel} paddingLeft={1} paddingRight={1} flexDirection="column">
        <text fg={props.colors.text}><b>{shorten(modelLabel(), 72)}</b></text>
        <text fg={props.colors.muted}>context limit <span style={{ fg: props.colors.text }}>{model()?.contextLimit ? formatTokens(model()!.contextLimit!) : "unavailable"}</span>  estimated utilization <span style={{ fg: props.colors.warning }}>{formatPercent(props.snapshot.utilization)}</span></text>
      </box>
      <box flexDirection="row" gap={1}>
        <box width="50%" flexDirection="column" gap={1}>
          <Metric label="RECORDED INPUT" value={formatTokens(recordedInput())} detail={`${formatTokens(props.snapshot.usage.input)} fresh`} colors={props.colors} />
          <Metric label="OUTPUT" value={formatTokens(props.snapshot.usage.output)} detail={`${formatTokens(props.snapshot.usage.reasoning)} reasoning`} colors={props.colors} />
        </box>
        <box width="50%" flexDirection="column" gap={1}>
          <Metric label="CACHE" value={formatTokens(props.snapshot.usage.cacheRead + props.snapshot.usage.cacheWrite)} detail={`${formatPercent(props.snapshot.cacheEfficiency)} read efficiency`} colors={props.colors} />
          <Metric label="RETAINED EST." value={formatTokens(props.snapshot.retained.estimatedTokens)} detail={`${formatTokens(props.snapshot.retained.characters)} chars`} colors={props.colors} />
        </box>
      </box>
      <Panel title="ACTIVITY" colors={props.colors}>
        <Line label="Messages" value={`${props.snapshot.messageCount.user} user / ${props.snapshot.messageCount.assistant} assistant`} colors={props.colors} />
        <Line label="Tools / compactions" value={`${props.snapshot.toolCalls} / ${props.snapshot.compaction.count}`} colors={props.colors} />
        <Line label="Latest boundary" value={props.snapshot.compaction.latestBoundary ?? "unavailable"} colors={props.colors} />
      </Panel>
      <text fg={props.colors.muted}>Provider tokens are <span style={{ fg: props.colors.success }}>recorded</span>. Retained tokens and utilization are <span style={{ fg: props.colors.warning }}>estimated</span>; the final payload is not observable.</text>
    </box>
  )
}

function Content(props: { rows: Contributor[]; selected: number; colors: Skin; height: number }) {
  const limit = Math.max(4, props.height - 3)
  const start = Math.max(0, Math.min(props.selected - Math.floor(limit / 2), Math.max(props.rows.length - limit, 0)))
  const visible = () => props.rows.slice(start, start + limit)
  return (
    <Panel title={`LARGEST RETAINED CONTRIBUTORS  ${props.rows.length}`} colors={props.colors} grow>
      {props.rows.length === 0 ? <text fg={props.colors.muted}>No observable retained text.</text> : visible().map((row, offset) => {
        const active = start + offset === props.selected
        return (
          <box flexDirection="row" justifyContent="space-between" backgroundColor={active ? props.colors.panel : undefined}>
            <text fg={active ? props.colors.primary : props.colors.text}>{active ? "> " : "  "}{shorten(row.label, 48)}</text>
            <text fg={props.colors.muted}>~{formatTokens(row.estimatedTokens)} tok</text>
          </box>
        )
      })}
    </Panel>
  )
}

function Environment(props: { rows: EnvironmentItem[]; selected: number; colors: Skin; height: number }) {
  const limit = Math.max(4, props.height - 3)
  const start = Math.max(0, Math.min(props.selected - Math.floor(limit / 2), Math.max(props.rows.length - limit, 0)))
  return (
    <Panel title={`OBSERVABLE ENVIRONMENT  ${props.rows.length}`} colors={props.colors} grow>
      {props.rows.length === 0 ? <text fg={props.colors.muted}>No instructions, agents, skills, MCPs, or tools exposed in current TUI state.</text> : props.rows.slice(start, start + limit).map((row, offset) => {
        const active = start + offset === props.selected
        return (
          <box flexDirection="row" justifyContent="space-between" backgroundColor={active ? props.colors.panel : undefined}>
            <text fg={active ? props.colors.primary : props.colors.text}>{active ? "> " : "  "}{row.category}: {shorten(row.name, 42)}</text>
            <text fg={props.colors.muted}>{shorten(row.detail ?? "configured", 24)}</text>
          </box>
        )
      })}
    </Panel>
  )
}

function NoSession(props: { colors: Skin }) {
  return (
    <box flexGrow={1} border borderColor={props.colors.border} alignItems="center" justifyContent="center">
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={props.colors.text}><b>No active session</b></text>
        <text fg={props.colors.muted}>Open a session, then run /context again.</text>
      </box>
    </box>
  )
}

function Metric(props: { label: string; value: string; detail: string; colors: Skin }) {
  return (
    <box width="100%" border borderColor={props.colors.border} backgroundColor={props.colors.panel} paddingLeft={1} paddingRight={1} flexDirection="column">
      <text fg={props.colors.muted}>{props.label}</text>
      <text fg={props.colors.primary}><b>{props.value}</b></text>
      <text fg={props.colors.muted}>{props.detail}</text>
    </box>
  )
}

function Panel(props: { title: string; colors: Skin; children?: unknown; grow?: boolean }) {
  return (
    <box width="100%" flexGrow={props.grow ? 1 : 0} overflow="hidden" border borderColor={props.colors.border} paddingLeft={1} paddingRight={1} flexDirection="column">
      <text fg={props.colors.text}><b>{props.title}</b></text>
      {props.children as never}
    </box>
  )
}

function Line(props: { label: string; value: string; colors: Skin; accent?: Color }) {
  return <text fg={props.colors.muted}>{props.label}: <span style={{ fg: props.accent ?? props.colors.text }}>{shorten(props.value, 48)}</span></text>
}

async function loadSnapshot(api: TuiPluginApi, sessionID?: string) {
  if (!sessionID) return emptySnapshot()
  let messages = api.state.session.messages(sessionID)
  const remoteParts = new Map<string, ReadonlyArray<Part>>()
  if (messages.length === 0) {
    try {
      const response = await api.client.session.messages({ sessionID, directory: api.state.path.directory })
      if (response.data) {
        messages = response.data.map((item) => item.info)
        for (const item of response.data) remoteParts.set(item.info.id, item.parts)
      }
    } catch {
      // Synchronized state remains the best available source when the client is unavailable.
    }
  }
  const tools = await loadTools(api)
  return buildSnapshot({
    sessionID,
    messages,
    parts: (messageID) => api.state.part(messageID).length > 0 ? api.state.part(messageID) : remoteParts.get(messageID) ?? [],
    providers: api.state.provider,
    config: api.state.config,
    mcp: api.state.mcp(),
    tools,
  })
}

async function loadTools(api: TuiPluginApi) {
  try {
    const client = api.client as unknown as { tool?: { ids?: (input: { directory?: string }) => Promise<{ data?: string[] }> } }
    const response = await client.tool?.ids?.({ directory: api.state.path.directory })
    return response?.data?.map((id) => ({ id })) ?? []
  } catch {
    return []
  }
}

function emptySnapshot(sessionID?: string): ContextSnapshot {
  return buildSnapshot({ sessionID, messages: [] as Message[], parts: () => [], providers: [] })
}

function registerCommands(api: TuiPluginApi) {
  api.keymap.registerLayer({
    commands: [{
      name: commands.open,
      title: "Context",
      desc: "Inspect current-session context usage",
      category: "Plugin",
      namespace: "palette",
      slashName: "context",
      run() {
        api.ui.dialog.replace(
          () => <ContextDialog api={api} sessionID={currentSessionID(api)} register={(value) => { activeStore.value = value }} />,
          () => {
            activeStore.value = undefined
          },
        )
        api.ui.dialog.setSize("large")
      },
    }],
  })
  api.keymap.registerLayer({
    mode: MODE,
    enabled: () => activeStore.value !== undefined,
    commands: [
      hidden(commands.close, () => activeStore.value?.close()),
      hidden(commands.next, () => activeStore.value?.next()),
      hidden(commands.previous, () => activeStore.value?.previous()),
      hidden(commands.down, () => activeStore.value?.down()),
      hidden(commands.up, () => activeStore.value?.up()),
      hidden(commands.refresh, () => { void activeStore.value?.refresh() }),
      hidden(commands.export, () => { void activeStore.value?.export() }),
    ],
    bindings: [
      { key: "escape", cmd: commands.close, desc: "Close" },
      { key: "right,l", cmd: commands.next, desc: "Next tab" },
      { key: "left,h", cmd: commands.previous, desc: "Previous tab" },
      { key: "down,j", cmd: commands.down, desc: "Next row" },
      { key: "up,k", cmd: commands.up, desc: "Previous row" },
      { key: "r", cmd: commands.refresh, desc: "Refresh" },
      { key: "e", cmd: commands.export, desc: "Export" },
    ],
  })
}

const activeStore: { value?: Controller } = {}

function hidden(name: string, run: () => void) {
  return { name, title: name, hidden: true, run }
}

const tui: TuiPlugin = async (api) => {
  registerCommands(api)
  api.lifecycle.onDispose(() => {
    if (api.ui.dialog.open) api.ui.dialog.clear()
    activeStore.value = undefined
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-context-tui",
  tui,
}

export default plugin
