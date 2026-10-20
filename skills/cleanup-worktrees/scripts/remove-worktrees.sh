#!/usr/bin/env bash
# Remove git worktrees, and their branches where that loses no work.
#
# Usage: remove-worktrees.sh [--force] [--keep-branch] <path>...
#   --force        also remove worktrees with uncommitted changes (that work
#                  is lost); a locked worktree is never removed: unlock it first
#   --keep-branch  leave each worktree's branch in place
#
# For each path: runs Paseo's worktree.teardown (paseo.json) if there is one,
# removes the worktree (or prunes it if its folder is gone), then deletes the
# branch: `git branch -d`, or -D only when the branch's changes are already in
# the default branch (squash or rebase merged) or its merged PR's head is the
# branch tip. A branch with work found nowhere else is kept, and said so.
# Works with bash 3.2 (macOS).
set -euo pipefail

force=0 keep_branch=0 targets=()
while (( $# )); do
  case "$1" in
    --force) force=1; shift ;;
    --keep-branch) keep_branch=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown argument: $1" >&2; exit 2 ;;
    *) targets+=("$1"); shift ;;
  esac
done
(( ${#targets[@]} )) || { echo "Name at least one worktree path." >&2; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Not in a git repository." >&2; exit 1; }

# Run everything from the main checkout, which is never removed.
main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
here=$(git rev-parse --show-toplevel 2>/dev/null || true)
default=$(git -C "$main" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
[[ -n "$default" ]] || default=main
ref="origin/$default"
git -C "$main" rev-parse --verify --quiet "$ref^{commit}" >/dev/null || ref="$default"
have_gh=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then have_gh=1; fi

# The branch checked out at a worktree path, from the porcelain list.
branch_of() {
  git -C "$main" worktree list --porcelain | awk -v p="$1" '
    $1 == "worktree" { cur = substr($0, 10) }
    $1 == "branch" && cur == p { sub("refs/heads/", "", $2); print $2; exit }'
}
is_worktree() { git -C "$main" worktree list --porcelain | grep -Fxq "worktree $1"; }

# Paseo teardown commands, one per line, read with whichever of jq, node or python3 is here.
teardown_of() {
  local file="$1/paseo.json"
  [[ -f "$file" ]] || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r '.worktree.teardown // empty | if type == "array" then .[] else . end' "$file"
  elif command -v node >/dev/null 2>&1; then
    node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).worktree?.teardown; for (const x of [].concat(v ?? [])) console.log(x)' "$file"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json, sys
v = (json.load(open(sys.argv[1])).get("worktree") or {}).get("teardown")
for x in (v if isinstance(v, list) else [v] if v else []): print(x)' "$file"
  fi
}

# Whether deleting the branch loses nothing: its changes are in the default
# branch, or a merged PR's head is its tip.
is_merged_elsewhere() {
  local branch="$1" tip tree
  tip=$(git -C "$main" rev-parse "refs/heads/$branch")
  tree=$(git -C "$main" merge-tree --write-tree "$ref" "$tip" 2>/dev/null | head -1 || true)
  [[ -n "$tree" && "$tree" == "$(git -C "$main" rev-parse "$ref^{tree}")" ]] && return 0
  if (( have_gh )); then
    [[ -n "$(cd "$main" && gh pr list --state merged --head "$branch" --json headRefOid \
      --jq ".[] | select(.headRefOid == \"$tip\") | .headRefOid" 2>/dev/null | head -1)" ]] && return 0
  fi
  return 1
}

failed=0
for target in "${targets[@]}"; do
  path="${target%/}"
  [[ -d "$path" ]] && path=$(cd "$path" && pwd -P)
  # Match the spelling git lists, in case of symlinks in the path.
  if ! is_worktree "$path" && is_worktree "${target%/}"; then path="${target%/}"; fi
  if ! is_worktree "$path"; then echo "✗ $target: not a worktree of this repository"; failed=1; continue; fi
  if [[ "$path" == "$main" ]]; then echo "✗ $path: the main checkout is not removed"; failed=1; continue; fi
  if [[ "$path" == "$here" ]]; then echo "✗ $path: this shell is in it; run from another worktree"; failed=1; continue; fi
  branch=$(branch_of "$path")
  args=(worktree remove)
  # One --force discards changes; git needs a second to override a lock, which is never given.
  (( force )) && args+=(--force)

  if [[ -d "$path" ]]; then
    steps=$(teardown_of "$path")
    if [[ -n "$steps" ]]; then
      echo "  running Paseo teardown in $path"
      while IFS= read -r line; do
        [[ -n "${line// }" ]] || continue
        (cd "$path" && PASEO_SOURCE_CHECKOUT_PATH="$main" PASEO_ROOT_PATH="$main" PASEO_WORKTREE_PATH="$path" \
          PASEO_BRANCH_NAME="$branch" bash -c "$line") || echo "  teardown step failed (going on): $line"
      done <<< "$steps"
    fi
  fi
  # A missing folder is removed by its path too: a prune would drop every missing worktree.
  if ! out=$(git -C "$main" "${args[@]}" "$path" 2>&1); then
    echo "✗ $path: $(printf '%s' "${out#fatal: }" | tr '\n' ' ' | sed 's/ *$//')"
    failed=1
    continue
  fi
  line="✓ removed $path"

  if [[ -n "$branch" ]] && (( ! keep_branch )); then
    if git -C "$main" branch -d "$branch" >/dev/null 2>&1; then
      line+=", deleted branch $branch"
    elif is_merged_elsewhere "$branch" && git -C "$main" branch -D "$branch" >/dev/null 2>&1; then
      line+=", deleted branch $branch (merged by squash/rebase or PR)"
    else
      line+=", kept branch $branch (has commits not in $ref; delete with: git branch -D $branch)"
    fi
  fi
  echo "$line"
done
exit "$failed"
