# opencode-context-tui

[![npm](https://img.shields.io/npm/v/opencode-context-tui)](https://www.npmjs.com/package/opencode-context-tui)

Current-session context inspection with a native OpenCode TUI modal.

`/context` opens a large modal over the current screen with recorded token usage, estimated context utilization, message and tool activity, and the largest retained context contributors. It does not invoke an LLM to build the report.

### Overview

Provider-recorded token usage, estimated context utilization, cache efficiency, and session activity.

![opencode-context Overview tab showing token usage, context utilization, cache efficiency, and session activity](https://raw.githubusercontent.com/ZackarySantana/opencode-context/main/assets/oc-context-demo.png)

### Content

The largest observable retained messages, reasoning, attachments, and tool outputs.

![opencode-context Content tab showing the largest retained context contributors](https://raw.githubusercontent.com/ZackarySantana/opencode-context/main/assets/oc-context-demo-2.png)

### Environment

Observable instructions, agents, skills, MCP servers, and available tools.

![opencode-context Environment tab showing instructions, agents, skills, MCP servers, and tools](https://raw.githubusercontent.com/ZackarySantana/opencode-context/main/assets/oc-context-demo-3.png)

Published on npm as [`opencode-context-tui`](https://www.npmjs.com/package/opencode-context-tui).

## Requirements

- OpenCode 1.18.11 or newer within the 1.x release line
- Bun, which is already used by OpenCode's plugin runtime

The TUI plugin API is new and version-coupled. This package declares an `engines.opencode` range so incompatible OpenCode versions skip it rather than loading an unsupported interface.

## Install

Install globally so `/context` is available from every project:

```sh
opencode plugin --global opencode-context-tui
```

The package exposes a TUI entrypoint only. OpenCode updates `~/.config/opencode/tui.json` for the native modal.

Quit and restart OpenCode after installation. Plugin configuration is loaded only at startup.

Then run inside a session:

```text
/context
```

## Context Modal

- `h` / `l` or left / right arrows: switch tabs
- `j` / `k` or arrow keys: move selection
- `r`: refresh immediately
- `e`: export a redacted snapshot
- `esc`: close the modal

The modal also refreshes automatically when session messages change. It follows the active OpenCode theme and adapts to narrow terminals.

## Accounting

The report keeps three kinds of data separate:

- **Recorded:** input, cache-read, cache-write, output, and reasoning tokens reported on OpenCode assistant messages
- **Measured:** local character and byte counts from retained message parts available to the TUI
- **Estimated:** retained token counts and context utilization derived locally from observable content

Estimated values are not provider billing totals or an exact reconstruction of the next provider request. OpenCode does not expose the final provider payload or every hidden system-prompt layer through a stable public API.

## Export

Press `e` to write a redacted JSON snapshot under:

```text
<opencode-state>/opencode-context-tui/exports/
```

Exports are explicit and stored outside the worktree by default. Likely secrets are redacted, and contributor previews are omitted. Review an export before sharing it.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build
```

To load a local checkout, reference its absolute directory in OpenCode's TUI plugin configuration, then restart OpenCode.

## Data Model

The modal reads current TUI and SDK state for:

- Current provider, model, and context-window limit
- Provider-recorded token telemetry
- User and assistant message counts
- Tool-call and compaction counts
- Retained text, reasoning, tool output, and file attachment metadata
- Configured instructions, agents, skills, MCP servers, and available tools where exposed

Session content is analyzed locally. The plugin does not upload content, invoke an LLM, read OpenCode's private database, or persist session data during normal use.
