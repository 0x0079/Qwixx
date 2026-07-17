import type { Action, Color, Dice, GameState, PlayerState, RulesConfig } from './types';
import { COLORS } from './types';
import { rollDie, seedToState } from './rng';
import { validateBoard } from './board';
import { computeScore } from './scoring';

export const DEFAULT_RULES: Omit<RulesConfig, 'board' | 'numPlayers' | 'seed'> = {
  maxPenalties: 4,
  penaltyPoints: 5,
  minMarksToLock: 5,
  locksToEnd: 2,
};

export function newGame(config: RulesConfig): GameState {
  validateBoard(config.board);
  if (config.numPlayers < 1) throw new Error('at least 1 player required');
  const players: PlayerState[] = Array.from({ length: config.numPlayers }, () => ({
    marks: config.board.rows.map((r) => r.cells.map(() => false)),
    penalties: 0,
  }));
  const state: GameState = {
    config,
    players,
    lockedRows: config.board.rows.map(() => false),
    removedColors: [],
    activePlayer: 0,
    dice: { white: [1, 1], colors: {} },
    phase: 'whiteChoice',
    whiteQueue: [],
    activeMarked: false,
    turn: 1,
    rngState: seedToState(config.seed),
  };
  rollDice(state);
  resetQueue(state);
  return state;
}

function rollDice(state: GameState): void {
  let s = state.rngState;
  const w1 = rollDie(s); s = w1.state;
  const w2 = rollDie(s); s = w2.state;
  const dice: Dice = { white: [w1.value, w2.value], colors: {} };
  for (const c of COLORS) {
    if (!state.removedColors.includes(c)) {
      const r = rollDie(s); s = r.state;
      dice.colors[c] = r.value;
    }
  }
  state.rngState = s;
  state.dice = dice;
}

/** 白骰决定顺序：从主动玩家开始按座位顺序（规则上同时发生，序列化仅为实现方便）。 */
function resetQueue(state: GameState): void {
  const n = state.config.numPlayers;
  state.whiteQueue = Array.from({ length: n }, (_, i) => (state.activePlayer + i) % n);
  state.activeMarked = false;
  state.phase = 'whiteChoice';
}

/** 当前需要行动的玩家；游戏结束时返回 -1。 */
export function currentActor(state: GameState): number {
  if (state.phase === 'gameOver') return -1;
  if (state.phase === 'whiteChoice') return state.whiteQueue[0]!;
  return state.activePlayer;
}

export function whiteSum(state: GameState): number {
  return state.dice.white[0] + state.dice.white[1];
}

/** 玩家 p 在 (row, cell) 划记是否满足位置规则（从左到右、未锁定、锁定格门槛）。 */
function cellMarkable(state: GameState, player: number, row: number, cell: number): boolean {
  if (state.lockedRows[row]) return false;
  const marks = state.players[player]!.marks[row]!;
  if (marks[cell]) return false;
  for (let i = cell; i < marks.length; i++) {
    if (i !== cell && marks[i]) return false; // 已有更右侧的划记
  }
  if (cell === marks.length - 1) {
    const count = marks.filter(Boolean).length;
    if (count < state.config.minMarksToLock) return false;
  }
  return true;
}

/** 枚举玩家 p 用点数和 sum（可选限定颜色）能划的所有格子。 */
function markableCells(
  state: GameState,
  player: number,
  sum: number,
  color?: Color,
): { row: number; cell: number }[] {
  const out: { row: number; cell: number }[] = [];
  state.config.board.rows.forEach((rowDef, r) => {
    rowDef.cells.forEach((c, i) => {
      if (c.number !== sum) return;
      if (color !== undefined && c.color !== color) return;
      if (cellMarkable(state, player, r, i)) out.push({ row: r, cell: i });
    });
  });
  return out;
}

