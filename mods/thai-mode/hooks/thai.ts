export type Row = { label: string; arg: string }

const MCP_SERVICE: Record<string, string> = {
  github: 'GitHub',
  'chrome-devtools': 'Chrome',
  'claude-in-chrome': 'Chrome',
  gmail: 'Gmail',
  claude_ai_gmail: 'Gmail',
  'google-calendar': 'Calendar',
  stripe: 'Stripe',
  memory: 'Memory',
  sentry: 'Sentry',
  claude_ai_claude_docs: 'Claude Docs',
  'cloudflare-docs': 'Cloudflare Docs',
  'connect-apps': 'Connect Apps',
  shadcn: 'shadcn',
  time: 'Time',
  'sequential-thinking': 'Thinking',
  a11y: 'A11y',
}

const VERB: Record<string, string> = {
  search: 'ค้นหา',
  list: 'ดูรายการ',
  get: 'ดู',
  read: 'อ่าน',
  fetch: 'ดึง',
  create: 'สร้าง',
  add: 'เพิ่ม',
  update: 'แก้',
  edit: 'แก้',
  modify: 'แก้',
  delete: 'ลบ',
  remove: 'ลบ',
  trash: 'ทิ้ง',
  take: 'ถ่าย',
  navigate: 'เปิดหน้า',
  open: 'เปิด',
  close: 'ปิด',
  click: 'คลิก',
  fill: 'กรอก',
  type: 'พิมพ์',
  press: 'กด',
  hover: 'ชี้',
  drag: 'ลาก',
  select: 'เลือก',
  send: 'ส่ง',
  reply: 'ตอบ',
  forward: 'ส่งต่อ',
  query: 'ค้นข้อมูล',
  execute: 'รัน',
  run: 'รัน',
  write: 'เขียน',
  push: 'push',
  merge: 'merge',
  upload: 'อัปโหลด',
  download: 'ดาวน์โหลด',
  evaluate: 'รันสคริปต์',
  resize: 'ปรับขนาด',
  emulate: 'จำลอง',
  wait: 'รอ',
  mark: 'ทำเครื่องหมาย',
  label: 'ติดป้าย',
  save: 'บันทึก',
  set: 'ตั้งค่า',
  authenticate: 'เข้าสู่ระบบ',
  respond: 'ตอบรับ',
  analyze: 'วิเคราะห์',
  lighthouse: 'ตรวจ Lighthouse',
  performance: 'วัดความเร็ว',
}

