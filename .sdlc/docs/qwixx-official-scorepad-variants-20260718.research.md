# Official score-pad variant research

## Research question

Which official Qwixx products can be played with the original six dice by replacing the
score sheet, and what engine mechanics do they add?

## Findings

Primary sources are NSV's English rule PDFs. The score-pad line contains:

- Qwixx mixed / gemixxt A and B: mixed colours or mixed numbers.
- Big Points: two shared-scoring bonus rows.
- Bonus A and B: chain-reaction crosses or paired-symbol rewards.
- Connected A and B: an extra eleven-cell step score or linked cell pairs; physical pads
  contain five player sheets A-E.
- Double A and B: repeat the latest number, or four printed double-count cells per row.
- X-Change: nine ordered, single-use white-sum swaps.
- Longo is a compatible official standalone variant using d8s and longer rows.

On Board, The Card Game, and Das Duell require materially different components and turn
structures, so they are catalogued but are not score-sheet presets for this engine.

## Primary sources

- https://www.nsv.de/wp-content/uploads/2024/04/QwixxGX_GB.pdf
- https://www.nsv.de/wp-content/uploads/2024/04/QwixxBP_GB.pdf
- https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_Bonus_GB.pdf
- https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_connect_GB.pdf
- https://www.nsv.de/wp-content/uploads/2024/04/Qwixx_Double_GB.pdf
- https://www.nsv.de/wp-content/uploads/2024/09/QwixxXChange_EN.pdf
- https://www.nsv.de/wp-content/uploads/2024/04/QwixxLongo_GB.pdf
- https://www.nsv.de/wp-content/uploads/2025/06/QwixxOnBoard_GB.pdf

## Recommendation

Model score-pad mechanics as a discriminated `BoardDef.variant` union. Keep automatic
effects in the core state machine, expose choices as legal actions, and use per-seat
Connected sheets. This preserves deterministic replay, bots, and UI parity.
