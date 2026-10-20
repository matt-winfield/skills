// Mod tests, run against the engine itself: `claude plugin test .`
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Fake = { path: string; branch?: string; changes: string; commits: string; files: string; isLocked?: boolean }

const BAND = {
  plugin: 'worktrees',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 30 },
    view: {}
  }
} as const

/**
 * Everything beneath the mod: a repository of three worktrees that `git` answers for, the
 * session's directory, `/cd`, the clipboard, the store and the summary model.
 */
function world (on: On) {
  const state = {
    cwd: '/home/me/app',
    worktrees: [
      { path: '/home/me/app', branch: 'main', changes: '', commits: '', files: '' },
      {
        path: '/home/me/app/.worktrees/login',
        branch: 'feat/login',
        changes: ' M src/auth.ts\n?? src/session.ts\n',
        commits: 'Add OAuth callback\nAdd login page\n',
        files: 'M\tsrc/auth.ts\nA\tsrc/login.tsx\n'
      },
      { path: '/home/me/app/.worktrees/old', branch: 'fix/typo', changes: '', commits: 'Fix typo in README\n', files: 'M\tREADME.md\n' }
    ] as Fake[],
    prompts: [] as string[],
    copied: [] as string[],
    deletedBranches: [] as string[],
    bareMain: false
  }
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const fail = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

  on('process.run', ($, e) => {
    const [cmd, ...args] = e.argv
    const cwd = e.init?.cwd ?? state.cwd
    const here = state.worktrees.find(wt => wt.path === cwd)
    if (cmd !== 'git') return fail('not git')
    const line = args.join(' ')
    if (line === 'worktree list --porcelain') {
      const bare = state.bareMain ? 'worktree /home/me/app.git\nbare\n\n' : ''
      return ok(bare + state.worktrees.map(wt => `worktree ${wt.path}\nHEAD 0123456789abcdef\nbranch refs/heads/${wt.branch}\n${wt.isLocked ? 'locked\n' : ''}`).join('\n'))
    }
    if (line === 'status --porcelain') return here ? ok(here.changes) : fail('fatal: not a git repository')
    if (line === 'symbolic-ref --short refs/remotes/origin/HEAD') return ok('origin/main\n')
    if (line.startsWith('merge-base')) return ok('base123\n')
    if (line.startsWith('log --format=%s')) return ok(here?.commits ?? '')
    if (line.startsWith('diff --name-status')) return ok(here?.files ?? '')
    if (args[0] === 'worktree' && args[1] === 'remove') {
      const path = args.at(-1)!
      const target = state.worktrees.find(wt => wt.path === path)
      if (target === undefined) return fail(`fatal: '${path}' is not a working tree`)
      if (target.changes !== '' && !args.includes('--force')) return fail(`fatal: '${path}' contains modified or untracked files, use --force to delete it`)
      state.worktrees = state.worktrees.filter(wt => wt !== target)
      return ok()
    }
    if (args[0] === 'branch' && args[1] === '-d') {
      state.deletedBranches.push(args[2]!)
      return ok(`Deleted branch ${args[2]}\n`)
    }
    return fail(`unexpected: git ${line}`)
  })
  on('session.cwd', () => ({ value: state.cwd }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  const store: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('model.complete', ($, e) => {
    state.prompts.push(e.prompt)
    const text = e.prompt.includes('feat/login') ? '"Add OAuth login page and callback."' : 'Fix README typo'
    return { value: { isAnswered: true, text, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })
  on('ui.copy', ($, e) => {
    state.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'cd' }, ($, e) => {
    state.cwd = e.args
    return { text: `Moved to ${e.args}` }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return state
}

/** `/worktrees`, as the person types it at the prompt. */
const slash = ($: Engine, args = '') =>
  $.command.run({ command: 'worktrees', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

const startSession = ($: Engine) => $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })

/** Shows the band with `/worktrees` and waits for every summary to land. */
async function showBand ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  await slash($)
  const ui = await $.ui.mount({ ...BAND, surface })
  for (let i = 0; i < 200 && (await ui.find({ type: 'Text', text: /summarising/ })) !== undefined; i++) {
    await ui.redraw()
  }
  return ui
}

test('draws nothing until /worktrees shows the band', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Worktrees/ })).toBeUndefined()
})

test('lists each worktree with its branch, folder and summary, on terminal and desktop', async ($, on) => {
  const state = world(on)
  await startSession($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await showBand($, surface)
    expect(await ui.find({ type: 'Text', text: 'feat/login' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~\/app\/\.worktrees\/login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Add OAuth login page and callback' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / \[2 changed\]/ })).toBeDefined()
    // The main worktree on the default branch, clean, needs no model call.
    expect(await ui.find({ type: 'Text', text: 'No changes yet' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / \[here, main\]/ })).toBeDefined()
    await ui.unmount()
    await slash($)
  }
  // The second showing found every summary in the store.
  expect(state.prompts).toHaveLength(2)
  expect(state.prompts[0]).toContain('Add OAuth callback')
})

test('a second /worktrees hides the band', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await showBand($)
  await slash($)
  expect(await ui.find({ type: 'Text', text: /Worktrees/ })).toBeUndefined()
})

test('copies the selected worktree path', async ($, on) => {
  const state = world(on)
  await startSession($)
  const ui = await showBand($)
  await ui.press({ key: 'row:/home/me/app/.worktrees/old' })
  await ui.press({ key: 'copy' })
  expect(state.copied).toEqual(['/home/me/app/.worktrees/old'])
})

test('opens a worktree by moving the session there with /cd', async ($, on) => {
  const state = world(on)
  await startSession($)
  const ui = await showBand($)
  await ui.press({ key: 'row:/home/me/app/.worktrees/login' })
  await ui.press({ key: 'open' })
  expect(state.cwd).toBe('/home/me/app/.worktrees/login')
  expect(await ui.find({ type: 'Text', text: / \[here, 2 changed\]/ })).toBeDefined()
})

test('will not delete the main worktree or the one Claude works in', async ($, on) => {
  const state = world(on)
  await startSession($)
  const ui = await showBand($)
  await ui.press({ key: 'row:/home/me/app' })
  await ui.press({ key: 'delete' })
  expect(await ui.find({ type: 'Text', text: /main worktree/ })).toBeDefined()
  expect(await ui.find({ key: 'cancel' })).toBeUndefined()
  expect(state.worktrees).toHaveLength(3)
})

test('deletes a clean worktree and its branch after confirming', async ($, on) => {
  const state = world(on)
  await startSession($)
  const ui = await showBand($)
  await ui.press({ key: 'row:/home/me/app/.worktrees/old' })
  await ui.press({ key: 'delete' })
  expect(await ui.find({ type: 'Text', text: /Delete ~\/app\/\.worktrees\/old\?/ })).toBeDefined()
  await ui.press({ key: 'remove-branch' })
  expect(state.worktrees.map(wt => wt.path)).not.toContain('/home/me/app/.worktrees/old')
  expect(state.deletedBranches).toEqual(['fix/typo'])
  expect(await ui.find({ type: 'Text', text: /Deleted ~\/app\/\.worktrees\/old and branch fix\/typo/ })).toBeDefined()
  expect(await ui.find({ key: 'row:/home/me/app/.worktrees/old' })).toBeUndefined()
})

test('warns before force-deleting a worktree with uncommitted changes; cancel keeps it', async ($, on) => {
  const state = world(on)
  await startSession($)
  const ui = await showBand($)
  await ui.press({ key: 'row:/home/me/app/.worktrees/login' })
  await ui.press({ key: 'delete' })
  expect(await ui.find({ type: 'Text', text: /2 uncommitted changes, which will be lost/ })).toBeDefined()
  await ui.press({ key: 'cancel' })
  expect(state.worktrees).toHaveLength(3)
  await ui.press({ key: 'delete' })
  await ui.press({ key: 'remove' })
  expect(state.worktrees.map(wt => wt.path)).not.toContain('/home/me/app/.worktrees/login')
  expect(state.deletedBranches).toEqual([])
})

test('deletes a worktree when the main repository is bare', async ($, on) => {
  const state = world(on)
  state.bareMain = true
  state.worktrees = state.worktrees.slice(1)
  state.cwd = '/home/me/app/.worktrees/login'
  await startSession($)
  const ui = await showBand($)
  // The first linked worktree is not taken for the main one.
  expect(await ui.find({ type: 'Text', text: / \[here, 2 changed\]/ })).toBeDefined()
  await ui.press({ key: 'row:/home/me/app/.worktrees/old' })
  await ui.press({ key: 'delete' })
  await ui.press({ key: 'remove' })
  expect(state.worktrees.map(wt => wt.path)).toEqual(['/home/me/app/.worktrees/login'])
})
