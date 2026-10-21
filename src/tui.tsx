/** @jsxImportSource @opentui/solid */

import type { RGBA } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { exportStatePath, writeSnapshot } from "./export.js"
import { formatPercent, formatTokens, shorten } from "./format.js"
import { buildSnapshot, type ContextSnapshot, type Contributor, type EnvironmentItem } from "./snapshot.js"
import { loadSnapshot } from "./load.js"

const MODE = "opencode-context-tui.modal"
const tabs = ["Overview", "Content", "Environment"] as const
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

export function currentSessionID(api: Pick<Context, "ui">) {
  const route = api.ui.router.current()
  return route.type === "session" ? route.sessionID : undefined
}

export function narrowLayout(width: number) {
  return width < 120
}

function skin(api: Context): Skin {
  const theme = api.theme.surface("dialog")
  return {
    background: theme.background.base,
    panel: theme.background.raised.base,
    border: theme.border.base,
    activeBorder: theme.text.action.primary.base,
    text: theme.text.base,
    muted: theme.text.muted,
    primary: theme.text.action.primary.base,
    success: theme.text.feedback.success.base,
    warning: theme.text.feedback.warning.base,
    error: theme.text.feedback.error.base,
  }
}

function ContextDialog(props: { api: Context; sessionID?: string }) {
  const dimensions = useTerminalDimensions()
  const colors = createMemo(() => skin(props.api))
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
      const path = await writeSnapshot(exportStatePath(), snapshot())
      props.api.ui.toast.show({ variant: "success", title: "Context exported", message: path })
    } catch (error) {
      props.api.ui.toast.show({ variant: "error", title: "Export failed", message: error instanceof Error ? error.message : String(error) })
    }
  }

  const popMode = props.api.keymap.mode.push(MODE)
  props.api.keymap.layer(() => ({
    mode: MODE,
    priority: 100,
    commands: [
      { id: commands.close, bind: "escape", run: () => props.api.ui.dialog.clear() },
      { id: commands.next, bind: "right,l", run: () => switchTab(1) },
      { id: commands.previous, bind: "left,h", run: () => switchTab(-1) },
      { id: commands.down, bind: "down,j", run: () => move(1) },
      { id: commands.up, bind: "up,k", run: () => move(-1) },
      { id: commands.refresh, bind: "r", run: refresh },
      { id: commands.export, bind: "e", run: exportCurrent },
    ],
  }))

  onMount(() => void refresh())
  const stop = props.api.data.listen(({ details }) => {
    if ("sessionID" in details.data && details.data.sessionID === props.sessionID) scheduleRefresh()
  })
  onCleanup(() => {
    generation += 1
    if (pending) clearTimeout(pending)
    stop()
    popMode()
  })

  const bodyHeight = () => Math.max(12, Math.min(dimensions().height - 10, 28))

  return (
      <box width="100%" maxWidth="100%" overflow="hidden" flexDirection="column" paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <text fg={colors().text}><b>Current context</b><span style={{ fg: colors().muted }}> {shorten(snapshot().sessionID ?? "no active session", 30)}</span></text>
          <text fg={colors().muted}>{loading() ? "refreshing  " : ""}<span style={{ fg: colors().text }}>esc</span> close</text>
        </box>
        <box flexDirection="row" gap={1} paddingBottom={1}>
          {tabs.map((item, index) => (
            <box border borderColor={index === tabIndex() ? colors().activeBorder : colors().border} paddingLeft={1} paddingRight={1}>
              <text fg={index === tabIndex() ? colors().primary : colors().muted}>{item}</text>
            </box>
          ))}
        </box>
        <box height={bodyHeight()} flexDirection="column">
          {!snapshot().available ? <NoSession colors={colors()} /> : tab() === "Overview"
            ? <Overview snapshot={snapshot()} colors={colors()} />
            : tab() === "Content"
              ? <Content rows={snapshot().retained.contributors} selected={selected()} colors={colors()} height={bodyHeight()} />
              : <Environment rows={snapshot().environment} selected={selected()} colors={colors()} height={bodyHeight()} />}
        </box>
        <box paddingTop={1}><text fg={colors().muted}><span style={{ fg: colors().text }}>h/l</span> tabs  <span style={{ fg: colors().text }}>j/k</span> rows  <span style={{ fg: colors().text }}>r</span> refresh  <span style={{ fg: colors().text }}>e</span> export</text></box>
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
        <Line label="Latest checkpoint" value={props.snapshot.compaction.latestBoundary ?? "unavailable"} colors={props.colors} />
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

function emptySnapshot(sessionID?: string): ContextSnapshot {
  return buildSnapshot({ sessionID, messages: [], providers: [] })
}

export default Plugin.define({
  id: "opencode-context-tui",
  setup(api) {
    let opened = false
    api.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: commands.open,
        title: "Context",
        description: "Inspect current-session context usage",
        group: "Plugin",
        palette: true,
        slash: { name: "context" },
        run() {
          const sessionID = currentSessionID(api)
          api.ui.dialog.show(() => <ContextDialog api={api} sessionID={sessionID} />, () => { opened = false })
          opened = true
          api.ui.dialog.set({ size: "large", centered: true })
        },
      }],
    }))
    return () => {
      if (opened) api.ui.dialog.clear()
    }
  },
})
