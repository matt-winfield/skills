#!/usr/bin/env bash
# Create a git worktree for an agent to work in, then get it ready to run:
# copy the gitignored files .worktreeinclude names (.env and the like) and run
# the project's worktree setup (Cursor, Paseo or Conductor config, else the
# package manager's install).
#
# Usage: create-worktree.sh [--branch <name>] [--name <slug>] [--base <ref>]
#                           [--from-current] [--no-setup]
#   --branch        branch to create (default: the slug)
#   --name          folder name (default: from --branch, else a random one)
#   --base          ref to branch from (default: origin's default branch)
#   --from-current  branch from the current HEAD instead of the default branch
#   --no-setup      skip copying files and running setup
#
# Worktrees go in ${WORKTREE_ROOT:-~/.worktrees}/<repo>/<slug>.
# The last line printed is WORKTREE_PATH=<absolute path>.
# Works with bash 3.2 (macOS).
set -euo pipefail

branch="" name="" base="" from_current=0 setup=1
while (( $# )); do
  case "$1" in
    --branch) branch="${2:?--branch needs a value}"; shift 2 ;;
    --name) name="${2:?--name needs a value}"; shift 2 ;;
    --base) base="${2:?--base needs a value}"; shift 2 ;;
    --from-current) from_current=1; shift ;;
    --no-setup) setup=0; shift ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "Not in a git repository." >&2; exit 1; }

# The main checkout: the folder holding the shared .git directory.
common=$(cd "$(git rev-parse --git-common-dir)" && pwd)
root=$(dirname "$common")
[[ "$(basename "$common")" == ".git" ]] || root=$(git rev-parse --show-toplevel)
repo=$(basename "$root")

slugify() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//' | cut -c1-50; }

if [[ -z "$name" && -n "$branch" ]]; then name=$(slugify "$branch"); fi
if [[ -z "$name" ]]; then
  adjectives=(brisk calm eager fuzzy gentle happy jolly keen lucky mellow nimble quiet rapid sunny tidy witty)
  animals=(badger crane dingo eagle ferret gecko heron ibis koala lemur marten newt otter panda quail robin)
  name="${adjectives[RANDOM % ${#adjectives[@]}]}-${animals[RANDOM % ${#animals[@]}]}"
fi
name=$(slugify "$name")
[[ -n "$name" ]] || { echo "The name is empty once made safe for a folder." >&2; exit 2; }
[[ -n "$branch" ]] || branch="$name"
git check-ref-format --branch "$branch" >/dev/null 2>&1 || { echo "Not a valid branch name: $branch" >&2; exit 2; }
if git show-ref --verify --quiet "refs/heads/$branch"; then
  echo "Branch $branch already exists. Pick another --branch, or add a worktree for it with: git worktree add <path> $branch" >&2
  exit 1
fi

wt_root="${WORKTREE_ROOT:-$HOME/.worktrees}"
path="$wt_root/$repo/$name"
[[ ! -e "$path" ]] || { echo "$path already exists. Pick another --name." >&2; exit 1; }

default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
[[ -n "$default" ]] || default=main
if [[ -z "$base" ]]; then
  if (( from_current )); then
    base=HEAD
  else
    git fetch origin "$default" --quiet 2>/dev/null || echo "Warning: could not fetch origin/$default; using what is local." >&2
    for ref in "origin/$default" "$default" HEAD; do
      if git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then base=$ref; break; fi
    done
  fi
fi

mkdir -p "$wt_root/$repo"
echo "Creating $path on new branch $branch from $base"
git worktree add --quiet --no-track -b "$branch" "$path" "$base"

if (( ! setup )); then
  echo "Skipped setup (--no-setup)."
  echo "WORKTREE_PATH=$path"
  exit 0
fi

# Gitignored files the project wants in every worktree: those matched by
# .worktreeinclude (gitignore syntax, as Claude Code reads it) and ignored by git.
if [[ -f "$root/.worktreeinclude" ]]; then
  copied=0
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    file="${file%/}"
    git -C "$root" check-ignore -q "$file" 2>/dev/null || continue
    mkdir -p "$path/$(dirname "$file")"
    cp -R "$root/$file" "$path/$(dirname "$file")/"
    copied=$((copied + 1))
  done < <(git -C "$root" ls-files --others --ignored --directory --exclude-from=.worktreeinclude 2>/dev/null)
  echo "Copied $copied path(s) named by .worktreeinclude."
fi

