import type { Action, GameState } from '../core/types';
import { legalActions, rightmostMark } from '../core/engine';
import { effectiveRowCount } from '../core/scoring';
import { nextRand } from '../core/rng';

/**
 * 机器人接口：给定状态与合法动作，返回一个动作。
 * rand() 由调用方注入（0~1 均匀），保证对局可复现。
 */
export interface Bot {
  readonly name: string;
  chooseAction(state: GameState, playerId: number, rand: () => number): Action;
}

/** 创建基于种子的 rand() 闭包。 */
export function makeRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    const r = nextRand(s);
    s = r.state;
    return r.value;
  };
}

type MarkAction = Exclude<Action, { type: 'skipWhite' } | { type: 'skipColor' }>;

/** 玩家某计分组当前的边际计数（scoreBy='color' 时按颜色统计）。 */
function groupCount(state: GameState, player: number, row: number, cell: number): number {
  const { board } = state.config;
  if (board.scoreBy === 'row') return effectiveRowCount(state, player, row);
  const color = board.rows[row]!.cells[cell]!.color;
  let count = 0;
  board.rows.forEach((rd, r) =>
    rd.cells.forEach((c, i) => {
      if (c.color === color && state.players[player]!.marks[r]![i]) count++;
    }),
  );
  return count;
}

/** 划记动作的启发式评估要素：边际得分、跳格数、是否锁行。 */
function evaluateMark(
  state: GameState,
  player: number,
  action: MarkAction,
): { gain: number; skipped: number; locks: boolean } {
  const { board } = state.config;

  if (action.type === 'markBonusWhite' || action.type === 'markBonusColor') {
    // 奖励格：计入相邻两行，各行边际 +1。
    const bonusDef = board.bonusRows![action.bonus]!;
    const bm = state.players[player]!.bonusMarks[action.bonus]!;
    let rightmost = -1;
    for (let i = bm.length - 1; i >= 0; i--) if (bm[i]) { rightmost = i; break; }
    const skipped = action.cell - rightmost - 1;
    let gain = 0;
    const cap = board.scoreCap ?? Infinity;
    for (const adj of bonusDef.adjacent) {
      const n = effectiveRowCount(state, player, adj);
      if (n < cap) gain += n + 1;
    }
    return { gain, skipped, locks: false };
  }

  const row = action.row;
  const cell = action.type === 'markLucky' ? rightmostMark(state, player, row) + 1 : action.cell;
  const skipped = action.type === 'markLucky' ? 0 : cell - rightmostMark(state, player, row) - 1;
  const count = groupCount(state, player, row, cell);
  const tail = board.lockableTail ?? 1;
  const isLock = cell >= board.rows[row]!.cells.length - tail;
  // 边际得分：第 n+1 个划记价值 n+1 分；锁定格额外再 +1 个计数（再 +n+2 分）。
  const gain = count + 1 + (isLock ? count + 2 : 0);
  return { gain, skipped, locks: isLock };
}

function isSkip(a: Action): boolean {
  return a.type === 'skipWhite' || a.type === 'skipColor';
}

/** 随机机器人：在合法动作中等概率选择。 */
export class RandomBot implements Bot {
  readonly name = 'random';
  chooseAction(state: GameState, _playerId: number, rand: () => number): Action {
    const legal = legalActions(state);
    return legal[Math.floor(rand() * legal.length)]!;
  }
}

