# Automatic Match Seed and Start Controls

## Existing Behavior

- `Setup.seed` is initialized with a random number as soon as the page loads, so the input always appears explicitly configured.
- Starting or restarting a match reuses that same value, which unintentionally repeats the dice sequence.
- The same seed drives the core game RNG, randomized board generation, and each AI player's deterministic RNG.
- Seed controls currently sit in a separate full-width panel, away from the match summary and primary start action.

## Requirements

1. Treat the setup seed as optional user intent and leave it blank by default.
2. Resolve a new integer seed when a match starts if the input is blank.
3. Preserve and reuse an explicitly entered integer seed so the same match can be reproduced.
4. On restart, generate a fresh seed for automatic mode and reuse the value for explicit mode.
5. Use the resolved match seed consistently for dice, randomized boards, and AI randomness.
6. Place the optional seed control beside the start action and explain the active mode inline.
7. Show the resolved seed during the match so an automatically generated game can be replayed later.

## Interaction Design

- Label the field `随机种子（可选）` and use `留空则每局随机` as its placeholder.
- In automatic mode, show `每次开始都会生成新局`.
- With an explicit value, show that the match can be reproduced with that seed.
- Keep a shuffle action for users who want the app to generate a visible, reusable seed.
- Keep player-name validation as the only condition that disables the start button.

## Validation

- Starting twice with a blank field produces different resolved seeds.
- Starting twice with an explicit seed produces the same resolved seed.
- The resolved seed is visible in the active match header.
- Desktop and mobile layouts keep the seed field and start action together without overflow.
- `npm run build` and `npm test` pass.

## Security and Privacy

The feature remains fully local. The optional numeric seed is rendered as escaped React text and is not persisted or transmitted.
