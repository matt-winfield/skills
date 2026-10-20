// The usage behind the graph: Claude Code's own session transcripts, every model call in them with
// its time and tokens, weighed by what the call costs relative to others, then summed per hour or
// day. Plain functions, no `$`: the hooks module reads the files and draws.

/** One model call from a transcript: its message id, when it was made, and its relative weight. */
export type Call = { id: string; t: number; weight: number }

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

// What a model's input token costs relative to the others, and its cache reads relative to its
// input: the API's list prices, which follow what a call takes from the limits closely enough to
// tell a busy hour from a quiet one. The first pattern a model id matches wins.
const MODELS: Array<{ match: RegExp; input: number; read: number }> = [
  { match: /fable|mythos/, input: 10, read: 0.025 },
  { match: /opus-5-5/, input: 4, read: 0.05 },
  { match: /opus/, input: 5, read: 0.1 },
  { match: /sonnet-5/, input: 2, read: 0.1 },
  { match: /sonnet/, input: 3, read: 0.1 },
  { match: /haiku-5/, input: 0.1, read: 0.1 },
  { match: /haiku/, input: 1, read: 0.1 }
]
const DEFAULT_MODEL = { input: 4, read: 0.1 }
// Output, and the two cache writes, relative to input: the same for every model.
const OUTPUT = 5
const WRITE_5M = 1.25
const WRITE_1H = 2

/** A call's weight: its tokens of each kind, priced relative to one input token of Claude Haiku 5.5. */
export function weightOf (model: string, usage: Usage): number {
  const { input, read } = MODELS.find(entry => entry.match.test(model)) ?? DEFAULT_MODEL
  const written = usage.cache_creation_input_tokens ?? 0
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const minutes = usage.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, written - hour)
  const tokens =
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) * OUTPUT +
    minutes * WRITE_5M +
    hour * WRITE_1H +
    (usage.cache_read_input_tokens ?? 0) * read
  return tokens * input
}

/**
 * The model calls in a transcript's text since `since`. A streamed response is written as a line
 * per content block, each with the message's usage: the last line of a message id stands for it.
 */
