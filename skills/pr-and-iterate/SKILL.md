---
name: pr-and-iterate
description: Open a pull request for completed work, then watch CI and review comments and push fixes for each failure or actionable comment until the PR is green and quiet. Use when the user says "open a PR and iterate", "create a PR and keep fixing it", "ship this and watch the checks", or otherwise asks you to take a branch from "done locally" to "green on CI with reviewer feedback addressed".
---

# pr-and-iterate

Take a finished branch and drive it to a clean, green PR. Three phases: **open**, **watch**, **fix-and-push** — repeat watch+fix until CI is green and there are no unaddressed comments.

## 1. Open the PR

Before creating:

- `git status` — nothing uncommitted that belongs in the PR
- `git log <base>..HEAD` and `git diff <base>...HEAD` — read **all** commits, not just the latest
- Push the branch with `-u` if it has no upstream

Then `gh pr create` with a short title (<70 chars) and a body covering **Summary** + **Test plan**. Use a HEREDOC. Capture the PR number — every later command needs it.

## 2. Watch CI and comments

Run **one persistent Monitor** that emits a single line per new event covering both CI and comments, so you're notified instead of polling. Use the ready recipe and stop it with TaskStop when the PR is done:

```
Monitor(
  command: "bash <skill>/scripts/watch-pr.sh <owner/repo> <pr>",
  persistent: true,
  description: "PR <pr>: CI + comments + review findings",
)
```

`scripts/watch-pr.sh` is built to avoid the five ways this watch usually goes wrong — read the header before adapting it. The traps, in order of how often they bite:

- **Comments hide in THREE endpoints, not one.** `issues/<pr>/comments` (conversation), `pulls/<pr>/comments` (inline, in-diff), **and `pulls/<pr>/reviews` (review *bodies*)**. CodeRabbit's "Outside diff range", "Duplicate comments", and "Actionable comments posted: N" findings live **only in the review body** — they are in no comment endpoint. Polling just comments silently drops them; this is the number-one cause of "you missed a comment." A `gh pr view --json reviews,comments,reviewThreads` one-shot does capture all three, but lacks the dedup/priming below.
- **Bot summaries re-render on every push.** CodeRabbit edits one summary comment each push, so naive `?since=` polling re-fires it forever. Dedup by `id + updated_at` (so an edit that *adds* findings still fires), and only surface bot summaries/reviews matching a findings pattern (`Outside diff|Duplicate comments|Actionable comments posted: [1-9]`) — humans always pass through.
- **Prime on the first pass.** On startup, record existing items as seen *without emitting*, or a restart replays the whole history as "new."
- **Emit failures, not just passes.** Surface `fail`/`cancel` checks and a completion summary too — silence must never be mistakable for success.
- **macOS ships bash 3.2** (no `declare -A`). Track the "seen" set as a delimited string, not an associative array, or a check name with spaces ("Build and Validate") breaks it.

Each emitted line is a notification: `CI <bucket>: <name>`, `CI COMPLETE: …`, `COMMENT <user>: …`, `REVIEW <user> [file:line]: …`, `REVIEW-SUMMARY <user>: …`. Keep your own running set of comment/thread IDs you've already addressed so you don't loop on the same feedback.

## 3. Fix CI failures

When a check fails:

1. `gh pr checks <pr>` → find the failing check's run URL
2. `gh run view <run-id> --log-failed` — pull only the failing step's log
3. Reproduce locally if cheap (`pnpm lint`, `pnpm test`, etc. — check `package.json`)
4. Fix the root cause. Do **not** skip hooks, disable the failing test, or `--no-verify` your way past it
5. Commit with a Conventional Commit message (`fix:`, `chore:`, etc.) and push

## 4. Address review comments

For each unresolved thread or actionable comment:

- Read the comment in full context (file + line from `reviewThreads`)
- If it's actionable: make the change, commit, push, **then resolve the thread** via the GraphQL `resolveReviewThread` mutation (thread IDs come from the `reviewThreads` query above)
- If it's a question or you disagree: reply via `gh pr comment` or `gh api .../pulls/<pr>/comments/<id>/replies` — don't silently ignore it. Don't resolve a thread you only replied to; leave it for the reviewer

**Only dismiss a comment if it is factually incorrect** — wrong about what the code does, based on a misread, suggests a change that would break something, or contradicts a documented decision. Dismiss by replying with the specific reason it's wrong (and leave the thread unresolved so the reviewer sees the reply).

**"Too nitpicky" is not a valid reason to dismiss.** Style nits, naming preferences, formatting suggestions, minor refactors, and CodeRabbit pedantry all count as actionable. Apply them, push, and resolve the thread. If you find yourself thinking "this is too small to bother with", apply it anyway — the reviewer asked for it.

Resolve example:

```bash
gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id isResolved } } }' -F id=<thread-id>
```

## 5. Loop

After each push, CI re-runs. Go back to step 2. Exit when:

- All required checks are green (`gh pr checks <pr>` shows no failing/pending required checks), AND
- No unresolved review threads remain that you authored a fix for but haven't pushed, AND
- No new comments arrived in the last poll cycle

Report the PR URL and a one-line status to the user.

## Guardrails

- Never force-push to a shared branch without the user's explicit OK. `git push --force-with-lease` to your own PR branch is fine after a rebase you intended.
- Never push to `main`/`master`.
- If a fix would meaningfully change the PR's scope (new feature, large refactor), stop and check with the user instead of pushing.
- If the same check fails twice with the same root cause after your fix, stop and report — you're guessing.
- Don't churn: batch related fixes into one commit per round rather than one commit per comment.
