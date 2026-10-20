import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode, SessionRateLimit, Timer } from 'claude-code'

import { bucketsFor, callsIn, chartOf, sinceFor } from './usage'
import type { Call } from './usage'
import type { Limit } from '../types'

const limits = atom({ plugin: 'sub-meter', key: 'limits' } as const, [] as Limit[])
const view = atom({ plugin: 'sub-meter', key: 'view' } as const, 0)
const isHovered = atom({ plugin: 'sub-meter', key: 'isHovered' } as const, false)
const scannedAt = atom({ plugin: 'sub-meter', key: 'scannedAt' } as const, 0)

const WINDOWS = ['five_hour', 'seven_day']
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week' }
const ROTATE_SECONDS = 8
const CELLS = 10
const CYCLE_HINT = /\s*\([^()]+ to cycle\)/
// The pointer going from the meter up onto its graph, over the prompt box between them, leaves one
// well before it enters the other: the graph stays up this long after a leave. Off both for good, the switch timer resumes, with at
// least a second to go. A pointer that left the terminal says nothing: after a minute with no
// word from it, the meter is no longer hovered.
const LEAVE_MS = 700
const MIN_RESUME_MS = 1000
const HOVER_TIMEOUT_MS = 60_000
// Under this many columns the graph packs its bars.
const COMPACT_COLUMNS = 64
const CHART_ROWS = 6
// The transcripts are looked at again when the graph opens, at most this often; a file over what
// one read takes is streamed instead.
const RESCAN_MS = 30_000
const MAX_READ_BYTES = 4 * 1024 * 1024

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

/** Keeps the latest reading for the meter, and for the next session until a response reports again. */
async function remember ($: EngineInterface, found: Limit[]) {
  if (found.length === 0) return
  await update($, limits, () => found)
  await $.store.set('limits', found)
}

// The model calls of every transcript of the last week, by path, as last read; and the scan running.
const transcripts = new Map<string, { mtimeMs: number; size: number; calls: Call[] }>()
let scanning: Promise<void> | undefined
let lastScan = -Infinity

/** Where Claude Code keeps its session transcripts: one folder per project, a `.jsonl` per session. */
async function projectsDir ($: EngineInterface) {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const root = config ?? (home === undefined ? undefined : `${home}/.claude`)
  return root === undefined ? undefined : `${root.replace(/[\\/]+$/, '')}/projects`
}

/** The model calls in one transcript: read at once, or streamed where it is bigger than a read takes. */
async function callsOf ($: EngineInterface, path: string, size: number, since: number): Promise<Call[]> {
  if (size < MAX_READ_BYTES) return callsIn(await $.fs.read(path), since)
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const calls: Call[] = []
  let rest = ''
  for await (const piece of $.process.spawn({ argv: isWindows ? ['cmd', '/c', 'type', path] : ['cat', path] })) {
    if (piece.stream !== 'stdout') continue
    const text = rest + piece.text
    const end = text.lastIndexOf('\n')
    rest = text.slice(end + 1)
    if (end >= 0) calls.push(...callsIn(text.slice(0, end), since))
  }
  calls.push(...callsIn(rest, since))
  return calls
}

/**
 * Reads again the transcripts written to in the last week (each session's, and its subagents'),
 * skipping those unchanged since the last look. Unreadable ones are left out.
 */
async function scan ($: EngineInterface) {
  const now = await $.clock.now()
  if (scanning || now - lastScan < RESCAN_MS) return scanning
  lastScan = now
  scanning = (async () => {
    const since = sinceFor('seven_day', now)
    const root = await projectsDir($)
    const seen = new Set<string>()
    const look = async (path: string, mtimeMs: number, size: number) => {
      seen.add(path)
      const known = transcripts.get(path)
      if (known && known.mtimeMs === mtimeMs && known.size === size) return
      const calls = await callsOf($, path, size, since).catch(() => [])
      transcripts.set(path, { mtimeMs, size, calls })
    }
    const list = (path: string) => $.fs.list(path).catch(() => [])
    for (const project of root === undefined ? [] : await list(root)) {
      if (project.kind !== 'dir') continue
      const folder = `${root}/${project.name}`
      for (const entry of await list(folder)) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.jsonl') || entry.mtimeMs < since) continue
        await look(`${folder}/${entry.name}`, entry.mtimeMs, entry.size)
        // A session's subagents write transcripts of their own, beside it.
        const subagents = `${folder}/${entry.name.slice(0, -'.jsonl'.length)}/subagents`
        for (const agent of await list(subagents)) {
          if (agent.kind === 'file' && agent.name.endsWith('.jsonl') && agent.mtimeMs >= since) await look(`${subagents}/${agent.name}`, agent.mtimeMs, agent.size)
        }
      }
    }
    for (const path of transcripts.keys()) if (!seen.has(path)) transcripts.delete(path)
    await update($, scannedAt, () => now)
  })().finally(() => {
    scanning = undefined
  })
  return scanning
}

function * allCalls () {
  for (const { calls } of transcripts.values()) yield * calls
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
    if (!(await read($, isHovered))) {
      await update($, isHovered, () => true)
      void scan($).catch(() => undefined)
    }
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
  transcripts.clear()
  lastScan = -Infinity

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('limits')
    if (Array.isArray(saved)) await update($, limits, () => saved as Limit[])

    const usage = await $.session.usage()
    await remember($, windowsOf(usage.rateLimits))

    await update($, isHovered, () => false)
    await schedule($, rotateMs)
    // The graph's data, read ahead so it shows at once; the session does not wait on it.
    if (e.isInteractive) void scan($).catch(() => undefined)
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
        </Box>
      </Box>
    )
  })

  // The graph, while the meter or the graph itself is hovered: in the band above the prompt, at its
  // right end over the meter. The footer's own slot clips anything drawn above its row.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ui = $.ui.resolve(e)
    if (!('Client' in ui) || e.viewport?.isFullscreen === false || e.props.hasSurvey || !(await read($, isHovered))) return next(e)
    const all = await read($, limits)
    if (all.length === 0) return next(e)

    const shown = all[(await read($, view)) % all.length]!
    const now = await $.clock.now()
    await read($, scannedAt)
    // The border and the title, axis and footer lines around the bars; and a space either side.
    const rows = Math.max(2, Math.min(CHART_ROWS, e.props.maxRows - 5))
    const isCompact = e.props.bodyColumns < COMPACT_COLUMNS
    const chart = chartOf(bucketsFor(allCalls(), shown.kind, now), shown.kind, isCompact, rows)
    const line = (text: string) => ` ${text} `
    const { Box, Client, Text } = ui
    const below: RenderElement = await next(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box key="graph" flexDirection="row" justifyContent="flex-end">
          <Box flexShrink={0}>
            <Box flexDirection="column" borderStyle="round" borderColor="claude" flexShrink={0} width={chart.width + 4}>
              <Text bold>{line(chart.title)}</Text>
              {chart.rows.map((row, i) => <Text key={`row-${i}`} color="claude">{line(row)}</Text>)}
              <Text dimColor>{line(chart.axis)}</Text>
              <Text dimColor>{line(chart.footer)}</Text>
            </Box>
            <Box position="absolute" top={0} left={0}>
              <Client key="graph-hit" module="./hit.tsx" width={chart.width + 4} height={chart.rows.length + 5} />
            </Box>
          </Box>
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
