// The usage history behind the graph: readings of both windows over time, and what was used in
// each hour or day between them. Plain functions, no `$`: the hooks module stores and draws.
import type { Limit, Sample } from '../types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// How long readings are kept: the week the graph shows, and a day before it for a baseline.
const KEEP_MS = 8 * DAY
const MAX_SAMPLES = 5000
// A window's `resetsAt` only moves when a new window starts, and then by hours: a smaller
// difference is the same window reported again.
const NEW_WINDOW_MS = 30 * 60_000
const LEVELS = ' ▁▂▃▄▅▆▇█'
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A reading of the windows found, as one sample at `t`. */
export function sampleOf (t: number, found: readonly Limit[]): Sample {
  const sample: Sample = { t }
  for (const limit of found) {
    if (limit.kind === 'five_hour') Object.assign(sample, { f: limit.percentUsed, fr: limit.resetsAt })
    if (limit.kind === 'seven_day') Object.assign(sample, { w: limit.percentUsed, wr: limit.resetsAt })
  }
  return sample
}

const sameReading = (a: Sample, b: Sample) => a.f === b.f && a.w === b.w && a.fr === b.fr && a.wr === b.wr

/**
 * Both histories as one, oldest first: every session of this user writes to the same store, so
 * what another wrote since this one read it is kept. Repeats of the same reading are dropped,
 * as are readings older than the graph needs.
 */
export function merge (now: number, ...lists: ReadonlyArray<readonly Sample[]>): Sample[] {
  const byTime = new Map<number, Sample>()
  for (const list of lists) for (const sample of list) byTime.set(sample.t, sample)
  const sorted = [...byTime.values()].filter(sample => sample.t >= now - KEEP_MS).sort((a, b) => a.t - b.t)
  const kept = sorted.filter((sample, i) => i === 0 || !sameReading(sorted[i - 1]!, sample))
  return kept.slice(-MAX_SAMPLES)
}

/** Whether a stored value is a history this module wrote. */
export const isHistory = (value: unknown): value is Sample[] =>
  Array.isArray(value) && value.every(sample => typeof sample === 'object' && sample !== null && typeof (sample as Sample).t === 'number')

/**
 * What was used of one window between readings, at the time of the later one: the rise since
 * the reading before, or all of it where a new window started (its reset moved, or it fell).
 */
export function usedOf (samples: readonly Sample[], kind: string): Array<{ t: number; used: number }> {
  const valueOf = (s: Sample) => (kind === 'five_hour' ? s.f : s.w)
  const resetOf = (s: Sample) => (kind === 'five_hour' ? s.fr : s.wr)
  const used: Array<{ t: number; used: number }> = []
  let prev: Sample | undefined
  for (const sample of samples) {
    const value = valueOf(sample)
    if (value === undefined) continue
    if (prev !== undefined) {
      const before = valueOf(prev)!
      const reset = resetOf(sample)
      const resetBefore = resetOf(prev)
      const hasMoved = reset !== undefined && resetBefore !== undefined && Math.abs(Date.parse(reset) - Date.parse(resetBefore)) > NEW_WINDOW_MS
      const rise = hasMoved || value < before ? value : value - before
      if (rise > 0) used.push({ t: sample.t, used: rise })
    }
    prev = sample
  }
  return used
}

export type Bucket = { start: number; label: string; used: number }

/** Where the hour (or the local calendar day) holding `t` starts. */
function startOf (t: number, unit: 'hour' | 'day') {
  const date = new Date(t)
  if (unit === 'day') date.setHours(0, 0, 0, 0)
  else date.setMinutes(0, 0, 0)
  return date.getTime()
}

/**
 * The graph's bars: for the 5-hour window, what was used of it in each of the last 24 hours;
 * for the weekly one, in each of the last 7 days. The current hour or day is last.
 */