export function callsIn (text: string, since: number): Call[] {
  const byId = new Map<string, Call>()
  for (const line of text.split('\n')) {
    // Most lines are no model call: skip them before parsing.
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    let entry: { type?: unknown; timestamp?: unknown; message?: { id?: unknown; model?: unknown; usage?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const message = entry.message
    if (entry.type !== 'assistant' || typeof entry.timestamp !== 'string' || !message || typeof message.usage !== 'object' || !message.usage) continue
    const t = Date.parse(entry.timestamp)
    if (!(t >= since)) continue
    const model = typeof message.model === 'string' ? message.model : ''
    // A turn the engine wrote itself (an error, an interruption) names no real model and costs nothing.
    if (model === '<synthetic>') continue
    const id = typeof message.id === 'string' ? message.id : `${entry.timestamp}:${byId.size}`
    byId.set(id, { id, t, weight: weightOf(model, message.usage as Usage) })
  }
  return [...byId.values()]
}

export type Bucket = { start: number; label: string; weight: number }

const HOUR = 3_600_000
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Where the hour (or the local calendar day) holding `t` starts. */
function startOf (t: number, unit: 'hour' | 'day') {
  const date = new Date(t)
  if (unit === 'day') date.setHours(0, 0, 0, 0)
  else date.setMinutes(0, 0, 0)
  return date.getTime()
}

/** How far back the graph of a window reaches: 24 hours for the 5-hour one, 7 days for the weekly. */
export function sinceFor (kind: string, now: number) {
  return kind === 'five_hour' ? startOf(now, 'hour') - 23 * HOUR : startOf(startOf(now, 'day') - 6 * 24 * HOUR + 12 * HOUR, 'day')
}

/**
 * The graph's bars: for the 5-hour window, each of the last 24 hours; for the weekly one, each of
 * the last 7 days. The current hour or day is last. A call made twice (a resumed session copies
 * its history into the new transcript) counts once.
 */
export function bucketsFor (calls: Iterable<Call>, kind: string, now: number): Bucket[] {
  const unit = kind === 'five_hour' ? 'hour' : 'day'
  const count = unit === 'hour' ? 24 : 7
  const buckets: Bucket[] = []
  let start = startOf(now, unit)
  for (let i = 0; i < count; i++) {
    const date = new Date(start)
    const label = unit === 'hour' ? String(date.getHours()).padStart(2, '0') : DAY_NAMES[date.getDay()]!
    buckets.unshift({ start, label, weight: 0 })
    // A day before midnight is a calendar day back, whatever the clocks did that day.
    start = unit === 'hour' ? start - HOUR : startOf(start - HOUR, 'day')
  }
  const seen = new Set<string>()
  for (const call of calls) {
    if (seen.has(call.id)) continue
    seen.add(call.id)
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (call.t >= buckets[i]!.start) {
        if (call.t < (buckets[i + 1]?.start ?? Infinity)) buckets[i]!.weight += call.weight
        break
      }
    }
  }
  return buckets
}

export type Chart = { title: string; rows: string[]; axis: string; footer: string; width: number }

const LEVELS = ' ▁▂▃▄▅▆▇█'

/**
 * The bar chart of the buckets, as rows of text the popover draws, every row as wide as the
 * chart so it paints over what is under it. The bars are relative: the busiest is full height.
 * `isCompact` packs them for a narrow terminal; `height` is how many rows the bars take.
 */
export function chartOf (buckets: readonly Bucket[], kind: string, isCompact = false, height = 6): Chart {
  const isHours = kind === 'five_hour'
  const barWidth = isHours ? 1 : isCompact ? 3 : 5
  const gap = isHours ? (isCompact ? 0 : 1) : isCompact ? 1 : 2
  const width = buckets.length * barWidth + (buckets.length - 1) * gap
  const max = Math.max(...buckets.map(bucket => bucket.weight))
  const rows: string[] = []
  for (let row = height - 1; row >= 0; row--) {
    const cells = buckets.map(bucket => {
      // Eighths of a row: a bar with any use shows at least the lowest one.
      const eighths = bucket.weight > 0 ? Math.max(1, Math.round((bucket.weight / max) * height * 8)) : 0
      return LEVELS[Math.min(8, Math.max(0, eighths - row * 8))]!.repeat(barWidth)
    })
    rows.push(cells.join(' '.repeat(gap)))
  }
  // Under the bars: the hours 00, 06, 12 and 18 from their bar on, or every day centered under its bar.
  const axis = Array.from({ length: width }, () => ' ')
  buckets.forEach((bucket, i) => {
    if (isHours && Number(bucket.label) % 6 !== 0) return
    const label = isHours ? bucket.label : bucket.label.slice(0, barWidth)
    const centered = i * (barWidth + gap) + (isHours ? 0 : Math.floor((barWidth - label.length) / 2))
    const at = Math.min(Math.max(0, centered), width - label.length)
    for (let c = 0; c < label.length; c++) axis[at + c] = label[c]!
  })
  const busiest = buckets.reduce((top, bucket) => (bucket.weight > top.weight ? bucket : top), buckets[0]!)
  const title = isCompact
    ? (isHours ? 'Usage per hour, 24h' : 'Usage per day, 7 days')
    : (isHours ? 'Claude Code usage per hour, last 24h' : 'Claude Code usage per day, last 7 days')
  const footer = max === 0
    ? (isHours ? 'no use in the last 24 hours' : 'no use in the last 7 days')
    : `busiest: ${isHours ? `${busiest.label}:00` : busiest.label}`
  return {
    title: title.slice(0, width).padEnd(width),
    rows,
    axis: axis.join(''),
    footer: footer.slice(0, width).padEnd(width),
    width
  }
}
