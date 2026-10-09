import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RepoState } from '../types'
import { C, cellWidth, commandDirs, commitPrompt, fit, fixPushPrompt, githubAccount, isPending, norm, parentDir, parseStatus, shortReason } from './logic'

const repos = atom({ plugin: 'git-band', key: 'repos' } as const, [] as RepoState[])
const roots = atom({ plugin: 'git-band', key: 'roots' } as const, [] as string[])
const edited = atom({ plugin: 'git-band', key: 'edited' } as const, [] as string[])
const busy = atom({ plugin: 'git-band', key: 'busy' } as const, false)

const LEAD = 'git ค้าง  '
const rootOf = new Map<string, string | null>()
let refreshing: Promise<void> | null = null

async function git($: EngineInterface, root: string, args: string[], timeoutMs = 15000) {
  return $.process.run(['git', '-C', root, ...args], { timeoutMs })
}

async function findRoot($: EngineInterface, dir: string): Promise<string | null> {
  const key = norm(dir)
  if (rootOf.has(key)) return rootOf.get(key) ?? null
  let root: string | null = null
  try {
    const r = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
    if (r.exitCode === 0) root = r.stdout.trim() || null
  } catch {
    root = null
  }
  rootOf.set(key, root)
  return root
}

async function addDir($: EngineInterface, dir: string) {
  const root = await findRoot($, dir)
  if (!root) return
  await update($, roots, list => (list.some(r => norm(r) === norm(root)) ? list : [...list, root]))
}

async function scan($: EngineInterface, root: string, prev: RepoState | undefined, mineAbs: string[]): Promise<RepoState | null> {
  let st
  try {
    const r = await git($, root, ['status', '--porcelain=v1', '-b', '-uall'])
    if (r.exitCode !== 0) return null
    st = parseStatus(r.stdout)
  } catch {
    return null
  }
  let ahead = st.ahead
  if (!st.upstream) {
    try {
      const remotes = await git($, root, ['remote'])
      if (remotes.stdout.trim()) {
        const c = await git($, root, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
        ahead = c.exitCode === 0 ? Number(c.stdout.trim()) || 0 : 0
      } else ahead = 0
    } catch {
      ahead = 0
    }
  }
  const base = norm(root)
  const mine = st.files.filter(f => mineAbs.includes(`${base}/${norm(f)}`))
  const name = root.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? root
  const keep = prev?.phase === 'fail' || prev?.phase === 'pushing' || prev?.phase === 'done' ? prev : undefined
  return {
    root,
    name,
    branch: st.branch,
    dirty: st.files.length,
    files: st.files,
    mine,
    ahead,
    phase: keep?.phase,
    reason: keep?.reason,
    error: keep?.error,
  }
}

async function refresh($: EngineInterface) {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const [list, prev, mineAbs] = await Promise.all([read($, roots), read($, repos), read($, edited)])
    const out: RepoState[] = []
    for (const root of list ?? []) {
      const s = await scan($, root, (prev ?? []).find(p => p.root === root), mineAbs ?? [])
      if (s) out.push(s)
    }
    await update($, repos, () => out)
  })()
  try {
    await refreshing
  } finally {
    refreshing = null
  }
}

async function setPhase($: EngineInterface, root: string, patch: Partial<RepoState>) {
  await update($, repos, list => list.map(r => (r.root === root ? { ...r, ...patch } : r)))
}

