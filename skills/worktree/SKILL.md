---
name: worktree
description: Start the task in a fresh git worktree on a new branch, set up like the main checkout (gitignored files from .worktreeinclude, then the Cursor, Paseo or Conductor setup script, else the package install), then do all the work there and finish with a pull request. Use when the user runs /worktree, or asks to work in a worktree, an isolated checkout, or in parallel with another agent without touching the current checkout.
---

# worktree

Do the rest of this task in a new git worktree, so the user's checkout (and any other agent working in it) is never touched. The work leaves the worktree as a pushed branch and a pull request. There is no "apply back" step: once the PR merges, the worktree is deleted (see the `cleanup-merged-worktrees` skill).

`<skill>` below is the folder holding this SKILL.md.

## 1. Create it

Pick a branch name from the task, in the repo's style (look at `git branch -r` for prefixes like `feat/`, `fix/`), then:

```bash
bash <skill>/scripts/create-worktree.sh --branch <branch>
```

The script:

- fetches and branches from `origin/<default branch>` (`--base <ref>` for another base, `--from-current` to start from the current HEAD, to build on the current branch's commits)
- creates the worktree at `~/.worktrees/<repo>/<slug>` (override the root with `WORKTREE_ROOT`)
- copies the gitignored files `.worktreeinclude` names (`.env`, local config), as Claude Code does
- runs the first worktree setup it finds, in the new worktree:
  1. `.cursor/worktrees.json`: `setup-worktree-unix` / `setup-worktree-windows` / `setup-worktree` (commands, or a script path), with `$ROOT_WORKTREE_PATH`
  2. `paseo.json`: `worktree.setup`, with `$PASEO_SOURCE_CHECKOUT_PATH`, `$PASEO_WORKTREE_PATH`, `$PASEO_BRANCH_NAME`
  3. `conductor.json`: `scripts.setup`, with `$CONDUCTOR_ROOT_PATH`, `$CONDUCTOR_WORKSPACE_PATH`
  4. none of those: the install for each lockfile present (pnpm, bun, yarn, npm, uv, poetry, bundler, go)
- prints `WORKTREE_PATH=<path>` as its last line

If setup fails, the worktree still exists: read the error, fix what you can (a missing tool, a step that needs the main checkout's files), and re-run the failing step inside the worktree. Tell the user if it can't be fixed. Use `--no-setup` only if the user asks.

## 2. Move into it

Everything from here on happens in `WORKTREE_PATH`, never in the original checkout.

- **Claude Code:** call the `EnterWorktree` tool with `path: <WORKTREE_PATH>`. The session's working directory moves there.
- **Other agents (Cursor, Codex, ...):** `cd <WORKTREE_PATH>` at the start of every shell command (`cd <WORKTREE_PATH> && ...`), and use absolute paths under it for every file you read or edit.

Before going on, check you're in the right place: `git -C <WORKTREE_PATH> branch --show-current` prints the new branch.

## 3. Do the task

Work as usual, inside the worktree. Commit as you go with clear messages. Don't edit, stage or commit anything in the original checkout.

## 4. Finish with a PR

1. Run the project's checks (lint, typecheck, tests) in the worktree.
2. Push: `git push -u origin <branch>`.
3. Open a PR (`gh pr create`, or the `pr-and-iterate` skill to also watch CI and review comments).
4. Tell the user the PR link and the worktree path. Leave the worktree in place: they may want to look at it or iterate on review comments. Once the PR merges, it can be removed with the `cleanup-merged-worktrees` skill or the `/worktrees` band in Claude Code.

Don't merge the branch into the user's checkout and don't delete the worktree unless the user asks.
