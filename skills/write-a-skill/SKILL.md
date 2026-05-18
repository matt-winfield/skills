---
name: write-a-skill
description: Create a new agent skill in Matt's personal skills repo (~/dev/skills, github.com/matt-winfield/skills), then publish it to GitHub and install it via npx skills. Use when the user wants to create, write, build, or fork a new skill.
---

# Writing a skill

Skills live in **`~/dev/skills/skills/<name>/`** (repo: `matt-winfield/skills`). The workflow is: draft locally → push to GitHub → install with `npx skills`.

## Process

1. **Gather requirements** — ask:
   - What task/domain does the skill cover?
   - What use cases must it handle?
   - Pure instructions, or does it also need executable scripts?
   - Any reference docs to bundle?

2. **Draft** at `~/dev/skills/skills/<name>/`:
   - `SKILL.md` (required, with frontmatter)
   - `REFERENCE.md` / `EXAMPLES.md` only if `SKILL.md` exceeds ~100 lines
   - Scripts (`cleanup.sh`, etc.) for deterministic operations

3. **Review with user** before publishing.

4. **Publish & install** (see below).

## Skill structure

```
~/dev/skills/skills/<name>/
├── SKILL.md           # required
├── REFERENCE.md       # split when SKILL.md > ~100 lines
├── EXAMPLES.md        # optional
└── scripts/           # optional helpers (bash/node/python)
    └── helper.sh
```

## SKILL.md template

```md
---
name: skill-name
description: What it does. Use when [specific triggers].
---

# Skill name

## Quick start
[Minimal working example.]

## Workflows
[Step-by-step processes.]

## Advanced features
[Link to REFERENCE.md if needed.]
```

## Description requirements

The description is **the only thing the agent sees** when deciding whether to load the skill.

- Max 1024 chars, third person
- First sentence: what it does
- Second sentence: `Use when [specific triggers]`

**Good:** `Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.`

**Bad:** `Helps with documents.`

## When to add scripts

Add a script when the operation is deterministic (validation, formatting, scanning), the same code would be regenerated repeatedly, or errors need explicit handling. Scripts save tokens and improve reliability vs. LLM-generated code.

## When to split files

Split when `SKILL.md` exceeds ~100 lines, content covers distinct domains, or advanced features are rarely needed.

## Publish & install

```bash
cd ~/dev/skills
git add skills/<name>
git commit -m "feat: add <name> skill"
git push

npx skills add matt-winfield/skills -g -s <name> -y
```

### Convert to symlink layout

`npx skills` defaults to **copy** when only one agent is targeted (no `--symlink` flag exists; the prompt only fires with multiple agents). To match the rest of the symlink-managed skills:

```bash
mv ~/.claude/skills/<name> ~/.agents/skills/<name>
ln -s ../../.agents/skills/<name> ~/.claude/skills/<name>
```

Don't forget to also update the README table in `~/dev/skills/README.md`.

### Updating later

```bash
cd ~/dev/skills && git pull   # if edited elsewhere
npx skills update -g          # pulls latest from GitHub for installed skills
```

## Review checklist

- [ ] Description starts with what + "Use when..."
- [ ] `SKILL.md` under ~100 lines
- [ ] No time-sensitive info (dates, version numbers that rot)
- [ ] Consistent terminology
- [ ] Concrete examples included
- [ ] Listed in `~/dev/skills/README.md`
