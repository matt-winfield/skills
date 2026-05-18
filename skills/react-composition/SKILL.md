---
name: react-composition
description: Guides React component design toward composition, compound components, and provider-backed state instead of boolean-heavy prop APIs. Use when building or refactoring React UI with many conditional props, nested ternaries, compound component patterns, shared context, or slot-based composition.
---

# React Composition

## Quick start

When a component starts accumulating feature flags like `isUpdate`, `isThread`, `showFooter`, or `allowAttachments`, treat that as a design smell.

Prefer composition over boolean branching:

```tsx
<ComposerProvider>
  <ComposerFrame>
    <ComposerHeader />
    <ComposerInput />
    <ComposerFooter>
      <EmojiAction />
      <TextFormatAction />
    </ComposerFooter>
  </ComposerFrame>
</ComposerProvider>
```

If a feature is optional, omit that child instead of passing a prop that disables internal behavior.

## Workflow

### 1. Detect the boolean trap

- Flag components that coordinate multiple `isX`, `hasY`, `showZ`, or `hideZ` props.
- Flag nested ternaries or long conditional branches that only decide which sub-UI to render.
- Stop adding new booleans once the component is acting like multiple products behind one API.

### 2. Split structure from behavior

- Extract visual pieces into focused child components.
- Keep each child responsible for one surface: frame, header, input, footer, action, drop zone.
- Replace configuration props with explicit composition through children.

### 3. Lift shared state into a provider

- Put draft state, actions, validation, and submit behavior into context.
- Let children read from hooks like `useComposer()` rather than passing long prop chains.
- Keep the UI tree agnostic to persistence details so the same UI can run against different providers.

### 4. Compose the exact variant you need

- Render only the pieces needed for that screen.
- Prefer separate providers when the behavior changes substantially.
- Use the same UI pieces with different providers when the layout is stable but the state model changes.

## Decision rules

- Prefer composition when a component is hiding or swapping internal sections with booleans.
- Prefer a provider when sibling or external controls need shared state or actions.
- Prefer separate top-level components when two variants do different jobs, even if they look similar.
- Keep public APIs narrow; complexity should live behind provider hooks and focused internals.

## Refactor checklist

- Remove boolean props that only toggle subcomponents.
- Introduce compound components with explicit child composition.
- Move shared logic into a provider and hook.
- Ensure actions can be triggered from inside or outside the main frame.
- Verify the same presentational pieces can work with alternate providers.

## Guidance for AI-assisted codegen

- Generate small composable components instead of one generic controller component.
- Avoid inventing new boolean props when the UI difference can be expressed by children.
- Keep provider contracts explicit: state shape, actions, and constraints.
- Favor predictable composition trees over large conditional render blocks.