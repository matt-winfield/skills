# Sub Meter

A Claude Code mod: your subscription usage, always at the bottom right, on the same line as the permission mode.

A fork of [midudev/better-claude](https://github.com/midudev/better-claude)'s [Sub Meter](https://github.com/midudev/better-claude/tree/main/plugins/sub-meter), which adds a click to switch windows and a usage graph on hover.

```text
                                  ╭──────────────────────────────────────────────────╮
                                  │ Claude Code usage per hour, last 24h             │
                                  │                     ▃ █ █ ▃                      │
                                  │                   ▁ █ █ █ █ ▁                    │
                                  │                   █ █ █ █ █ █                    │
                                  │                 ▃ █ █ █ █ █ █ ▃                  │
                                  │                 █ █ █ █ █ █ █ █                  │
                                  │               ▃ █ █ █ █ █ █ █ █ ▄                │
                                  │   00          06          12          18         │
                                  │ busiest: 10:00                                   │
                                  ╰──────────────────────────────────────────────────╯
⏵⏵ auto mode on                                                5h ━━━━━━──── 58% · 2h 10m
```

Every 8 seconds it switches between the **5-hour** window and the **weekly** one (change it in `/config`, `rotateSeconds`). The bar turns yellow from 75% and red from 90%. After it the time until that window resets.

There is no monthly window: Claude Code only reports the 5-hour and the weekly ones. Off a subscription (API key billing) there is nothing to show, so the footer stays as it is.

While it is on, it also drops the `(shift+tab to cycle)` hint after the permission mode, to leave room for the meter. Turn that off in `/config` (`hideCycleHint`).

## What the fork adds

- **Click to switch.** Clicking the meter (or its graph) switches between the 5-hour and the weekly window at once, and starts the switch timer over, so the window you picked stays up for a full `rotateSeconds`.
- **Usage graph on hover.** With the pointer on the meter, a graph pops up above it:
  - showing the **5-hour** window, your usage in each of the last **24 hours**;
  - showing the **weekly** window, your usage on each of the last **7 days**.

  The bars are relative, so the busiest hour or day is full height, and the busiest is named underneath. It's there to show when usage was highest, not how much. Click while the graph is up and it follows the window you switched to.
- **Hover pauses the switch.** While the pointer is on the meter or on its graph, the automatic switch is paused. When the pointer leaves, it picks up with the time it had left (at least a second).

The graph comes from Claude Code's own session transcripts (`~/.claude/projects/**/*.jsonl`, or under `$CLAUDE_CONFIG_DIR`), the same files tools like ccusage and codeburn read. Every model call in them has its time, model and token counts, so the graph covers the whole week from the first time it opens, including usage from before the mod was installed. Subagent transcripts are included.

Each call is weighted by the API's relative list prices: output tokens count about 5× input, cache writes a little more than input, cache reads about a tenth, and bigger models more than smaller ones. That follows how fast you use up your limits much better than raw token counts, which are mostly cheap cache reads. No numbers are shown, since the weights are only an approximation of what counts against the limits.

The transcripts are read when the session starts and again when the graph opens, at most every 30 seconds, and only files that changed are re-read.

### Limits

- Click and hover need **fullscreen mode**. Off fullscreen the terminal reports no pointer, so the meter works like upstream's and switches by itself.
- **No pointer cursor.** The mod API can't change the mouse cursor, and the terminal decides its shape. Instead the meter's label lights up (bold, in the accent color) while it is hovered.
- A terminal doesn't always report the pointer leaving its window. If it doesn't, the graph closes by itself after a minute without pointer movement.
- The graph only sees **Claude Code on this machine**. Usage on claude.ai, the desktop app or another computer counts against the same limits but isn't in these transcripts. Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays`), which is more than the graph needs.

## Install

From Claude Code:

```text
/plugin marketplace add matt-winfield/skills
/plugin install sub-meter@matt-winfield-skills
```

Or from the shell:

```bash
claude plugin marketplace add matt-winfield/skills
claude plugin install sub-meter@matt-winfield-skills
```

If midudev's `sub-meter@better-claude` is installed, uninstall it first (`claude plugin uninstall sub-meter@better-claude`). Both draw in the same spot.

Get updates with `claude plugin marketplace update matt-winfield-skills`, then `claude plugin update sub-meter@matt-winfield-skills`.

## How it works

The hooks module is [`hooks/register.tsx`](hooks/register.tsx). Reading and weighting transcripts and drawing the chart is in [`hooks/usage.ts`](hooks/usage.ts), and the pointer targets are in [`hooks/hit.tsx`](hooks/hit.tsx).

- `session.measure` hands it the rate-limit windows after each response (`five_hour`, `seven_day`), and `$.session.usage()` gives the first reading at start.
- The last reading is kept in `$.store`, so a new session shows it before its first response.
- The graph's data is read with `$.fs.list` and `$.fs.read` from the transcripts changed in the last week. A file of 4 MiB or more, past what one read can take, is streamed through `cat` (`type` on Windows) with `$.process.spawn`. A message streamed as several lines, or copied into a resumed session's transcript, counts once by its message id.
- A `ui.render` hook on `SessionMode` wraps what the engine draws there (its mode labels) and adds the meter after it.
- Over the meter sits a `Client` (`hit.tsx`), an unpainted region that posts pointer enter, leave and click to the hooks module through `ui.message`. While hovered, the graph is drawn in an absolutely positioned box above the meter, with its own `Client` on top, so the pointer on the graph counts as hovering too.
- The switch is a `$.clock.after` timer. It is cancelled on hover with its remaining time saved, rescheduled on leave, and reset by a click.
- A `ui.render` hook on `PromptHint` rewrites the hint line without `(shift+tab to cycle)`. The engine still draws it, and the mode label before it.

## Development

```bash
claude plugin validate ./claude-code-mods/sub-meter   # from the repository root
claude plugin test ./claude-code-mods/sub-meter       # runs hooks/*.test.ts(x) against the engine
claude --plugin-dir ./claude-code-mods/sub-meter      # try it in a session; edits hot-reload
```

### Pulling in upstream changes

This folder was imported with `git subtree`, keeping upstream's history of `plugins/sub-meter`. To merge newer upstream commits:

```bash
git clone https://github.com/midudev/better-claude /tmp/better-claude
git -C /tmp/better-claude subtree split --prefix=plugins/sub-meter -b sub-meter-split
git subtree pull --prefix=claude-code-mods/sub-meter /tmp/better-claude sub-meter-split
```

MIT © Miguel Ángel Durán (midudev), fork changes © Matthew Winfield. See [LICENSE](LICENSE).
