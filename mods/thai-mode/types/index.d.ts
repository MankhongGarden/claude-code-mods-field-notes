export type ThaiModeEnabled = boolean

declare module 'claude-code' {
  interface PluginState {
    'thai-mode': { enabled: ThaiModeEnabled }
  }
}
