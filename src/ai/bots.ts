import type { Action, GameState } from '../core/types';
import { legalActions, whiteSum } from '../core/engine';
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

/** 玩家在某行当前最右划记的位置（无则 -1）。 */
function rightmost(state: GameState, player: number, row: number): number {
  const marks = state.players[player]!.marks[row]!;
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i]) return i;
  return -1;
}

/** 划记动作的启发式评估要素。 */
function evaluateMark(
  state: GameState,
  player: number,
  action: Extract<Action, { type: 'markWhite' | 'markColor' }>,
): { gain: number; skipped: number; locks: boolean } {
  const { board } = state.config;
  const rowDef = board.rows[action.row]!;
  const cell = rowDef.cells[action.cell]!;
  const skipped = action.cell - rightmost(state, player, action.row) - 1;

  // 当前计分组内已划数量（决定边际得分 n+1）。
  let count = 0;
  if (board.scoreBy === 'row') {
    count = state.players[player]!.marks[action.row]!.filter(Boolean).length;
  } else {
    board.rows.forEach((rd, r) =>
      rd.cells.forEach((c, i) => {
        if (c.color === cell.color && state.players[player]!.marks[r]![i]) count++;
      }),
    );
  }
  const isLock = action.cell === rowDef.cells.length - 1;
  // 边际得分：第 n+1 个划记价值 n+1 分；锁定格额外再 +1 个计数（再 +n+2 分）。
  const gain = count + 1 + (isLock ? count + 2 : 0);
  return { gain, skipped, locks: isLock };
}

/** 随机机器人：在合法动作中等概率选择。 */
export class RandomBot implements Bot {
  readonly name = 'random';
  chooseAction(state: GameState, _playerId: number, rand: () => number): Action {
    const legal = legalActions(state);
    return legal[Math.floor(rand() * legal.length)]!;
  }
}

/** 贪心机器人：只要不跳格（skipped<=1 且非主动过多）就划边际得分最高的格。 */
export class GreedyBot implements Bot {
  readonly name = 'greedy';
  constructor(private maxSkip = 1) {}
  chooseAction(state: GameState, playerId: number, _rand: () => number): Action {
    const legal = legalActions(state);
    let best: Action | undefined;
    let bestVal = -Infinity;
    for (const a of legal) {
      if (a.type === 'skipWhite' || a.type === 'skipColor') continue;
      const e = evaluateMark(state, playerId, a);
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
        if (a.type !== 'markColor') continue;
        const e = evaluateMark(state, playerId, a);
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
 * - 价值 = 边际得分 - w_skip * 跳格数，随游戏进程放宽跳格容忍度；
 * - 白骰阶段主动玩家会考虑彩骰阶段仍有机会，阈值略高；
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
    const locks = state.lockedRows.filter(Boolean).length / state.config.locksToEnd;
    const pen = Math.max(...state.players.map((p) => p.penalties)) / state.config.maxPenalties;
    const marks =
      Math.max(...state.players.map((p) => p.marks.flat().filter(Boolean).length)) / 30;
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
      if (a.type === 'skipWhite' || a.type === 'skipColor') continue;
      const e = evaluateMark(state, playerId, a);
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
      // 若白骰不划，彩骰阶段没划成则 -5；这里保守一点，稍降门槛。
      threshold = -0.5;
    }
    if (isActive && state.phase === 'colorChoice' && !state.activeMarked) {
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
