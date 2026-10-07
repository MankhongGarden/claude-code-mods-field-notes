export function imageNumbers(text: string): number[] {
  const found = text.match(/\[Image #\d+\]/g) ?? []
  const nums = found.map(s => Number(s.slice(8, -1)))
  return [...new Set(nums)].sort((a, b) => a - b)
}

export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

export function stateText(sources: ReadonlyMap<number, string>): string {
  return [...sources.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, src]) => `${n}\t${src}`)
    .join('\n') + (sources.size ? '\n' : '')
}

export type PeekOptions = { language: string; theme: string; bottom_offset: number; right_offset: number }

export function peekArgs(o: Partial<PeekOptions>): string[] {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d)
  return [
    '--lang', o.language === 'th' ? 'th' : 'en',
    '--theme', o.theme === 'light' ? 'light' : 'dark',
    '--bottom', String(num(o.bottom_offset, 91)),
    '--right', String(num(o.right_offset, 27)),
  ]
}
