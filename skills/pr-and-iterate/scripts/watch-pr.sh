#!/usr/bin/env bash
# watch-pr.sh <owner/repo> <pr-number>
#
# One persistent Monitor source for a PR: emits a single stdout line per NEW
# event — each CI check as it reaches a terminal state, a completion summary,
# and every new comment from all three places GitHub scatters them. Run via the
# Monitor tool with persistent:true. Stop with TaskStop.
#
# Why this is more than a one-liner — the gotchas this script handles:
#   1. Comments live in THREE endpoints, not one:
#        - issues/<pr>/comments  → top-level conversation comments
#        - pulls/<pr>/comments    → inline (in-diff) review comments
#        - pulls/<pr>/reviews     → review BODIES — where CodeRabbit puts its
#          "Outside diff range" / "Duplicate comments" / "Actionable comments
#          posted: N" findings. These appear in NO other endpoint; polling only
#          comments silently drops them. This is the #1 cause of "you missed a
#          comment".
#   2. Bots (CodeRabbit) EDIT one summary comment on every push, so naive
#      `?since=` polling re-fires it endlessly. Dedup by id+updated_at and only
#      surface bot summaries/reviews that actually carry findings.
#   3. Prime on the first pass so a restart doesn't replay the whole history.
#   4. Coverage: emit failed/cancelled checks too, not just passes — silence
#      must never look like success.
#   5. macOS ships bash 3.2 (no associative arrays / `declare -A`). Track the
#      "seen" set as a delimited string so it can't break on a check name with
#      spaces ("Build and Validate").

set -u
REPO="${1:?usage: watch-pr.sh <owner/repo> <pr-number>}"
PR="${2:?usage: watch-pr.sh <owner/repo> <pr-number>}"

# Bot summary comments/reviews are only worth surfacing when they carry findings.
FINDING_RE="Outside diff|Duplicate comments|Actionable comments posted: [1-9]"

seen_ci="|"
seen_comments="|"
ci_done=0
primed=0

# Fetch a GitHub API array, defaulting to [] so a transient failure can't kill
# the monitor or feed null into jq.
api() {
  local out
  out=$(gh api "$1" 2>/dev/null)
  [ -z "$out" ] && out='[]'
  printf '%s' "$out"
}

emit_comments() {
  # Top-level conversation comments: humans always; bots only when they carry
  # findings. Keyed by id+updated_at so an edit that adds findings re-fires.
  while IFS=$'\t' read -r key user body; do
    [ -z "$key" ] && continue
    case "$seen_comments" in
      *"|${key}|"*) ;;
      *)
        seen_comments="${seen_comments}${key}|"
        [ "$primed" = "1" ] && echo "COMMENT ${user}: ${body}"
        ;;
    esac
  done < <(api "repos/$REPO/issues/$PR/comments" | jq -r --arg finding "$FINDING_RE" '
    .[]
    | select((.user.login | test("\\[bot\\]$") | not) or (.body | test($finding)))
    | [((.id|tostring) + ":" + .updated_at), .user.login, (.body[0:400] | gsub("[\r\n]+"; " "))]
    | @tsv')

  # Inline (in-diff) review comments — always actionable; dedup by id.
  while IFS=$'\t' read -r id user path line body; do
    [ -z "$id" ] && continue
    case "$seen_comments" in
      *"|i${id}|"*) ;;
      *)
        seen_comments="${seen_comments}i${id}|"
        [ "$primed" = "1" ] && echo "REVIEW ${user} [${path}:${line}]: ${body}"
        ;;
    esac
  done < <(api "repos/$REPO/pulls/$PR/comments" | jq -r '
    .[]
    | [(.id|tostring), .user.login, .path, ((.line // .original_line)|tostring), (.body[0:400] | gsub("[\r\n]+"; " "))]
    | @tsv')

  # Review BODIES — the easy-to-miss source. Surface only those with findings.
  while IFS=$'\t' read -r id user body; do
    [ -z "$id" ] && continue
    case "$seen_comments" in
      *"|v${id}|"*) ;;
      *)
        seen_comments="${seen_comments}v${id}|"
        [ "$primed" = "1" ] && echo "REVIEW-SUMMARY ${user}: ${body}"
        ;;
    esac
  done < <(api "repos/$REPO/pulls/$PR/reviews" | jq -r --arg finding "$FINDING_RE" '
    .[]
    | select(.body | test($finding))
    | [(.id|tostring), .user.login, (.body[0:600] | gsub("[\r\n]+"; " "))]
    | @tsv')
}

while true; do
  checks=$(gh pr checks "$PR" --repo "$REPO" --json name,state,bucket 2>/dev/null)
  [ -z "$checks" ] && checks='[]'

  # Each check once, when it leaves "pending" — pass, fail, cancel, or skip.
  while IFS=$'\t' read -r name bucket; do
    [ -z "$name" ] && continue
    case "$seen_ci" in
      *"|${name}|"*) ;;
      *)
        seen_ci="${seen_ci}${name}|"
        echo "CI ${bucket}: ${name}"
        ;;
    esac
  done < <(echo "$checks" | jq -r '.[] | select(.bucket != "pending") | "\(.name)\t\(.bucket)"')

  total=$(echo "$checks" | jq 'length')
  pending=$(echo "$checks" | jq '[.[] | select(.bucket=="pending")] | length')
  if [ "$ci_done" = "0" ] && [ "$total" != "0" ] && [ "$pending" = "0" ]; then
    fails=$(echo "$checks" | jq '[.[] | select(.bucket=="fail")] | length')
    if [ "$fails" = "0" ]; then
      echo "CI COMPLETE: all ${total} checks passed"
    else
      echo "CI COMPLETE: ${fails} of ${total} checks FAILED"
    fi
    ci_done=1
  fi

  emit_comments
  primed=1

  sleep 30
done
