import type { Action, BoardDef, BonusSymbol, CellRef, Color, Dice, GameState, PlayerState, RulesConfig } from './types';
import { COLORS } from './types';
import { nextRand, rollDie, seedToState } from './rng';
import { validateBoard } from './board';
import { computeScore } from './scoring';
import { chainPartner, nextRewardIndex, sameRef } from './variants';

export const DEFAULT_RULES: Omit<RulesConfig, 'board' | 'numPlayers' | 'seed'> = {
  maxPenalties: 4,
  penaltyPoints: 5,
  minMarksToLock: 5,
  locksToEnd: 2,
  dieFaces: 6,
};

/**
 * 按棋盘预设生成完整规则配置：合并棋盘自带的规则覆盖（Longo 的八面骰、锁行门槛 6），
 * 并在需要时（Longo）为每名玩家从种子确定性地生成 2 个不同的幸运数字。
 */
export function configForBoard(board: BoardDef, numPlayers: number, seed: number): RulesConfig {
  const config: RulesConfig = {
    ...DEFAULT_RULES,
    ...board.rulesOverrides,
    board,
    numPlayers,
    seed,
  };
  if (board.luckyNumbers) {
    const maxSum = 2 * config.dieFaces;
    let s = seedToState(seed ^ 0x51ac9e37);
    config.luckyNumbers = Array.from({ length: numPlayers }, () => {
      const pair: number[] = [];
      while (pair.length < 2) {
        const r = nextRand(s);
        s = r.state;
        const n = 2 + Math.floor(r.value * (maxSum - 1)); // 2..maxSum
        if (!pair.includes(n)) pair.push(n);
      }
      return pair.sort((a, b) => a - b);
    });
  }
  return config;
}

/**
 * 创建新局。`startingPlayer` 只决定谁先掷骰（回合仍按座位顺序轮转），
 * 不影响座位数组本身，因此可以脱离座位重排独立随机化"先手"。
 */