async function push($: EngineInterface, r: RepoState) {
  await setPhase($, r.root, { phase: 'pushing', reason: undefined, error: undefined })
  let args = ['push']
  try {
    let remote: string | undefined
    const up = await git($, r.root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    if (up.exitCode !== 0) {
      const remotes = (await git($, r.root, ['remote'])).stdout.split(/\r?\n/).filter(Boolean)
      remote = remotes.includes('origin') ? 'origin' : remotes[0]
      if (!remote) {
        await setPhase($, r.root, { phase: 'fail', reason: 'ไม่มี remote', error: 'repo นี้ยังไม่มี remote ให้ push' })
        return
      }
      args = ['push', '-u', remote, r.branch]
    } else {
      remote = up.stdout.trim().split('/')[0]
    }
    const pinned = await git($, r.root, ['config', 'credential.username'])
    if (!pinned.stdout.trim() && remote) {
      const url = await git($, r.root, ['remote', 'get-url', '--push', remote])
      const account = githubAccount(url.stdout)
      if (account) args = ['-c', `credential.username=${account}`, ...args]
    }
    const res = await git($, r.root, args, 120000)
    if (res.exitCode === 0) {
      await setPhase($, r.root, { phase: 'done' })
      $.clock.after(5000, async () => {
        await setPhase($, r.root, { phase: undefined })
        await refresh($)
      })
    } else {
      await setPhase($, r.root, { phase: 'fail', reason: shortReason(res.stderr), error: res.stderr })
    }
  } catch (err) {
    await setPhase($, r.root, { phase: 'fail', reason: 'git ไม่ตอบ', error: String(err) })
  }
}

async function commit($: EngineInterface, r: RepoState) {
  await setPhase($, r.root, { phase: 'queued' })
  await $.prompt.submit({ text: commitPrompt(r) })
}

async function askFix($: EngineInterface, r: RepoState) {
  await setPhase($, r.root, { phase: undefined, reason: undefined })
  await $.prompt.submit({ text: fixPushPrompt(r) })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, busy, () => false)
    await addDir($, await $.session.cwd())
    await refresh($)
    return started
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') {
      const file = 'file_path' in e ? (e.file_path as string) : 'notebook_path' in e ? (e.notebook_path as string) : ''
      if (file) {
        await update($, edited, list => (list.includes(norm(file)) ? list : [...list, norm(file)]))
        await addDir($, parentDir(file))
      }
    } else if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const command = 'command' in e ? (e.command as string) : ''
      for (const d of commandDirs(command)) await addDir($, d)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await update($, busy, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await update($, repos, list => list.map(r => (r.phase === 'queued' ? { ...r, phase: undefined } : r)))
      await refresh($)
      await update($, busy, () => false)
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [list, isBusy] = await Promise.all([read($, repos), read($, busy)])
    const pending = (list ?? []).filter(isPending)
    if (e.props.hasSurvey || isBusy || pending.length === 0) return next(e)

    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const { shown, hidden } = fit(pending, e.props.bodyColumns - 1, cellWidth(LEAD) + 1)

    return (
      <Box flexDirection="column">
        <Text color={C.faint}>{'╌'.repeat(Math.max(0, e.props.bodyColumns - 1))}</Text>
        <Box flexDirection="row">
          <Text color={C.dim}> {LEAD}</Text>
          {shown.map((r, i) => (
            <Box key={r.root} flexDirection="row">
              {i > 0 ? <Text color={C.faint}> │ </Text> : null}
              <Text color={C.fg}>{r.name} </Text>
              {r.phase === 'pushing' ? (
                <Text color={C.blue}>⠹ กำลัง push</Text>
              ) : r.phase === 'done' ? (
                <Text color={C.green}>✓ push แล้ว</Text>
              ) : r.phase === 'fail' ? (
                <Box flexDirection="row">
                  <Text color={C.red}>✗ push ไม่ผ่าน {r.reason ?? ''} </Text>
                  <Button key={`fix:${r.root}`} label="ให้ Claude แก้" onPress={() => askFix($, r)} />
                </Box>
              ) : (
                <Box flexDirection="row">
                  {r.dirty > 0 ? <Text color={C.amber}>●{r.dirty} </Text> : null}
                  {r.ahead > 0 ? <Text color={C.amber}>↑{r.ahead} </Text> : null}
                  {r.phase === 'queued' ? (
                    <Text color={C.dim}>◷ รอ Claude commit</Text>
                  ) : (
                    <Box flexDirection="row">
                      {r.dirty > 0 ? <Button key={`commit:${r.root}`} label="commit" onPress={() => commit($, r)} /> : null}
                      {r.dirty > 0 && r.ahead > 0 ? <Text> </Text> : null}
                      {r.ahead > 0 ? <Button key={`push:${r.root}`} label="push" onPress={() => push($, r)} /> : null}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          ))}
          {hidden > 0 ? <Text color={C.dim}> │ +{hidden}</Text> : null}
        </Box>
        {below}
      </Box>
    )
  })
}
