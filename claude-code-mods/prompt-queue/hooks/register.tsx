import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { QueueItem, SendMode } from '../types'

const MODES: readonly SendMode[] = ['queue', 'steer', 'interrupt']
const PANE = 'prompt-queue'
// `ctrl+x q`, bound in keybindings.json to `diff:back`: that action's only
// built-in handler runs inside the diff dialog, so at the prompt the band's
// Button answers it.
const OPEN_ACTION = 'diff:back'
const OPEN_CHORD = 'ctrl+x q'
const PREVIEW_LINES = 3

// Prompt-queue mod: Cursor-style queued messages for Claude Code.
//
// While a turn runs, Enter does one of three things (the session's mode, or the
// `defaultMode` option): `queue` holds the prompt in a list above the prompt box
// and sends it once the whole turn has finished, `steer` hands it to the engine
// (delivered after the next tool call, Claude Code's own behaviour), `interrupt`
// stops the turn and sends it straight away. `ctrl+x enter` does the other
// thing once: it steers in queue mode and queues in steer or interrupt mode.
//
// The list above the prompt is read-only. Up in an empty prompt (or `/queue`)
// opens the queue editor: a focused pane where up and down walk the items.
export const register: Register = (on, options) => {
  const defaultMode = toMode(options.defaultMode) ?? 'queue'
  const showModeInFooter = options.showModeInFooter !== false
  // The prompt box's text as last seen, to tell an Up in an empty box apart.
  let draft = ''
  // The item the editor's focus ring is on.
  let focusedId: string | null = null
  // A prompt the mod took: Claude Code puts a stopped prompt back in the box,
  // so the next time the box holds exactly this text it is cleared.
  let taken: string | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'queue',
      description: 'Open the prompt queue editor (or press Up in an empty prompt)',
      immediate: true,
    })
    await $.command.register({
      name: 'queue-mode',
      description: 'Set what Enter does while Claude works: queue, steer or interrupt',
      argumentHint: '[queue|steer|interrupt]',
      immediate: true,
    })
    await $.command.register({
      name: 'todo',
      description: 'Add a disabled item to the prompt queue (skipped until you enable it)',
      argumentHint: '<prompt>',
      immediate: true,
    })
    await $.command.register({
      name: 'queue-clear',
      description: 'Empty the prompt queue',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'queue' }, async $ => {
    if ((await read($, itemsAtom)).length === 0) {
      return { text: 'The queue is empty.' }
    }
    await openEditor($)

    return { text: 'Queue editor opened.' }
  })

  on('command.run', { command: 'queue-mode' }, async ($, e) => {
    const asked = e.args.trim()
    const mode = asked === '' ? nextMode(await currentMode($, defaultMode)) : toMode(asked)
    if (mode === undefined) {
      return { text: `Unknown mode "${asked}". Use one of: ${MODES.join(', ')}.` }
    }
    await update($, modeAtom, () => mode)

    return { text: `While Claude works, Enter will now ${describeMode(mode)}.` }
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = e.args.trim()
    if (text === '') {
      return { text: 'Usage: /todo <prompt>' }
    }
    await enqueue($, text, false)

    return { text: 'Added a disabled item to the queue.' }
  })

  on('command.run', { command: 'queue-clear' }, async $ => {
    await update($, itemsAtom, () => [])
    await update($, editingAtom, () => null)
    await closeEditor($)

    return { text: 'Queue cleared.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const isPerson = isPersonOrigin(e.origin)
    const editingId = await read($, editingAtom)
    if (editingId !== null && isPerson && e.command === undefined) {
      await saveEdit($, editingId, e.text)
      taken = e.text

      return { drop: 'Saved back to the queue' }
    }
    if (!isPerson || e.command !== undefined || e.attachments !== undefined || e.turnId === undefined) {
      return next(e)
    }

    const current = await currentMode($, defaultMode)
    const mode: SendMode = e.wait ? oneOff(current) : current
    if (mode === 'steer') {
      return next(e)
    }

    if (mode === 'interrupt') {
      await update($, interruptAtom, () => e.text)
      await $.turn.abort({ turnId: e.turnId })
      taken = e.text

      return { drop: 'Interrupting, then sending this' }
    }

    const count = await enqueue($, e.text, true)
    taken = e.text

    // Claude Code has no silent way to stop a prompt: every stop shows this
    // reason as "Prompt dropped by a hook: ..." and puts the text back.
    return { drop: `Queued (#${count})` }
  })

  // Up in an empty prompt opens the editor instead of recalling history.
  on('prompt.edit', async ($, e, next) => {
    const isUp = e.key?.key === 'up' && e.key.shift !== true && e.key.ctrl !== true && e.key.meta !== true
    if (isUp && e.text === '' && (await read($, itemsAtom)).length > 0) {
      await openEditor($)

      return { text: e.text, cursor: e.cursor }
    }
    const box = await next(e)
    draft = box.text

    return box
  })

  // Fallback where Up reaches history without a `prompt.edit`: put the empty
  // draft back and open the editor.
  on('prompt.change', async ($, e, next) => {
    const wasEmpty = draft === ''
    draft = e.text
    if (taken !== null && e.text === taken && e.origin.kind !== 'plugin') {
      taken = null
      await $.prompt.fill({ text: '' })
      draft = ''

      return next(e)
    }
    if (e.origin.kind === 'clear' && e.text === '' && (await read($, editingAtom)) !== null) {
      await update($, editingAtom, () => null)
    }
    if (e.origin.kind === 'history' && wasEmpty && (await read($, itemsAtom)).length > 0) {
      await $.prompt.fill({ text: '' })
      draft = ''
      await openEditor($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }

    const interruptText = await read($, interruptAtom)
    if (interruptText !== null) {
      await update($, interruptAtom, () => null)
      void $.prompt.submit({ text: interruptText, asUser: true })

      return result
    }

    if (e.reason !== 'answer') {
      // Esc or an error: hold the queue instead of firing into a stopped session.
      const items = await read($, itemsAtom)
      if (items.some(item => item.isEnabled)) {
        await update($, pausedAtom, () => true)
      }

      return result
    }

    if (!(await read($, pausedAtom))) {
      await sendNext($)
    }

    return result
  })

  // The footer's mode labels: drawn dim beside the session's other modes.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!showModeInFooter) {
      return next(e)
    }
    const label = `${await currentMode($, defaultMode)} mode`

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })

  // The read-only list above the prompt; hidden while the editor is open.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const items = await read($, itemsAtom)
    if (e.props.hasSurvey || items.length === 0 || (await read($, paneOpenAtom))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const isPaused = await read($, pausedAtom)
    const once = oneOff(await currentMode($, defaultMode))
    const editingId = await read($, editingAtom)
    const editingIndex = items.findIndex(item => item.id === editingId)
    const width = Math.max(20, e.props.bodyColumns - 8)

    return (
      <Box flexDirection="column">
        {editingIndex >= 0 ? (
          <Box>
            <Text color="warning">Editing queue item {editingIndex + 1} · enter save · clear the prompt to cancel · </Text>
            <Button key="open" plain dimColor action={OPEN_ACTION} label={`${OPEN_CHORD} back to queue`} onPress={() => openEditor($)} />
          </Box>
        ) : (
          <Box>
            <Text dimColor>
              Queue · {items.filter(item => item.isEnabled).length}
              {isPaused ? ' · paused' : ''} · ↑ in an empty prompt or{' '}
            </Text>
            <Button key="open" plain dimColor action={OPEN_ACTION} label={`${OPEN_CHORD} to open`} onPress={() => openEditor($)} />
            <Text dimColor> · ctrl+x enter to {once} once</Text>
          </Box>
        )}
        {items.map((item, index) => (
          <Text key={item.id} dimColor={!item.isEnabled}>
            {item.isEnabled ? '●' : '○'} {index + 1}. {preview(item.text, width)}
          </Text>
        ))}
      </Box>
    )
  })

  // The queue editor: one Button per item, so up and down walk the items.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const items = await read($, itemsAtom)
    const isPaused = await read($, pausedAtom)
    const mode = await currentMode($, defaultMode)
    const width = Math.max(20, e.props.bodyColumns - 8)
    const focused = (): QueueItem | undefined => items.find(item => item.id === focusedId) ?? items[0]

    return (
      <Box flexDirection="column">
        {items.length === 0 && <Text dimColor>The queue is empty. Esc to close.</Text>}
        {items.map((item, index) => (
            <Button
              key={`row-${item.id}`}
              plain
              autoFocus={index === 0 ? true : undefined}
              dimColor={!item.isEnabled}
              onPress={() => startEdit($, item)}
            >
              {item.isEnabled ? '●' : '○'} {index + 1}. {preview(item.text, width)}
            </Button>
        ))}
        <Text> </Text>
        <Box>
          <Text dimColor>↑↓ select · enter edit in prompt · </Text>
          <Button key="key-toggle" plain dimColor hotkey="t" label="on/off" onPress={() => withFocused($, focused(), item => update($, itemsAtom, list => toggle(list, item.id)))} />
          <Text dimColor> · </Text>
          <Button key="key-delete" plain dimColor hotkey="x" label="delete" onPress={() => withFocused($, focused(), item => removeItem($, items, item))} />
          <Text dimColor> · </Text>
          <Button key="key-up" plain dimColor hotkey="k" label="move up" onPress={() => withFocused($, focused(), item => update($, itemsAtom, list => move(list, item.id, -1)))} />
          <Text dimColor> · </Text>
          <Button key="key-down" plain dimColor hotkey="j" label="move down" onPress={() => withFocused($, focused(), item => update($, itemsAtom, list => move(list, item.id, 1)))} />
        </Box>
        <Box>
          <Button key="key-mode" plain dimColor hotkey="m" label={`mode: ${mode}`} onPress={() => update($, modeAtom, () => nextMode(mode))} />
          {isPaused && (
            <Box>
              <Text dimColor> · </Text>
              <Button key="key-resume" plain hotkey="r" label="resume" onPress={() => resume($)} />
            </Box>
          )}
          {!isPaused && (
            <Box>
              <Text dimColor> · </Text>
              <Button key="key-send" plain dimColor hotkey="s" label="send next now" onPress={() => sendNext($)} />
            </Box>
          )}
          <Text dimColor> · esc close (puts back any draft)</Text>
        </Box>
      </Box>
    )
  })

  // Keep the focus ring on the items: the shortcut row is pressed by its keys.
  on('ui.focus', async ($, e, next) => {
    if (e.requestId !== PANE) {
      return next(e)
    }
    if (e.element === undefined || e.element.startsWith('key-')) {
      return { deny: 'the queue editor keeps the focus on its items' }
    }
    if (e.element.startsWith('row-')) {
      focusedId = e.element.slice('row-'.length)
    }

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, paneOpenAtom, () => false)
      await restoreDraft($)
    }

    return next(e)
  })
}

