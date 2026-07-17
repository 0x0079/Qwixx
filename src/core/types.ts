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
 * 奖励行（Qwixx Big Points）：一排圆形双色格，夹在 adjacent 指定的两行之间，
 * 第 i 格与两行的第 i 格相邻（经典布局下三者数字相同）。
 * 奖励格不单独计分、不参与锁行，但计入相邻两行的划记总数。
 */
export interface BonusRowDef {
  adjacent: [number, number];
  numbers: number[];
}

/**
 * 记分卡（棋盘）定义。
 * scoreBy = 'row'：按行计数得分（官方各版本均如此）；
 * scoreBy = 'color'：按颜色计数得分（自定义变体）。
 */
export interface BoardDef {
  id: string;
  name: string;
  rows: RowDef[];
  scoreBy: 'row' | 'color';
  /** 行尾可锁定格数：划其中任意一格即锁行（经典 1，Longo 2）。缺省 1。 */
  lockableTail?: number;
  /** 每个计分组最多计入的划记数（Big Points 为 15）。缺省不封顶。 */
  scoreCap?: number;
  /** 奖励行（Big Points）。 */
  bonusRows?: BonusRowDef[];
  /** 该棋盘建议的规则覆盖（骰面数、锁行门槛等），由 configForBoard 合并。 */
  rulesOverrides?: Partial<Pick<RulesConfig, 'dieFaces' | 'minMarksToLock'>>;
  /** 是否启用幸运数字（Longo）：每名玩家分到 2 个幸运数字。 */
  luckyNumbers?: boolean;
}

export interface RulesConfig {
  board: BoardDef;
  numPlayers: number;
  /** 失误上限，达到即结束游戏（经典 4）。 */
  maxPenalties: number;
  /** 每个失误扣分（经典 5）。 */
  penaltyPoints: number;
  /** 划行尾锁定格所需的本行已划数量（经典 5，Longo 6）。 */
  minMarksToLock: number;
  /** 锁定多少行后游戏结束（经典 2）。 */
  locksToEnd: number;
  /** 每颗骰子的面数（经典 6，Longo 8；点数 1..dieFaces）。 */
  dieFaces: number;
  /** 每名玩家的幸运数字（Longo）；无此机制时为 undefined。 */
  luckyNumbers?: number[][];
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
  /** bonusMarks[bonusRow][cell] 是否已划记（无奖励行时为空数组）。 */
  bonusMarks: boolean[][];
  penalties: number;
}

/**
 * 回合阶段：
 * - whiteChoice：按 whiteQueue 顺序，每名玩家决定是否用双白骰之和划记（所有人都可用）。
 * - colorChoice：主动玩家决定是否用 1 白 + 1 彩的组合划记。
 * - gameOver：游戏结束。
 * 锁定与骰子移除在白骰窗口全员结算完毕后立即生效（官方规则）。
 */
export type Phase = 'whiteChoice' | 'colorChoice' | 'gameOver';

export interface GameState {
  config: RulesConfig;
  players: PlayerState[];
  /** 已生效的锁定行。 */
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
  /** 白骰阶段：用双白骰之和划普通格。 */
  | { type: 'markWhite'; row: number; cell: number }
  /** 白骰阶段（Longo）：白骰和为幸运数字时，改划"划记最少的行"的下一格。 */
  | { type: 'markLucky'; row: number }
  /** 白骰阶段（Big Points）：白骰和触发奖励格。 */
  | { type: 'markBonusWhite'; bonus: number; cell: number }
  | { type: 'skipWhite' }
  /** 彩骰阶段（仅主动玩家）：1 白 + 1 彩划对应颜色普通格。 */
  | { type: 'markColor'; row: number; cell: number }
  /** 彩骰阶段（Big Points）：彩骰组合触发奖励格。 */
  | { type: 'markBonusColor'; bonus: number; cell: number }
  | { type: 'skipColor' };

export function actionKey(a: Action): string {
  switch (a.type) {
    case 'markWhite':
    case 'markColor':
      return `${a.type}:${a.row}:${a.cell}`;
    case 'markLucky':
      return `${a.type}:${a.row}`;
    case 'markBonusWhite':
    case 'markBonusColor':
      return `${a.type}:${a.bonus}:${a.cell}`;
    default:
      return a.type;
  }
}
