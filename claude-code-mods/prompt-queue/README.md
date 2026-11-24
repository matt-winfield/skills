# Prompt Queue

A Claude Code mod that queues the messages you send while Claude is working, and sends them one at a time once each turn has finished: Cursor Agent's queued messages, for Claude Code. Claude Code's own behaviour, delivering a message after the next tool call, is still there as the **steer** mode.

```text
Queue · 2 · ↑ in an empty prompt or ctrl+x q to open · ctrl+x enter to steer once
● 1. then add tests for the parser
○ 2. idea: rename the config module
```

## Send modes

What Enter does while Claude is working:

| Mode        | What happens                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `queue`     | The message waits in the queue and is sent when the whole turn finishes, not after a tool call.      |
| `steer`     | Claude Code's own behaviour: the message reaches Claude after the next tool call.                    |
| `interrupt` | The turn stops and the message is sent straight away.                                                |

`ctrl+x enter` does the other of queue and steer for one message: it steers in queue mode, and queues in steer or interrupt mode. The current mode is shown among the footer's mode labels. Change it with `/queue-mode <mode>` (no argument cycles through them), `m` in the queue editor, or the `defaultMode` option in `/config`.

The queue sends its first enabled item after a turn ends with an answer. After Esc or an error it pauses instead; press `r` in the editor to resume.

## The queue

The list above the prompt shows what is queued, and only appears when something is. `●` items are sent in order; `○` items are disabled and skipped, for keeping a todo list of ideas you don't want started yet. `/todo <prompt>` adds a disabled item.

Open the queue editor with **↑ in an empty prompt**, **`ctrl+x q`** from anywhere (see below), or `/queue`. Any draft in the prompt is set aside while it is open and put back when it closes.

| Key     | In the queue editor                                                       |
| ------- | ------------------------------------------------------------------------- |
| `↑` `↓` | Select an item                                                            |
| `enter` | Edit the item in the prompt box. Enter there saves it back to its place.  |
| `t`     | Turn the item on or off                                                   |
| `x`     | Delete the item                                                           |
| `k` `j` | Move the item up or down                                                  |
| `m`     | Cycle the send mode                                                       |
| `s`     | Send the next item now (`r` resumes a paused queue)                       |
| `esc`   | Close the editor                                                          |

While an item is being edited in the prompt box, Enter saves it back to the queue without sending it, and clearing the prompt cancels the edit.

### `ctrl+x q`

Claude Code has no way for a mod to add a keybinding of its own, so the editor answers a binding for `diff:back`, an action whose only built-in handler runs inside the diff dialog. Add it to `~/.claude/keybindings.json`:

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [{ "context": "Chat", "bindings": { "ctrl+x q": "diff:back" } }]
}
```

## Settings

In `/config`:

| Option             | Default | What it does                                                |
| ------------------ | ------- | ----------------------------------------------------------- |
| `defaultMode`      | `queue` | What Enter does while Claude works: queue, steer, interrupt |
| `showModeInFooter` | `true`  | Show the send mode among the footer's mode labels           |

## Limitations

- Claude Code has no silent way for a mod to stop a submitted prompt, so queueing a message shows `Prompt dropped by a hook: Queued (#n)`. The text Claude Code puts back in the box is cleared.
- Messages with pasted images skip the queue. Claude Code doesn't expand `@file` mentions in a prompt a mod sends, so a queued `@file` arrives as plain text.
- The queue lasts for the session.
- A press doesn't say which key made it, so Space can't be told apart from Enter in the editor: `t`, not Space, toggles an item.

## Install

From Claude Code:

```text
/plugin marketplace add matt-winfield/skills
/plugin install prompt-queue@matt-winfield-skills
```

Or from the shell:

```bash
claude plugin marketplace add matt-winfield/skills
claude plugin install prompt-queue@matt-winfield-skills
```

## How it works

The hooks module is [`hooks/register.tsx`](hooks/register.tsx).

- A `prompt.submit` hook sees each message typed during a turn (`e.turnId` set). In queue mode it stores the message and drops it; in steer mode it passes it on; in interrupt mode it aborts the turn with `$.turn.abort`.
- A `turn.complete` hook on the main loop sends the first enabled item with `$.prompt.submit({ asUser: true })`, which runs once the session is idle.
- The list is a `ui.render` hook on `AbovePrompt`. The editor is a focused `Pane` with one `Button` per item, so the arrow keys walk the items; a `ui.focus` hook keeps the ring off the shortcut row.
- Up in an empty prompt is caught by `prompt.edit`, with a `prompt.change` fallback for a history recall. `ctrl+x q` presses a band `Button` whose `action` is `diff:back`.
- The mode label is a `ui.render` hook on `SessionMode`.

## Development

```bash
claude plugin validate ./claude-code-mods/prompt-queue   # from the repository root
claude plugin test ./claude-code-mods/prompt-queue       # runs hooks/*.test.tsx against the engine
claude --plugin-dir ./claude-code-mods/prompt-queue      # try it in a session; edits hot-reload
```

MIT © Matthew Winfield. See [LICENSE](LICENSE).