// Survives reloads; the `shape` tag declines what an older version stored.
const itemsAtom = atom({ plugin: 'prompt-queue', key: 'items' } as const, [], { shape: 'items-1' })
const modeAtom = atom({ plugin: 'prompt-queue', key: 'mode' } as const, null)
const editingAtom = atom({ plugin: 'prompt-queue', key: 'editingId' } as const, null)
const pausedAtom = atom({ plugin: 'prompt-queue', key: 'isPaused' } as const, false)
const paneOpenAtom = atom({ plugin: 'prompt-queue', key: 'isPaneOpen' } as const, false)
const interruptAtom = atom({ plugin: 'prompt-queue', key: 'interruptText' } as const, null)
const nextIdAtom = atom({ plugin: 'prompt-queue', key: 'nextId' } as const, 1)
const stashedAtom = atom({ plugin: 'prompt-queue', key: 'stashedDraft' } as const, null)

// The editor takes the keyboard only over an empty prompt, so a draft is set
// aside while it is open and put back when it closes.
async function openEditor($: EngineInterface): Promise<void> {
  const box = await $.prompt.read()
  if (box.text !== '') {
    await update($, stashedAtom, () => box.text)
    await $.prompt.fill({ text: '' })
  }
  const items = await read($, itemsAtom)
  const rows = items.reduce((sum, item) => sum + Math.min(PREVIEW_LINES + 1, item.text.split('\n').length), 0) + 3
  await update($, paneOpenAtom, () => true)
  await $.ui.open({ id: PANE, title: 'Queue', focus: true, closeOnEscape: true, rows, columns: 1000 })
}