/** 主动玩家彩骰阶段所有可划格子（任一白骰 + 任一在场彩骰，颜色须匹配格子颜色）。 */
function colorMarkableCells(state: GameState): { row: number; cell: number }[] {
  const seen = new Set<string>();
  const out: { row: number; cell: number }[] = [];
  for (const w of state.dice.white) {
    for (const c of COLORS) {
      const dv = state.dice.colors[c];
      if (dv === undefined) continue;
      for (const m of markableCells(state, state.activePlayer, w + dv, c)) {
        const k = `${m.row}:${m.cell}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(m);
        }
      }
    }
  }
  return out;
}

/** 当前决策者的所有合法动作（跳过永远合法）。 */
export function legalActions(state: GameState): Action[] {
  if (state.phase === 'gameOver') return [];
  if (state.phase === 'whiteChoice') {
    const p = state.whiteQueue[0]!;
    const marks = markableCells(state, p, whiteSum(state));
    return [
      ...marks.map((m): Action => ({ type: 'markWhite', row: m.row, cell: m.cell })),
      { type: 'skipWhite' },
    ];
  }
  const marks = colorMarkableCells(state);
  return [
    ...marks.map((m): Action => ({ type: 'markColor', row: m.row, cell: m.cell })),
    { type: 'skipColor' },
  ];
}

export function isLegal(state: GameState, action: Action): boolean {
  const legal = legalActions(state);
  return legal.some(
    (a) =>
      a.type === action.type &&
      (a.type === 'skipWhite' ||
        a.type === 'skipColor' ||
        ((a as { row: number }).row === (action as { row: number }).row &&
          (a as { cell: number }).cell === (action as { cell: number }).cell)),
  );
}

/** 应用动作，返回新状态（原状态不被修改）。非法动作抛错。 */
export function applyAction(state: GameState, action: Action): GameState {
  if (!isLegal(state, action)) {
    throw new Error(`illegal action ${JSON.stringify(action)} in phase ${state.phase}`);
  }
  const next = structuredClone(state);
  applyActionInPlace(next, action);
  return next;
}

/** 原地应用动作（供高吞吐自对弈使用）。调用方需保证动作合法。 */
export function applyActionInPlace(state: GameState, action: Action): void {
  if (state.phase === 'whiteChoice') {
    const p = state.whiteQueue.shift()!;
    if (action.type === 'markWhite') {
      state.players[p]!.marks[action.row]![action.cell] = true;
      if (p === state.activePlayer) state.activeMarked = true;
    }
    if (state.whiteQueue.length === 0) {
      // 动作 1（白骰）窗口全员结算完毕：锁定立即生效（官方规则）。
      // 若锁满结束游戏，动作 2 不再执行，也不做失误判定。
      resolveLocks(state);
      if (checkGameEnd(state)) return;
      state.phase = 'colorChoice';
    }
    return;
  }
  if (state.phase === 'colorChoice') {
    if (action.type === 'markColor') {
      state.players[state.activePlayer]!.marks[action.row]![action.cell] = true;
      state.activeMarked = true;
    }
    // 两步动作均未划记 → 主动玩家记 1 次失误（可自愿）。
    if (!state.activeMarked) state.players[state.activePlayer]!.penalties += 1;
    resolveLocks(state);
    if (checkGameEnd(state)) return;
    state.activePlayer = (state.activePlayer + 1) % state.config.numPlayers;
    state.turn += 1;
    rollDice(state);
    resetQueue(state);
    return;
  }
  throw new Error('game is over');
}

/** 锁定结算：任何玩家划了某行最右格 → 该行锁定，对应彩骰立即移出（本回合动作 2 也不可再用）。 */
function resolveLocks(state: GameState): void {
  state.config.board.rows.forEach((rowDef, r) => {
    if (state.lockedRows[r]) return;
    const last = rowDef.cells.length - 1;
    if (state.players.some((pl) => pl.marks[r]![last])) {
      state.lockedRows[r] = true;
      if (!state.removedColors.includes(rowDef.lockColor)) {
        state.removedColors.push(rowDef.lockColor);
      }
      delete state.dice.colors[rowDef.lockColor];
    }
  });
}

/** 终局判定：锁满 locksToEnd 行，或有人失误达上限。返回是否已结束并完成计分。 */
function checkGameEnd(state: GameState): boolean {
  const locks = state.lockedRows.filter(Boolean).length;
  const busted = state.players.some((p) => p.penalties >= state.config.maxPenalties);
  if (locks < state.config.locksToEnd && !busted) return false;
  state.phase = 'gameOver';
  state.finalScores = state.players.map((_, i) => computeScore(state, i).total);
  const best = Math.max(...state.finalScores);
  state.winners = state.finalScores
    .map((s, i) => (s === best ? i : -1))
    .filter((i) => i >= 0);
  return true;
}

export { markableCells, colorMarkableCells, cellMarkable };
