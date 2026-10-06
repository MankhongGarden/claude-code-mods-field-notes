import { expect, test } from 'claude-code/testing'

import { buildLines, modeFromHint, prettyModel, projectSegs, shortTokens, stripModePill, untilReset } from '../hooks/register'
import { tempLabel, workedLabel } from '../hooks/project'
import type { FuelSnapshot } from '../types'

const NOW = Date.parse('2026-10-07T10:00:00Z')
const SNAP: FuelSnapshot = {
  turn: 27,
  model: 'Opus 5.5',
  effort: 'high',
  tokens: 338_000,
  window: 1_000_000,
  threshold: 470_000,
  fiveHour: { percent: 78, resetsAt: '2026-10-07T10:48:00Z' },
  sevenDay: { percent: 31, resetsAt: '2026-10-10T11:00:00Z' },
}
const text = (lines: { text: string }[][]) => lines.map(l => l.map(s => s.text).join(''))

test('model ids read as short names', () => {
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(prettyModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
})

test('token counts and reset times are short', () => {
  expect(shortTokens(338_000)).toBe('338.0k')
  expect(shortTokens(451_270)).toBe('451.3k')
  expect(shortTokens(1_000_000)).toBe('1M')
  expect(untilReset('2026-10-07T10:48:00Z', NOW)).toBe('48m')
  expect(untilReset('2026-10-07T12:15:00Z', NOW)).toBe('2h15m')
  expect(untilReset('2026-10-10T11:00:00Z', NOW)).toBe('3d1h')
  expect(untilReset('2026-10-07T09:00:00Z', NOW)).toBeUndefined()
})

test('mode is read from the hint and its pill is removed', () => {
  const hint = '⏵⏵ auto mode on (shift+tab to cycle)'
  expect(modeFromHint(hint)).toBe('auto')
  expect(stripModePill(hint)).toBe('')
  expect(modeFromHint('? for shortcuts')).toBeUndefined()
})

test('wide screen shows everything; gauge counts to auto-compact', () => {
  const [line] = text(buildLines(SNAP, 'auto', 'esc to interrupt', 140, NOW))
  expect(line).toContain(' AUTO ')
  expect(line).toContain('T27')
  expect(line).toContain('Opus 5.5 · high')
  expect(line).toContain('71.9% 338.0k/1M')
  expect(line).toContain('5h 78.0% (48m)')
  expect(line).toContain('7D 31.0% (3d1h)')
  expect(line).toContain('esc to interrupt')
})

test('narrowing drops hint, then resets, then quota, keeping the k count', () => {
  const at = (cols: number) => text(buildLines(SNAP, 'auto', 'esc to interrupt', cols, NOW))
  expect(at(100)[0]).not.toContain('esc to interrupt')
  expect(at(100)[0]).toContain('(48m)')
  expect(at(86)[0]).not.toContain('(48m)')
  expect(at(86)[0]).toContain('5h 78.0%')
  expect(at(62)[0]).not.toContain('5h')
  expect(at(62)[0]).toContain('338.0k/1M')
  const two = at(40)
  expect(two.length).toBe(2)
  expect(two[1]).toContain('71.9% 338.0k/1M')
})

test('project line: name, weather to one decimal, time worked', () => {
  const w = { tempC: 24.25, code: 0, isDay: false, humidity: 88, rainChance: 47, city: 'Bangkok', at: NOW }
  const line = projectSegs('My Project', w, 0, (4 * 60 + 20) * 60_000).map(s => s.text).join('')
  expect(line).toContain('MY PROJECT')
  expect(line).toContain('24.3° กลางคืน')
  expect(line).toContain('ฝน 47%')
  expect(line).toContain('ทำงานมาแล้ว 4:20 hr')
  expect(tempLabel(31)).toBe('31.0°')
  expect(workedLabel(5 * 60_000)).toBe('0:05 hr')
  expect(projectSegs('x', null, 0, undefined).map(s => s.text).join('')).toContain('กำลังโหลดอากาศ')
})

test('quota % uses the gauge colors: green under 60, amber 60-85, red over 85', () => {
  const colorOf = (pct: number) => {
    const [line] = buildLines({ ...SNAP, fiveHour: { percent: pct } }, undefined, '', 200, NOW)
    return line!.find(s => s.text === `${pct.toFixed(1)}%`)?.color
  }
  expect(colorOf(25)).toBe('#3f8a3a')
  expect(colorOf(70)).toBe('#a06c00')
  expect(colorOf(92)).toBe('#b8322b')
})
