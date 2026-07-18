# Automatic Match Seed Validation

## Behavior

- Automatic mode generated different randomized-board seeds on consecutive starts: `516126` and `77697`.
- Explicit seed `424242` produced `随机混排 #424242` on consecutive starts.
- AI randomness now derives from the resolved seed in `GameState.config`, matching dice and board generation.
- The resolved seed remains visible in the active match header, including the mobile layout.

## Layout

- The optional seed field and start button share the same match-summary card.
- Their measured vertical gap is `12px`; the former standalone seed panel is absent.
- Desktop setup at 1440 px and mobile setup at 390 px show no horizontal overflow.
- At 900 px, the seed/start group spans the full summary width before the primary action.

## Automated Checks

- `npm run build`: passed.
- `npm test`: 41/41 tests passed.
- `git diff --check`: passed.
- `npm audit --offline --omit=dev`: 0 vulnerabilities.

## Review

No gameplay-rule changes, network calls, persistence, unsafe rendering, or new dependencies were introduced. The start action resolves the optional seed once and passes that value through the existing engine configuration path.

PR creation was intentionally omitted because the requested workflow is staged local commits and the branch is already prepared for the user's existing PR flow.
