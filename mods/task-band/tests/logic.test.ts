import { expect, test } from 'claude-code/testing'

import { average, insertOrdered, viewOrder, cellWidth, chipSegs, frameBottom, frameTop, rowPad, clearFinished, clock, estimate, navLabel, pageOf, paginate, parseNotifications, pushSample, segWidth, statusOf, stoppedTaskId } from '../hooks/logic'
import type { BandTask } from '../types'

const T0 = 1_000_000
const text = (segs: { text: string }[]) => segs.map(s => s.text).join('')
const agent = (over: Partial<BandTask> = {}): BandTask => ({ id: 'a1', kind: 'agent', label: 'หาไฟล์ config', agentType: 'Explore', startedAt: T0, status: 'running', ...over })

test('elapsed clock', () => {
  expect(clock(72_000)).toBe('1:12')
  expect(clock(3_725_000)).toBe('1:02:05')
})

test('estimate needs 3 samples and caps at 95', () => {
  expect(average([10, 20])).toBe(undefined)
  expect(average([10, 20, 30])).toBe(20)
  expect(pushSample(Array.from({ length: 10 }, (_, i) => i), 99).length).toBe(10)
  expect(estimate(62_000, 100_000)).toBe(62)
  expect(estimate(500_000, 100_000)).toBe(95)
  expect(estimate(1000, undefined)).toBe(undefined)
})

test('agent with history shows ~percent, without shows sweep + time', () => {
  expect(text(chipSegs(agent({ estMs: 100_000 }), T0 + 62_000, 2))).toBe('⠹ agent หาไฟล์ config ━━━━━─── ~62% 1:02')
  expect(text(chipSegs(agent(), T0 + 5_000, 2))).toBe('⠹ agent หาไฟล์ config ──━━──── 0:05')
})

test('workflow counts finished/started agents', () => {
  const wf: BandTask = { id: 'w', kind: 'wf', label: 'review-changes', startedAt: T0, status: 'running', members: ['1', '2', '3', '4'], finished: ['1', '2', '3'] }
  expect(text(chipSegs(wf, T0 + 250_000, 0))).toBe('⠋ wf review-changes ━━━━━━── 3/4 4:10')
  expect(text(chipSegs({ ...wf, status: 'done', endedAt: T0 + 9000 }, T0 + 9999, 0))).toBe('✓ wf review-changes ━━━━━━━━ 4/4')
})

test('done and fail', () => {
  expect(text(chipSegs(agent({ status: 'done', endedAt: T0 + 3000 }), T0 + 5000, 0))).toBe('✓ agent หาไฟล์ config ━━━━━━━━ 100%')
  const sh: BandTask = { id: 's', kind: 'sh', label: 'npm run dev', startedAt: T0, status: 'fail', endedAt: T0 + 48_000 }
  expect(text(chipSegs(sh, T0 + 60_000, 0))).toBe('✗ sh npm run dev ━━━━──── fail 0:48')
})

test('long labels are clipped', () => {
  expect(text(chipSegs(agent({ label: 'a very long description of the work' }), T0, 0))).toContain('a very long descr… ')
})

test('pages hold at most 3 chips and fit the width', () => {
  const widths = [40, 40, 40, 40, 40, 30]
  expect(paginate(widths, 129)).toEqual([[0, 2], [2, 4], [4, 6]])
  expect(paginate([30, 30, 30, 30], 129)).toEqual([[0, 3], [3, 4]])
  expect(pageOf([[0, 3], [3, 4]], 3)).toBe(1)
  expect(navLabel(1, 3, 6)).toBe('1-3/6')
  expect(navLabel(4, 4, 4)).toBe('4/4')
})

test('real chips fit 3 per page at 129 columns', () => {
  const list = [agent({ estMs: 100_000 }), agent({ id: 'b', label: 'review-changes' }), agent({ id: 'c', label: 'fix-tests', status: 'done', endedAt: T0 })]
  const widths = list.map(t => segWidth(chipSegs(t, T0 + 60_000, 0)))
  expect(paginate(widths, 129)).toEqual([[0, 3]])
})

test('task notifications parse id and status', () => {
  const msg = '<task-notification>\n<task-id>bt6lg4cl7</task-id>\n<tool-use-id>x</tool-use-id>\n<status>completed</status>\n</task-notification>'
  expect(parseNotifications(msg)).toEqual([{ id: 'bt6lg4cl7', status: 'completed' }])
  expect(statusOf('completed')).toBe('done')
  expect(statusOf('killed')).toBe('fail')
  expect(statusOf('failed')).toBe('fail')
})

test('turn end keeps only running tasks', () => {
  expect(clearFinished([agent(), agent({ id: 'x', status: 'done' }), agent({ id: 'y', status: 'fail' })]).map(t => t.id)).toEqual(['a1'])
})

test('hand-drawn frame lines are exactly the band width', () => {
  expect(cellWidth(frameTop(129))).toBe(129)
  expect(cellWidth(frameBottom(129))).toBe(129)
  expect(frameTop(40).startsWith('┌─ งานเบื้องหลัง ─')).toBe(true)
  expect(rowPad(129, 100).length).toBe(25)
  expect(rowPad(20, 100)).toBe('')
})


test('tasks keep the order they were started in, not the order results came back', () => {
  const sh = (id: string, order: number): BandTask => ({ id, kind: 'sh', label: id, startedAt: T0 + 50, order, status: 'running' })
  let list: BandTask[] = []
  for (const t of [sh('3', T0 + 0.003), sh('1', T0 + 0.001), sh('5', T0 + 0.005), sh('2', T0 + 0.002), sh('4', T0 + 0.004)]) list = insertOrdered(list, t)
  expect(list.map(t => t.id).join('')).toBe('12345')
})

test('running tasks show before finished ones, each group in start order', () => {
  const t = (id: string, status: BandTask['status']): BandTask => ({ id, kind: 'sh', label: id, startedAt: T0, status })
  expect(viewOrder([t('1', 'done'), t('2', 'running'), t('3', 'fail'), t('4', 'running')]).map(x => x.id).join('')).toBe('2413')
})

test('TaskStop input gives the stopped task id', () => {
  expect(stoppedTaskId({ task_id: 'bsf2igl3k' })).toBe('bsf2igl3k')
  expect(stoppedTaskId({ shell_id: ' b1 ' })).toBe('b1')
  expect(stoppedTaskId({})).toBe(undefined)
  expect(stoppedTaskId({ task_id: '' })).toBe(undefined)
  expect(statusOf('stopped')).toBe('fail')
})