# Reads a value out of a JSON file with whichever of jq, node or python3 is here.
# $2 is a path of keys joined by dots. Arrays come out one item per line,
# strings as they are, anything else empty.
json_get() {
  local file="$1" keys="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$keys" 'getpath($k | split(".")) // empty | if type == "array" then .[] else . end | if type == "string" then . else empty end' "$file"
  elif command -v node >/dev/null 2>&1; then
    node -e 'let v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); for (const k of process.argv[2].split(".")) v = v == null ? undefined : v[k]; for (const x of [].concat(v ?? [])) if (typeof x === "string") console.log(x)' "$file" "$keys"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json, sys
v = json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."):
    v = v.get(k) if isinstance(v, dict) else None
for x in (v if isinstance(v, list) else [v]):
    if isinstance(x, str): print(x)' "$file" "$keys"
  else
    echo "Warning: no jq, node or python3 to read $file." >&2
  fi
}

# Runs setup commands, one per line, in the worktree, stopping at the first failure.
run_lines() {
  local label="$1" lines="$2" line
  echo "Running $label setup:"
  while IFS= read -r line; do
    [[ -n "${line// }" ]] || continue
    echo "  \$ $line"
    (cd "$path" && bash -c "$line") || { echo "Setup step failed: $line" >&2; return 1; }
  done <<< "$lines"
}

export ROOT_WORKTREE_PATH="$root"                                     # Cursor
export PASEO_SOURCE_CHECKOUT_PATH="$root" PASEO_ROOT_PATH="$root"     # Paseo
export PASEO_WORKTREE_PATH="$path" PASEO_BRANCH_NAME="$branch"
export CONDUCTOR_ROOT_PATH="$root" CONDUCTOR_WORKSPACE_PATH="$path"   # Conductor
export CONDUCTOR_WORKSPACE_NAME="$name" CONDUCTOR_DEFAULT_BRANCH="$default"

ran=""
status=0
# Cursor: .cursor/worktrees.json, looked for in the new worktree first, then the main checkout.
for dir in "$path/.cursor" "$root/.cursor"; do
  config="$dir/worktrees.json"
  [[ -f "$config" ]] || continue
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) os_key=setup-worktree-windows ;; *) os_key=setup-worktree-unix ;; esac
  steps=$(json_get "$config" "$os_key")
  [[ -n "$steps" ]] || steps=$(json_get "$config" setup-worktree)
  [[ -n "$steps" ]] || break
  # A single value naming a file is a script, relative to worktrees.json.
  if [[ "$steps" != *$'\n'* && -f "$dir/$steps" ]]; then
    echo "Running Cursor setup script: $steps"
    (cd "$path" && bash "$dir/$steps") || status=$?
  else
    run_lines "Cursor (.cursor/worktrees.json)" "$steps" || status=$?
  fi
  ran="Cursor"
  break
done

# Paseo: paseo.json worktree.setup (a multi-line string or an array of commands).
if [[ -z "$ran" && -f "$path/paseo.json" ]]; then
  steps=$(json_get "$path/paseo.json" worktree.setup)
  if [[ -n "$steps" ]]; then run_lines "Paseo (paseo.json)" "$steps" || status=$?; ran="Paseo"; fi
fi

# Conductor: conductor.json scripts.setup.
if [[ -z "$ran" && -f "$path/conductor.json" ]]; then
  steps=$(json_get "$path/conductor.json" scripts.setup)
  if [[ -n "$steps" ]]; then run_lines "Conductor (conductor.json)" "$steps" || status=$?; ran="Conductor"; fi
fi

# No worktree setup configured: install dependencies from whichever lockfile is there.
if [[ -z "$ran" ]]; then
  install() {
    if ! command -v "$1" >/dev/null 2>&1; then echo "Skipped $2 install: $1 is not installed." >&2; return 0; fi
    run_lines "$2" "$3"
  }
  has() { [[ -f "$path/$1" ]]; }
  if has pnpm-lock.yaml; then install pnpm pnpm "pnpm install --frozen-lockfile" || status=$?; ran=pnpm
  elif has bun.lock || has bun.lockb; then install bun bun "bun install --frozen-lockfile" || status=$?; ran=bun
  elif has yarn.lock; then install yarn yarn "yarn install" || status=$?; ran=yarn
  elif has package-lock.json; then install npm npm "npm ci" || status=$?; ran=npm
  elif has package.json; then install npm npm "npm install" || status=$?; ran=npm
  fi
  if has uv.lock; then install uv uv "uv sync" || status=$?; ran="${ran:+$ran, }uv"
  elif has poetry.lock; then install poetry poetry "poetry install" || status=$?; ran="${ran:+$ran, }poetry"
  fi
  if has Gemfile.lock; then install bundle bundler "bundle install" || status=$?; ran="${ran:+$ran, }bundler"; fi
  if has go.mod; then install go go "go mod download" || status=$?; ran="${ran:+$ran, }go"; fi
  [[ -n "$ran" ]] || echo "No worktree setup config or lockfile found: nothing to install."
fi

if (( status != 0 )); then
  echo "Setup failed (exit $status). The worktree is created; fix the setup and re-run it there." >&2
fi
echo
echo "Branch:   $branch (from $base)"
echo "Setup:    ${ran:-none}"
echo "WORKTREE_PATH=$path"
exit "$status"
