import type { EngineInterface, Register } from 'claude-code'

import { imageNumbers, peekArgs, projectSlug, stateText } from './logic'
import type { PeekOptions } from './logic'

const VERSION = '0.2.0'

const sources = new Map<number, string>()
let statePath = ''
let imagesDir = ''
let exePath = ''
let written = ''
let running = false
let broken = false
let args: string[] = []

async function ensurePaths($: EngineInterface) {
  if (statePath && imagesDir) return
  const temp = (await $.env.get('TEMP')) ?? 'C:\\Windows\\Temp'
  const sid = await $.session.id()
  statePath = `${temp}\\peek-${sid}.txt`
  const sessionDir = `${temp}\\claude\\${projectSlug(await $.session.cwd())}\\${sid}`
  imagesDir = `${sessionDir}\\images`
  if (await $.fs.exists(sessionDir)) return
  try {
    for (const entry of await $.fs.list(`${temp}\\claude`)) {
      const dir = `${temp}\\claude\\${typeof entry === 'string' ? entry : entry.name}\\${sid}`
      if (await $.fs.exists(dir)) {
        imagesDir = `${dir}\\images`
        return
      }
    }
  } catch {}
}

async function ensureExe($: EngineInterface): Promise<boolean> {
  if (exePath) return true
  const local = (await $.env.get('LOCALAPPDATA')) ?? (await $.env.get('TEMP')) ?? 'C:\\Windows\\Temp'
  const dir = `${local}\\paste-peek`
  const exe = `${dir}\\peek-${VERSION}.exe`
  if (!(await $.fs.exists(exe))) {
    const windir = (await $.env.get('WINDIR')) ?? 'C:\\Windows'
    const csc = `${windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`
    if (!(await $.fs.exists(csc))) {
      $.ui.toast('paste-peek: C# compiler not found (needs .NET Framework 4.x)')
      return false
    }
    await $.process.run(['cmd.exe', '/d', '/c', 'if', 'not', 'exist', dir, 'mkdir', dir])
    const r = await $.process.run([
      csc, '/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
      `/out:${exe}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
      `${$.plugin.root}\\native\\peek.cs`,
    ])
    if (r.exitCode !== 0 || !(await $.fs.exists(exe))) {
      $.ui.toast('paste-peek: could not build peek.exe, see the debug log')
      $.ui.log(r.stdout + r.stderr, { to: 'debug' })
      return false
    }
  }
  exePath = exe
  return true
}

async function launch($: EngineInterface) {
  if (running || broken) return
  running = true
  try {
    if (!(await ensureExe($))) {
      broken = true
      return
    }
    const child = $.process.spawn({ argv: [exePath, statePath, ...args] })
    for await (const _ of child) void _
  } catch {
  } finally {
    running = false
  }
}

async function sync($: EngineInterface, text: string) {
  const nums = imageNumbers(text)
  if (nums.length === 0 && sources.size === 0) return
  await ensurePaths($)
  for (const n of [...sources.keys()]) if (!nums.includes(n)) sources.delete(n)
  for (const n of nums) if (!sources.has(n)) sources.set(n, `dir\t${imagesDir}`)
  const next = stateText(sources)
  if (next !== written) {
    written = next
    await $.fs.write(statePath, next)
  }
  if (sources.size > 0 && !running) void launch($)
}

async function poll($: EngineInterface) {
  const { text } = await $.prompt.read()
  await sync($, text)
}

export const register: Register = (on, options) => {
  args = peekArgs(options as Partial<PeekOptions>)

  on('session.start', async ($, e, next) => {
    $.clock.every(250, () => poll($))
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (r.text.includes('[Image #') || sources.size > 0) void sync($, r.text)
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && sources.size > 0) {
      sources.clear()
      written = ''
      await $.fs.write(statePath, '')
    }
    return next(e)
  }).catch(async ($, e, next) => next(e))
}
