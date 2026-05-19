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

Poll both in parallel. Prefer Monitor for the CI watch so each status change is a notification rather than a poll loop:

```bash
# CI: streams a line per check transition
gh pr checks <pr> --watch
```

For comments, poll on a slow cadence (90–180s) — there's no streaming endpoint:

```bash
gh pr view <pr> --json reviews,comments,reviewThreads \
  --jq '{reviews: [.reviews[] | {author: .author.login, state, body, submittedAt}],
         comments: [.comments[] | {author: .author.login, body, createdAt}],
         threads: [.reviewThreads[] | select(.isResolved == false) | {path: .path, line: .line, comments: [.comments[] | {author: .author.login, body}]}]}'
```

Track which comments / thread IDs you've already addressed so you don't loop on the same feedback.

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
