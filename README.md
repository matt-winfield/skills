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
| [pr-and-iterate](skills/pr-and-iterate/SKILL.md)       | Open a PR, watch CI and review comments, and push fixes until green.                         |
| [react-composition](skills/react-composition/SKILL.md) | Guides React component design toward composition and compound components over boolean props. |
| [write-a-skill](skills/write-a-skill/SKILL.md)         | Create a new skill in this repo, publish, and install via `npx skills`.                      |
