import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BandJump, BandTask, TaskStatus } from '../types'
import { average, C, cellWidth, chipSegs, clampPage, clearFinished, insertOrdered, navLabel, pageOf, paginate, parseNotifications, pushSample, segWidth, statusOf, viewOrder, frameTop, frameBottom, rowPad } from './logic'

const tasks = atom({ plugin: 'task-band', key: 'tasks' } as const, [] as BandTask[])
const page = atom({ plugin: 'task-band', key: 'page' } as const, 0)
const jump = atom({ plugin: 'task-band', key: 'jump' } as const, null as BandJump | null)
const tick = atom({ plugin: 'task-band', key: 'tick' } as const, 0)

const JUMP_MS = 3000
const FRAME = 4
let pageCount = 1
let seq = 0
type Durations = Record<string, number[]>

async function now($: EngineInterface): Promise<number> {
  return $.clock.now()
}

async function entryOrder($: EngineInterface): Promise<number> {
  const s = ++seq % 1000
  return (await now($)) + s / 1000
}

async function flash($: EngineInterface, id: string) {
  const until = (await now($)) + JUMP_MS
  await update($, jump, () => ({ id, until }))
  $.clock.after(JUMP_MS + 50, async () => {
    const j = await read($, jump)
    if (j && j.until <= (await now($))) await update($, jump, () => null)
  })
}

async function addTask($: EngineInterface, t: BandTask) {
  await update($, tasks, list => insertOrdered(list ?? [], t))
  await flash($, t.id)
}

async function finish($: EngineInterface, match: (t: BandTask) => boolean, status: TaskStatus) {
  const at = await now($)
  let hit: BandTask | undefined
  await update($, tasks, list =>
    (list ?? []).map(t => {
      if (t.status !== 'running' || !match(t)) return t
      hit = { ...t, status, endedAt: at }
      return hit
    }),
  )
  if (!hit) return
  await flash($, hit.id)
  if (hit.kind === 'agent' && status === 'done' && hit.agentType) {
    const all = ((await $.store.get('durations')) as Durations | undefined) ?? {}
    all[hit.agentType] = pushSample(all[hit.agentType], at - hit.startedAt)
    await $.store.set('durations', all)
  }
}

async function estimateFor($: EngineInterface, agentType: string): Promise<number | undefined> {
  const all = (await $.store.get('durations')) as Durations | undefined
  return average(all?.[agentType])
}

