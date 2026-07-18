# Qwixx UI/UX Experience Refresh

## Motivation

The existing interface exposes every core feature but presents setup and gameplay as flat groups of controls. Players must infer what a board variant changes, whose decision is pending, and which interaction is expected next. The refresh should make the game immediately readable without altering the rules engine.

## Scope

- Reorganize the setup screen into a clear product header, player configuration, board selection, and match summary.
- Add board-variant descriptions and immediate readiness feedback.
- Strengthen gameplay hierarchy with turn/stage context, action guidance, legal-choice count, and player status.
- Add safe exit confirmation, restart support, action announcements, empty states, and improved button labels.
- Improve responsive score-sheet behavior, keyboard focus, contrast, and reduced-motion handling.

## Functional Requirements

1. Support the same 1–5 player types, board presets, seeds, and deterministic game creation.
2. Prevent starting while any player name is blank and explain why inline.
3. Represent board presets as descriptive selectable cards while preserving all existing IDs.
4. Show white and color action phases as a two-step progress indicator.
5. Tell the current user whether they can mark a cell, should wait for AI, or have no mark available.
6. Confirm before discarding an active match.
7. Allow a completed match to restart with the same setup or return to setup.
8. Keep every action routed through `legalActions` and `applyAction`; no gameplay rule duplication.

## Interaction Design

- Legal score cells receive a high-contrast ring, hover lift, descriptive tooltip, and accessible label.
- AI turns show a subtle thinking indicator and do not expose enabled human controls.
- The latest transition is announced through a polite live region.
- On narrow screens, score sheets scroll horizontally within each card rather than compressing below a usable tap target.
- Exit confirmation uses an in-app modal with cancel as the safe default.

## Visual Direction

A warm tabletop surface, off-white paper cards, ink-like typography, and four Qwixx row colors. Green is reserved for primary actions and legal targets; amber communicates the active player/turn. Layout and interaction use CSS only to preserve the current lightweight stack.

## Component Changes

- Add preset metadata and compact icon components in `src/ui/App.tsx`.
- Expand `SetupScreen` with preset cards, seat controls, and a sticky/adjacent match summary.
- Expand `GameScreen` with phase stepper, status guidance, confirmation modal, final standings, and restart callback.
- Add semantic labels and action descriptions to dice and score cells.
- Replace the current stylesheet with a tokenized responsive visual system in `src/ui/styles.css`.

## Validation

- `npm test`
- `npm run build`
- Manual browser pass at desktop and mobile widths covering setup, start, human action, skip, AI wait, exit confirmation, and game-over rendering where practical.

## Security and Privacy

No network calls, storage, authentication, or user-generated HTML are introduced. Player names continue to render as escaped React text.

## Out of Scope

- Rule engine or bot strategy changes.
- Persistence, online multiplayer, sound, authentication, or external analytics.
