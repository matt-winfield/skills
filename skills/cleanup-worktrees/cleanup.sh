#!/usr/bin/env bash
# Delete git worktrees with clean state whose work is in origin/<default-branch>.
# Default: dry-run. Pass --apply (or -y) to actually delete.
set -euo pipefail

git rev-parse --git-dir >/dev/null 2>&1 || { echo "Not in a git repo." >&2; exit 1; }

default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
[[ -z "${default:-}" ]] && default=main

if ! git fetch origin "$default" --quiet 2>/dev/null; then
  echo "Warning: could not fetch origin/$default; using local ref if present." >&2
fi

ref="origin/$default"
git rev-parse --verify --quiet "$ref" >/dev/null || ref="$default"
git rev-parse --verify --quiet "$ref" >/dev/null || { echo "No ref for $default found." >&2; exit 1; }

current=$(git rev-parse --show-toplevel)
have_gh=0
command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && have_gh=1

declare -a safe_paths safe_reasons safe_branches keep_paths keep_reasons

wt_path=""; wt_head=""; wt_branch=""; wt_bare=0; wt_locked=0; wt_detached=0

process() {
  local path="$1" head="$2" branch="$3" locked="$4" detached="$5"
  if [[ "$path" == "$current" ]]; then
    keep_paths+=("$path"); keep_reasons+=("current worktree"); return
  fi
  if (( locked )); then
    keep_paths+=("$path"); keep_reasons+=("locked"); return
  fi
  local status
  status=$(git -C "$path" status --porcelain 2>/dev/null || echo "?")
  if [[ -n "$status" ]]; then
    keep_paths+=("$path"); keep_reasons+=("uncommitted changes"); return
  fi
  if git -C "$path" merge-base --is-ancestor "$head" "$ref" 2>/dev/null; then
    safe_paths+=("$path"); safe_reasons+=("ancestor of $ref"); safe_branches+=("${branch}"); return
  fi
  if (( detached == 0 )) && [[ -n "$branch" ]] && (( have_gh == 1 )); then
    local pr
    pr=$(gh pr list --state merged --head "$branch" --json number --jq '.[0].number' 2>/dev/null || echo "")
    if [[ -n "$pr" ]]; then
      safe_paths+=("$path"); safe_reasons+=("PR #$pr merged"); safe_branches+=("${branch}"); return
    fi
  fi
  keep_paths+=("$path"); keep_reasons+=("unmerged commits")
}

flush() {
  if [[ -n "$wt_path" ]] && (( wt_bare == 0 )); then
    process "$wt_path" "$wt_head" "$wt_branch" "$wt_locked" "$wt_detached"
  fi
  wt_path=""; wt_head=""; wt_branch=""; wt_bare=0; wt_locked=0; wt_detached=0
}

while IFS= read -r line; do
  if [[ -z "$line" ]]; then flush; continue; fi
  key="${line%% *}"
  val=""
  [[ "$line" == *" "* ]] && val="${line#* }"
  case "$key" in
    worktree) wt_path="$val" ;;
    HEAD)     wt_head="$val" ;;
    branch)   wt_branch="${val#refs/heads/}" ;;
    bare)     wt_bare=1 ;;
    locked)   wt_locked=1 ;;
    detached) wt_detached=1 ;;
  esac
done < <(git worktree list --porcelain; printf '\n')
flush

echo
echo "Safe to delete:"
if (( ${#safe_paths[@]} == 0 )); then
  echo "  (none)"
else
  for i in "${!safe_paths[@]}"; do
    printf "  %s  [%s]\n" "${safe_paths[$i]}" "${safe_reasons[$i]}"
  done
fi

echo
echo "Keeping:"
if (( ${#keep_paths[@]} == 0 )); then
  echo "  (none)"
else
  for i in "${!keep_paths[@]}"; do
    printf "  %s  [%s]\n" "${keep_paths[$i]}" "${keep_reasons[$i]}"
  done
fi

(( ${#safe_paths[@]} == 0 )) && exit 0

mode="${1:-}"
if [[ "$mode" != "--apply" && "$mode" != "-y" ]]; then
  echo
  echo "Dry run. Re-run with --apply to delete."
  exit 0
fi

echo
for path in "${safe_paths[@]}"; do
  echo "Removing $path"
  git worktree remove "$path"
done
echo "Done."
