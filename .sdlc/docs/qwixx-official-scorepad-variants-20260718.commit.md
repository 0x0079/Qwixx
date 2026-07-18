# Commit Report: Official Qwixx Score-pad Variants

**Date:** 2026-07-18
**Branch:** `feat/variant`

## Commit batches

1. `bc1b43e feat: add official scorepad variant rules`
   - Core variant types, boards, engine transitions, scoring, AI support, codecs, and regression tests.
2. `594eb0d feat: expose official variants in game UI`
   - Setup choices, special-cell badges, forced-bonus interaction, progress indicators, and score display.
3. `doc: document official Qwixx variants`
   - Official source research, architecture/specification records, manuals, API/design notes, and validation reports.

## Pre-commit checks

- 50/50 tests passed.
- TypeScript check and production build passed.
- Browser acceptance passed with no console errors.
- Production dependency audit reported 0 vulnerabilities.
- Code review passed after resolving duplicate Connected B endpoints.

The pre-existing untracked `pnpm-lock.yaml` was intentionally excluded.
