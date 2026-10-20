# Worktrees

A Claude Code mod that lists your repository's git worktrees in a band above the prompt. Run `/worktrees` to show or hide it.

```text
Worktrees · 3 · ctrl+x tab to focus, ↑↓ to select
❯ feat/login [here, 2 changed] · Add OAuth login page and callback
    ~/.worktrees/app/feat-login
  main [main] · No changes yet
    ~/dev/app
  fix/typo · Fix README typo
    ~/.worktrees/app/fix-typo
o: Open here  c: Copy path  d: Delete  r: Refresh  q: Close
```

Each worktree shows its **branch**, its **folder**, and a **4-10 word summary** of what the branch does. Haiku writes the summary from the branch's commit messages since it left the default branch, the files it changed, and any uncommitted changes. Tags show which worktree Claude Code is working in (`here`), the main checkout (`main`), uncommitted changes, locked worktrees, and worktrees whose folder is gone.

## Using it

- **Mouse:** click a worktree to select it, then click an action.
- **Keyboard:** `ctrl+x tab` (or a click) focuses the band. Tab and the arrow keys move between worktrees, and moving onto one selects it. Then press:
  - `o` **Open here:** moves Claude Code's working directory into the worktree (`/cd`).
  - `c` **Copy path:** copies the worktree's folder to the clipboard.
  - `d` **Delete:** asks first. `y` deletes the worktree, `b` also deletes its branch (`git branch -d`, so an unmerged branch is kept), `n` cancels. A worktree with uncommitted changes or a lock is force-deleted only after a warning. The main checkout, and the worktree Claude Code is working in, can't be deleted from here.
  - `r` **Refresh**, `q` **Close**.
- `Esc` goes back to the prompt.

The list refreshes when it opens, after each turn while it is shown, and on `r`.

## Settings

In `/config`:

| Option          | Default | What it does                                                                     |
| --------------- | ------- | -------------------------------------------------------------------------------- |
| `summaryModel`  | `haiku` | The model that writes summaries: an alias or a full model id.                   |
| `showSummaries` | `true`  | Off: no model calls. Each worktree shows its latest commit's subject instead. |

Summaries are cached per worktree and only asked for again when the branch's commits or changes move. A branch with no commits and no changes shows `No changes yet` without a model call.

## Install

From Claude Code:

```text
/plugin marketplace add matt-winfield/skills
/plugin install worktrees@matt-winfield-skills
```

Or from the shell:

```bash
claude plugin marketplace add matt-winfield/skills
claude plugin install worktrees@matt-winfield-skills
```

It works well with the [`worktree`](../../skills/worktree/SKILL.md) skill, which creates worktrees for agents, and [`cleanup-merged-worktrees`](../../skills/cleanup-merged-worktrees/SKILL.md), which clears out the merged ones.

## How it works

The hooks module is [`hooks/register.tsx`](hooks/register.tsx). The parsing and prompt helpers are in [`hooks/git.ts`](hooks/git.ts).

- `/worktrees` is registered with `$.command.register` at `session.start`. It toggles the `isOpen` state, and `/worktrees refresh` reads the list again.
- `git worktree list --porcelain` and `git status --porcelain` run through `$.process.run`. Summaries come from `$.model.complete`, three at a time, and are kept in `$.store` keyed by a hash of what the model read.
- A `ui.render` hook on `AbovePrompt` draws the band. Each worktree is a `Button`, so it can be clicked, and a `ui.focus` hook selects the row the focus ring lands on. Actions are `Button`s with hotkeys.
- **Open here** runs `/cd <path>` with `$.command.run`. On a build without `/cd` it falls back to the `EnterWorktree` tool.
- **Copy path** is `$.ui.copy`. **Delete** is `git worktree remove` (with `--force` after the warning), then `git branch -d`.

## Development

```bash
claude plugin validate ./claude-code-mods/worktrees   # from the repository root
claude plugin test ./claude-code-mods/worktrees       # runs hooks/*.test.ts(x) against the engine
claude --plugin-dir ./claude-code-mods/worktrees      # try it in a session; edits hot-reload
```

MIT © Matthew Winfield. See [LICENSE](LICENSE).
