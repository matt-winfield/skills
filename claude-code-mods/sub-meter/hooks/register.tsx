import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode, SessionRateLimit, Timer } from 'claude-code'

import { bucketsFor, chartOf, isHistory, merge, sampleOf } from './history'
import type { Limit, Sample } from '../types'

const limits = atom({ plugin: 'sub-meter', key: 'limits' } as const, [] as Limit[])
const view = atom({ plugin: 'sub-meter', key: 'view' } as const, 0)
const isHovered = atom({ plugin: 'sub-meter', key: 'isHovered' } as const, false)
const history = atom({ plugin: 'sub-meter', key: 'history' } as const, [] as Sample[])

const WINDOWS = ['five_hour', 'seven_day']
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week' }
const ROTATE_SECONDS = 8
const CELLS = 10
const CYCLE_HINT = /\s*\([^()]+ to cycle\)/
// The pointer going from the meter up onto its graph leaves one before it enters the other: the
// graph stays up this long after a leave. Off both for good, the switch timer resumes, with at
// least a second to go. A pointer that left the terminal says nothing: after a minute with no
// word from it, the meter is no longer hovered.
const LEAVE_MS = 250
const MIN_RESUME_MS = 1000
const HOVER_TIMEOUT_MS = 60_000
// Under this many columns the graph packs its bars.
const COMPACT_COLUMNS = 64

/** The subscription windows the meter shows, in order, from what the engine measured. */
const windowsOf = (rateLimits: readonly SessionRateLimit[]): Limit[] =>
  WINDOWS.flatMap(kind => {
    const found = rateLimits.find(limit => limit.kind === kind)
    return found ? [{ kind, percentUsed: found.percentUsed, resetsAt: found.resetsAt }] : []
  })

/** Whether a drawing beneath shows nothing: no text, no control (the engine's own node is empty). */
function isBlank (node: RenderNode | undefined): boolean {
  if (node === undefined || node === null) return true
  if (typeof node === 'string') return node.trim() === ''
  return (node.type === 'Box' || node.type === 'Text') && (node.children ?? []).every(isBlank)
}

const colorFor = (percent: number) => (percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'claude')

