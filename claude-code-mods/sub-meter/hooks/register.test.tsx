// Mod tests, run against the engine itself: `claude plugin test .`
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const NOW = Date.parse('2026-10-12T10:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const HOUR = 3_600_000
const LIMITS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 58, resetsAt: at(2 * HOUR + 10 * 60_000) },
  { kind: 'seven_day', percentUsed: 23.5, resetsAt: at(76 * HOUR) }
]

/** Everything beneath the mod: the clock, the store, the session's usage and what the engine draws. */
function world (on: On, rateLimits: SessionRateLimit[] = LIMITS) {
  const clock = mock.clock(on, { now: NOW })
  const store: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits } as never }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return 'hint' in e.props ? <Text>{e.props.hint}</Text> : <Box key="engine" />
  })
  return { clock, store }
}

const startSession = ($: Engine) => $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
const footer = ($: Engine, modes: string[] = []) =>
  $.ui.mount({ plugin: 'sub-meter', surface: 'terminal', component: 'SessionMode', props: { modes } })
const hint = ($: Engine, text: string) =>
  $.ui.mount({ plugin: 'sub-meter', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: text } })

test('shows the 5-hour window first, as a bar with the time until it resets', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '━━━━━━' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '────' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 58%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · 2h 10m' })).toBeDefined()
})

test('takes turns with the weekly window', async ($, on) => {
  const w = world(on)
  await startSession($)
  await w.clock.advance(8000)
  const ui = await footer($)
  expect(await ui.find({ type: 'Text', text: 'week ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · 3d 4h' })).toBeDefined()
})

test('takes turns as often as rotateSeconds says', { options: { rotateSeconds: 30 } }, async ($, on) => {
  const w = world(on)
  await startSession($)
  await w.clock.advance(8000)
  expect(await (await footer($)).find({ type: 'Text', text: '5h ' })).toBeDefined()
  await w.clock.advance(22_000)
  expect(await (await footer($)).find({ type: 'Text', text: 'week ' })).toBeDefined()
})

test("keeps the engine's mode labels before the meter", async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($, ['focus'])
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
})

test("keeps another plugin's drawing there before the meter, with no mode labels", async ($, on) => {
  // Beneath the meter: another plugin's switch, where the engine has no labels to draw.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'⏵ narrator on'}</Text>
  })
  world(on)
  await startSession($)
  const ui = await footer($)
  expect(await ui.find({ type: 'Text', text: '⏵ narrator on' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
})

test('off a subscription the engine draws its own footer', async ($, on) => {
  world(on, [])
  await startSession($)
  const ui = await footer($)
  expect(await ui.find({ key: 'engine' })).toBeDefined()
})

test('a new measurement shows at once and is kept for the next session', async ($, on) => {
  const w = world(on, [])
  await startSession($)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ ...LIMITS[0], percentUsed: 91 }], changed: ['rateLimits'] } as never)
  const ui = await footer($)
  const used = await ui.find({ type: 'Text', text: '━━━━━━━━━' })
  expect(used?.props.color).toBe('error')
  expect(w.store.limits).toEqual([{ ...LIMITS[0], percentUsed: 91 }])
})

test('a window past its reset shows as empty', async ($, on) => {
  const w = world(on)
  await startSession($)
  await w.clock.set(NOW + 3 * HOUR)
  const ui = await footer($)
  expect(await ui.find({ type: 'Text', text: ' 0%' })).toBeDefined()
})

test('drops the cycle hint from the line after the mode', async ($, on) => {
  world(on)
  const ui = await hint($, '(shift+tab to cycle) · ← for agents')
  expect(await ui.find({ type: 'Text', text: '← for agents' })).toBeDefined()
})

test('keeps what is around the cycle hint, without empty parts', async ($, on) => {
  world(on)
  const ui = await hint($, 'esc to interrupt (shift+tab to cycle) ·  · ctrl+t to hide tasks')
  expect(await ui.find({ type: 'Text', text: 'esc to interrupt · ctrl+t to hide tasks' })).toBeDefined()
})

