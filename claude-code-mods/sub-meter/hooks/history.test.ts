// The usage history's arithmetic, run with the mod's tests: `claude plugin test .`
import { expect, test } from 'claude-code/testing'

import { bucketsFor, chartOf, merge, usedOf } from './history'

const HOUR = 3_600_000
const NOW = new Date(2026, 9, 12, 15, 30).getTime()
const RESET = '2026-10-12T18:00:00.000Z'
const NEXT_RESET = '2026-10-12T23:00:00.000Z'

test('counts the rise between readings, and all of a new window', () => {
  const used = usedOf([
    { t: 1, f: 10, fr: RESET },
    { t: 2, f: 25, fr: RESET },
    { t: 3, f: 25, fr: RESET },
    { t: 4, f: 5, fr: NEXT_RESET }
  ], 'five_hour')
  expect(used).toEqual([{ t: 2, used: 15 }, { t: 4, used: 5 }])
})

test('a fall with no reset reported starts a new window too', () => {
  expect(usedOf([{ t: 1, w: 40 }, { t: 2, w: 3 }], 'seven_day')).toEqual([{ t: 2, used: 3 }])
})

test('the 5-hour window in 24 hourly bars, the current hour last', () => {
  const buckets = bucketsFor([
    { t: NOW - 3 * HOUR, f: 10 },
    { t: NOW - 3 * HOUR + 60_000, f: 30 },
    { t: NOW - 60_000, f: 42 }
  ], 'five_hour', NOW)
  expect(buckets).toHaveLength(24)
  expect(buckets[23]!.label).toBe('15')
  expect(buckets[23]!.used).toBe(12)
  expect(buckets[20]!.used).toBe(20)
})

test('the weekly window in 7 daily bars, today last', () => {
  const buckets = bucketsFor([
    { t: NOW - 2 * 24 * HOUR, w: 10 },
    { t: NOW - 2 * 24 * HOUR + HOUR, w: 14 },
    { t: NOW, w: 20 }
  ], 'seven_day', NOW)
  expect(buckets.map(bucket => bucket.label)).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'])
  expect(buckets[4]!.used).toBe(4)
  expect(buckets[6]!.used).toBe(6)
})

test('every row of the chart is as wide as the chart', () => {
  for (const kind of ['five_hour', 'seven_day']) {
    for (const isCompact of [false, true]) {
      const chart = chartOf(bucketsFor([{ t: NOW - HOUR, f: 1, w: 1 }, { t: NOW, f: 9, w: 9 }], kind, NOW), kind, isCompact)
      for (const row of chart.rows) expect(row.gutter.length + row.bars.length).toBe(chart.width)
      expect(chart.axis.length).toBe(chart.width)
      expect(chart.title.length).toBe(chart.width)
      expect(chart.footer.length).toBe(chart.width)
    }
  }
})

test('merging keeps every session\'s readings once, in order, and drops repeats and old ones', () => {
  const old = { t: NOW - 9 * 24 * HOUR, f: 1 }
  const merged = merge(NOW, [old, { t: NOW - 2, f: 5 }], [{ t: NOW - 3, f: 4 }, { t: NOW - 2, f: 5 }, { t: NOW - 1, f: 5 }])
  expect(merged).toEqual([{ t: NOW - 3, f: 4 }, { t: NOW - 2, f: 5 }])
})
