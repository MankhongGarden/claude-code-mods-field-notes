export type RepoPhase = 'queued' | 'pushing' | 'done' | 'fail'

export type RepoState = {
  root: string
  name: string
  branch: string
  dirty: number
  files: string[]
  mine: string[]
  ahead: number
  phase?: RepoPhase
  reason?: string
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'git-band': { repos: RepoState[]; roots: string[]; edited: string[]; busy: boolean }
  }
}
