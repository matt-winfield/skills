#!/usr/bin/env bash
# Sort a repository's git worktrees into safe to delete, stale, and keep.
#
# Usage: find-worktrees.sh [--days N] [--no-fetch] [--tsv]
#   --days N    a worktree with no commit or file change in N days is stale (default 30)
#   --no-fetch  don't run `git fetch --prune` first (upstream-deleted checks may be out of date)
#   --tsv       print one tab-separated row per worktree instead of the report:
#               id, category, path, branch, idle days, reasons
#
# safe   clean, and its work is in the default branch: an ancestor of it, a merged
#        PR whose head is the worktree's HEAD (gh), or changes that are already
#        there (squash or rebase merge), or its folder is gone
# stale  worth a look: merged but with local changes, upstream branch deleted,
#        or idle for --days
# keep   active work
# The main checkout and the worktree this runs in are never listed for deletion.
# Works with bash 3.2 (macOS). Read-only: deletes nothing.
set -euo pipefail

days=30 fetch=1 tsv=0
while (( $# )); do
  case "$1" in
    --days) days="${2:?--days needs a number}"; shift 2 ;;
    --no-fetch) fetch=0; shift ;;
    --tsv) tsv=1; shift ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$days" =~ ^[0-9]+$ ]] || { echo "--days takes a whole number" >&2; exit 2; }

git rev-parse --git-dir >/dev/null 2>&1 || { echo "Not in a git repository." >&2; exit 1; }
here=$(git rev-parse --show-toplevel 2>/dev/null || true)

fetched="not fetched"
if (( fetch )); then
  if git fetch --prune origin --quiet 2>/dev/null; then
    fetched="fetched"
    # The remote's default branch may have changed (a rename): record it again while online.
    git remote set-head origin --auto >/dev/null 2>&1 || true
  else
    fetched="fetch failed, using local refs"
  fi
fi
default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
# Without origin/HEAD, main or master when exactly one of them exists; both is ambiguous.
if [[ -z "$default" ]]; then
  found=""
  for name in main master; do
    if git rev-parse --verify --quiet "origin/$name^{commit}" >/dev/null || git rev-parse --verify --quiet "$name^{commit}" >/dev/null; then found+="$name "; fi
  done
  [[ "$found" == "main " || "$found" == "master " ]] && default="${found% }"
fi
[[ -n "$default" ]] || { echo "Can't tell the default branch: set it with git remote set-head origin --auto." >&2; exit 1; }
ref="origin/$default"
git rev-parse --verify --quiet "$ref^{commit}" >/dev/null || ref="$default"
git rev-parse --verify --quiet "$ref^{commit}" >/dev/null || { echo "No ref for the default branch ($default) found." >&2; exit 1; }
ref_tree=$(git rev-parse "$ref^{tree}")

have_gh=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then have_gh=1; fi
# merge-tree --write-tree (git 2.38+) tells a squash-merged branch apart.
have_merge_tree=0
if git merge-tree --write-tree "$ref" "$ref" >/dev/null 2>&1; then have_merge_tree=1; fi

