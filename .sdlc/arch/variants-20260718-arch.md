# Qwixx Variants Architecture

**Last Updated**: 2026-07-18
**Cache Level**: Module
**Expires**: 2026-08-01
**Branch**: feat/variant
**Hash**: 298db82775d90badf46043589d84ef517b904d69

## Overview

The project is a deterministic TypeScript Qwixx engine with a React UI, bots, and a
fixed-action RL adapter. `BoardDef` describes score-sheet geometry while `engine.ts`
owns turn sequencing and rule legality.

## Components

| Component | Location | Purpose |
|---|---|---|
| Variant schema | `src/core/types.ts` | Serializable board, player, action, and phase data |
| Presets | `src/core/board.ts` | Official and custom score-sheet definitions |
| State machine | `src/core/engine.ts` | Legal actions, forced effects, locks, and game end |
| Scoring | `src/core/scoring.ts` | Row totals, bonuses, and penalties |
| UI | `src/ui/App.tsx` | Setup choices and clickable score sheets |
| Bots / RL | `src/ai/` | Generic legal-action consumers and encoders |

## Data Flow

`BoardDef -> configForBoard -> newGame -> legalActions -> applyAction -> computeScore`.
The UI and bots consume only legal actions, so new mechanics must be represented as
serializable actions rather than hidden UI state.

## Key Patterns

- Immutable public transition (`applyAction`) plus mutable hot path (`applyActionInPlace`).
- White-dice choices are serialized through `whiteQueue`; locks resolve after the whole
  white window to preserve simultaneous-play semantics.
- Variant-specific marks live in `PlayerState`; board metadata remains static.
- Every new action must be added to identity, UI routing, bot evaluation, and RL codec.

## Integration Points

- Double variants need a second mark layer and alternative lock-count semantics.
- Bonus variants need forced-effect actions that suspend and resume the originating phase.
- Connected uses per-player A-E sheet metadata selected deterministically by seat.
- X-Change combines one white-sum exchange with a normal white mark.