const ARTIFACT_ACTION: Record<string, string> = {
  publish: 'เผยแพร่หน้าเว็บ',
  read: 'อ่านหน้าเว็บ',
  list: 'ดูรายการหน้าเว็บ',
  delete: 'ลบหน้าเว็บ',
  open: 'เปิดหน้าเว็บ',
  quickstart: 'เตรียมสร้างหน้าเว็บ',
  pin: 'ปักหมุดหน้าเว็บ',
  unpin: 'เลิกปักหมุดหน้าเว็บ',
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function firstLine(s: string, max = 80): string {
  const line = (s.split(/\r?\n/)[0] ?? '').trim()
  const more = s.includes('\n') ? ' …' : ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line + more
}

export function shortPath(p: string, cwd?: string): string {
  let s = p.replace(/\\/g, '/')
  if (cwd) {
    const c = cwd.replace(/\\/g, '/').replace(/\/$/, '')
    if (s.toLowerCase().startsWith(`${c.toLowerCase()}/`)) s = s.slice(c.length + 1)
  }
  const parts = s.split('/')
  return parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : s
}

export function mcpRow(tool: string, input: unknown): Row | undefined {
  const m = tool.match(/^mcp__(.+?)__(.+)$/)
  if (!m || !m[1] || !m[2]) return undefined
  const key = m[1].toLowerCase()
  const service = MCP_SERVICE[key] ?? m[1].replace(/^claude_ai_/i, '').replace(/[_-]+/g, ' ')
  const words = m[2].split(/[_-]+/).filter(Boolean)
  const verb = words[0] ? VERB[words[0].toLowerCase()] : undefined
  const rest = words.slice(1).join(' ')
  const action = verb ? `${verb}${rest ? ` ${rest}` : ''}` : words.join(' ')
  const i = obj(input)
  const hint = str(i.query) || str(i.url) || str(i.q) || str(i.name) || ''
  return { label: `${service} · ${action}`, arg: hint ? `"${firstLine(hint, 50)}"` : '' }
}

export function toolRow(tool: string, input: unknown, cwd?: string): Row | undefined {
  const i = obj(input)
  const path = (k = 'file_path') => shortPath(str(i[k]), cwd)
  switch (tool) {
    case 'Read':
      return { label: 'อ่านไฟล์', arg: path() }
    case 'Write':
      return { label: 'เขียนไฟล์', arg: path() }
    case 'Edit':
      return { label: 'แก้ไฟล์', arg: path() }
    case 'NotebookEdit':
      return { label: 'แก้ notebook', arg: path('notebook_path') }
    case 'Grep': {
      const where = str(i.path) ? ` ใน ${shortPath(str(i.path), cwd)}` : ''
      return { label: 'ค้นหาคำ', arg: `"${firstLine(str(i.pattern), 50)}"${where}` }
    }
    case 'Glob':
      return { label: 'หาไฟล์', arg: `${str(i.pattern)}${str(i.path) ? ` ใน ${shortPath(str(i.path), cwd)}` : ''}` }
    case 'Bash':
    case 'PowerShell':
      return { label: 'รันคำสั่ง', arg: firstLine(str(i.command)) }
    case 'WebSearch':
      return { label: 'ค้นเว็บ', arg: `"${firstLine(str(i.query), 60)}"` }
    case 'WebFetch':
      return { label: 'เปิดเว็บ', arg: firstLine(str(i.url), 70) }
    case 'Agent':
    case 'Task':
      return { label: 'ส่งผู้ช่วยไปทำ', arg: firstLine(str(i.description), 60) }
    case 'Skill':
      return { label: 'ใช้สกิล', arg: str(i.skill) }
    case 'ToolSearch':
      return { label: 'โหลดเครื่องมือ', arg: firstLine(str(i.query), 60) }
    case 'TodoWrite':
      return { label: 'อัปเดตรายการงาน', arg: '' }
    case 'AskUserQuestion':
      return { label: 'ถามคุณ', arg: '' }
    case 'ScheduleWakeup':
      return { label: 'ตั้งเวลาปลุก', arg: '' }
    case 'Monitor':
      return { label: 'เฝ้าดู', arg: firstLine(str(i.command) || str(i.description), 60) }
    case 'SendUserFile':
      return { label: 'ส่งไฟล์ให้คุณ', arg: '' }
    case 'Artifact': {
      const action = str(i.action) || 'publish'
      return { label: ARTIFACT_ACTION[action] ?? `Artifact · ${action}`, arg: str(i.file_path) ? shortPath(str(i.file_path), cwd) : '' }
    }
    default:
      return mcpRow(tool, input)
  }
}

export function thaiDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? `${h} ชั่วโมง ${m} นาที` : `${h} ชั่วโมง`
  if (m > 0) return s > 0 ? `${m} นาที ${s} วินาที` : `${m} นาที`
  return `${s} วินาที`
}

const shortDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} นาที ${s % 60} วิ` : `${s} วิ`
}

const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

export function patchSource(patches: unknown): { source: string; added: number; removed: number } {
  let added = 0
  let removed = 0
  const hunks: string[] = []
  for (const p of Array.isArray(patches) ? patches : []) {
    const h = obj(p)
    const lines = Array.isArray(h.lines) ? (h.lines as unknown[]).map(String) : []
    for (const l of lines) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
    hunks.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...lines)
  }
  return { source: hunks.join('\n'), added, removed }
}

export type ResultView = { summary: string; diff?: string; path?: string }

export function resultView(tool: string, output: unknown): ResultView | undefined {
  const o = obj(output)
  switch (tool) {
    case 'Read': {
      if (o.type === 'image') return { summary: 'อ่านรูปภาพ' }
      const f = obj(o.file)
      const n = Number(f.numLines ?? 0)
      const total = Number(f.totalLines ?? n)
      const start = Number(f.startLine ?? 1)
      if (o.type !== 'text') return undefined
      return { summary: n < total ? `อ่าน ${n} บรรทัด (บรรทัด ${start}–${start + n - 1} จาก ${total})` : `อ่าน ${n} บรรทัด` }
    }
    case 'Grep': {
      const files = Number(o.numFiles ?? 0)
      if (o.mode === 'content') {
        const lines = Number(o.numLines ?? 0)
        return { summary: lines ? `เจอ ${lines} บรรทัด` : 'ไม่เจอ' }
      }
      if (o.mode === 'count') return { summary: `เจอ ${Number(o.numMatches ?? 0)} จุด ใน ${files} ไฟล์` }
      return { summary: files ? `เจอใน ${files} ไฟล์` : 'ไม่เจอ' }
    }
    case 'Glob': {
      const n = Number(o.numFiles ?? 0)
      return { summary: n ? `เจอ ${n} ไฟล์${o.truncated ? ' (แสดงไม่หมด)' : ''}` : 'ไม่เจอไฟล์' }
    }
    case 'Write': {
      if (o.type === 'create') {
        const body = str(o.content).replace(/\r?\n$/, '')
        const n = body ? body.split(/\r?\n/).length : 0
        return { summary: `สร้างไฟล์ใหม่ ${n} บรรทัด` }
      }
      const d = patchSource(o.structuredPatch)
      return { summary: `เขียนทับ · เพิ่ม ${d.added} · ลบ ${d.removed} บรรทัด`, diff: d.source || undefined, path: str(o.filePath) }
    }
    case 'Edit': {
      const d = patchSource(o.structuredPatch)
      return { summary: `เพิ่ม ${d.added} · ลบ ${d.removed} บรรทัด`, diff: d.source || undefined, path: str(o.filePath) }
    }
    case 'WebSearch': {
      const n = Number(o.searchCount ?? 1)
      const sec = Math.round(Number(o.durationSeconds ?? 0))
      return { summary: `ค้น ${n} ครั้ง ใช้เวลา ${sec} วิ` }
    }
    case 'WebFetch': {
      const kb = Math.max(1, Math.round(Number(o.bytes ?? 0) / 1024))
      return { summary: `ได้ข้อมูล ${kb} KB (${o.code ?? '?'} ${str(o.codeText)})`.trim() }
    }
    case 'Agent':
    case 'Task': {
      if (o.totalToolUseCount === undefined) return undefined
      return {
        summary: `เสร็จ (ใช้เครื่องมือ ${o.totalToolUseCount} ครั้ง · ${kTokens(Number(o.totalTokens ?? 0))} token · ${shortDuration(Number(o.totalDurationMs ?? 0))})`,
      }
    }
    default:
      return undefined
  }
}

const GROUP_NOUN: Record<string, [string, string]> = {
  Read: ['อ่าน', 'ไฟล์'],
  Grep: ['ค้นหา', 'คำ'],
  Glob: ['หาไฟล์', 'ครั้ง'],
  Bash: ['รัน', 'คำสั่ง'],
  PowerShell: ['รัน', 'คำสั่ง'],
  WebSearch: ['ค้นเว็บ', 'ครั้ง'],
  WebFetch: ['เปิดเว็บ', 'หน้า'],
  Edit: ['แก้', 'ไฟล์'],
  Write: ['เขียน', 'ไฟล์'],
}

export function groupLine(calls: ReadonlyArray<{ tool: string }>, isActive: boolean): string {
  const counts = new Map<string, number>()
  for (const c of calls) {
    const noun = GROUP_NOUN[c.tool]
    const r = noun ? undefined : mcpRow(c.tool, {})
    const key = noun ? `${noun[0]}|${noun[1]}` : `${r ? r.label : c.tool}|ครั้ง`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts].map(([key, n]) => {
    const [verb, unit] = key.split('|')
    return `${verb} ${n} ${unit}`
  })
  const text = parts.join(' · ')
  return isActive ? `กำลัง${text}…` : text
}

export const SPINNER_WORD: Record<string, string> = {
  requesting: 'กำลังส่งคำขอ',
  thinking: 'กำลังคิด',
  responding: 'กำลังตอบ',
  'tool-input': 'กำลังเตรียมคำสั่ง',
  'tool-use': 'กำลังใช้เครื่องมือ',
}

export function thaiProgressHint(hint: string): string {
  return hint.replace(/to run in background/i, 'ให้ทำเบื้องหลัง')
}