async function onTick($: EngineInterface) {
  const list = await read($, tasks)
  if (list && list.some(t => t.status === 'running')) await update($, tick, n => (n + 1) % 1_000_000)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, () => onTick($))
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const order = await entryOrder($)
    const r = await next(e)
    const agentId = (r as { agentId?: string }).agentId
    if (!agentId) return r
    const at = await now($)
    if (e.workflow) {
      const runId = e.workflow.runId
      const list = (await read($, tasks)) ?? []
      if (!list.some(t => t.runId === runId)) {
        await addTask($, { id: `run:${runId}`, kind: 'wf', label: 'workflow', startedAt: at, order, status: 'running', runId, members: [], finished: [] })
      }
      await update($, tasks, l => (l ?? []).map(t => (t.runId === runId ? { ...t, members: [...(t.members ?? []), agentId] } : t)))
      return r
    }
    const agentType = e.subagentType || 'general-purpose'
    await addTask($, { id: agentId, kind: 'agent', label: e.description || agentType, agentType, startedAt: at, order, status: 'running', estMs: await estimateFor($, agentType) })
    return r
  })

  on('tool.call', async ($, e, next) => {
    const bg = e.tool === 'Bash' || e.tool === 'PowerShell' || e.tool === 'Monitor' || e.tool === 'Workflow'
    const order = bg && !e.agentId ? await entryOrder($) : undefined
    const r = await next(e)
    if (e.agentId || !('result' in r) || !r.result) return r
    const res = r.result as Record<string, unknown>
    const at = await now($)
    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const bgId = res.backgroundTaskId
      if (typeof bgId === 'string') {
        const label = (e.description as string | undefined) || String(e.command).split('\n')[0] || e.tool
        await addTask($, { id: bgId, taskId: bgId, kind: 'sh', label, startedAt: at, order, status: 'running' })
      }
    } else if (e.tool === 'Monitor') {
      const id = res.taskId
      if (typeof id === 'string') await addTask($, { id, taskId: id, kind: 'mon', label: String(e.description || 'monitor'), startedAt: at, order, status: 'running' })
    } else if (e.tool === 'Workflow') {
      const id = res.taskId
      const runId = typeof res.runId === 'string' ? res.runId : undefined
      const label = typeof res.workflowName === 'string' ? res.workflowName : 'workflow'
      if (typeof id !== 'string') return r
      const list = (await read($, tasks)) ?? []
      if (runId && list.some(t => t.runId === runId)) {
        await update($, tasks, l => (l ?? []).map(t => (t.runId === runId ? { ...t, taskId: id, label } : t)))
      } else {
        await addTask($, { id, taskId: id, kind: 'wf', label, startedAt: at, order, status: 'running', runId, members: [], finished: [] })
      }
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const agentId = e.agentId
    if (!agentId) {
      await update($, tasks, l => clearFinished(l ?? []))
      return r
    }
    const list = (await read($, tasks)) ?? []
    const wf = list.find(t => t.status === 'running' && t.members?.includes(agentId) && !t.finished?.includes(agentId))
    if (wf) {
      await update($, tasks, l => (l ?? []).map(t => (t.id === wf.id ? { ...t, finished: [...(t.finished ?? []), agentId] } : t)))
      return r
    }
    if (list.some(t => t.id === agentId && t.status === 'running')) {
      const info = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)
      if (info && (info.status === 'idle' || info.status === 'waiting')) return r
      await finish($, t => t.id === agentId, statusOf(info?.status))
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification') {
      for (const n of parseNotifications(e.text)) {
        const status = statusOf(n.status)
        await finish($, t => t.taskId === n.id || t.id === n.id, status)
      }
    }
    return next(e)
  })

  on('ui.focus', async ($, e, next) => {
    if (e.component !== 'AbovePrompt' || e.plugin !== 'task-band' || e.origin.kind !== 'person') return next(e)
    if (e.element === 'prev' || e.element === 'next') {
      const step = e.element === 'next' ? 1 : -1
      await update($, jump, () => null)
      await update($, page, p => clampPage(p + step, pageCount))
      return {}
    }
    return next(e)
  })

  on('ui.scroll', async ($, e, next) => {
    if (e.component !== 'AbovePrompt' || e.by === 0) return next(e)
    const list = (await read($, tasks)) ?? []
    if (list.length === 0) return next(e)
    await update($, jump, () => null)
    await update($, page, p => clampPage(p + (e.by > 0 ? 1 : -1), pageCount))
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = viewOrder((await read($, tasks)) ?? [])
    if (e.props.hasSurvey || list.length === 0) return next(e)
    const [t, p, j, at] = await Promise.all([read($, tick), read($, page), read($, jump), now($)])
    const chips = list.map(task => chipSegs(task, at, t))
    const pages = paginate(chips.map(segWidth), e.props.bodyColumns - 1 - FRAME)
    pageCount = pages.length
    const jumpIndex = j && j.until > at ? list.findIndex(x => x.id === j.id) : -1
    const shown = jumpIndex >= 0 ? pageOf(pages, jumpIndex) : clampPage(p, pages.length)
    const [from, to] = pages[shown] ?? [0, 0]
    const { Box, Button, Text } = $.ui.resolve(e)
    const many = pages.length > 1

    const W = e.props.bodyColumns - 1
    const nav = many ? `‹ ${navLabel(from + 1, to, list.length)} ›  ` : ''
    const visible = chips.slice(from, to)
    const used = cellWidth(nav) + visible.reduce((n, segs, i) => n + segWidth(segs) + (i > 0 ? 3 : 0), 0)

    return (
      <Box flexDirection="column">
        <Text color={C.faint}>{frameTop(W)}</Text>
        <Box flexDirection="row">
          <Text color={C.faint}>│ </Text>
          {many ? <Button key="prev" label="‹" plain dimColor onPress={() => undefined} /> : null}
          {many ? <Text> </Text> : null}
          {many ? <Button key="pos" label={navLabel(from + 1, to, list.length)} plain autoFocus onPress={() => undefined} /> : null}
          {many ? <Text> </Text> : null}
          {many ? <Button key="next" label="›" plain dimColor onPress={() => undefined} /> : null}
          {many ? <Text>  </Text> : null}
          {visible.map((segs, i) => {
            const task = list[from + i]
            const isJump = jumpIndex === from + i
            return (
              <Box key={task?.id ?? `c${i}`} flexDirection="row">
                {i > 0 ? <Text color={C.faint}> │ </Text> : null}
                {segs.map((s, k) => (
                  <Text key={`s${k}`} color={s.color} backgroundColor={isJump ? C.hl : undefined} bold={s.bold}>
                    {s.text}
                  </Text>
                ))}
              </Box>
            )
          })}
          <Text>{rowPad(W, used)}</Text>
          <Text color={C.faint}> │</Text>
        </Box>
        <Text color={C.faint}>{frameBottom(W)}</Text>
      </Box>
    )
  })
}
