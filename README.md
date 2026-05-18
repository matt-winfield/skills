# skills

Personal collection of [agent skills](https://github.com/anthropics/skills) for [Claude Code](https://claude.com/claude-code) and other agents that follow the same convention.

## Install

Install all skills globally for Claude Code:

```bash
npx skills add matt-winfield/skills -g -a claude-code -s '*' -y
```

Or pick specific skills:

```bash
npx skills add matt-winfield/skills -g -a claude-code -s cleanup-worktrees
```

Update later with:

```bash
npx skills update -g
```

## Skills

| Name                                                  | Description                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [cleanup-worktrees](skills/cleanup-worktrees/SKILL.md) | Delete git worktrees whose work is already in the default branch.                            |
| [react-composition](skills/react-composition/SKILL.md) | Guides React component design toward composition and compound components over boolean props. |
