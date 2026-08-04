export function formatTokens(value: number) {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${trim(value / 1_000)}k`
  return `${trim(value / 1_000_000)}m`
}

export function formatPercent(value?: number) {
  return value === undefined ? "unavailable" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
}

export function shorten(value: string, width: number) {
  if (value.length <= width) return value
  if (width <= 3) return value.slice(0, width)
  return `${value.slice(0, width - 3)}...`
}

function trim(value: number) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
}
