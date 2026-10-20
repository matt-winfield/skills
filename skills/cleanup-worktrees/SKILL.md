---
name: cleanup-worktrees
description: Find a repository's git worktrees that are merged into the default branch, whose upstream branch was deleted, or that have been idle for 30+ days, report which are safe to delete and which are stale, ask the user which to remove, then remove them and their branches. Use when the user asks to clean up, prune, tidy or remove old, merged, stale or unused git worktrees.
model: haiku
---

# cleanup-worktrees

Two scripts do the work; your job is to relay, ask and run. Don't re-check what the scripts already checked.
`<skill>` is the folder holding this SKILL.md. Run both from the repository's main checkout, or any worktree you are not removing.

## 1. Report

```bash
bash <skill>/scripts/find-worktrees.sh            # --days N to change the 30-day idle limit
```

It fetches with `--prune`, then lists every worktree except the main checkout, numbered:

- **SAFE TO DELETE:** nothing uncommitted, and the work is already in the default branch (an ancestor of it, a merged PR whose head is the worktree's HEAD, or a squash/rebase merge whose changes are all there), or the folder is gone.
- **STALE:** worth a look: merged but with uncommitted changes, upstream branch deleted, or idle for 30+ days. Deleting these can lose work.
- **KEEP:** active. Never offer these for deletion.

## 2. Ask

Show the user the SAFE and STALE lists as the script printed them (short paths, branch, reasons). Don't re-explain each line. Then ask which to delete:

- If you have a multiple-choice question tool (Claude Code's `AskUserQuestion`, with `multiSelect`), use it: "All safe ones" first, then up to three more options, such as single stale worktrees or "None". The user can type ids under Other.
- Otherwise ask for the ids, for example "all safe", "1,3,5" or "none".

If nothing is SAFE or STALE, say so and stop.

## 3. Remove

Only what the user picked. Map each picked id to the path printed beside it in the report (a `~` in it stands for the home folder; the script expands it):

```bash
bash <skill>/scripts/remove-worktrees.sh <path> <path> ...
```

- It runs Paseo's `worktree.teardown` if there is one, removes each worktree, and deletes its branch only when no work is lost (otherwise it keeps the branch and says so).
- It refuses a worktree with uncommitted changes. Add `--force` only for the ones the user picked knowing about those changes (STALE entries that list "uncommitted"). Run those in a separate call. A locked worktree is never removed, even with `--force`: tell the user to `git worktree unlock` it first if they really mean it.
- `--keep-branch` keeps the branches, if the user asks.

Report the script's ✓/✗ lines in a short summary. For a ✗, say why, in its words.

## Notes

- The `model: haiku` frontmatter runs this skill on a small model in Claude Code; other agents ignore it. All the checks are in the scripts, so any model can do this.
- `--tsv` prints machine-readable rows (id, category, path, branch, idle days, reasons) for scripting.
- Both scripts work with macOS's bash 3.2 and use `gh` when it is installed and logged in. Without `gh`, merged PRs are still found from their changes.
