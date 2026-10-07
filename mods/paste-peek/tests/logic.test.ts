import { expect, test } from 'claude-code/testing'

import { imageNumbers, peekArgs, projectSlug, stateText } from '../hooks/logic'

test('finds image numbers once, sorted', () => {
  expect(imageNumbers('see [Image #2] and [Image #1], again [Image #2]')).toEqual([1, 2])
  expect(imageNumbers('no images here')).toEqual([])
})

test('project slug matches the temp folder name', () => {
  expect(projectSlug('C:\\Users\\me\\My Project')).toBe('C--Users-me-My-Project')
})

test('state file lines', () => {
  const m = new Map<number, string>([[2, 'dir\tC:\\x'], [1, 'dir\tC:\\x']])
  expect(stateText(m)).toBe('1\tdir\tC:\\x\n2\tdir\tC:\\x\n')
  expect(stateText(new Map())).toBe('')
})

test('options become exe arguments with safe defaults', () => {
  expect(peekArgs({})).toEqual(['--lang', 'en', '--theme', 'dark', '--bottom', '91', '--right', '27'])
  expect(peekArgs({ language: 'th', theme: 'light', bottom_offset: 120.4, right_offset: 0 })).toEqual(['--lang', 'th', '--theme', 'light', '--bottom', '120', '--right', '0'])
})
