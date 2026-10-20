import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, RenderSurface } from 'claude-code'

import { cleanSummary, hash, parseWorktrees, summaryPrompt, tildify, worktreeOf } from './git'
import type { Confirm, Worktree } from '../types'

const isOpen = atom({ plugin: 'worktrees', key: 'isOpen' } as const, false)
const isLoading = atom({ plugin: 'worktrees', key: 'isLoading' } as const, false)
const list = atom({ plugin: 'worktrees', key: 'list' } as const, [] as Worktree[])
const summaries = atom({ plugin: 'worktrees', key: 'summaries' } as const, {} as Record<string, string>)
const selected = atom({ plugin: 'worktrees', key: 'selected' } as const, null as string | null)
const confirm = atom({ plugin: 'worktrees', key: 'confirm' } as const, null as Confirm | null)
const notice = atom({ plugin: 'worktrees', key: 'notice' } as const, null as string | null)

const ROW = 'row:'
// Summaries are asked for a few at a time, and each one gives up after this long.
const SUMMARY_CONCURRENCY = 3
const SUMMARY_TIMEOUT_MS = 20_000

type Git = { isOk: boolean; out: string; err: string }

async function git ($: EngineInterface, cwd: string, args: string[]): Promise<Git> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['git', ...args], { cwd, timeoutMs: 15_000 })
    return { isOk: exitCode === 0, out: stdout, err: stderr.trim() }
  } catch (error) {
    return { isOk: false, out: '', err: error instanceof Error ? error.message : String(error) }
  }
}

const firstLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.replace(/^(fatal|error): /, '') ?? ''

/** Whether a drawing beneath shows nothing: no text, no control. */
function isBlank (node: RenderNode | undefined): boolean {
  if (node === undefined || node === null) return true
  if (typeof node === 'string') return node.trim() === ''
  return (node.type === 'Box' || node.type === 'Text') && (node.children ?? []).every(isBlank)
}

/** The ref a branch is compared against: origin's default branch, else a local main or master. */
async function defaultRef ($: EngineInterface, cwd: string): Promise<string | undefined> {
  const remote = await git($, cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (remote.isOk && remote.out.trim() !== '') return remote.out.trim()
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if ((await git($, cwd, ['rev-parse', '--verify', '--quiet', ref])).isOk) return ref
  }
  return undefined
}

// What the person set in /config, as the module last registered with.
let model = 'haiku'
let showSummaries = true
// The band's id, as the engine draws it: what `$.ui.focus` names it by.
let bandId: string | undefined
// Summaries being written, by path, so a refresh mid-way does not ask twice.
const writing = new Set<string>()

async function say ($: EngineInterface, text: string | null) {
  await update($, notice, () => text)
}

/** One worktree's summary: from the store while its changes stand still, else from the model. */
async function summaryOf ($: EngineInterface, wt: Worktree, base: string | undefined): Promise<string> {
  if (wt.isPrunable) return 'Folder is missing'
  const since = base === undefined ? undefined : await git($, wt.path, ['merge-base', base, 'HEAD'])
  const range = since?.isOk === true ? `${since.out.trim()}..HEAD` : undefined
  const commits = await git($, wt.path, range ? ['log', '--format=%s', '-n', '30', range] : ['log', '--format=%s', '-n', '5'])
  const files = range ? await git($, wt.path, ['diff', '--name-status', since!.out.trim()]) : { out: '' }
  const status = await git($, wt.path, ['status', '--porcelain'])
  const prompt = summaryPrompt(wt.branch ?? 'detached HEAD', commits.out, files.out, status.out)
  if (prompt === undefined) return 'No changes yet'

  const key = hash(`${model}\n${prompt}`)
  const cached = (await $.store.get(`summary:${wt.path}`)) as { key: string; text: string } | undefined
  if (cached?.key === key) return cached.text

  const fallback = cleanSummary(commits.out) || 'Uncommitted changes'
  if (!showSummaries) return fallback
  const reply = await $.model.complete({ model, prompt, maxTokens: 60, effort: 'low', timeoutMs: SUMMARY_TIMEOUT_MS })
    .catch(() => undefined)
  if (reply?.isAnswered !== true) return fallback
  const text = cleanSummary(reply.text) || fallback
  await $.store.set(`summary:${wt.path}`, { key, text })
  return text
}

