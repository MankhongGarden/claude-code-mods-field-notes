import { expect, test } from 'claude-code/testing'

import { commandDirs, fit, githubAccount, isPending, norm, parseStatus, shortReason } from '../hooks/logic'
import type { RepoState } from '../types'

test('parses branch, upstream, ahead and files', () => {
  const s = parseStatus('## master...origin/master [ahead 2]\n M hooks/a.ts\n?? new.txt\nR  old.ts -> "sub dir/new.ts"\n')
  expect(s.branch).toBe('master')
  expect(s.upstream).toBe('origin/master')
  expect(s.ahead).toBe(2)
  expect(s.files).toEqual(['hooks/a.ts', 'new.txt', 'sub dir/new.ts'])
})

test('branch without upstream', () => {
  const s = parseStatus('## feature/x\n')
  expect(s.branch).toBe('feature/x')
  expect(s.upstream).toBe(undefined)
  expect(s.ahead).toBe(0)
  expect(s.files).toEqual([])
})

test('ahead and behind together', () => {
  expect(parseStatus('## main...origin/main [ahead 3, behind 1]').ahead).toBe(3)
})

test('dirs from shell commands', () => {
  expect(commandDirs('cd /d/Work/mods && git status')).toEqual(['/d/Work/mods'])
  expect(commandDirs('git -C "D:\\Repo A" push')).toEqual(['D:\\Repo A'])
  expect(commandDirs('Set-Location "D:\\x"; git log')).toEqual(['D:\\x'])
  expect(commandDirs('cd src && ls')).toEqual([])
})

test('normalises paths', () => {
  expect(norm('/d/Work/Mods/')).toBe('d:/work/mods')
  expect(norm('D:\\Work\\Mods')).toBe('d:/work/mods')
})

test('push failure reasons', () => {
  expect(shortReason(' ! [rejected]        master -> master (fetch first)\nerror: failed to push')).toBe('ต้อง pull ก่อน')
  expect(shortReason('fatal: unable to access https://x: Could not resolve host: github.com')).toBe('ต่อเน็ตไม่ได้')
})

const repo = (name: string, dirty: number, ahead: number): RepoState => ({ root: name, name, branch: 'main', dirty, files: [], mine: [], ahead })

test('pending only with something to do', () => {
  expect(isPending(repo('a', 0, 0))).toBe(false)
  expect(isPending(repo('a', 1, 0))).toBe(true)
  expect(isPending(repo('a', 0, 2))).toBe(true)
})

test('fit cuts repos that do not fit and counts them', () => {
  const list = Array.from({ length: 12 }, (_, i) => repo(`repository-${i}`, 3, 2))
  const { shown, hidden } = fit(list, 128, 10)
  expect(shown.length + hidden).toBe(12)
  expect(hidden > 0).toBe(true)
})

test('github account comes from the remote owner, unless the URL already names one', () => {
  expect(githubAccount('https://github.com/other-account/app.git\n')).toBe('other-account')
  expect(githubAccount('https://github.com/some-owner/some-repo')).toBe('some-owner')
  expect(githubAccount('https://alice@github.com/mona/test.git')).toBe(null)
  expect(githubAccount('git@github.com:mona/test.git')).toBe(null)
  expect(githubAccount('https://gitlab.com/mona/test.git')).toBe(null)
})
