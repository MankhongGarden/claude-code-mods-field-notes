import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FuelQuota, FuelSnapshot } from '../types'
import { baseName, cellWidth, fitCells, shortNote, tempLabel, WEATHER_COLOR, WEATHER_GLYPH, WEATHER_TH, weatherKind, workedLabel } from './project'
import type { Weather } from './project'

const snapshot = atom({ plugin: 'fuel-bar', key: 'snapshot' } as const, null)
const thaiOn = atom({ plugin: 'thai-mode', key: 'enabled' } as const, false)
const weather = atom({ plugin: 'fuel-bar', key: 'weather' } as const, null)
const toast = atom({ plugin: 'fuel-bar', key: 'toast' } as const, null)
const frame = atom({ plugin: 'fuel-bar', key: 'frame' } as const, 0)
const startedAt = atom({ plugin: 'fuel-bar', key: 'startedAt' } as const, 0)

const TOAST_MS = 8000
const WEATHER_MS = 30 * 60_000

const HINT_TH: Array<[RegExp, string]> = [
  [/\? for shortcuts/i, '? ดูคีย์ลัด'],
  [/esc to interrupt/i, 'esc หยุด'],
  [/for agents/i, 'ดู agents'],
  [/ctrl\+c again to exit/i, 'กด ctrl+c อีกครั้งเพื่อออก'],
  [/esc again to clear/i, 'กด esc อีกครั้งเพื่อล้าง'],
]

export function thaiHint(hint: string): string {
  return HINT_TH.reduce((h, [re, th]) => h.replace(re, th), hint)
}

const C = {
  fg: '#2d2a24',
  dim: '#6b675e',
  faint: '#b9b5a3',
  off: '#d2ceb4',
  pillBg: '#3a3a3a',
  pillFg: '#e0e0e0',
  green: '#3f8a3a',
  name: '#c25a2c',
  yellow: '#a06c00',
  red: '#b8322b',
}

const MODE_LABEL: Record<string, string> = {
  auto: 'AUTO',
  acceptEdits: 'EDITS',
  plan: 'PLAN',
  bypassPermissions: 'BYPASS',
  dontAsk: 'DONT ASK',
}

const GAUGE_CELLS = 12

type Seg = { text: string; color?: string; bg?: string; bold?: boolean }

export function prettyModel(id: string): string {
  const m = id.match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-.](\d+))?/i)
  if (!m || !m[1]) return id.replace(/\[.*\]$/, '')
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  return `${(n / 1000).toFixed(1)}k`
}

