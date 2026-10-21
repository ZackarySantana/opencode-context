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

- OpenCode 2.1.1 or newer within the 2.x release line
- Bun, which is already used by OpenCode's plugin runtime

The TUI plugin API is new and version-coupled. This package declares an `engines.opencode` range so incompatible OpenCode versions skip it rather than loading an unsupported interface.

## Install

Install globally so `/context` is available from every project:

```sh
opencode plugin add opencode-context-tui
```

The package exposes V2 server and TUI entrypoints. The server component only exposes a read-only list of available tools; the TUI builds and displays the report. OpenCode loads both from the global plugin configuration.

Alternatively, add the package to `plugins` in `~/.config/opencode/opencode.json(c)` (preserving existing entries):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-context-tui"]
}
```

Restart OpenCode if the modal is not available after installation.

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

V2's retained-context API supplies the content estimate, including retained compaction summaries. Recorded usage and activity still cover session history. If an API is unavailable, the report falls back to cached data where possible and lists the limitation in exported snapshots. The latest checkpoint is identified by its V2 compaction message ID.

## Export

Press `e` to write a redacted JSON snapshot under:

```text
$XDG_STATE_HOME/opencode/opencode-context-tui/exports/
```

When `XDG_STATE_HOME` is unset, the base is `~/.local/state`. Exports are explicit and stored on the terminal client's machine, outside the worktree by default, including when connected to a remote server. Likely secrets are redacted, and contributor previews are omitted. Review an export before sharing it.

## Development

Mise pins Bun to 1.4.3 for this project:

```sh
mise install
bun install
bun run test
bun run typecheck
bun run build
```

To load a built local checkout, add its absolute directory to `plugins` in `opencode.json(c)`, then restart OpenCode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-context"]
}
```

For a remote service, install the package on that service; its TUI entrypoint loads in the connected CLI. A CLI-only installation under `~/.config/opencode/cli.json` can display the report without the server component, but cannot list the available tool catalog.

## V1 migration

This version uses the V2 plugin API and does not run on OpenCode 1.x. Remove the old entry from `tui.json` and install/configure the plugin as above. `/context`, its three tabs, keyboard controls, automatic refresh, and redacted JSON exports remain available.

Migration references: [V1 plugin migration](https://opencode.ai/v2/docs/build/plugins/migrate-v1), [CLI plugin API](https://opencode.ai/v2/docs/build/plugins/cli), and [plugin RPC](https://opencode.ai/v2/docs/build/plugins/rpc).

## Data Model

The modal reads current TUI and SDK state for:

- Current provider, model, and context-window limit
- Provider-recorded token telemetry
- User and assistant message counts
- Tool-call and compaction counts
- Retained text, reasoning, tool output, and file attachment metadata
- Configured instructions, agents, skills, MCP servers, and available tools where exposed

Session content is analyzed locally. The plugin does not upload content, invoke an LLM, read OpenCode's private database, or persist session data during normal use.
