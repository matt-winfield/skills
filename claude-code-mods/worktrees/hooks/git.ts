import type { Worktree } from '../types'

/** One worktree as `git worktree list --porcelain` reports it, before its status is read. */
export type Listed = Omit<Worktree, 'isCurrent' | 'changes'>

/**
 * The worktrees in `git worktree list --porcelain` output, the main one first. Bare entries are
 * left out: they have no files to open.
 */
export function parseWorktrees (porcelain: string): Listed[] {
  const found: Listed[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    let path: string | undefined
    let head = ''
    let branch: string | undefined
    let isBare = false
    let isLocked = false
    let isPrunable = false
    for (const line of block.split('\n')) {
      const space = line.indexOf(' ')
      const key = space < 0 ? line : line.slice(0, space)
      const value = space < 0 ? '' : line.slice(space + 1)
      if (key === 'worktree') path = value
      else if (key === 'HEAD') head = value
      else if (key === 'branch') branch = value.replace(/^refs\/heads\//, '')
      else if (key === 'bare') isBare = true
      else if (key === 'locked') isLocked = true
      else if (key === 'prunable') isPrunable = true
    }
    if (path === undefined || isBare) continue
    found.push({ path, head, branch, isMain: found.length === 0, isLocked, isPrunable })
  }
  return found
}

/** The worktree `cwd` is in: the one whose path is the longest prefix of it. */
export function worktreeOf (paths: readonly string[], cwd: string): string | undefined {
  const inside = paths.filter(path => cwd === path || cwd.startsWith(path.endsWith('/') ? path : `${path}/`))
  return inside.sort((a, b) => b.length - a.length)[0]
}

/** `/home/me/dev/app` as `~/dev/app`. */
export function tildify (path: string, home: string | undefined): string {
  if (home === undefined || home === '') return path
  const root = home.replace(/[\\/]+$/, '')
  if (path === root) return '~'
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path
}

/** What the summary model reads about one branch, or undefined when it has nothing to say. */
export function summaryPrompt (branch: string, commits: string, files: string, status: string): string | undefined {
  const lines = (text: string, max: number) => text.split('\n').map(line => line.trimEnd()).filter(Boolean).slice(0, max)
  const subjects = lines(commits, 30)
  const changed = lines(files, 40)
  const pending = lines(status, 40)
  if (subjects.length === 0 && changed.length === 0 && pending.length === 0) return undefined
  return [
    'Summarise what this git branch changes in 4 to 10 words, as a short phrase (e.g. "Add OAuth login with token refresh").',
    'Reply with the phrase only: no quotes, no trailing full stop, no preamble.',
    '',
    `Branch: ${branch}`,
    subjects.length > 0 ? `Commits (newest first):\n${subjects.join('\n')}` : 'Commits: none yet',
    changed.length > 0 ? `Files changed against the default branch:\n${changed.join('\n')}` : '',
    pending.length > 0 ? `Uncommitted changes (git status):\n${pending.join('\n')}` : ''
  ].filter(Boolean).join('\n')
}

/** The model's reply as one short line: the first line, unquoted, without a trailing full stop. */
export function cleanSummary (reply: string): string {
  const first = reply.trim().split('\n')[0] ?? ''
  const line = first.replace(/^summary:\s*/i, '').replace(/^["'`*]+|["'`*]+$/g, '').replace(/\.$/, '').trim()
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** A short, stable hash of a string (FNV-1a), to tell when a worktree's changes moved. */
export function hash (text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
