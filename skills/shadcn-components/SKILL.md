---
name: shadcn-components
description: Add shadcn/ui components to a project using the shadcn CLI rather than hand-writing them. Use whenever the user asks to add, install, or scaffold a shadcn UI element (button, dialog, dropdown, form, sheet, sidebar, etc.), mentions shadcn or shadcn/ui, or asks for a component that is available in the shadcn registry.
---

# shadcn components

## Core rule

When a project uses shadcn/ui and the user asks for a UI element that exists in the shadcn registry, **install it with the CLI**. Do not hand-write the component "in shadcn style" — the generated source is the source of truth and gets future updates via the CLI.

After install, light styling tweaks (palette, radii, backdrop opacity, dialog overlays) are allowed and expected to match the project's theme.

## Quick start

```bash
# Add one component
pnpm dlx shadcn@latest add button

# Add several at once
pnpm dlx shadcn@latest add dialog dropdown-menu sheet

# Overwrite an existing file (after confirming with the user)
pnpm dlx shadcn@latest add dialog --overwrite
```

Use whichever package manager the project uses (`npm`, `pnpm`, `yarn`, `bun`). Prefer `dlx`/`npx` over global installs.

## Workflow

### 1. Confirm the project uses shadcn

Look for `components.json` at the project root (or in the relevant package for monorepos). If it's missing, the project hasn't been initialized — run `pnpm dlx shadcn@latest init` first and confirm config choices with the user.

In a monorepo, run the CLI from the directory that owns `components.json` (usually the app package, e.g. `packages/web`).

### 2. Identify the component

Map the user's request to a registry component name. Common ones:

- modal / popup → `dialog` (or `alert-dialog` for confirmations)
- drawer / side panel → `sheet`
- menu → `dropdown-menu` (or `context-menu`, `menubar`)
- combobox / picker → `command` + `popover`
- toast / notification → `sonner` (current) or `toast` (legacy)
- date picker → `calendar` + `popover`
- tooltip → `tooltip`
- form → `form` (includes `react-hook-form` + `zod` wiring)

If unsure, check https://ui.shadcn.com/docs/components or run `pnpm dlx shadcn@latest add` with no args to see an interactive list.

### 3. Install

Run the CLI from the correct working directory. If a file already exists, the CLI will prompt — only pass `--overwrite` after confirming with the user that local edits to that component should be discarded.

### 4. Adapt to the project theme

After install, scan the generated component for hard-coded values that fight the project's design tokens:

- Replace ad-hoc colors with the project's CSS variables / Tailwind tokens.
- Match existing modal/dialog patterns — backdrop opacity, blur, border radius, shadow.
- Keep API shape (props, exports) unchanged so future `shadcn add --overwrite` is a clean diff.

Look at sibling components already in `components/ui/` to mirror conventions before tweaking.

### 5. Wire it up

Import from the project's UI path (typically `@/components/ui/<name>`), not from `shadcn/ui` directly. The CLI writes components into the local source tree on purpose.

## What not to do

- Don't hand-write a "Dialog" / "Button" / etc. component that mimics shadcn output. Use the CLI.
- Don't import shadcn components from an npm package — there isn't one; the model is copy-into-source.
- Don't pin `shadcn@<version>` unless the user asked for it; prefer `shadcn@latest`.
- Don't run `init` in a project that already has `components.json` — it will overwrite config.
- Don't restyle by forking the component's API. Tweak Tailwind classes / CSS variables instead.

## Registry blocks and primitives

Beyond single components, the CLI can install larger blocks (dashboard, sidebar layouts) and third-party registries:

```bash
pnpm dlx shadcn@latest add sidebar-07           # a named block
pnpm dlx shadcn@latest add <url-to-registry>    # external registry item
```

Use blocks when the user asks for a composed pattern (e.g. "shadcn sidebar layout") rather than a single primitive.