export function newGame(config: RulesConfig, startingPlayer = 0): GameState {
  validateBoard(config.board);
  if (config.numPlayers < 1) throw new Error('at least 1 player required');
  const players: PlayerState[] = Array.from({ length: config.numPlayers }, () => ({
    marks: config.board.rows.map((r) => r.cells.map(() => false)),
    bonusMarks: (config.board.bonusRows ?? []).map((b) => b.numbers.map(() => false)),
    secondMarks: config.board.rows.map((r) => r.cells.map(() => false)),
    variantState: config.board.variant?.kind === 'bonus-a'
      ? { bonusTrackUsed: config.board.variant.rewardTrack.map(() => false) }
      : config.board.variant?.kind === 'bonus-b'
        ? { bonusSymbols: {} }
        : config.board.variant?.kind === 'x-change'
          ? { xChangeThrough: -1 }
          : {},
    penalties: 0,
  }));
  const state: GameState = {
    config,
    players,
    lockedRows: config.board.rows.map(() => false),
    removedColors: [],
    activePlayer: startingPlayer,
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
  const faces = state.config.dieFaces;
  let s = state.rngState;
  const w1 = rollDie(s, faces); s = w1.state;
  const w2 = rollDie(s, faces); s = w2.state;
  const dice: Dice = { white: [w1.value, w2.value], colors: {} };
  for (const c of COLORS) {
    if (!state.removedColors.includes(c)) {
      const r = rollDie(s, faces); s = r.state;
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
  if (state.phase === 'bonusChoice') return state.pendingBonus!.player;
  if (state.phase === 'whiteChoice') return state.whiteQueue[0]!;
  return state.activePlayer;
}

export function whiteSum(state: GameState): number {
  return state.dice.white[0] + state.dice.white[1];
}

/** 玩家 p 在某行的最右划记位置（无则 -1）。 */
export function rightmostMark(state: GameState, player: number, row: number): number {
  const marks = state.players[player]!.marks[row]!;
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i]) return i;
  return -1;
}

/** 玩家 p 在 (row, cell) 划记是否满足位置规则（从左到右、未锁定、锁定格门槛）。 */
function cellMarkable(state: GameState, player: number, row: number, cell: number): boolean {
  if (state.lockedRows[row]) return false;
  const marks = state.players[player]!.marks[row]!;
  if (marks[cell]) return false;
  if (rightmostMark(state, player, row) >= cell) return false;
  const tail = state.config.board.lockableTail ?? 1;
  if (cell >= marks.length - tail) {
    const count = marks.filter(Boolean).length + state.players[player]!.secondMarks[row]!.filter(Boolean).length;
    if (count < state.config.minMarksToLock) return false;
  }
  return true;
}

/** 枚举玩家 p 用点数和 sum（可选限定颜色）能划的所有普通格。 */
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

/** 主动玩家彩骰阶段所有可划普通格（任一白骰 + 任一在场彩骰，颜色须匹配格子颜色）。 */
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

function doubleLatestActions(state: GameState, player: number, phase: 'white' | 'color'): Action[] {
  if (state.config.board.variant?.kind !== 'double-a') return [];
  const out: Action[] = [];
  state.config.board.rows.forEach((rowDef, row) => {
    if (state.lockedRows[row]) return;
    const cell = rightmostMark(state, player, row);
    if (cell < 0 || state.players[player]!.secondMarks[row]![cell]) return;
    const def = rowDef.cells[cell]!;
    if (phase === 'white') {
      if (def.number === whiteSum(state)) out.push({ type: 'markDoubleWhite', row, cell });
      return;
    }
    const die = state.dice.colors[def.color];
    if (die !== undefined && state.dice.white.some((white) => white + die === def.number)) {
      out.push({ type: 'markDoubleColor', row, cell });
    }
  });
  return out;
}

function exchangeActions(state: GameState, player: number): Action[] {
  const variant = state.config.board.variant;
  if (variant?.kind !== 'x-change') return [];
  const through = state.players[player]!.variantState.xChangeThrough ?? -1;
  const sum = whiteSum(state);
  const out: Action[] = [];
  variant.swaps.forEach(([a, b], swap) => {
    if (swap <= through) return;
    const exchanged = sum === a ? b : sum === b ? a : undefined;
    if (exchanged === undefined) return;
    for (const target of markableCells(state, player, exchanged)) {
      out.push({ type: 'markWhiteExchange', ...target, swap });
    }
  });
  return out;
}

function forcedActions(state: GameState): Action[] {
  if (!state.pendingBonus) return [];
  discardImpossibleEffects(state);
  const pending = state.pendingBonus;
  if (!pending) return legalActions(state);
  const effect = pending.effects[0];
  if (!effect) return [];
  let rows: number[];
  if (effect.kind === 'row') {
    rows = [effect.row];
  } else if (effect.row !== undefined) {
    rows = [effect.row];
  } else {
    const candidates = state.config.board.rows
      .map((_, row) => ({ row, count: state.players[pending.player]!.marks[row]!.filter(Boolean).length }))
      .filter(({ row }) => !state.lockedRows[row] && state.config.board.rows[row]!.cells.some((_, cell) => cellMarkable(state, pending.player, row, cell)));
    const min = Math.min(...candidates.map((candidate) => candidate.count));
    rows = candidates.filter((candidate) => candidate.count === min).map((candidate) => candidate.row);
  }
  return rows.flatMap((row) => {
    const cell = state.config.board.rows[row]!.cells.findIndex((_, index) => cellMarkable(state, pending.player, row, index));
    return cell >= 0 ? [{ type: 'markForced', row, cell } as Action] : [];
  });
}

/**
 * 奖励格 (b, i) 对玩家 p 是否可划（不含"掷出对应数字"的触发条件，由调用方检查）：
 * 未划过、满足奖励行内从左到右、且相邻两普通格至少一个已被 p 划过。
 * 奖励行不受行锁定影响（官方规则：相邻行锁定后奖励格仍可划）。
 */
function bonusCellMarkable(state: GameState, player: number, b: number, i: number): boolean {
  const bonusDef = state.config.board.bonusRows![b]!;
  const bm = state.players[player]!.bonusMarks[b]!;
  if (bm[i]) return false;
  for (let j = i + 1; j < bm.length; j++) if (bm[j]) return false; // 从左到右
  const [a0, a1] = bonusDef.adjacent;
  const pm = state.players[player]!.marks;
  return pm[a0]![i]! || pm[a1]![i]!;
}

/** Longo 幸运数字：玩家 p 可用的 markLucky 动作（白骰和等于其幸运数字时）。 */
function luckyActions(state: GameState, player: number): Action[] {
  const lucky = state.config.luckyNumbers?.[player];
  if (!lucky || !lucky.includes(whiteSum(state))) return [];
  // "当前划记最少的行"：在未锁定的行中取最小划记数，并列可任选。
  const counts: { row: number; count: number }[] = [];
  state.config.board.rows.forEach((_, r) => {
    if (!state.lockedRows[r]) {
      counts.push({ row: r, count: state.players[player]!.marks[r]!.filter(Boolean).length });
    }
  });
  if (counts.length === 0) return [];
  const min = Math.min(...counts.map((c) => c.count));
  const out: Action[] = [];
  for (const { row, count } of counts) {
    if (count !== min) continue;
    const target = rightmostMark(state, player, row) + 1; // "下一个可划的格子"（不跳格）
    if (target < state.config.board.rows[row]!.cells.length && cellMarkable(state, player, row, target)) {
      out.push({ type: 'markLucky', row });
    }
  }
  return out;
}

/** Big Points：白骰阶段玩家 p 可划的奖励格。 */
function bonusWhiteActions(state: GameState, player: number): Action[] {
  const out: Action[] = [];
  const sum = whiteSum(state);
  (state.config.board.bonusRows ?? []).forEach((bonusDef, b) => {
    bonusDef.numbers.forEach((n, i) => {
      if (n === sum && bonusCellMarkable(state, player, b, i)) {
        out.push({ type: 'markBonusWhite', bonus: b, cell: i });
      }
    });
  });
  return out;
}

/**
 * Big Points：彩骰阶段主动玩家可划的奖励格。
 * 触发条件：某白骰 + 颜色 c 彩骰之和等于奖励格数字，且相邻的 c 色普通格已被划过
 * （官方例：已划绿 10，再掷出"绿 10"即可划相邻奖励格）。
 */
function bonusColorActions(state: GameState): Action[] {
  const p = state.activePlayer;
  const out: Action[] = [];
  const seen = new Set<string>();
  (state.config.board.bonusRows ?? []).forEach((bonusDef, b) => {
    bonusDef.numbers.forEach((n, i) => {
      if (!bonusCellMarkable(state, p, b, i)) return;
      for (const w of state.dice.white) {
        for (const c of COLORS) {
          const dv = state.dice.colors[c];
          if (dv === undefined || w + dv !== n) continue;
          // 相邻普通格中颜色为 c 且已划过的才能作为触发
          const markedAdj = bonusDef.adjacent.some(
            (a) => state.config.board.rows[a]!.cells[i]!.color === c && state.players[p]!.marks[a]![i],
          );
          if (markedAdj) {
            const k = `${b}:${i}`;
            if (!seen.has(k)) {
              seen.add(k);
              out.push({ type: 'markBonusColor', bonus: b, cell: i });
            }
          }
        }
      }
    });
  });
  return out;
}

/** 当前决策者的所有合法动作（跳过永远合法）。 */
export function legalActions(state: GameState): Action[] {
  if (state.phase === 'gameOver') return [];
  if (state.phase === 'bonusChoice') return forcedActions(state);
  if (state.phase === 'whiteChoice') {
    const p = state.whiteQueue[0]!;
    const marks = markableCells(state, p, whiteSum(state));
    return [
      ...marks.map((m): Action => ({ type: 'markWhite', row: m.row, cell: m.cell })),
      ...doubleLatestActions(state, p, 'white'),
      ...exchangeActions(state, p),
      ...luckyActions(state, p),
      ...bonusWhiteActions(state, p),
      { type: 'skipWhite' },
    ];
  }
  const marks = colorMarkableCells(state);
  return [
    ...marks.map((m): Action => ({ type: 'markColor', row: m.row, cell: m.cell })),
    ...doubleLatestActions(state, state.activePlayer, 'color'),
    ...bonusColorActions(state),
    { type: 'skipColor' },
  ];
}

export function isLegal(state: GameState, action: Action): boolean {
  const key = JSON.stringify(actionIdentity(action));
  return legalActions(state).some((a) => JSON.stringify(actionIdentity(a)) === key);
}

function actionIdentity(a: Action): unknown[] {
  switch (a.type) {
    case 'markWhite':
    case 'markColor':
    case 'markDoubleWhite':
    case 'markDoubleColor':
    case 'markForced':
      return [a.type, a.row, a.cell];
    case 'markWhiteExchange':
      return [a.type, a.row, a.cell, a.swap];
    case 'markLucky':
      return [a.type, a.row];
    case 'markBonusWhite':
    case 'markBonusColor':
      return [a.type, a.bonus, a.cell];
    default:
      return [a.type];
  }
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

/** 把动作落到玩家划记上；返回是否构成"划记"（决定失误判定）。 */
function performMark(state: GameState, player: number, action: Action): boolean {
  switch (action.type) {
    case 'markWhite':
    case 'markColor':
    case 'markWhiteExchange':
    case 'markForced':
      state.players[player]!.marks[action.row]![action.cell] = true;
      if (action.type === 'markWhiteExchange') state.players[player]!.variantState.xChangeThrough = action.swap;
      afterCellMarked(state, player, { row: action.row, cell: action.cell });
      return true;
    case 'markDoubleWhite':
    case 'markDoubleColor':
      state.players[player]!.secondMarks[action.row]![action.cell] = true;
      return true;
    case 'markLucky': {
      const target = rightmostMark(state, player, action.row) + 1;
      state.players[player]!.marks[action.row]![target] = true;
      afterCellMarked(state, player, { row: action.row, cell: target });
      return true;
    }
    case 'markBonusWhite':
    case 'markBonusColor':
      state.players[player]!.bonusMarks[action.bonus]![action.cell] = true;
      return true; // 只划奖励格也不算失误（官方规则）
    default:
      return false;
  }
}

function ensurePending(state: GameState, player: number): void {
  if (state.pendingBonus) return;
  const resume = state.phase === 'colorChoice' ? 'colorChoice' : 'whiteChoice';
  state.pendingBonus = { player, resume, effects: [] };
}

function afterCellMarked(state: GameState, player: number, ref: CellRef): void {
  const variant = state.config.board.variant;
  const p = state.players[player]!;
  if (!variant) return;

  if (variant.kind === 'double-b' && variant.multiplierCells.includes(ref.cell)) {
    p.secondMarks[ref.row]![ref.cell] = true;
    return;
  }

  if (variant.kind === 'connected-chain') {
    const other = chainPartner(state.config.board, player, ref);
    if (other) p.marks[other.row]![other.cell] = true;
    return;
  }

  if (variant.kind === 'bonus-a' && variant.triggerCells.some((trigger) => sameRef(trigger, ref))) {
    const used = p.variantState.bonusTrackUsed!;
    const index = nextRewardIndex(used);
    if (index >= 0) {
      used[index] = true;
      ensurePending(state, player);
      state.pendingBonus!.effects.push({ kind: 'row', row: COLORS.indexOf(variant.rewardTrack[index]!), remaining: 1 });
      state.phase = 'bonusChoice';
    }
    return;
  }

  if (variant.kind === 'bonus-b') {
    const activated = p.variantState.bonusSymbols!;
    for (const [symbol, pair] of Object.entries(variant.symbols) as [BonusSymbol, [CellRef, CellRef]][]) {
      if (activated[symbol] || !pair.some((item) => sameRef(item, ref))) continue;
      if (!pair.every((item) => p.marks[item.row]![item.cell])) continue;
      activated[symbol] = true;
      if (symbol === 'circle') {
        ensurePending(state, player);
        state.pendingBonus!.effects.push({ kind: 'fewest', remaining: 2 });
      } else if (symbol === 'diamond') {
        ensurePending(state, player);
        for (let row = 0; row < 4; row++) state.pendingBonus!.effects.push({ kind: 'row', row, remaining: 1 });
      }
    }
    if (state.pendingBonus?.effects.length) state.phase = 'bonusChoice';
  }
}

function hasMarkableInRow(state: GameState, player: number, row: number): boolean {
  return state.config.board.rows[row]!.cells.some((_, cell) => cellMarkable(state, player, row, cell));
}

function discardImpossibleEffects(state: GameState): void {
  const pending = state.pendingBonus;
  if (!pending) return;
  while (pending.effects.length > 0) {
    const effect = pending.effects[0]!;
    if (effect.kind === 'row' || effect.row !== undefined) {
      const row = effect.kind === 'row' ? effect.row : effect.row!;
      if (hasMarkableInRow(state, pending.player, row)) break;
      pending.effects.shift();
      continue;
    }
    const any = state.config.board.rows.some((_, row) => !state.lockedRows[row] && hasMarkableInRow(state, pending.player, row));
    if (any) break;
    pending.effects.shift();
  }
  if (pending.effects.length === 0) finishPending(state);
}

function finishWhiteDecision(state: GameState): void {
  state.phase = 'whiteChoice';
  if (state.whiteQueue.length > 0) return;
  resolveLocks(state);
  if (checkGameEnd(state)) return;
  state.phase = 'colorChoice';
}

function finishColorDecision(state: GameState): void {
  state.phase = 'colorChoice';
  if (!state.activeMarked) state.players[state.activePlayer]!.penalties += 1;
  resolveLocks(state);
  if (checkGameEnd(state)) return;
  state.activePlayer = (state.activePlayer + 1) % state.config.numPlayers;
  state.turn += 1;
  rollDice(state);
  resetQueue(state);
}

function finishPending(state: GameState): void {
  const resume = state.pendingBonus!.resume;
  delete state.pendingBonus;
  if (resume === 'whiteChoice') finishWhiteDecision(state);
  else finishColorDecision(state);
}

/** 原地应用动作（供高吞吐自对弈使用）。调用方需保证动作合法。 */
export function applyActionInPlace(state: GameState, action: Action): void {
  if (state.phase === 'bonusChoice') {
    const pending = state.pendingBonus!;
    const effect = pending.effects[0]!;
    if (effect.kind === 'fewest' && effect.row === undefined) effect.row = action.type === 'markForced' ? action.row : undefined;
    performMark(state, pending.player, action);
    effect.remaining -= 1;
    if (effect.remaining <= 0) pending.effects.shift();
    discardImpossibleEffects(state);
    return;
  }
  if (state.phase === 'whiteChoice') {
    const p = state.whiteQueue.shift()!;
    if (performMark(state, p, action) && p === state.activePlayer) state.activeMarked = true;
    if (state.pendingBonus) return;
    finishWhiteDecision(state);
    return;
  }
  if (state.phase === 'colorChoice') {
    if (performMark(state, state.activePlayer, action)) state.activeMarked = true;
    if (state.pendingBonus) return;
    finishColorDecision(state);
    return;
  }
  throw new Error('game is over');
}

/**
 * 锁定结算：任何玩家划了某行行尾锁定格（尾部 lockableTail 格之一）→ 该行锁定，
 * 对应彩骰立即移出（本回合动作 2 也不可再用）。
 */
function resolveLocks(state: GameState): void {
  const tail = state.config.board.lockableTail ?? 1;
  state.config.board.rows.forEach((rowDef, r) => {
    if (state.lockedRows[r]) return;
    const len = rowDef.cells.length;
    const lockedByAnyone = state.players.some((pl) => {
      for (let i = len - tail; i < len; i++) if (pl.marks[r]![i]) return true;
      return false;
    });
    if (lockedByAnyone) {
      state.lockedRows[r] = true;
      if (!state.removedColors.includes(rowDef.lockColor)) {
        state.removedColors.push(rowDef.lockColor);
      }
      delete state.dice.colors[rowDef.lockColor];
      const variant = state.config.board.variant;
      if (variant?.kind === 'bonus-a') {
        state.players.forEach((player) => {
          variant.rewardTrack.forEach((color, index) => {
            if (color === rowDef.lockColor) player.variantState.bonusTrackUsed![index] = true;
          });
        });
      }
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
