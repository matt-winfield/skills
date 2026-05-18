---
name: cleanup-worktrees
description: Delete git worktrees that are safe to remove — clean working tree and all commits already in origin's default branch (either HEAD is an ancestor, or the branch has a merged PR via gh). Use when the user asks to clean up, prune, or remove old/unused/stale git worktrees.
---

# cleanup-worktrees

Single bash script does everything. Two-step flow:

1. **Dry run** — preview what would be deleted:
   ```bash
   bash ~/.claude/skills/cleanup-worktrees/cleanup.sh
   ```
   Relay the output to the user.

2. **Apply** — only after the user confirms:
   ```bash
   bash ~/.claude/skills/cleanup-worktrees/cleanup.sh --apply
   ```

The script fetches `origin/<default-branch>` and classifies each non-current, non-bare worktree as:
- **safe** — clean tree AND (HEAD is ancestor of `origin/<default>` OR branch has a merged PR via `gh`)
- **keep** — locked, uncommitted changes, or unmerged commits

Do not run `--apply` without explicit user confirmation.
