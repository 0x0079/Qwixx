import type { Color, GameState } from './types';
import { COLORS } from './types';

/** 划 n 格得 n(n+1)/2 分：1,3,6,10,…,78（12x），Longo 延伸到 120（15x）。 */
export function pointsForCount(n: number): number {
  return (n * (n + 1)) / 2;
}

export interface ScoreBreakdown {
  /** 按计分组（行或颜色）的划记数量（锁定奖励与奖励格已计入，封顶后）。 */
  groupCounts: number[];
  /** 对应每组的得分。 */
  groupPoints: number[];
  /** 组标签（行号或颜色名）。 */
  groupLabels: string[];
  penalties: number;
  penaltyPoints: number;
  variantBonusPoints: number;
  total: number;
}

/**
 * 计分：
 * - scoreBy='row'：按行统计划记数（官方各版本均如此）；
 * - scoreBy='color'：按颜色统计划记数（自定义变体，不含奖励行）；
 * - 玩家亲手划下某行行尾锁定格 → 该行额外 +1（锁定符号的叉计入总数）；
 * - Big Points：奖励格计入相邻两行的划记数，每行最多计 scoreCap（15）个。
 */
export function computeScore(state: GameState, player: number): ScoreBreakdown {
  const { board } = state.config;
  const p = state.players[player]!;
  let labels: string[];
  let counts: number[];

  if (board.scoreBy === 'row') {
    labels = board.rows.map((_, i) => `row${i}`);
    counts = board.rows.map((_, r) => p.marks[r]!.filter(Boolean).length + p.secondMarks[r]!.filter(Boolean).length);
    const tail = board.lockableTail ?? 1;
    board.rows.forEach((rowDef, r) => {
      const len = rowDef.cells.length;
      for (let i = len - tail; i < len; i++) {
        if (p.marks[r]![i]) {
          counts[r]! += 1; // 锁定奖励
          break;
        }
      }
    });
    (board.bonusRows ?? []).forEach((bonusDef, b) => {
      const bonusCount = p.bonusMarks[b]!.filter(Boolean).length;
      for (const adj of bonusDef.adjacent) counts[adj]! += bonusCount;
    });
    if (board.scoreCap !== undefined) {
      counts = counts.map((c) => Math.min(c, board.scoreCap!));
    }
    if (board.variant?.kind === 'connected-steps') {
      const sheet = board.variant.sheets[player % board.variant.sheets.length]!;
      counts.push(sheet.filter(({ row, cell }) => p.marks[row]![cell]).length);
      labels.push('steps');
    }
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
  let variantBonusPoints = 0;
  const symbols = p.variantState.bonusSymbols;
  if (board.variant?.kind === 'bonus-b' && symbols) {
    if (symbols.square) {
      const min = Math.min(...counts.slice(0, 4));
      const row = counts.slice(0, 4).findIndex((count) => count === min);
      groupPoints[row]! *= 2;
    }
    if (symbols.octagon) variantBonusPoints += 13;
  }
  const penaltyPoints = board.variant?.kind === 'bonus-b' && symbols?.star
    ? 0
    : p.penalties * state.config.penaltyPoints;
  const total = groupPoints.reduce((a, b) => a + b, 0) + variantBonusPoints - penaltyPoints;
  return { groupCounts: counts, groupPoints, groupLabels: labels, penalties: p.penalties, penaltyPoints, variantBonusPoints, total };
}

/** 玩家某行的"有效计数"（含锁定奖励与奖励格、封顶前），供 AI 估值使用。 */
export function effectiveRowCount(state: GameState, player: number, row: number): number {
  const { board } = state.config;
  const p = state.players[player]!;
  let count = p.marks[row]!.filter(Boolean).length + p.secondMarks[row]!.filter(Boolean).length;
  (board.bonusRows ?? []).forEach((bonusDef, b) => {
    if (bonusDef.adjacent.includes(row)) count += p.bonusMarks[b]!.filter(Boolean).length;
  });
  return count;
}
