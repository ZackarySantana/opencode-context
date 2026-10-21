import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import type { ContextSnapshot } from "./snapshot.js"

export function exportStatePath(env: NodeJS.ProcessEnv = process.env) {
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode")
}

const SECRET_PATTERNS = [
  /\b(?:sk|pk|ghp|github_pat|xox[baprs])-[-_a-z0-9]{12,}\b/gi,
  /\bBearer\s+[-._~+/a-z0-9]+=*\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
]

export function redact(value: string) {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[REDACTED]"), value)
}

export function exportPayload(snapshot: ContextSnapshot) {
  return {
    ...snapshot,
    model: snapshot.model ? {
      ...snapshot.model,
      providerName: snapshot.model.providerName ? redact(snapshot.model.providerName) : undefined,
      modelName: snapshot.model.modelName ? redact(snapshot.model.modelName) : undefined,
    } : undefined,
    retained: {
      ...snapshot.retained,
      contributors: snapshot.retained.contributors.map((item) => ({
        ...item,
        label: redact(item.label),
      })),
    },
    environment: snapshot.environment.map((item) => ({
      ...item,
      name: redact(item.name),
      detail: item.detail ? redact(item.detail) : undefined,
    })),
  }
}

export async function writeSnapshot(statePath: string, snapshot: ContextSnapshot) {
  const directory = join(statePath, "opencode-context-tui", "exports")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stamp = snapshot.capturedAt.replaceAll(":", "-").replaceAll(".", "-")
  const path = join(directory, `context-${snapshot.sessionID ?? "no-session"}-${stamp}.json`)
  await writeFile(path, `${JSON.stringify(exportPayload(snapshot), null, 2)}\n`, { mode: 0o600 })
  return path
}
