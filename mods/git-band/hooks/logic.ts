import type { RepoState } from '../types'

export const C = {
  fg: '#2d2a24',
  dim: '#6b675e',
  faint: '#b9b5a3',
  green: '#3f8a3a',
  amber: '#a06c00',
  red: '#b8322b',
  blue: '#2f5fd0',
}

const THAI_ZERO = /[ัิ-ฺ็-๎]/u

export function cellWidth(s: string): number {
  let n = 0
  for (const ch of s) if (!THAI_ZERO.test(ch)) n++
  return n
}

export function norm(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const msys = s.match(/^\/([a-zA-Z])\/(.*)$/)
  if (msys) s = `${msys[1]}:/${msys[2]}`
  return s.toLowerCase()
}

export function parentDir(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : s
}

export type Status = {
  branch: string
  upstream?: string
  ahead: number
  files: string[]
}

export function parseStatus(out: string): Status {
  const lines = out.split(/\r?\n/).filter(l => l.length > 0)
  let branch = ''
  let upstream: string | undefined
  let ahead = 0
  const files: string[] = []
  for (const l of lines) {
    if (l.startsWith('## ')) {
      const head = l.slice(3)
      const m = head.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/)
      branch = m?.[1] ?? head
      if (branch.startsWith('No commits yet on ')) branch = branch.slice(18)
      upstream = m?.[2]
      const a = (m?.[3] ?? '').match(/ahead (\d+)/)
      ahead = a ? Number(a[1]) : 0
      continue
    }
    let f = l.slice(3)
    const arrow = f.indexOf(' -> ')
    if (arrow >= 0) f = f.slice(arrow + 4)
    if (f.startsWith('"') && f.endsWith('"')) f = f.slice(1, -1)
    files.push(f)
  }
  return { branch, upstream, ahead, files }
}

const CD = /(?:^|[;&|(]\s*)(?:cd|Set-Location|pushd|sl)\s+(?:-LiteralPath\s+|-Path\s+|\/d\s+)?("[^"]+"|'[^']+'|[^\s;&|)]+)/gi
const GIT_C = /\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/gi

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, '')
}

export function commandDirs(command: string): string[] {
  const out: string[] = []
  for (const m of command.matchAll(CD)) out.push(unquote(m[1] ?? ''))
  for (const m of command.matchAll(GIT_C)) out.push(unquote(m[1] ?? ''))
  return out.filter(d => /^([a-zA-Z]:[\\/]|\/[a-zA-Z]\/)/.test(d))
}

export function shortReason(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const hit =
    lines.find(l => /rejected|non-fast-forward|fetch first/i.test(l)) ??
    lines.find(l => /^(fatal|error|remote):/i.test(l)) ??
    lines[lines.length - 1] ??
    'ไม่ทราบสาเหตุ'
  if (/fetch first|non-fast-forward|rejected/i.test(hit)) return 'ต้อง pull ก่อน'
  if (/could not read|authentication|permission denied|403/i.test(hit)) return 'สิทธิ์/login ไม่ผ่าน'
  if (/could not resolve host|unable to access/i.test(hit)) return 'ต่อเน็ตไม่ได้'
  return hit.replace(/^(fatal|error|remote):\s*/i, '').slice(0, 40)
}

export function isPending(r: RepoState): boolean {
  return r.dirty > 0 || r.ahead > 0 || r.phase !== undefined
}

export function chipWidth(r: RepoState): number {
  let n = cellWidth(r.name) + 1
  if (r.phase === 'pushing') return n + cellWidth('⠹ กำลัง push')
  if (r.phase === 'done') return n + cellWidth('✓ push แล้ว')
  if (r.phase === 'fail') return n + cellWidth(`✗ push ไม่ผ่าน ${r.reason ?? ''} `) + cellWidth('[ ให้ Claude แก้ ]')
  if (r.dirty > 0) n += cellWidth(`●${r.dirty}`) + 1
  if (r.ahead > 0) n += cellWidth(`↑${r.ahead}`) + 1
  if (r.phase === 'queued') return n + cellWidth('◷ รอ Claude commit')
  if (r.dirty > 0) n += cellWidth('[ commit ]') + 1
  if (r.ahead > 0) n += cellWidth('[ push ]')
  return n
}

export function fit(list: RepoState[], columns: number, lead: number): { shown: RepoState[]; hidden: number } {
  const shown: RepoState[] = []
  let used = lead
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!
    const w = chipWidth(r) + (shown.length > 0 ? 3 : 0)
    const rest = list.length - i - 1
    const tail = rest > 0 ? cellWidth(` │ +${rest}`) : 0
    if (used + w + tail > columns && shown.length > 0) return { shown, hidden: list.length - shown.length }
    shown.push(r)
    used += w
  }
  return { shown, hidden: 0 }
}

export function commitPrompt(r: RepoState): string {
  const mine = r.mine
  const others = r.files.filter(f => !mine.includes(f))
  const lines = [
    `[git-band] founder กดปุ่ม commit เอง = ต้องการให้ commit งานที่ค้างทั้งหมดใน repo ${r.root} (branch ${r.branch}) แม้บางไฟล์จะมาจาก session อื่น`,
  ]
  if (mine.length > 0) lines.push(`ไฟล์ที่ session นี้แก้: ${mine.join(', ')}`)
  if (others.length > 0) lines.push(`${mine.length > 0 ? 'ไฟล์อื่นที่ค้าง' : 'ไฟล์ที่ค้าง'} (งานจาก session อื่นหรือแก้มือ): ${others.join(', ')}`)
  lines.push(
    'ทำ: อ่าน git diff ก่อน · แยกเป็นหลาย commit ตามเรื่องของงาน (งานของ session นี้เป็น commit แยก) · เขียนข้อความ commit ให้ตรงงาน · ใช้ git identity ที่ตั้งไว้ใน repo',
    'ข้ามเฉพาะไฟล์ที่มีค่าลับ ไฟล์ชั่วคราว/ขยะ หรือโค้ดที่เห็นชัดว่าเสียครึ่งทาง แล้วบอก founder ว่าข้ามไฟล์ไหนเพราะอะไร · อย่าปฏิเสธเพียงเพราะไม่ใช่งานของ session นี้',
    'ยังไม่ต้อง push',
  )
  return lines.join('\n')
}

export function githubAccount(url: string): string | null {
  const m = url.trim().match(/^https:\/\/([^@/]+@)?github\.com\/([^/]+)\//i)
  if (!m || m[1]) return null
  return m[2]
}

export function fixPushPrompt(r: RepoState): string {
  return [
    `[git-band] git push ใน repo ${r.root} (branch ${r.branch}) ไม่ผ่าน`,
    'ข้อความจาก git:',
    (r.error ?? '').slice(0, 1500),
    'แก้ให้ push ได้ (เช่น pull --rebase ถ้าปลอดภัย) · ถ้าต้องตัดสินใจอะไรที่เสี่ยงให้ถามก่อน',
  ].join('\n')
}
