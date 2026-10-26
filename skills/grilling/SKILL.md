---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea, a few questions at a time through the agent's built-in question tool. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Then wait for the user's answers before the next round.

## Asking a round

Ask each round with the built-in question tool (`AskUserQuestion` in Claude Code), not as a block of markdown:

- **At most 4 questions per round** (the tool's limit). If the frontier is bigger, ask the most fundamental questions first, the ones that unblock the most of the tree, and leave the rest for later rounds.
- Give each question 2–4 concrete options. Put your recommended answer first and end its label with `(Recommended)`. Use each option's description for its trade-offs.
- Keep the question text short: one or two sentences of context, then the question. Don't restate background the user already gave.
- The tool adds an "Other" choice for free-form answers, so don't add one yourself.

A question that's genuinely open-ended and doesn't fit a few options (e.g. "what should this be called?") goes in plain text, one at a time, with your suggestion.

If the agent has no structured question tool, ask in plain numbered text with the same limit: at most 4 questions, each with your recommended answer. Word each question so "yes" accepts the recommendation.

## Moving the frontier

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
