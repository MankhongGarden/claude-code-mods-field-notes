export type FuelWeather = { tempC: number; code: number; isDay: boolean; humidity: number; rainChance: number; city: string; at: number }
export type FuelToast = { text: string; at: number }

export type FuelQuota = { percent: number; resetsAt?: string }

export type FuelSnapshot = {
  turn: number
  model: string
  effort?: string
  tokens?: number
  window: number
  threshold?: number
  fiveHour?: FuelQuota
  sevenDay?: FuelQuota
  permissionMode?: string
}

declare module 'claude-code' {
  interface PluginState {
    'fuel-bar': {
      snapshot: FuelSnapshot | null
      weather: FuelWeather | null
      toast: FuelToast | null
      frame: number
      startedAt: number
    }
  }
}
