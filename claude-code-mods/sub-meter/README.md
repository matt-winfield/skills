# Sub Meter

A Claude Code mod: your subscription usage, always at the bottom right, on the same line as the permission mode.

A fork of [midudev/better-claude](https://github.com/midudev/better-claude)'s [Sub Meter](https://github.com/midudev/better-claude/tree/main/plugins/sub-meter), which adds a click to switch windows and a usage graph on hover.

```text
                                  ╭───────────────────────────────────────────────────────╮
                                  │ 5h window · used per hour, last 24h                   │
                                  │ 8.9% │                  ▃ █ █ ▃                       │
                                  │      │                ▁ █ █ █ █ ▁                     │
                                  │      │                █ █ █ █ █ █                     │
                                  │      │              ▃ █ █ █ █ █ █ ▃                   │
                                  │      │              █ █ █ █ █ █ █ █                   │
                                  │   0% │            ▃ █ █ █ █ █ █ █ █ ▄                 │
                                  │         00          06          12          18        │
                                  │ total 54% · peak 8.9%                                 │
                                  ╰───────────────────────────────────────────────────────╯
⏵⏵ auto mode on                                                5h ━━━━━━──── 58% · 2h 10m
```

Every 8 seconds it switches between the **5-hour** window and the **weekly** one (change it in `/config`, `rotateSeconds`). The bar turns yellow from 75% and red from 90%. After it the time until that window resets.

There is no monthly window: Claude Code only reports the 5-hour and the weekly ones. Off a subscription (API key billing) there is nothing to show, so the footer stays as it is.

While it is on, it also drops the `(shift+tab to cycle)` hint after the permission mode, to leave room for the meter. Turn that off in `/config` (`hideCycleHint`).

## What the fork adds

- **Click to switch.** Clicking the meter (or its graph) switches between the 5-hour and the weekly window at once, and starts the switch timer over, so the window you picked stays up for a full `rotateSeconds`.
- **Usage graph on hover.** With the pointer on the meter, a graph pops up above it:
  - showing the **5-hour** window, what was used of it in each of the last **24 hours**;
  - showing the **weekly** window, what was used of it on each of the last **7 days**.

  Bars are in percentage points of that window, with the peak and the total underneath. Click while the graph is up and it follows the window you switched to.
- **Hover pauses the switch.** While the pointer is on the meter or on its graph, the automatic switch is paused. When the pointer leaves, it picks up with the time it had left (at least a second).

The graph is built from the readings the meter takes after each response, kept for 8 days in the mod's store and shared by all your sessions. It starts empty and fills in as you use Claude Code. Usage from elsewhere (claude.ai, another machine) shows up in the hour or day of the next reading this machine takes.

### Limits

- Click and hover need **fullscreen mode**. Off fullscreen the terminal reports no pointer, so the meter works like upstream's and switches by itself.
- **No pointer cursor.** The mod API can't change the mouse cursor, and the terminal decides its shape. Instead the meter's label lights up (bold, in the accent color) while it is hovered.
- A terminal doesn't always report the pointer leaving its window. If it doesn't, the graph closes by itself after a minute without pointer movement.

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

The hooks module is [`hooks/register.tsx`](hooks/register.tsx). The history and chart math is in [`hooks/history.ts`](hooks/history.ts), and the pointer targets are in [`hooks/hit.tsx`](hooks/hit.tsx).

- `session.measure` hands it the rate-limit windows after each response (`five_hour`, `seven_day`), and `$.session.usage()` gives the first reading at start.
- The last reading is kept in `$.store`, so a new session shows it before its first response. Each reading is also added to a `history` in `$.store`, merged with what other sessions stored since.
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
