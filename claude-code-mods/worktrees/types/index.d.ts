/** One worktree of the repository, as `git worktree list --porcelain` reports it. */
export type Worktree = {
  path: string
  head: string
  /** The branch checked out, without `refs/heads/`; absent when HEAD is detached. */
  branch?: string
  isMain: boolean
  /** The session's directory is inside it. */
  isCurrent: boolean
  isLocked: boolean
  /** Its folder is gone: `git worktree prune` would drop it. */
  isPrunable: boolean
  /** How many files `git status` lists as changed or untracked. */
  changes: number
}

/** A delete waiting on the person's word. */
export type Confirm = { path: string; isForce: boolean }

declare module 'claude-code' {
  interface PluginState {
    worktrees: {
      isOpen: boolean
      isLoading: boolean
      list: Worktree[]
      summaries: Record<string, string>
      selected: string | null
      confirm: Confirm | null
      notice: string | null
    }
  }
}
