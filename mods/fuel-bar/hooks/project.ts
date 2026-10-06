export type Weather = { tempC: number; code: number; isDay: boolean; humidity: number; rainChance: number; city: string; at: number }
export type WeatherKind = 'sun' | 'hot' | 'cloud' | 'rain' | 'storm' | 'fog' | 'night'

export const baseName = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? p

export function weatherKind(w: Weather): WeatherKind {
  const c = w.code
  if (c >= 95) return 'storm'
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain'
  if (c === 45 || c === 48) return 'fog'
  if (c === 3 || c === 2) return w.isDay ? 'cloud' : 'night'
  if (!w.isDay) return 'night'
  return w.tempC >= 36 ? 'hot' : 'sun'
}

export const WEATHER_TH: Record<WeatherKind, string> = {
  sun: 'แดดดี',
  hot: 'ร้อนจัด',
  cloud: 'เมฆมาก',
  rain: 'ฝนตก',
  storm: 'พายุฝนฟ้าคะนอง',
  fog: 'หมอก',
  night: 'กลางคืน',
}

export const WEATHER_COLOR: Record<WeatherKind, string> = {
  sun: '#a06c00',
  hot: '#b8322b',
  cloud: '#6b675e',
  rain: '#2f6aa8',
  storm: '#7d4fb0',
  fog: '#8a8780',
  night: '#2a8a86',
}

export const WEATHER_GLYPH: Record<WeatherKind, [string, string]> = {
  sun: ['☀', '✹'],
  hot: ['☀', '♨'],
  cloud: ['☁', '☁'],
  rain: ['☂', '⁘'],
  storm: ['↯', '☁'],
  fog: ['≡', '≈'],
  night: ['☾', '✦'],
}

export function shortNote(w: Weather, kind: WeatherKind): string {
  if (kind === 'storm') return 'ระวังฟ้าผ่า'
  if (kind === 'hot') return 'ดื่มน้ำ'
  return `ฝน ${w.rainChance}%`
}

export function tempLabel(c: number): string {
  return `${c.toFixed(1)}°`
}

export function workedLabel(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} hr`
}

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