// Loads an item into the full-width prompt box; Enter there saves it back.
async function startEdit($: EngineInterface, item: QueueItem): Promise<void> {
  // The item replaces whatever draft was set aside.
  await update($, stashedAtom, () => null)
  await closeEditor($)
  await update($, editingAtom, () => item.id)
  await $.prompt.fill({ text: item.text })
}

async function saveEdit($: EngineInterface, id: string, value: string): Promise<void> {
  const text = value.trim()
  await update($, itemsAtom, list =>
    text === '' ? list.filter(one => one.id !== id) : list.map(one => (one.id === id ? { ...one, text } : one)),
  )
  await update($, editingAtom, () => null)
}

// Moving the ring is a nicety: an action must not fail because it could not.
async function refocus($: EngineInterface, key: string): Promise<void> {
  try {
    await $.ui.focus({ requestId: PANE, key })
  } catch {
    // The editor closed or lost the keys meanwhile.
  }
}

async function closeEditor($: EngineInterface): Promise<void> {
  if (await read($, paneOpenAtom)) {
    await $.ui.close({ id: PANE })
    await update($, paneOpenAtom, () => false)
    await restoreDraft($)
  }
}

// Puts back a draft `openEditor` set aside; a no-op once it has been.
async function restoreDraft($: EngineInterface): Promise<void> {
  const stashed = await read($, stashedAtom)
  if (stashed === null) {
    return
  }
  await update($, stashedAtom, () => null)
  await $.prompt.fill({ text: stashed })
}

