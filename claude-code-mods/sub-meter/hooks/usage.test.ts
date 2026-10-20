// The usage graph's arithmetic, run with the mod's tests: `claude plugin test .`
import { expect, test } from 'claude-code/testing'

import { bucketsFor, callsIn, chartOf, weightOf } from './usage'

const HOUR = 3_600_000
const NOW = new Date(2026, 9, 12, 15, 30).getTime()
const line = (id: string, t: number, usage: object, model = 'claude-opus-5-5', type = 'assistant') =>
  JSON.stringify({ type, timestamp: new Date(t).toISOString(), message: { id, model, usage } })

test('weighs output over input, cache reads under it, and bigger models over smaller', () => {
  expect(weightOf('claude-opus-5-5', { output_tokens: 1 })).toBe(weightOf('claude-opus-5-5', { input_tokens: 5 }))
  expect(Math.round(weightOf('claude-sonnet-5-5', { cache_read_input_tokens: 10 }) * 1000)).toBe(Math.round(weightOf('claude-sonnet-5-5', { input_tokens: 1 }) * 1000))
  expect(weightOf('claude-fable-5-1', { input_tokens: 1 })).toBeGreaterThan(weightOf('claude-opus-5-5', { input_tokens: 1 }))
  expect(weightOf('claude-opus-5-5', { input_tokens: 1 })).toBeGreaterThan(weightOf('claude-haiku-5-5', { input_tokens: 1 }))
})

test('reads one call per message id, since the time asked, and nothing else', () => {
  const text = [
    line('a', NOW - HOUR, { output_tokens: 10 }),
    line('a', NOW - HOUR, { output_tokens: 10 }),
    line('old', NOW - 10 * 24 * HOUR, { output_tokens: 10 }),
    line('fake', NOW, { output_tokens: 10 }, '<synthetic>'),
    line('user', NOW, { output_tokens: 10 }, 'claude-opus-5-5', 'user'),
    'not json "usage" "assistant"',
    ''
  ].join('\n')
  expect(callsIn(text, NOW - 24 * HOUR).map(call => call.id)).toEqual(['a'])
})

test('the 5-hour window in 24 hourly bars, the current hour last, a call copied twice counted once', () => {
  const calls = [{ id: 'a', t: NOW - 3 * HOUR, weight: 4 }, { id: 'a', t: NOW - 3 * HOUR, weight: 4 }, { id: 'b', t: NOW - 60_000, weight: 1 }]
  const buckets = bucketsFor(calls, 'five_hour', NOW)
  expect(buckets).toHaveLength(24)
  expect(buckets[23]!.label).toBe('15')
  expect(buckets[23]!.weight).toBe(1)
  expect(buckets[20]!.weight).toBe(4)
})

test('the weekly window in 7 daily bars, today last', () => {
  const buckets = bucketsFor([{ id: 'a', t: NOW - 2 * 24 * HOUR, weight: 3 }, { id: 'b', t: NOW, weight: 1 }], 'seven_day', NOW)
  expect(buckets.map(bucket => bucket.label)).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'])
  expect(buckets[4]!.weight).toBe(3)
  expect(buckets[6]!.weight).toBe(1)
})

test('every row of the chart is as wide as the chart, and the busiest bar is full height', () => {
  for (const kind of ['five_hour', 'seven_day']) {
    for (const isCompact of [false, true]) {
      const chart = chartOf(bucketsFor([{ id: 'a', t: NOW - HOUR, weight: 1 }, { id: 'b', t: NOW, weight: 9 }], kind, NOW), kind, isCompact)
      for (const row of [chart.title, ...chart.rows, chart.axis, chart.footer]) expect(row.length).toBe(chart.width)
      expect(chart.rows[0]).toMatch(/█+$/)
    }
  }
})