/** Writes each worktree's summary into the band as it arrives. */
async function summarise ($: EngineInterface, worktrees: Worktree[]) {
  const todo = worktrees.filter(wt => !writing.has(wt.path))
  if (todo.length === 0) return
  for (const wt of todo) writing.add(wt.path)
  const base = await defaultRef($, todo[0]!.path)
  const queue = [...todo]
  const work = async () => {
    for (let wt = queue.shift(); wt !== undefined; wt = queue.shift()) {
      const path = wt.path
      const text = await summaryOf($, wt, base).catch(() => '')
      writing.delete(path)
      await update($, summaries, all => ({ ...all, [path]: text }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(SUMMARY_CONCURRENCY, todo.length) }, work))
}

/** Reads the worktrees again; their summaries follow without holding the caller up. */
async function refresh ($: EngineInterface) {
  await update($, isLoading, () => true)
  try {
    const cwd = await $.session.cwd()
    const listed = await git($, cwd, ['worktree', 'list', '--porcelain'])
    if (!listed.isOk) {
      await update($, list, () => [])
      await say($, `Not in a git repository (${firstLine(listed.err) || cwd})`)
      return
    }
    const found = parseWorktrees(listed.out)
    const current = worktreeOf(found.map(wt => wt.path), cwd)
    const worktrees: Worktree[] = await Promise.all(found.map(async wt => {
      const status = wt.isPrunable ? { out: '' } : await git($, wt.path, ['status', '--porcelain'])
      const changes = status.out.split('\n').filter(line => line.trim() !== '').length
      return { ...wt, isCurrent: wt.path === current, changes }
    }))
    await update($, list, () => worktrees)
    await update($, selected, path =>
      worktrees.some(wt => wt.path === path) ? path : (current ?? worktrees[0]?.path ?? null))
    void summarise($, worktrees)
  } finally {
    await update($, isLoading, () => false)
  }
}

async function open ($: EngineInterface) {
  await update($, isOpen, () => true)
  await update($, confirm, () => null)
  await say($, null)
  await refresh($)
}

async function close ($: EngineInterface) {
  await update($, isOpen, () => false)
  await update($, confirm, () => null)
  await say($, null)
}

async function chosen ($: EngineInterface) {
  const path = await read($, selected)
  return (await read($, list)).find(wt => wt.path === path)
}

/** Moves the session into the worktree, as `/cd <path>` does. */
async function moveInto ($: EngineInterface) {
  const wt = await chosen($)
  if (wt === undefined) return
  if (wt.isCurrent) return say($, 'Claude Code is already working in this worktree')
  if (wt.isPrunable) return say($, 'Its folder is missing: delete it instead')
  try {
    await $.command.run({ command: 'cd', args: wt.path })
  } catch {
    // Builds without /cd: the EnterWorktree tool switches into an existing worktree too.
    await $.tool.call({ tool: 'EnterWorktree', path: wt.path }).catch(() => undefined)
  }
  await say($, null)
  await refresh($)
  if (!(await chosen($))?.isCurrent) await say($, `Could not move into ${wt.path}`)
  else $.ui.toast(`Working in ${wt.branch ?? wt.path}`)
}

async function copyPath ($: EngineInterface, surface: RenderSurface) {
  const wt = await chosen($)
  if (wt === undefined) return
  const copied = await $.ui.copy({ text: wt.path, surface })
  if (copied.isCopied) $.ui.toast(`Copied ${wt.path}`)
  else await say($, `Could not copy the path (${copied.reason})`)
}

async function askDelete ($: EngineInterface) {
  const wt = await chosen($)
  if (wt === undefined) return
  if (wt.isMain) return say($, 'The main worktree is the repository itself: it is not deleted from here')
  if (wt.isCurrent) return say($, 'Claude Code is working in this worktree: open another one first')
  await say($, null)
  await update($, confirm, () => ({ path: wt.path, isForce: wt.changes > 0 || wt.isLocked }))
  if (bandId !== undefined) void $.ui.focus({ requestId: bandId, key: 'cancel' }).catch(() => undefined)
}

/** Removes the worktree waiting on confirmation, and its branch when asked and merged. */
async function remove ($: EngineInterface, withBranch: boolean) {
  const waiting = await read($, confirm)
  const worktrees = await read($, list)
  const wt = worktrees.find(one => one.path === waiting?.path)
  const main = worktrees.find(one => one.isMain)
  await update($, confirm, () => null)
  if (waiting === null || wt === undefined || main === undefined) return
  const force = waiting.isForce ? (wt.isLocked ? ['--force', '--force'] : ['--force']) : []
  const removed = wt.isPrunable
    ? await git($, main.path, ['worktree', 'prune'])
    : await git($, main.path, ['worktree', 'remove', ...force, wt.path])
  if (!removed.isOk) {
    await refresh($)
    return say($, `Not deleted: ${firstLine(removed.err)}`)
  }
  let text = `Deleted ${tildify(wt.path, await $.env.get('HOME'))}`
  if (withBranch && wt.branch !== undefined) {
    const branch = await git($, main.path, ['branch', '-d', wt.branch])
    text += branch.isOk ? ` and branch ${wt.branch}` : `; kept branch ${wt.branch}: ${firstLine(branch.err)}`
  }
  await $.store.delete(`summary:${wt.path}`)
  await refresh($)
  await say($, text)
}

export const register: Register = (on, options) => {
  model = typeof options.summaryModel === 'string' && options.summaryModel !== '' ? options.summaryModel : 'haiku'
  showSummaries = options.showSummaries !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'worktrees',
      description: "Show this repository's git worktrees above the prompt (run again to hide)",
      argumentHint: '[refresh]'
    })
    if (await read($, isOpen)) void refresh($)
    return started
  })

  // `/worktrees` shows or hides the band; `/worktrees refresh` keeps it up and reads them again.
  on('command.run', { command: 'worktrees' }, async ($, e) => {
    if ((await read($, isOpen)) && (e.args ?? '').trim() !== 'refresh') {
      await close($)
      return { text: 'Worktrees hidden.' }
    }
    await open($)
    const count = (await read($, list)).length
    return { text: count === 0 ? 'No worktrees found.' : `${count} worktree${count === 1 ? '' : 's'} above the prompt. ctrl+x tab (or a click) focuses them.` }
  })

  // A turn can add, remove or change worktrees: read them again while the band is up.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isOpen)) void refresh($)
    return result
  })

  // Walking the rows with Tab or the arrows selects the one the focus lands on.
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.plugin === 'worktrees' && e.element?.startsWith(ROW)) {
      const path = e.element.slice(ROW.length)
      await update($, selected, () => path)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await read($, isOpen)) || e.props.hasSurvey) return next(e)
    bandId = e.requestId
    const { Box, Button, Text } = $.ui.resolve(e)
    const worktrees = await read($, list)
    const texts = await read($, summaries)
    const current = await read($, selected)
    const waiting = await read($, confirm)
    const message = await read($, notice)
    const loading = await read($, isLoading)
    const home = await $.env.get('HOME')
    const beneath = await next(e)
    const target = worktrees.find(wt => wt.path === waiting?.path)

    const row = (wt: Worktree) => {
      const isSelected = wt.path === current
      const tags = [
        wt.isCurrent ? 'here' : '',
        wt.isMain ? 'main' : '',
        wt.isLocked ? 'locked' : '',
        wt.isPrunable ? 'missing' : '',
        wt.changes > 0 ? `${wt.changes} changed` : ''
      ].filter(Boolean)
      const summary = texts[wt.path] ?? (showSummaries ? 'summarising…' : '')
      return (
        <Box key={`wt:${wt.path}`} flexDirection="column">
          <Button key={`${ROW}${wt.path}`} plain onPress={() => update($, selected, () => wt.path)}>
            <Text color="claude">{isSelected ? '❯ ' : '  '}</Text>
            <Text bold={isSelected} color={wt.branch === undefined ? 'warning' : 'suggestion'}>
              {wt.branch ?? `detached ${wt.head.slice(0, 7)}`}
            </Text>
            {tags.length > 0 ? <Text color={wt.changes > 0 ? 'warning' : undefined} dimColor={wt.changes === 0}> [{tags.join(', ')}]</Text> : ''}
            {summary !== '' ? <Text dimColor> · </Text> : ''}
            {summary !== '' ? <Text italic dimColor={texts[wt.path] === undefined}>{summary}</Text> : ''}
          </Button>
          <Text dimColor wrap="truncate-middle">{'    '}{tildify(wt.path, home)}</Text>
        </Box>
      )
    }

    const actions = (
      <Box key="actions" flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Button key="open" plain hotkey="o" label="Open here" onPress={() => moveInto($)} />
        <Button key="copy" plain hotkey="c" label="Copy path" onPress={press => copyPath($, press.surface)} />
        <Button key="delete" plain hotkey="d" label="Delete" onPress={() => askDelete($)} />
        <Button key="refresh" plain hotkey="r" label="Refresh" onPress={() => refresh($)} />
        <Button key="close" plain hotkey="q" role="dismiss" label="Close" onPress={() => close($)} />
      </Box>
    )

    const asking = target === undefined ? null : (
      <Box key="confirm" flexDirection="column">
        <Text color="warning">
          Delete {tildify(target.path, home)}
          {target.changes > 0 ? `? It has ${target.changes} uncommitted change${target.changes === 1 ? '' : 's'}, which will be lost.` : '?'}
          {target.isLocked ? ' It is locked.' : ''}
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Button key="remove" plain hotkey="y" label={target.changes > 0 || target.isLocked ? 'Force delete worktree' : 'Delete worktree'} onPress={() => remove($, false)} />
          {target.branch !== undefined
            ? <Button key="remove-branch" plain hotkey="b" label={`Delete worktree + branch ${target.branch}`} onPress={() => remove($, true)} />
            : null}
          <Button key="cancel" plain hotkey="n" label="Cancel" onPress={() => update($, confirm, () => null)} />
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box key="title" flexDirection="row">
          <Text bold>Worktrees</Text>
          <Text dimColor>
            {' '}· {worktrees.length}{loading ? ' · reading…' : ''} · ctrl+x tab to focus, ↑↓ to select
          </Text>
        </Box>
        {worktrees.map(row)}
        {message !== null ? <Text key="notice" color="warning">{message}</Text> : null}
        {asking ?? actions}
        {isBlank(beneath) ? null : beneath}
      </Box>
    )
  })
}
