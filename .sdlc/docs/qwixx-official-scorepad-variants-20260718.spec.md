# Official Qwixx score-pad variants

## Motivation

The app currently exposes only classic, gemixxt, Longo, and Big Points even though NSV
publishes several more score-pad variants. Users should be able to select and play those
variants with rules enforced by the engine rather than relying on visual-only sheets.

## Scope

Add playable presets for Double A/B, Bonus A/B, Connected Steps/Chain, and X-Change.
Keep On Board, card, and duel products documented but out of playable scope because they
require additional physical components or replace the dice-game turn model.

## Requirements

- All presets are selectable in setup and usable by humans and bots.
- Double tracks second crosses, uses a seven-cross lock threshold, and caps at 16 scoring
  crosses; B uses official multiplier positions.
- Bonus A uses the official twelve trigger cells and colour track; forced crosses can chain.
- Bonus B uses the official paired symbols and applies immediate/scoring rewards.
- Connected assigns seats deterministic A-E digital sheets; Steps adds a fifth score group,
  Chain automatically marks the paired cell even in a locked row.
- X-Change exposes the official nine ordered swaps during the white action only.
- State remains JSON-serializable and seeded games remain reproducible.
- Tests cover legality, forced effects, locks, scoring, and codec round trips.

## Design

- Extend `BoardDef` with variant metadata and optional per-player sheet metadata.
- Extend `PlayerState` with second marks and variant progress.
- Add explicit actions for Double repeats, X-Change marks, and forced Bonus choices.
- Add a `bonusChoice` phase with a resumable pending-effect queue.
- Extend scoring and rendering from the same board metadata.

## Validation

Run unit tests, typecheck/build, seeded bot playouts for every preset, and review the final
diff for accidental changes to the user's untracked `pnpm-lock.yaml`.