/** 贪心机器人：只要不跳格太多（skipped<=1）就划边际得分最高的格。 */
export class GreedyBot implements Bot {
  readonly name = 'greedy';
  constructor(private maxSkip = 1) {}
  chooseAction(state: GameState, playerId: number, _rand: () => number): Action {
    const legal = legalActions(state);
    let best: Action | undefined;
    let bestVal = -Infinity;
    for (const a of legal) {
      if (isSkip(a)) continue;
      const e = evaluateMark(state, playerId, a as MarkAction);
      if (e.skipped > this.maxSkip) continue;
      const val = e.gain - 2 * e.skipped;
      if (val > bestVal) {
        bestVal = val;
        best = a;
      }
    }
    if (best) return best;
    // 主动玩家彩骰阶段仍未划记 → 宁可多跳格也要避免 -5 失误。
    if (state.phase === 'colorChoice' && !state.activeMarked) {
      let fallback: Action | undefined;
      let fbVal = -Infinity;
      for (const a of legal) {
        if (isSkip(a)) continue;
        const e = evaluateMark(state, playerId, a as MarkAction);
        const val = e.gain - 2 * e.skipped;
        if (val > fbVal) {
          fbVal = val;
          fallback = a;
        }
      }
      if (fallback && fbVal > -state.config.penaltyPoints) return fallback;
    }
    return legal[legal.length - 1]!; // skip
  }
}

/**
 * 启发式机器人：
 * - 价值 = 边际得分 + 划记建设价值 - 跳格代价（随进度放宽）+ 锁行奖励；
 * - 硬性跳格上限（随进度放宽），锁行或被迫划记时豁免；
 * - 主动玩家避免失误：只要有代价低于 5 分的划法就不吃失误。
 */
export class HeuristicBot implements Bot {
  readonly name = 'heuristic';
  /**
   * wSkip：每跳过一格的代价；markBonus：划记本身的建设性价值
   * （推动锁行、压缩终局，实验表明积极划记在 2 人局中显著更强）。
   */
  constructor(private wSkip = 1.8, private markBonus = 1, private baseMaxSkip = 1) {}

  private progress(state: GameState): number {
    // 0~1 的粗略进度：锁定行数、最大失误数、各玩家划记总量。
    const cells = state.config.board.rows[0]!.cells.length * 4;
    const locks = state.lockedRows.filter(Boolean).length / state.config.locksToEnd;
    const pen = Math.max(...state.players.map((p) => p.penalties)) / state.config.maxPenalties;
    const marks =
      Math.max(...state.players.map((p) => p.marks.flat().filter(Boolean).length)) / (cells * 0.68);
    return Math.min(1, Math.max(locks, pen, marks));
  }

  chooseAction(state: GameState, playerId: number, _rand: () => number): Action {
    const legal = legalActions(state);
    const prog = this.progress(state);
    const tolerance = this.wSkip * (1 - 0.5 * prog); // 后期跳格代价降低
    const maxSkip = this.baseMaxSkip + Math.round(2 * prog); // 后期允许跳更多格
    const isActive = playerId === state.activePlayer;
    const mustMark = isActive && state.phase === 'colorChoice' && !state.activeMarked;

    let best: Action | undefined;
    let bestVal = -Infinity;
    for (const a of legal) {
      if (isSkip(a)) continue;
      const e = evaluateMark(state, playerId, a as MarkAction);
      if (e.skipped > maxSkip && !e.locks && !mustMark) continue; // 硬性跳格上限
      let val = e.gain + this.markBonus - tolerance * e.skipped;
      if (e.locks) val += 3; // 锁行既加分也压缩对手空间
      if (val > bestVal) {
        bestVal = val;
        best = a;
      }
    }

    // 通过阈值：非主动玩家跳过无代价，主动玩家白骰阶段还有彩骰机会。
    let threshold = 0;
    if (isActive && state.phase === 'whiteChoice') {
      threshold = -0.5;
    }
    if (mustMark) {
      threshold = -(state.config.penaltyPoints - 0.5); // 几乎任何划法都好过失误
    }

    if (best && bestVal > threshold) return best;
    return legal[legal.length - 1]!; // skip
  }
}

export const BOT_REGISTRY: Record<string, () => Bot> = {
  random: () => new RandomBot(),
  greedy: () => new GreedyBot(),
  heuristic: () => new HeuristicBot(),
};
