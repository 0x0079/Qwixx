/** Qwixx 核心类型定义。引擎为纯函数式状态机，便于 AI 训练与回放。 */

export type Color = 'red' | 'yellow' | 'green' | 'blue';

export const COLORS: readonly Color[] = ['red', 'yellow', 'green', 'blue'];

/** 记分卡上的一个格子：颜色 + 数字。 */
export interface Cell {
  color: Color;
  number: number;
}

/** 一行格子（从左到右）。锁定该行时，从游戏中移除 lockColor 对应的彩色骰。 */
export interface RowDef {
  cells: Cell[];
  lockColor: Color;
}

/**
 * 记分卡（棋盘）定义。
 * scoreBy = 'row'：按行计数得分（经典版）；
 * scoreBy = 'color'：按颜色计数得分（gemixxt 混色变体）。
 */
export interface BoardDef {
  id: string;
  name: string;
  rows: RowDef[];
  scoreBy: 'row' | 'color';
}

export interface RulesConfig {
  board: BoardDef;
  numPlayers: number;
  /** 失误上限，达到即结束游戏（经典 4）。 */
  maxPenalties: number;
  /** 每个失误扣分（经典 5）。 */
  penaltyPoints: number;
  /** 划最右端格子（锁定）所需的本行/本组已划数量（经典 5）。 */
  minMarksToLock: number;
  /** 锁定多少行后游戏结束（经典 2）。 */
  locksToEnd: number;
  seed: number;
}

export interface Dice {
  white: [number, number];
  /** 仍在场上的彩色骰的点数；被移除的颜色不出现。 */
  colors: Partial<Record<Color, number>>;
}

export interface PlayerState {
  /** marks[row][cell] 是否已划记。 */
  marks: boolean[][];
  penalties: number;
}

/**
 * 回合阶段：
 * - whiteChoice：按 whiteQueue 顺序，每名玩家决定是否用双白骰之和划记（所有人都可用）。
 * - colorChoice：主动玩家决定是否用 1 白 + 1 彩的组合划记。
 * - gameOver：游戏结束。
 * 锁定与骰子移除在回合结束时统一生效（官方规则：同一回合内所有行动视为同时发生）。
 */
export type Phase = 'whiteChoice' | 'colorChoice' | 'gameOver';

export interface GameState {
  config: RulesConfig;
  players: PlayerState[];
  /** 回合开始时已生效的锁定行。 */
  lockedRows: boolean[];
  /** 已移除的彩色骰。 */
  removedColors: Color[];
  activePlayer: number;
  dice: Dice;
  phase: Phase;
  /** 尚未做白骰决定的玩家（队首为当前决策者）。 */
  whiteQueue: number[];
  /** 主动玩家本回合是否已划记（未划记则回合结束记失误）。 */
  activeMarked: boolean;
  turn: number;
  rngState: number;
  /** 游戏结束时填充：每名玩家的总分。 */
  finalScores?: number[];
  /** 游戏结束时填充：得分最高的玩家（可并列）。 */
  winners?: number[];
}

export type Action =
  | { type: 'markWhite'; row: number; cell: number }
  | { type: 'skipWhite' }
  | { type: 'markColor'; row: number; cell: number }
  | { type: 'skipColor' };

export function actionKey(a: Action): string {
  return a.type === 'markWhite' || a.type === 'markColor'
    ? `${a.type}:${a.row}:${a.cell}`
    : a.type;
}