test('leaves every other hint as it is', async ($, on) => {
  world(on)
  const ui = await hint($, '? for shortcuts')
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
})

// The fork's pointer targets: a click on the meter shows the other window, the pointer on it (or
// on its graph) holds the switch and shows the graph. The pointer reaches them in fullscreen.
const VIEWPORT = { columns: 120, rows: 40, isFullscreen: true }
const fullscreen = ($: Engine) =>
  $.ui.mount({ plugin: 'sub-meter', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: VIEWPORT })
const click = async (ui: Awaited<ReturnType<typeof fullscreen>>) => {
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'meter-hit' })
  await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'meter-hit' })
}

test('off fullscreen the meter has no pointer target and no graph', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'sub-meter', surface: 'terminal', component: 'SessionMode', props: { modes: [] }, viewport: { ...VIEWPORT, isFullscreen: false } })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
})

test('a click on the meter shows the other window at once', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await fullscreen($)
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
  await click(ui)
  expect(await ui.find({ type: 'Text', text: 'week ' })).toBeDefined()
  await click(ui)
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
})

test('the pointer on the meter holds the switch, and shows the graph above it', async ($, on) => {
  const w = world(on)
  await startSession($)
  const ui = await fullscreen($)
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'meter-hit' })
  expect(await ui.find({ key: 'graph' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h window · used per hour/ })).toBeDefined()
  await w.clock.advance(60_000)
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
})

test('the pointer going from the meter onto the graph keeps it up', async ($, on) => {
  const w = world(on)
  await startSession($)
  const ui = await fullscreen($)
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'meter-hit' })
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'meter-hit' })
  await ui.pointer({ type: 'enter', x: 3, y: 3, in: 'graph-hit' })
  await w.clock.advance(1000)
  expect(await ui.find({ key: 'graph' })).toBeDefined()
  await ui.pointer({ type: 'leave', x: 3, y: 3, in: 'graph-hit' })
  await w.clock.advance(300)
  expect(await ui.find({ key: 'graph' })).toBeUndefined()
})

test('the switch picks up where it was paused once the pointer leaves', async ($, on) => {
  const w = world(on)
  await startSession($)
  const ui = await fullscreen($)
  await w.clock.advance(5000)
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'meter-hit' })
  await w.clock.advance(20_000)
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'meter-hit' })
  // The leave lets the graph go after a moment; then the 3 seconds left of the 8 run out.
  await w.clock.advance(250 + 2500)
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
  await w.clock.advance(600)
  expect(await ui.find({ type: 'Text', text: 'week ' })).toBeDefined()
})

test('a click starts the switch timer over', async ($, on) => {
  const w = world(on)
  await startSession($)
  const ui = await fullscreen($)
  await w.clock.advance(6000)
  await click(ui)
  await ui.pointer({ type: 'leave', x: 1, y: 0, in: 'meter-hit' })
  // Left alone after the click, the weekly window gets its full 8 seconds.
  await w.clock.advance(250 + 7000)
  expect(await ui.find({ type: 'Text', text: 'week ' })).toBeDefined()
  await w.clock.advance(1100)
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
})

test('the graph follows the window shown: per day for the weekly one', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await fullscreen($)
  await click(ui)
  expect(await ui.find({ type: 'Text', text: /Weekly window · used per day/ })).toBeDefined()
})

test('the graph draws what was used between readings, and keeps the history', { options: { rotateSeconds: 3600 } }, async ($, on) => {
  const w = world(on)
  await startSession($)
  await w.clock.advance(10 * 60_000)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ ...LIMITS[0], percentUsed: 70 }, LIMITS[1]], changed: ['rateLimits'] } as never)
  const ui = await fullscreen($)
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'meter-hit' })
  // 58% then 70%: 12 points of the 5-hour window used in this hour.
  expect(await ui.find({ type: 'Text', text: /total 12% · peak 12%/ })).toBeDefined()
  // The current hour, last, is the tallest bar.
  expect(await ui.find({ type: 'Text', text: /█ $/ })).toBeDefined()
  expect((w.store.history as unknown[]).length).toBe(2)
})
