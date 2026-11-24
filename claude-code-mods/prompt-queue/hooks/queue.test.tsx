import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'prompt-queue',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
}

const EDITOR = {
  plugin: 'prompt-queue',
  component: 'Pane' as const,
  requestId: 'prompt-queue',
  props: {
    title: 'Queue',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline' as const,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
}

test('a prompt typed mid-turn is queued, shown, and sent when the turn ends', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const queued = await $.prompt.submit({
    text: 'then write the tests',
    origin: { kind: 'composer' },
    turnId: 't1',
    wait: false,
  })
  expect(queued.drop).toBe('Queued (#1)')
  expect(sent).toEqual([])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /then write the tests/ }))?.text).toMatch(/1\. then write/)
  await ui.unmount()

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(sent).toEqual(['then write the tests'])
})

test('a disabled item is skipped and an Esc pauses the queue', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({
    command: 'todo',
    args: 'idea for later',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  await $.prompt.submit({ text: 'second', origin: { kind: 'composer' }, turnId: 't1', wait: false })

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(sent).toEqual([])

  const ui = await $.ui.mount({ ...EDITOR, surface: 'terminal' })
  await ui.press({ key: 'key-resume' })
  await ui.unmount()
  expect(sent).toEqual(['second'])
})

test('items can be reordered, and edited in the prompt box', async ($, on) => {
  const sent: string[] = []
  const filled: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('ui.close', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.prompt.submit({ text: 'first', origin: { kind: 'composer' }, turnId: 't1', wait: false })
  await $.prompt.submit({ text: 'second', origin: { kind: 'composer' }, turnId: 't1', wait: false })

  const ui = await $.ui.mount({ ...EDITOR, surface: 'terminal' })
  // The ring starts on the first item: j moves it below the second.
  await ui.press({ key: 'key-down' })
  await ui.press({ key: 'row-2' })
  await ui.unmount()
  expect(filled).toEqual(['second'])

  // Enter in the prompt box saves the item back instead of sending it.
  await $.prompt.submit({ text: 'second, edited', origin: { kind: 'composer' }, wait: false })
  expect(sent).toEqual([])

  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(sent).toEqual(['second, edited'])
})

test('the send mode is added to the footer mode labels', async ($, on) => {
  let modes: readonly string[] = []
  on('ui.render', ($, e) => {
    if (e.component === 'SessionMode') {
      modes = e.props.modes
    }
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'prompt-queue',
    component: 'SessionMode' as const,
    surface: 'terminal',
    props: { modes: ['focus'] },
  })
  await ui.unmount()
  expect(modes).toEqual(['focus', 'queue mode'])
})

test('ctrl+x enter steers once in queue mode', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  const result = await $.prompt.submit({ text: 'nudge', origin: { kind: 'composer' }, turnId: 't1', wait: true })
  expect(result.drop).toBeUndefined()
  expect(sent).toEqual(['nudge'])
})

test('a multi-line item shows its first lines in the band', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'one\ntwo\nthree\nfour\nfive', origin: { kind: 'composer' }, turnId: 't1', wait: false })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /one/ })
  await ui.unmount()
  expect(row?.text).toMatch(/1\. one\ntwo\nthree\n… \+2 more lines/)
})

test('Up in an empty prompt opens the editor instead of recalling history', async ($, on) => {
  const opened: string[] = []
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.edit', (_, e) => ({ text: 'recalled from history', cursor: e.cursor }))

  // @ts-expect-error The test kit raises `prompt.edit` though the engine's `$` has no such call.
  const before = await $.prompt.edit({ origin: { kind: 'composer' }, key: { key: 'up' }, text: '', cursor: 0, start: 0, end: 0, inputText: '' })
  expect(before.text).toBe('recalled from history')
  expect(opened).toEqual([])

  await $.prompt.submit({ text: 'queued', origin: { kind: 'composer' }, turnId: 't1', wait: false })
  // @ts-expect-error The test kit raises `prompt.edit` though the engine's `$` has no such call.
  const after = await $.prompt.edit({ origin: { kind: 'composer' }, key: { key: 'up' }, text: '', cursor: 0, start: 0, end: 0, inputText: '' })
  expect(after.text).toBe('')
  expect(opened).toEqual(['prompt-queue'])
})

test('ctrl+x q opens the editor over a draft and puts the draft back on close', async ($, on) => {
  const filled: string[] = []
  const opened: string[] = []
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.read', () => ({ value: { text: 'half-written draft', cursor: 18 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))

  await $.prompt.submit({ text: 'queued', origin: { kind: 'composer' }, turnId: 't1', wait: false })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'open' })
  await band.unmount()
  expect(opened).toEqual(['prompt-queue'])
  expect(filled).toEqual([''])

  // Deleting the only item closes the editor, which puts the draft back.
  const editor = await $.ui.mount({ ...EDITOR, surface: 'terminal' })
  await editor.press({ key: 'key-delete' })
  await editor.unmount()
  expect(filled).toEqual(['', 'half-written draft'])
})