now=$(date +%s)
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
home="${HOME:-}"
short() { if [[ -n "$home" && "$1" == "$home"/* ]]; then printf '~%s' "${1#"$home"}"; else printf '%s' "$1"; fi; }

ids=() cats=() paths=() branches=() idles=() reasons=() skipped=()

classify() {
  local path="$1" head="$2" branch="$3" locked="$4" prunable="$5" is_main="$6"
  if (( is_main )); then skipped+=("$(short "$path")  [main checkout]"); return; fi
  if [[ "$path" == "$here" ]]; then skipped+=("$(short "$path")  [this worktree: run from another one to include it]"); return; fi
  local label="${branch:-detached ${head:0:7}}"
  # A locked worktree may live on a drive that is not mounted now: its folder is missing but it is in use.
  if (( locked )) && [[ ! -d "$path" ]]; then
    add keep "$path" "$label" "-" "locked, folder not mounted"; return
  fi
  if (( prunable )) || [[ ! -d "$path" ]]; then
    add safe "$path" "$label" "-" "folder is missing"; return
  fi

  local dirty unpushed last idle notes="" merged=""
  dirty=$(git -C "$path" --no-optional-locks status --porcelain 2>/dev/null | grep -c . || true)
  unpushed=$(git -C "$path" rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)
  # Last activity: the newest of HEAD's commit, the index, and any changed file.
  last=$(git -C "$path" log -1 --format=%ct HEAD 2>/dev/null || echo 0)
  local index t file
  index=$(git -C "$path" rev-parse --path-format=absolute --git-path index 2>/dev/null || true)
  [[ -n "$index" && -e "$index" ]] && { t=$(mtime "$index"); (( t > last )) && last=$t; }
  if (( dirty > 0 )); then
    while IFS= read -r file; do
      [[ -e "$path/$file" ]] || continue
      t=$(mtime "$path/$file"); (( t > last )) && last=$t
    done < <(git -C "$path" --no-optional-locks status --porcelain 2>/dev/null | cut -c4- | sed 's/.* -> //' | head -200)
  fi
  idle=$(( (now - last) / 86400 ))

  # A branch that never moved from where it was created has no work of its own yet.
  local own=1
  if [[ -n "$branch" ]]; then
    local moves
    moves=$(git -C "$path" reflog show --format=%H "refs/heads/$branch" -- 2>/dev/null | grep -c . || true)
    (( moves == 1 )) && own=0
  fi

  if git -C "$path" merge-base --is-ancestor HEAD "$ref" 2>/dev/null; then
    if (( own )); then merged="merged into $ref"; else notes="no commits yet"; fi
  fi
  if [[ -z "$merged" && -n "$branch" ]] && (( have_gh )); then
    local pr
    pr=$(cd "$path" && gh pr list --state merged --head "$branch" --json number,headRefOid \
      --jq ".[] | select(.headRefOid == \"$head\") | .number" 2>/dev/null | head -1 || true)
    [[ -n "$pr" ]] && merged="PR #$pr merged"
  fi
  if [[ -z "$merged" && -z "$notes" ]] && (( have_merge_tree )); then
    local tree
    tree=$(git -C "$path" merge-tree --write-tree "$ref" HEAD 2>/dev/null | head -1 || true)
    [[ "$tree" == "$ref_tree" ]] && merged="changes already in $ref"
  fi

  local upstream=""
  [[ -n "$branch" ]] && upstream=$(git -C "$path" for-each-ref --format='%(upstream:track)' "refs/heads/$branch" 2>/dev/null || true)

  local why=()
  [[ -n "$merged" ]] && why+=("$merged")
  [[ -n "$notes" ]] && why+=("$notes")
  [[ "$upstream" == "[gone]" ]] && why+=("upstream branch deleted")
  (( dirty > 0 )) && why+=("$dirty uncommitted")
  (( unpushed > 0 )) && [[ -z "$merged" ]] && why+=("$unpushed unpushed commit$( (( unpushed == 1 )) || echo s)")
  (( locked )) && why+=("locked")
  (( idle >= days )) && why+=("idle ${idle}d")
  local text
  text=$(IFS=';'; printf '%s' "${why[*]-}" | sed 's/;/, /g')

  if (( locked )); then add keep "$path" "$label" "$idle" "$text"
  elif [[ -n "$merged" ]] && (( dirty == 0 )); then add safe "$path" "$label" "$idle" "$text"
  elif [[ -n "$merged" || "$upstream" == "[gone]" ]] || (( idle >= days )); then add stale "$path" "$label" "$idle" "$text"
  else add keep "$path" "$label" "$idle" "${text:-active}"
  fi
}

add() { cats+=("$1"); paths+=("$2"); branches+=("$3"); idles+=("$4"); reasons+=("$5"); }

wt_path="" wt_head="" wt_branch="" wt_bare=0 wt_locked=0 wt_prunable=0 count=0
flush() {
  if [[ -n "$wt_path" ]]; then
    if (( ! wt_bare )); then classify "$wt_path" "$wt_head" "$wt_branch" "$wt_locked" "$wt_prunable" "$(( count == 0 ))"; fi
    count=$((count + 1))
  fi
  wt_path="" wt_head="" wt_branch="" wt_bare=0 wt_locked=0 wt_prunable=0
}
while IFS= read -r line; do
  if [[ -z "$line" ]]; then flush; continue; fi
  key="${line%% *}"; val=""
  [[ "$line" == *" "* ]] && val="${line#* }"
  case "$key" in
    worktree) wt_path="$val" ;;
    HEAD) wt_head="$val" ;;
    branch) wt_branch="${val#refs/heads/}" ;;
    bare) wt_bare=1 ;;
    locked) wt_locked=1 ;;
    prunable) wt_prunable=1 ;;
  esac
done < <(git worktree list --porcelain; printf '\n')
flush

# Ids number safe, then stale: the ones a person picks from.
n=0
for cat in safe stale keep; do
  for i in ${cats[@]+"${!cats[@]}"}; do
    [[ "${cats[$i]}" == "$cat" ]] || continue
    if [[ "$cat" == keep ]]; then ids[$i]="-"; else n=$((n + 1)); ids[$i]=$n; fi
  done
done

if (( tsv )); then
  for cat in safe stale keep; do
    for i in ${cats[@]+"${!cats[@]}"}; do
      [[ "${cats[$i]}" == "$cat" ]] || continue
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${ids[$i]}" "$cat" "${paths[$i]}" "${branches[$i]}" "${idles[$i]}" "${reasons[$i]}"
    done
  done
  exit 0
fi

echo "Default branch: $ref ($fetched). Stale after ${days} days idle.$( (( have_gh )) || echo ' gh not available: merged PRs are only found by their changes.')"
section() {
  local cat="$1" title="$2" i shown=0
  echo
  echo "$title"
  for i in ${cats[@]+"${!cats[@]}"}; do
    [[ "${cats[$i]}" == "$cat" ]] || continue
    shown=1
    printf '  %-3s %-28s %s\n' "${ids[$i]}" "${branches[$i]}" "$(short "${paths[$i]}")"
    printf '      %s\n' "${reasons[$i]:-}"
  done
  (( shown )) || echo "  (none)"
}
section safe "SAFE TO DELETE (work is in $ref, nothing uncommitted)"
section stale "STALE (look before deleting: local work may be lost)"
section keep "KEEP (active)"
if (( ${#skipped[@]} )); then
  echo
  echo "NOT LISTED"
  for s in "${skipped[@]}"; do echo "  $s"; done
fi