export function untilReset(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const mins = Math.floor(ms / 60_000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return h > 0 ? `${d}d${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`
  return `${m}m`
}

export function modeFromHint(hint: string): string | undefined {
  const s = hint.toLowerCase()
  if (s.includes('auto mode')) return 'auto'
  if (s.includes('accept edits')) return 'acceptEdits'
  if (s.includes('plan mode')) return 'plan'
  if (s.includes('bypass permissions')) return 'bypassPermissions'
  if (s.includes("don't ask") || s.includes('dont ask')) return 'dontAsk'
  return undefined
}

export function stripModePill(hint: string): string {
  return hint
    .replace(/[⏵⏸▶►]+\s*[^·(]*?(mode|edits|permissions|ask)\s+on\b/gi, '')
    .replace(/\(shift\+tab to cycle\)/gi, '')
    .replace(/\s{2,}/g, '  ')
    .trim()
    .replace(/^[·\s]+|[·\s]+$/g, '')
}

const gaugeColor = (pct: number) => (pct > 85 ? C.red : pct >= 60 ? C.yellow : C.green)
const quotaColor = gaugeColor

export function buildLines(s: FuelSnapshot, mode: string | undefined, hint: string, columns: number, now: number): Seg[][] {
  const sep: Seg = { text: ' │ ', color: C.faint }
  const head: Seg[] = []
  const label = mode ? MODE_LABEL[mode] : undefined
  if (label) head.push({ text: ` ${label} `, color: C.pillFg, bg: C.pillBg, bold: true }, { text: ' ' })
  head.push({ text: `T${s.turn}`, color: C.fg, bold: true }, sep, { text: s.model, color: C.fg })
  if (s.effort) head.push({ text: ` · ${s.effort}`, color: C.dim })

  const gauge: Seg[] = []
  if (s.tokens === undefined) {
    gauge.push({ text: '━'.repeat(GAUGE_CELLS), color: C.off }, { text: ' —', color: C.dim })
  } else {
    const limit = s.threshold && s.threshold > 0 ? s.threshold : s.window
    const pct = Math.round((s.tokens / limit) * 1000) / 10
    const filled = Math.max(0, Math.min(GAUGE_CELLS, Math.round((pct / 100) * GAUGE_CELLS)))
    const color = gaugeColor(pct)
    gauge.push(
      { text: '━'.repeat(filled), color },
      { text: '━'.repeat(GAUGE_CELLS - filled), color: C.off },
      { text: ` ${pct.toFixed(1)}%`, color, bold: true },
      { text: ` ${shortTokens(s.tokens)}/${shortTokens(s.window)}`, color: C.dim },
    )
  }

  const quota = (name: string, q: FuelQuota | undefined, withReset: boolean): Seg[] => {
    if (!q) return []
    const out: Seg[] = [{ text: `${name} `, color: C.dim }, { text: `${q.percent.toFixed(1)}%`, color: quotaColor(q.percent) }]
    const left = withReset ? untilReset(q.resetsAt, now) : undefined
    if (left) out.push({ text: ` (${left})`, color: C.dim })
    return out
  }
  const quotas = (withReset: boolean): Seg[] => {
    const a = quota('5h', s.fiveHour, withReset)
    const b = quota('7D', s.sevenDay, withReset)
    if (!a.length && !b.length) return []
    return [sep, ...a, ...(a.length && b.length ? [{ text: ' · ', color: C.dim }] : []), ...b]
  }
  const hintSegs: Seg[] = hint ? [{ text: `   ${hint}`, color: C.faint }] : []

  const width = (segs: Seg[]) => segs.reduce((n, x) => n + [...x.text].length, 0) + 1
  const tries: Seg[][] = [
    [...head, sep, ...gauge, ...quotas(true), ...hintSegs],
    [...head, sep, ...gauge, ...quotas(true)],
    [...head, sep, ...gauge, ...quotas(false)],
    [...head, sep, ...gauge],
  ]
  for (const line of tries) if (width(line) <= columns) return [line]
  return [head, gauge]
}

async function refresh($: EngineInterface, patch: Partial<FuelSnapshot>) {
  const [turn, model] = await Promise.all([$.session.turns(), $.session.model()])
  await update($, snapshot, prev => ({
    window: 0,
    ...(prev ?? {}),
    ...patch,
    turn,
    model: prettyModel(model),
  }))
}

async function trackMode($: EngineInterface, mode: unknown) {
  if (typeof mode !== 'string') return
  const s = await read($, snapshot)
  if (s && s.permissionMode !== mode) await update($, snapshot, p => (p ? { ...p, permissionMode: mode } : p))
}

let lastHint = ''
let cwd = ''

async function loadWeather($: EngineInterface) {
  const cached = (await $.store.get('weather')) as Weather | undefined
  if (cached && Date.now() - cached.at < WEATHER_MS) {
    await update($, weather, () => cached)
    return
  }
  try {
    const geo = JSON.parse((await $.http.fetch('https://ipwho.is/')).text) as { latitude?: number; longitude?: number; city?: string }
    if (typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') return
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      '&current=temperature_2m,relative_humidity_2m,weather_code,is_day&hourly=precipitation_probability&forecast_hours=3&timezone=auto'
    const om = JSON.parse((await $.http.fetch(url)).text) as {
      current?: { temperature_2m: number; relative_humidity_2m: number; weather_code: number; is_day: number }
      hourly?: { precipitation_probability?: number[] }
    }
    if (!om.current) return
    const w: Weather = {
      tempC: om.current.temperature_2m,
      code: om.current.weather_code,
      isDay: om.current.is_day === 1,
      humidity: Math.round(om.current.relative_humidity_2m),
      rainChance: Math.max(0, ...(om.hourly?.precipitation_probability ?? [0])),
      city: geo.city ?? '',
      at: Date.now(),
    }
    await $.store.set('weather', w)
    await update($, weather, () => w)
  } catch {
    return
  }
}

async function tick($: EngineInterface) {
  await update($, frame, f => (f + 1) % 2)
  const t = await read($, toast)
  if (t && Date.now() - t.at > TOAST_MS) await update($, toast, () => null)
}

export function projectSegs(name: string, w: Weather | null, f: number, workedMs: number | undefined): Seg[] {
  const dot: Seg = { text: '  ·  ', color: C.faint }
  const out: Seg[] = [{ text: name.toUpperCase(), color: C.name, bold: true }, dot]
  if (w) {
    const kind = weatherKind(w)
    out.push(
      { text: WEATHER_GLYPH[kind][f % 2] ?? '', color: WEATHER_COLOR[kind], bold: true },
      { text: ` ${tempLabel(w.tempC)} ${WEATHER_TH[kind]}`, color: C.fg, bold: true },
      { text: ` ${shortNote(w, kind)}`, color: C.dim },
    )
  } else {
    out.push({ text: 'กำลังโหลดอากาศ…', color: C.dim })
  }
  out.push(dot, { text: 'ทำงานมาแล้ว ', color: C.fg }, { text: workedMs === undefined ? '—' : workedLabel(workedMs), color: C.fg, bold: true })
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    cwd = await $.session.cwd()
    const started = await $.session.usage()
    await update($, startedAt, () => (typeof started.startedAt === 'number' ? started.startedAt : Date.now()))
    await loadWeather($)
    $.clock.every(WEATHER_MS, () => loadWeather($))
    $.clock.every(2_000, () => tick($))
    await $.command.register({ name: 'fuel-debug', description: 'fuel-bar: show the raw values it is drawing from' })
    const settings = (await $.settings.read()) as { effortLevel?: string }
    const usage = await $.session.usage()
    await refresh($, {
      effort: settings.effortLevel,
      tokens: usage.context.tokens,
      window: usage.context.window,
    })
    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      const effort = String(e.effort)
      const s = await read($, snapshot)
      if (s && s.effort !== effort) await update($, snapshot, p => (p ? { ...p, effort } : p))
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage({ breakdown: 'summary' })
    const five = e.rateLimits.find(r => r.kind === 'five_hour')
    const seven = e.rateLimits.find(r => r.kind === 'seven_day')
    await refresh($, {
      tokens: e.context.tokens,
      window: e.context.window,
      threshold: usage.context.breakdown?.autoCompactThreshold,
      fiveHour: five ? { percent: five.percentUsed, resetsAt: five.resetsAt } : undefined,
      sevenDay: seven ? { percent: seven.percentUsed, resetsAt: seven.resetsAt } : undefined,
    })
    return result
  })

  on('ui.toast', async ($, e) => {
    await update($, toast, () => ({ text: e.text, at: Date.now() }))
    return { value: undefined }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (!s) return next(e)
    lastHint = e.props.hint
    const fromHint = modeFromHint(e.props.hint)
    const mode = fromHint ?? (s.permissionMode && s.permissionMode !== 'default' ? s.permissionMode : undefined)
    const stripped = stripModePill(e.props.hint)
    const hint = (await read($, thaiOn)) ? thaiHint(stripped) : stripped
    const columns = e.viewport?.columns ?? 120
    const enginePill = mode ? 20 : 0
    const room = columns - 2 - enginePill
    const lines = buildLines(s, undefined, hint, room, Date.now())
    const [w, t, f, start] = await Promise.all([read($, weather), read($, toast), read($, frame), read($, startedAt)])
    const proj = projectSegs(baseName(cwd), w, f, start ? Date.now() - start : undefined)
    const projWidth = proj.reduce((n, x) => n + cellWidth(x.text), 0) + 1
    const toastRoom = room - projWidth - 4
    const showToast = t && Date.now() - t.at <= TOAST_MS && toastRoom > 8
    const { Box, Text } = $.ui.resolve(e)
    const row = (segs: Seg[], key: string) =>
      segs.map((seg, j) => (
        <Text key={`${key}-${j}`} color={seg.color} backgroundColor={seg.bg} bold={seg.bold}>
          {seg.text}
        </Text>
      ))
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Box key={`l${i}`} flexDirection="row">
            <Text> </Text>
            {row(line, `s${i}`)}
          </Box>
        ))}
        <Box key="proj" flexDirection="row" justifyContent="space-between" width={room}>
          <Box flexDirection="row">
            <Text> </Text>
            {row(proj, 'p')}
          </Box>
          {showToast ? (
            <Text color={C.fg}>
              <Text color={C.yellow}>▍ </Text>
              {fitCells(t.text, toastRoom)}
            </Text>
          ) : null}
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'fuel-debug' }, async $ => {
    const s = await read($, snapshot)
    return { text: `hint: ${JSON.stringify(lastHint)}\nsnapshot: ${JSON.stringify(s)}` }
  })
}
