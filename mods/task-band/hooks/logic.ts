import type { BandTask, TaskStatus } from '../types'

export const C = {
  fg: '#2d2a24',
  dim: '#6b675e',
  faint: '#b9b5a3',
  green: '#3f8a3a',
  red: '#b8322b',
  hl: '#e6e2bf',
}

export type Seg = { text: string; color?: string; bg?: string; bold?: boolean }

export const GAUGE = 8
export const LABEL_MAX = 18
export const MIN_SAMPLES = 3
export const EST_CAP = 95
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SEP = ' │ '
const THAI_ZERO = /[ัิ-ฺ็-๎]/u

export function cellWidth(s: string): number {
  let n = 0
  for (const ch of s) if (!THAI_ZERO.test(ch)) n++
  return n
}

export function fitCells(s: string, max: number): string {
  if (cellWidth(s) <= max) return s
  let out = ''
  for (const ch of s) {
    if (cellWidth(out + ch) > max - 1) break
    out += ch
  }
  return `${out}…`
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function average(samples: number[] | undefined): number | undefined {
  if (!samples || samples.length < MIN_SAMPLES) return undefined
  return samples.reduce((a, b) => a + b, 0) / samples.length
}

export function pushSample(samples: number[] | undefined, ms: number): number[] {
  return [...(samples ?? []), ms].slice(-10)
}

export function estimate(elapsed: number, estMs: number | undefined): number | undefined {
  if (!estMs || estMs <= 0) return undefined
  return Math.min(EST_CAP, Math.round((elapsed / estMs) * 100))
}

function bar(fill: number, color: string): Seg[] {
  const n = Math.max(0, Math.min(GAUGE, Math.round(fill * GAUGE)))
  return [{ text: '━'.repeat(n), color }, { text: '─'.repeat(GAUGE - n), color: C.faint }]
}

function sweep(tick: number): Seg[] {
  const pos = tick % (GAUGE - 1)
  return [
    { text: '─'.repeat(pos), color: C.faint },
    { text: '━━', color: C.fg },
    { text: '─'.repeat(GAUGE - 2 - pos), color: C.faint },
  ]
}

export function chipSegs(t: BandTask, now: number, tick: number): Seg[] {
  const elapsed = (t.endedAt ?? now) - t.startedAt
  const head: Seg[] =
    t.status === 'done'
      ? [{ text: '✓ ', color: C.green }]
      : t.status === 'fail'
        ? [{ text: '✗ ', color: C.red }]
        : [{ text: `${SPIN[tick % SPIN.length]} `, color: C.fg }]
  head.push({ text: `${t.kind} `, color: C.dim }, { text: `${fitCells(t.label, LABEL_MAX)} `, color: C.fg })

  const total = t.members?.length ?? 0
  const done = t.finished?.length ?? 0
  const count = t.kind === 'wf' && total > 0 ? `${t.status === 'done' ? total : done}/${total}` : undefined

  if (t.status === 'done') {
    return [...head, ...bar(1, C.green), { text: ` ${count ?? '100%'}`, color: C.green }]
  }
  if (t.status === 'fail') {
    const fill = total > 0 ? done / total : (estimate(elapsed, t.estMs) ?? 50) / 100
    return [...head, ...bar(fill, C.red), { text: ' fail', color: C.red }, { text: ` ${clock(elapsed)}`, color: C.dim }]
  }
  if (count) {
    return [...head, ...bar(done / total, C.fg), { text: ` ${count}`, color: C.fg }, { text: ` ${clock(elapsed)}`, color: C.dim }]
  }
  const pct = t.kind === 'agent' ? estimate(elapsed, t.estMs) : undefined
  if (pct !== undefined) {
    return [...head, ...bar(pct / 100, C.fg), { text: ` ~${pct}%`, color: C.dim }, { text: ` ${clock(elapsed)}`, color: C.dim }]
  }
  return [...head, ...sweep(tick), { text: ` ${clock(elapsed)}`, color: C.dim }]
}

export function segWidth(segs: Seg[]): number {
  return segs.reduce((n, s) => n + cellWidth(s.text), 0)
}

export const MAX_PER_PAGE = 3

export function navLabel(first: number, last: number, total: number): string {
  return first === last ? `${first}/${total}` : `${first}-${last}/${total}`
}

export function navWidth(total: number): number {
  return cellWidth(`‹ ${navLabel(total, total, total)} ›  `) + 2
}

export function paginate(widths: number[], columns: number): Array<[number, number]> {
  const room = columns - navWidth(widths.length) - 1
  const pages: Array<[number, number]> = []
  let i = 0
  while (i < widths.length) {
    let used = widths[i] ?? 0
    let j = i + 1
    while (j < widths.length && j - i < MAX_PER_PAGE && used + SEP.length + (widths[j] ?? 0) <= room) {
      used += SEP.length + (widths[j] ?? 0)
      j++
    }
    pages.push([i, j])
    i = j
  }
  return pages
}

export function pageOf(pages: Array<[number, number]>, index: number): number {
  const p = pages.findIndex(([a, b]) => index >= a && index < b)
  return p < 0 ? 0 : p
}

export function clampPage(page: number, count: number): number {
  return Math.max(0, Math.min(page, count - 1))
}

export function parseNotifications(text: string): Array<{ id: string; status: string }> {
  const out: Array<{ id: string; status: string }> = []
  const blocks = text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? []
  for (const b of blocks) {
    const id = b.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim()
    const status = b.match(/<status>([^<]+)<\/status>/)?.[1]?.trim()
    if (id && status) out.push({ id, status })
  }
  return out
}

export function stoppedTaskId(input: Record<string, unknown>): string | undefined {
  const id = input.task_id ?? input.shell_id
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

export function statusOf(word: string | undefined): TaskStatus {
  if (word === 'failed' || word === 'killed' || word === 'error' || word === 'stopped') return 'fail'
  return 'done'
}

export function insertOrdered(list: BandTask[], t: BandTask): BandTask[] {
  return [...list.filter(x => x.id !== t.id), t].sort((a, b) => (a.order ?? a.startedAt) - (b.order ?? b.startedAt))
}

export function viewOrder(list: BandTask[]): BandTask[] {
  return [...list.filter(t => t.status === 'running'), ...list.filter(t => t.status !== 'running')]
}

export function clearFinished(tasks: BandTask[]): BandTask[] {
  return tasks.filter(t => t.status === 'running')
}

export const TITLE = 'งานเบื้องหลัง'

export function frameTop(width: number): string {
  const head = `┌─ ${TITLE} `
  return head + '─'.repeat(Math.max(0, width - cellWidth(head) - 1)) + '┐'
}

export function frameBottom(width: number): string {
  return '└' + '─'.repeat(Math.max(0, width - 2)) + '┘'
}

export function rowPad(width: number, used: number): string {
  return ' '.repeat(Math.max(0, width - 4 - used))
}
