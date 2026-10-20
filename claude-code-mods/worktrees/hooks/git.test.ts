import { expect, test } from 'claude-code/testing'

import { cleanSummary, parseWorktrees, summaryPrompt, tildify, worktreeOf } from './git'

const PORCELAIN = `worktree /repo
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /repo/.worktrees/a
HEAD 2222222222222222222222222222222222222222
detached

worktree /gone
HEAD 3333333333333333333333333333333333333333
branch refs/heads/feat/gone
locked reason here
prunable gitdir file points to non-existent location
`

test('reads the porcelain list, main first, detached, locked and prunable', async () => {
  const found = parseWorktrees(PORCELAIN)
  expect(found.map(wt => wt.path)).toEqual(['/repo', '/repo/.worktrees/a', '/gone'])
  expect(found[0]).toMatchObject({ isMain: true, branch: 'main' })
  expect(found[1]).toMatchObject({ isMain: false, branch: undefined })
  expect(found[2]).toMatchObject({ branch: 'feat/gone', isLocked: true, isPrunable: true })
})

test('leaves out a bare main repository', async () => {
  const found = parseWorktrees('worktree /repo.git\nbare\n\nworktree /w\nHEAD abc\nbranch refs/heads/x\n')
  expect(found.map(wt => wt.path)).toEqual(['/w'])
})

test('finds the worktree a directory is in, the deepest first', async () => {
  expect(worktreeOf(['/repo', '/repo/.worktrees/a'], '/repo/.worktrees/a/src')).toBe('/repo/.worktrees/a')
  expect(worktreeOf(['/repo', '/repo/.worktrees/a'], '/repo/src')).toBe('/repo')
  expect(worktreeOf(['/repo'], '/repository')).toBeUndefined()
})

test('shortens the home folder to ~', async () => {
  expect(tildify('/home/me/dev/app', '/home/me')).toBe('~/dev/app')
  expect(tildify('/home/meg/app', '/home/me')).toBe('/home/meg/app')
})

test('has nothing to ask the model about a branch without changes', async () => {
  expect(summaryPrompt('main', '', '', '')).toBeUndefined()
  expect(summaryPrompt('x', 'Add y\n', '', '')).toContain('Add y')
})

test('trims the model reply to one bare line', async () => {
  expect(cleanSummary('"Add OAuth login."\nMore text')).toBe('Add OAuth login')
  expect(cleanSummary('Summary: Fix flaky tests')).toBe('Fix flaky tests')
})
