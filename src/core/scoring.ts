import type { Color, GameState } from './types';
import { COLORS } from './types';

/** 划 n 格得 n(n+1)/2 分：1,3,6,10,15,21,28,36,45,55,66,78。 */
export function pointsForCount(n: number): number {
  return (n * (n + 1)) / 2;
}

export interface ScoreBreakdown {
  /** 按计分组（行或颜色）的划记数量（锁定奖励已计入 +1）。 */
  groupCounts: number[];
  /** 对应每组的得分。 */
  groupPoints: number[];
  /** 组标签（行号或颜色名）。 */
  groupLabels: string[];
  penalties: number;
  penaltyPoints: number;
  total: number;
}

/**
 * 计分：
 * - scoreBy='row'：按行统计划记数；
 * - scoreBy='color'：按颜色统计划记数（gemixxt）；
 * - 玩家亲手划下某行最右格（锁定格）→ 该格所属计分组额外 +1（锁定奖励）。
 */
export function computeScore(state: GameState, player: number): ScoreBreakdown {
  const { board } = state.config;
  const p = state.players[player]!;
  let labels: string[];
  let counts: number[];

  if (board.scoreBy === 'row') {
    labels = board.rows.map((_, i) => `row${i}`);
    counts = board.rows.map((_, r) => p.marks[r]!.filter(Boolean).length);
    board.rows.forEach((rowDef, r) => {
      const last = rowDef.cells.length - 1;
      if (p.marks[r]![last]) counts[r]! += 1; // 锁定奖励
    });
  } else {
    labels = [...COLORS];
    const idx = new Map<Color, number>(COLORS.map((c, i) => [c, i]));
    counts = COLORS.map(() => 0);
    board.rows.forEach((rowDef, r) => {
      rowDef.cells.forEach((cell, i) => {
        if (p.marks[r]![i]) {
          counts[idx.get(cell.color)!]! += 1;
          if (i === rowDef.cells.length - 1) counts[idx.get(cell.color)!]! += 1; // 锁定奖励
        }
      });
    });
  }

  const groupPoints = counts.map(pointsForCount);
  const penaltyPoints = p.penalties * state.config.penaltyPoints;
  const total = groupPoints.reduce((a, b) => a + b, 0) - penaltyPoints;
  return { groupCounts: counts, groupPoints, groupLabels: labels, penalties: p.penalties, penaltyPoints, total };
}
