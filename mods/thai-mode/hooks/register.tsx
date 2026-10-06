import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { groupLine, resultView, SPINNER_WORD, thaiDuration, thaiProgressHint, toolRow } from './thai'

const enabled = atom({ plugin: 'thai-mode', key: 'enabled' } as const, true)

const C = {
  text: '#2d2a24',
  dim: '#6b675e',
  green: '#3f8a3a',
  red: '#b8322b',
  running: '#a8a497',
}

let cwd: string | undefined

async function isOn($: EngineInterface): Promise<boolean> {
  return read($, enabled)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'thai', description: 'thai-mode: สลับเปิด/ปิดการแสดงผลภาษาไทย' })
    cwd = await $.session.cwd()
    const stored = await $.store.get('enabled')
    if (typeof stored === 'boolean') await update($, enabled, () => stored)
    return result
  })

  on('command.run', { command: 'thai' }, async $ => {
    const now = !(await read($, enabled))
    await update($, enabled, () => now)
    await $.store.set('enabled', now)
    return { text: now ? 'Thai Mode: เปิด' : 'Thai Mode: ปิด (กลับเป็นภาษาอังกฤษ)' }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const row = toolRow(e.props.tool, e.props.input, cwd)
    if (!row) return next(e)
    const dot = e.props.isRunning ? C.running : e.props.isErrored || e.props.isInterrupted ? C.red : C.green
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text color={dot}>● </Text>
        <Text color={C.text}>
          {row.label}
        </Text>
        {row.arg ? <Text color={C.text}> {row.arg}</Text> : null}
        {e.props.isInterrupted ? <Text color={C.dim}> · ถูกหยุด</Text> : null}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isErrored || !(await isOn($))) return next(e)
    const view = resultView(e.props.tool, e.props.output)
    if (!view) return next(e)
    const { Box, Text, Code } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color={C.dim}>  ⎿  {view.summary}</Text>
        {view.diff ? (
          <Box paddingLeft={5}>
            <Code source={view.diff} format="diff" path={view.path} />
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded || !(await isOn($))) return next(e)
    const calls = e.props.calls
    const dot = calls.some(c => c.isErrored) ? C.red : e.props.isActive ? C.running : C.green
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text color={dot}>● </Text>
        <Text color={C.text}>{groupLine(calls, e.props.isActive)}</Text>
        <Text color={C.dim}> (ctrl+o ดูทั้งหมด)</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const word = SPINNER_WORD[e.props.mode]
    return word ? next({ ...e, props: { ...e.props, word } }) : next(e)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box marginTop={1}>
        <Text color={C.dim}>✻ เสร็จใน {thaiDuration(e.props.durationMs)}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    return next({ ...e, props: { ...e.props, hint: thaiProgressHint(e.props.hint) } })
  })
}