/** "42m", "3h 5m", "2d 4h": how long until the window resets. */
function until (ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * Keeps the latest reading for the meter, and for the next session until a response reports
 * again; and adds it to the history the graph draws, with what other sessions stored since.
 */
async function remember ($: EngineInterface, found: Limit[]) {
  if (found.length === 0) return
  await update($, limits, () => found)
  await $.store.set('limits', found)

  const now = await $.clock.now()
  const stored = await $.store.get('history')
  const merged = merge(now, isHistory(stored) ? stored : [], await read($, history), [sampleOf(now, found)])
  await update($, history, () => merged)
  await $.store.set('history', merged)
}

// The switch timer: when it is due, and, while it is paused, how long it had left.
let timer: Timer | undefined
let dueAt = 0
let pausedWith: number | undefined
let rotateMs = ROTATE_SECONDS * 1000
// Which of the pointer targets the pointer is on, and the timers that end a hover.
const over = { meter: false, graph: false }
let leaving: Timer | undefined
let silence: Timer | undefined

async function schedule ($: EngineInterface, ms: number) {
  timer?.cancel()
  dueAt = (await $.clock.now()) + ms
  timer = $.clock.after(ms, () => {
    timer = undefined
    void rotate($)
  })
}

/** Shows the other window, and starts its time over. */
async function rotate ($: EngineInterface) {
  await update($, view, n => n + 1)
  if (pausedWith !== undefined) pausedWith = rotateMs
  else await schedule($, rotateMs)
}

async function pause ($: EngineInterface) {
  if (pausedWith !== undefined) return
  pausedWith = timer ? Math.max(0, dueAt - (await $.clock.now())) : rotateMs
  timer?.cancel()
  timer = undefined
}

async function resume ($: EngineInterface) {
  if (pausedWith === undefined) return
  const left = pausedWith
  pausedWith = undefined
  await schedule($, Math.max(left, MIN_RESUME_MS))
}

/** The pointer came onto a target (or moved on it) or left it: the graph shows while it is on either. */
async function point ($: EngineInterface, target: keyof typeof over, isOver: boolean) {
  over[target] = isOver
  silence?.cancel()
  if (over.meter || over.graph) {
    leaving?.cancel()
    leaving = undefined
    silence = $.clock.after(HOVER_TIMEOUT_MS, () => { void unhover($) })
    await pause($)
    if (!(await read($, isHovered))) await update($, isHovered, () => true)
    return
  }
  leaving ??= $.clock.after(LEAVE_MS, () => {
    leaving = undefined
    if (!over.meter && !over.graph) void unhover($)
  })
}

async function unhover ($: EngineInterface) {
  over.meter = false
  over.graph = false
  await update($, isHovered, () => false)
  await resume($)
}

export const register: Register = (on, options) => {
  const hideCycleHint = options.hideCycleHint !== false
  const rotateSeconds = Number(options.rotateSeconds)
  rotateMs = (rotateSeconds > 0 ? rotateSeconds : ROTATE_SECONDS) * 1000
  timer = undefined
  pausedWith = undefined
  over.meter = false
  over.graph = false

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('limits')
    if (Array.isArray(saved)) await update($, limits, () => saved as Limit[])
    const stored = await $.store.get('history')
    if (isHistory(stored)) {
      const kept = merge(await $.clock.now(), stored)
      await update($, history, () => kept)
    }

    const usage = await $.session.usage()
    await remember($, windowsOf(usage.rateLimits))

    await update($, isHovered, () => false)
    await schedule($, rotateMs)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await remember($, windowsOf(e.rateLimits))
    return next(e)
  })

  // The meter and its graph say where the pointer is; a click on either shows the other window.
  on('ui.message', async ($, e, next) => {
    const result = await next(e)
    const target = e.element === 'meter-hit' ? 'meter' : e.element === 'graph-hit' ? 'graph' : undefined
    if (target === undefined) return result
    const data = e.data as { isOver?: unknown; isClicked?: unknown } | null
    await point($, target, data?.isOver === true)
    if (data?.isClicked === true) await rotate($)
    return result
  })

  // Bottom right of the prompt footer: the engine's mode labels, then the meter.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const all = await read($, limits)
    if (all.length === 0) return next(e)

    const now = await $.clock.now()
    const shown = all[(await read($, view)) % all.length]!
    const resetsIn = shown.resetsAt === undefined ? undefined : Date.parse(shown.resetsAt) - now
    const hasReset = resetsIn !== undefined && resetsIn <= 0
    const percent = hasReset ? 0 : shown.percentUsed
    const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * CELLS)
    // The engine's own labels, and what any other plugin draws there (a switch), stay as drawn, before the meter.
    const beneath = await next(e)
    const labels = e.props.modes.length > 0 || !isBlank(beneath) ? beneath : null
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // The pointer reaches a `Client` on the terminal, and there only in fullscreen.
    const Client = 'Client' in ui && e.viewport?.isFullscreen !== false ? ui.Client : undefined
    const hovered = Client !== undefined && (await read($, isHovered))

    const label = `${LABELS[shown.kind] ?? shown.kind} `
    const tail = resetsIn !== undefined && !hasReset ? ` · ${until(resetsIn)}` : ''
    const width = label.length + CELLS + ` ${Math.round(percent)}%`.length + tail.length

    let graph: RenderElement | null = null
    if (Client && hovered) {
      const isCompact = (e.viewport?.columns ?? 80) < COMPACT_COLUMNS
      const chart = chartOf(bucketsFor(await read($, history), shown.kind, now), shown.kind, isCompact)
      const line = (text: string) => ` ${text} `
      graph = (
        <Box key="graph" position="absolute" bottom={1} right={0}>
          <Box flexDirection="column" borderStyle="round" borderColor="claude" flexShrink={0} width={chart.width + 4}>
            <Text bold>{line(chart.title)}</Text>
            {chart.rows.map((row, i) => (
              <Box key={`row-${i}`} flexDirection="row">
                <Text dimColor> {row.gutter}</Text>
                <Text color="claude">{row.bars} </Text>
              </Box>
            ))}
            <Text dimColor>{line(chart.axis)}</Text>
            <Text dimColor>{line(chart.footer)}</Text>
          </Box>
          <Box position="absolute" top={0} left={0}>
            <Client key="graph-hit" module="./hit.tsx" width={chart.width + 4} height={chart.rows.length + 5} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row">
        {labels}
        {labels ? <Text dimColor> · </Text> : null}
        <Box key="meter" flexDirection="row">
          {hovered ? <Text bold color="claude">{label}</Text> : <Text dimColor>{label}</Text>}
          <Text color={colorFor(percent)}>{'━'.repeat(filled)}</Text>
          <Text dimColor>{'─'.repeat(CELLS - filled)}</Text>
          <Text> {Math.round(percent)}%</Text>
          {tail ? <Text dimColor>{tail}</Text> : null}
          {Client
            ? (
              <Box position="absolute" top={0} left={0}>
                <Client key="meter-hit" module="./hit.tsx" width={width} height={1} />
              </Box>
              )
            : null}
          {graph}
        </Box>
      </Box>
    )
  })

  // The engine draws the mode label itself; the hint line after it starts with "(shift+tab to cycle)".
  if (hideCycleHint) {
    on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
      if (!CYCLE_HINT.test(e.props.hint)) return next(e)

      const hint = e.props.hint
        .replace(CYCLE_HINT, ' · ')
        .split('·')
        .map(part => part.trim())
        .filter(Boolean)
        .join(' · ')
      return next({ ...e, props: { ...e.props, hint } })
    })
  }
}