export function bucketsFor (samples: readonly Sample[], kind: string, now: number): Bucket[] {
  const unit = kind === 'five_hour' ? 'hour' : 'day'
  const count = unit === 'hour' ? 24 : 7
  const buckets: Bucket[] = []
  let start = startOf(now, unit)
  for (let i = 0; i < count; i++) {
    const date = new Date(start)
    const label = unit === 'hour' ? String(date.getHours()).padStart(2, '0') : DAY_NAMES[date.getDay()]!
    buckets.unshift({ start, label, used: 0 })
    // A day before midnight is a calendar day back, whatever the clocks did that day.
    start = unit === 'hour' ? start - HOUR : startOf(start - HOUR, 'day')
  }
  for (const { t, used } of usedOf(samples, kind)) {
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i]!.start) {
        if (t < (buckets[i + 1]?.start ?? Infinity)) buckets[i]!.used += used
        break
      }
    }
  }
  return buckets
}

/** A chart row: the scale beside it (`gutter`) and the bars (`bars`), drawn in two colors. */
export type ChartRow = { gutter: string; bars: string }
export type Chart = { title: string; rows: ChartRow[]; axis: string; footer: string; width: number }

const ROWS = 6
const GUTTER = 6

/** "38%", "4.5%", "0.3%": a share of a window, short. */
export const percentOf = (n: number) => (n >= 10 || n === 0 ? `${Math.round(n)}%` : `${Math.round(n * 10) / 10}%`)

/**
 * The bar chart of the buckets, as rows of text the popover draws, every row as wide as the
 * chart so it paints over what is under it. `isCompact` packs the bars for a narrow terminal.
 */
export function chartOf (buckets: readonly Bucket[], kind: string, isCompact = false): Chart {
  const isHours = kind === 'five_hour'
  const barWidth = isHours ? 1 : isCompact ? 3 : 5
  const gap = isHours ? (isCompact ? 0 : 1) : isCompact ? 1 : 2
  const plotWidth = buckets.length * barWidth + (buckets.length - 1) * gap
  const width = GUTTER + plotWidth
  const max = Math.max(...buckets.map(bucket => bucket.used))
  const scale = max > 0 ? max : 1
  const rows: ChartRow[] = []
  for (let row = ROWS - 1; row >= 0; row--) {
    const gutter = row === ROWS - 1 && max > 0 ? percentOf(max) : row === 0 ? '0%' : ''
    const cells = buckets.map(bucket => {
      // Eighths of a row: a bar with any use shows at least the lowest one.
      const eighths = bucket.used > 0 ? Math.max(1, Math.round((bucket.used / scale) * ROWS * 8)) : 0
      const fill = Math.min(8, Math.max(0, eighths - row * 8))
      return LEVELS[fill]!.repeat(barWidth)
    })
    rows.push({ gutter: `${gutter.padStart(GUTTER - 2)} │`, bars: cells.join(' '.repeat(gap)) })
  }
  // Under the bars: the hours 00, 06, 12 and 18 from their bar on, or every day centered under its bar.
  const axis = Array.from({ length: plotWidth }, () => ' ')
  buckets.forEach((bucket, i) => {
    if (isHours && Number(bucket.label) % 6 !== 0) return
    const label = isHours ? bucket.label : bucket.label.slice(0, barWidth)
    const centered = i * (barWidth + gap) + (isHours ? 0 : Math.floor((barWidth - label.length) / 2))
    const at = Math.min(Math.max(0, centered), plotWidth - label.length)
    for (let c = 0; c < label.length; c++) axis[at + c] = label[c]!
  })
  const total = buckets.reduce((sum, bucket) => sum + bucket.used, 0)
  const title = isCompact
    ? (isHours ? '5h · per hour, 24h' : 'Week · per day, 7 days')
    : (isHours ? '5h window · used per hour, last 24h' : 'Weekly window · used per day, last 7 days')
  const footer = max === 0 ? 'no usage recorded yet' : `total ${percentOf(total)} · peak ${percentOf(max)}`
  return {
    title: title.slice(0, width).padEnd(width),
    rows,
    axis: `${' '.repeat(GUTTER)}${axis.join('')}`,
    footer: footer.slice(0, width).padEnd(width),
    width
  }
}
