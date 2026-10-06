import { expect, test } from 'claude-code/testing'

import { firstLine, groupLine, mcpRow, patchSource, resultView, thaiDuration, toolRow } from '../hooks/thai'

const CWD = 'D:/proj/app'

test('built-in tool rows read as plain Thai', () => {
  expect(toolRow('Read', { file_path: 'D:\\proj\\app\\app\\page.tsx' }, CWD)).toEqual({ label: 'อ่านไฟล์', arg: 'app/page.tsx' })
  expect(toolRow('Bash', { command: 'npm test' }, CWD)).toEqual({ label: 'รันคำสั่ง', arg: 'npm test' })
  expect(toolRow('Grep', { pattern: 'createClient', path: 'lib' }, CWD)).toEqual({ label: 'ค้นหาคำ', arg: '"createClient" ใน lib' })
  expect(toolRow('Agent', { description: 'Research mod catalogs' }, CWD)?.label).toBe('ส่งผู้ช่วยไปทำ')
  expect(toolRow('SomethingNew', {}, CWD)).toBeUndefined()
})

test('long and multi-line commands are cut to the first line', () => {
  expect(firstLine('git add .\ngit commit -m x')).toBe('git add . …')
  expect(firstLine('x'.repeat(100), 10)).toBe('xxxxxxxxx…')
})

test('MCP tools become service · Thai verb', () => {
  expect(mcpRow('mcp__github__search_code', { query: 'ui.render' })).toEqual({ label: 'GitHub · ค้นหา code', arg: '"ui.render"' })
  expect(mcpRow('mcp__chrome-devtools__take_screenshot', {})).toEqual({ label: 'Chrome · ถ่าย screenshot', arg: '' })
  expect(mcpRow('mcp__stripe__api_read', {})?.label).toBe('Stripe · api read')
  expect(mcpRow('Read', {})).toBeUndefined()
})

test('result summaries; diffs are kept', () => {
  expect(resultView('Read', { type: 'text', file: { numLines: 142, totalLines: 142, startLine: 1 } })?.summary).toBe('อ่าน 142 บรรทัด')
  expect(resultView('Grep', { numFiles: 8, filenames: [] })?.summary).toBe('เจอใน 8 ไฟล์')
  expect(resultView('Grep', { numFiles: 0, filenames: [] })?.summary).toBe('ไม่เจอ')
  const edit = resultView('Edit', {
    filePath: 'lib/price.ts',
    structuredPatch: [{ oldStart: 12, oldLines: 1, newStart: 12, newLines: 1, lines: ['-const PRICE = 49', '+const PRICE = 59'] }],
  })
  expect(edit?.summary).toBe('เพิ่ม 1 · ลบ 1 บรรทัด')
  expect(edit?.diff).toBe('@@ -12,1 +12,1 @@\n-const PRICE = 49\n+const PRICE = 59')
  expect(resultView('Write', { type: 'create', content: 'a\nb\n' })?.summary).toBe('สร้างไฟล์ใหม่ 2 บรรทัด')
  expect(resultView('Bash', { stdout: 'ok' })).toBeUndefined()
  expect(patchSource([]).source).toBe('')
})

test('collapsed group and durations', () => {
  const calls = [{ tool: 'Read' }, { tool: 'Read' }, { tool: 'Read' }, { tool: 'Grep' }, { tool: 'Grep' }]
  expect(groupLine(calls, false)).toBe('อ่าน 3 ไฟล์ · ค้นหา 2 คำ')
  expect(groupLine(calls, true)).toBe('กำลังอ่าน 3 ไฟล์ · ค้นหา 2 คำ…')
  expect(groupLine([{ tool: 'Bash' }, { tool: 'PowerShell' }], false)).toBe('รัน 2 คำสั่ง')
  expect(thaiDuration(220_000)).toBe('3 นาที 40 วินาที')
  expect(thaiDuration(5_000)).toBe('5 วินาที')
})
