# skills

Personal collection of agent skills for AI agents that follow the skills specification.

## Install

Install skills globally

```bash
npx skills add matt-winfield/skills -g
```

Update later with:

```bash
npx skills update -g
```

## Skills

| Name                                                   | Description                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [cleanup-worktrees](skills/cleanup-worktrees/SKILL.md) | Delete git worktrees whose work is already in the default branch.                            |
| [home-assistant](skills/home-assistant/SKILL.md)       | Work with Home Assistant OS over SSH: `ha` CLI, states, history, logs, AppDaemon and config. |
| [pr-and-iterate](skills/pr-and-iterate/SKILL.md)       | Open a PR, watch CI and review comments, and push fixes until green.                         |
| [react-composition](skills/react-composition/SKILL.md) | Guides React component design toward composition and compound components over boolean props. |
| [shadcn-components](skills/shadcn-components/SKILL.md) | Add shadcn/ui components via the shadcn CLI instead of hand-writing them.                    |
| [write-a-skill](skills/write-a-skill/SKILL.md)         | Create a new skill in this repo, publish, and install via `npx skills`.                      |

## Claude Code mods

Mods change Claude Code's own interface: the footer, panes, hooks on tool calls and so on. They live in [`claude-code-mods/`](claude-code-mods), one folder per mod. This repository is also a Claude Code plugin marketplace ([`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)), which `npx skills` ignores.

### Install

In Claude Code:

```text
/plugin marketplace add matt-winfield/skills
/plugin install <mod>@matt-winfield-skills
```

Or from the shell:

```bash
claude plugin marketplace add matt-winfield/skills
claude plugin install <mod>@matt-winfield-skills
```

Restart Claude Code (or run `/reload-plugins`) to load it. Options a mod declares show up in `/config`.

Update later with:

```bash
claude plugin marketplace update matt-winfield-skills
claude plugin update <mod>@matt-winfield-skills
```

To try a mod from a local checkout without installing it, run `claude --plugin-dir ./claude-code-mods/<mod>`. Edits to it hot-reload.

### Mods

| Name                                              | Description                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [sub-meter](claude-code-mods/sub-meter/README.md) | Subscription usage bar in the footer. Click it to switch between the 5h and weekly windows, hover it for a graph of when usage was highest. Fork of midudev's Sub Meter. |
