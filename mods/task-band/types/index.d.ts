export type TaskKind = 'agent' | 'wf' | 'sh' | 'mon'
export type TaskStatus = 'running' | 'done' | 'fail'

export type BandTask = {
  id: string
  kind: TaskKind
  label: string
  startedAt: number
  status: TaskStatus
  endedAt?: number
  order?: number
  taskId?: string
  agentType?: string
  estMs?: number
  runId?: string
  members?: string[]
  finished?: string[]
}

export type BandJump = { id: string; until: number }

declare module 'claude-code' {
  interface PluginState {
    'task-band': {
      tasks: BandTask[]
      page: number
      jump: BandJump | null
      tick: number
    }
  }
}