async function withFocused($: EngineInterface, item: QueueItem | undefined, act: (item: QueueItem) => Promise<unknown>): Promise<void> {
  if (item === undefined) {
    return
  }
  await act(item)
  await refocus($, `row-${item.id}`)
}

async function removeItem($: EngineInterface, items: QueueItem[], item: QueueItem): Promise<void> {
  const index = items.findIndex(one => one.id === item.id)
  const neighbour = items[index + 1] ?? items[index - 1]
  await update($, itemsAtom, list => list.filter(one => one.id !== item.id))
  if (neighbour === undefined) {
    await closeEditor($)

    return
  }
  await refocus($, `row-${neighbour.id}`)
}

async function resume($: EngineInterface): Promise<void> {
  await update($, pausedAtom, () => false)
  await sendNext($)
}

async function sendNext($: EngineInterface): Promise<void> {
  const items = await read($, itemsAtom)
  const first = items.find(item => item.isEnabled)
  if (first === undefined) {
    await update($, pausedAtom, () => false)

    return
  }
  await update($, itemsAtom, list => list.filter(one => one.id !== first.id))
  await update($, editingAtom, id => (id === first.id ? null : id))
  await update($, pausedAtom, () => false)
  // A plugin's prompt runs once the session is idle, as its own turn.
  void $.prompt.submit({ text: first.text, asUser: true })
}

async function enqueue($: EngineInterface, text: string, isEnabled: boolean): Promise<number> {
  const id = await read($, nextIdAtom)
  await update($, nextIdAtom, n => n + 1)
  const item: QueueItem = { id: String(id), text, isEnabled }
  await update($, itemsAtom, list => [...list, item])

  return (await read($, itemsAtom)).length
}

async function currentMode($: EngineInterface, fallback: SendMode): Promise<SendMode> {
  return (await read($, modeAtom)) ?? fallback
}

function isPersonOrigin(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

function toggle(list: QueueItem[], id: string): QueueItem[] {
  return list.map(one => (one.id === id ? { ...one, isEnabled: !one.isEnabled } : one))
}

function move(list: QueueItem[], id: string, by: number): QueueItem[] {
  const from = list.findIndex(one => one.id === id)
  const to = from + by
  if (from < 0 || to < 0 || to >= list.length) {
    return list
  }
  const copy = [...list]
  copy.splice(to, 0, ...copy.splice(from, 1))

  return copy
}

// What `ctrl+x enter` does in each mode: the other of queue and steer.
function oneOff(mode: SendMode): SendMode {
  return mode === 'queue' ? 'steer' : 'queue'
}

function nextMode(mode: SendMode): SendMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? 'queue'
}

function toMode(value: unknown): SendMode | undefined {
  return MODES.find(mode => mode === value)
}

function describeMode(mode: SendMode): string {
  if (mode === 'queue') {
    return 'queue the prompt and send it after the turn finishes'
  }
  if (mode === 'steer') {
    return 'steer: deliver the prompt after the next tool call'
  }

  return 'interrupt the turn and send the prompt right away'
}

function preview(text: string, width: number): string {
  const lines = text.trim().split('\n')
  const shown = lines.slice(0, PREVIEW_LINES).map(line => truncate(line, width))
  const hidden = lines.length - shown.length

  return hidden > 0 ? `${shown.join('\n')}\n… +${hidden} more line${hidden === 1 ? '' : 's'}` : shown.join('\n')
}

function truncate(line: string, width: number): string {
  const flat = line.replace(/\s+/g, ' ')

  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat
}
