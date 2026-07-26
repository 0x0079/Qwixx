/**
 * 变体连锁关系的只读查询。
 *
 * 引擎在 `afterCellMarked` / `resolveLocks` 里“执行”这些连锁效果，但玩家在划记之前
 * 就需要知道效果是什么（会得到哪种颜色、会自动划到哪一格、还剩几次交换）。这里把
 * 那份推导单独抽出来，UI 与引擎共用同一份定义，避免两边各写一套而逐渐失配。
 */

import type { BoardDef, BonusSymbol, CellRef, Color, GameState } from './types';
import { COLORS } from './types';

export function sameRef(a: CellRef, b: CellRef): boolean {
  return a.row === b.row && a.cell === b.cell;
}

/** Bonus A 奖励轨上的一格。 */
export interface RewardSlot {
  index: number;
  color: Color;
  /** 该行行号（奖励轨按颜色追加划记，颜色即行）。 */
  row: number;
  /** 已被消费，或因该颜色行锁定而作废。 */
  used: boolean;
  /** 因所属颜色行被锁定而作废（区别于“已经用掉”）。 */
  voided: boolean;
  /** 下一次触发奖励格会拿到这一格。 */
  isNext: boolean;
}

/** 奖励轨上下一个可用格的下标；全部用完时返回 -1。引擎消费顺序的唯一定义。 */
export function nextRewardIndex(used: readonly boolean[]): number {
  return used.findIndex((value) => !value);
}

/** 玩家当前的奖励轨状态；非 Bonus A 棋盘返回空数组。 */
export function rewardTrack(state: GameState, player: number): RewardSlot[] {
  const variant = state.config.board.variant;
  if (variant?.kind !== 'bonus-a') return [];
  const used = state.players[player]!.variantState.bonusTrackUsed ?? [];
  const next = nextRewardIndex(used);
  return variant.rewardTrack.map((color, index) => {
    const row = COLORS.indexOf(color);
    return {
      index,
      color,
      row,
      used: used[index] ?? false,
      voided: (used[index] ?? false) && (state.lockedRows[row] ?? false),
      isNext: index === next,
    };
  });
}

/** 下一次触发 Bonus A 奖励格会追加划记的颜色；奖励轨用尽时为 undefined。 */
export function nextRewardColor(state: GameState, player: number): Color | undefined {
  return rewardTrack(state, player).find((slot) => slot.isNext)?.color;
}

/** 某格是否为 Bonus A 的奖励触发格。 */
export function isRewardTrigger(board: BoardDef, ref: CellRef): boolean {
  const variant = board.variant;
  return variant?.kind === 'bonus-a' && variant.triggerCells.some((trigger) => sameRef(trigger, ref));
}

/** Connected B 的一对连锁格。 */
export interface ChainLink {
  index: number;
  ends: [CellRef, CellRef];
}

/** 玩家所用卡面（按座位轮换）上的全部连锁对。 */
export function chainLinks(board: BoardDef, player: number): ChainLink[] {
  const variant = board.variant;
  if (variant?.kind !== 'connected-chain') return [];
  const sheet = variant.sheets[player % variant.sheets.length]!;
  return sheet.map((ends, index) => ({ index, ends }));
}

/** 划下 ref 会被自动连带划记的另一端；ref 不在任何连锁对上时为 undefined。 */
export function chainPartner(board: BoardDef, player: number, ref: CellRef): CellRef | undefined {
  const link = chainLinks(board, player).find(({ ends }) => ends.some((end) => sameRef(end, ref)));
  if (!link) return undefined;
  return sameRef(link.ends[0], ref) ? link.ends[1] : link.ends[0];
}

/** Bonus B 的一对同符号格。 */
export interface SymbolPair {
  symbol: BonusSymbol;
  ends: [CellRef, CellRef];
}

/** 棋盘上全部成对符号（按 symbols 定义顺序）。 */
export function symbolPairs(board: BoardDef): SymbolPair[] {
  const variant = board.variant;
  if (variant?.kind !== 'bonus-b') return [];
  return (Object.entries(variant.symbols) as [BonusSymbol, [CellRef, CellRef]][])
    .map(([symbol, ends]) => ({ symbol, ends }));
}

/** ref 所属的符号对；ref 上没有符号时为 undefined。 */
export function symbolPairAt(board: BoardDef, ref: CellRef): SymbolPair | undefined {
  return symbolPairs(board).find(({ ends }) => ends.some((end) => sameRef(end, ref)));
}

/** X-Change 交换轨上的一格。 */
export interface SwapSlot {
  index: number;
  pair: [number, number];
  /** 已被使用，或被跳过（X-Change 只能按顺序向后取用）。 */
  spent: boolean;
  /** 下一个仍可取用的交换。 */
  isNext: boolean;
  /** 本次白骰和正好命中这组交换，现在就能用。 */
  usableNow: boolean;
  /** 命中时白骰和会被换成的数字。 */
  exchangedTo?: number;
}

/** 玩家当前的交换轨状态；非 X-Change 棋盘返回空数组。 */
export function swapSlots(state: GameState, player: number, whiteSumValue: number): SwapSlot[] {
  const variant = state.config.board.variant;
  if (variant?.kind !== 'x-change') return [];
  const through = state.players[player]!.variantState.xChangeThrough ?? -1;
  const next = through + 1;
  return variant.swaps.map((pair, index) => {
    const [a, b] = pair;
    const exchangedTo = whiteSumValue === a ? b : whiteSumValue === b ? a : undefined;
    return {
      index,
      pair,
      spent: index <= through,
      isNext: index === next,
      usableNow: index > through && exchangedTo !== undefined,
      exchangedTo,
    };
  });
}

/** Connected A 的阶梯格（第五个计分组）。 */
export function stepCells(board: BoardDef, player: number): CellRef[] {
  const variant = board.variant;
  if (variant?.kind !== 'connected-steps') return [];
  return variant.sheets[player % variant.sheets.length]!;
}

/** Double A：玩家当前每行可以被划第二次的格子（还需骰子点数匹配才真正可选）。 */
export function doubleCandidates(state: GameState, player: number): CellRef[] {
  if (state.config.board.variant?.kind !== 'double-a') return [];
  const out: CellRef[] = [];
  state.config.board.rows.forEach((_, row) => {
    if (state.lockedRows[row]) return;
    const marks = state.players[player]!.marks[row]!;
    for (let cell = marks.length - 1; cell >= 0; cell--) {
      if (!marks[cell]) continue;
      if (!state.players[player]!.secondMarks[row]![cell]) out.push({ row, cell });
      break;
    }
  });
  return out;
}

/** 玩家使用的卡面编号（Connected A/E 五张卡按座位轮换）。 */
export function sheetLabel(board: BoardDef, player: number): string | undefined {
  const variant = board.variant;
  if (variant?.kind !== 'connected-steps' && variant?.kind !== 'connected-chain') return undefined;
  return String.fromCharCode(65 + (player % variant.sheets.length));
}
