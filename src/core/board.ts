import type { BoardDef, Cell, Color, RowDef } from './types';
import { COLORS } from './types';
import { nextRand } from './rng';

function row(color: Color, numbers: number[]): RowDef {
  const cells: Cell[] = numbers.map((n) => ({ color, number: n }));
  return { cells, lockColor: color };
}

const ASC = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DESC = [...ASC].reverse();

/** 经典记分卡：红黄 2→12，绿蓝 12→2，按行计分。 */
export const CLASSIC_BOARD: BoardDef = {
  id: 'classic',
  name: '经典 Qwixx',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
};

/**
 * gemixxt / Qwixx Mixx 变体 A：数字顺序与经典版一致（上两行 2→12，下两行 12→2），
 * 但行内颜色混排；锁定某行时移除"该行最右格颜色"的骰子；计分仍按行（官方规则）。
 * 此布局满足官方约束（同一数字在四行中恰好四色各一、四行锁定色互不相同），
 * 但格子的具体颜色排布为本项目自拟，非官方卡面扫描。
 */
export const GEMIXXT_A_BOARD: BoardDef = {
  id: 'gemixxt-a',
  name: 'gemixxt 变体 A（混色·数字有序）',
  rows: [
    zipRow(ASC, ['yellow', 'blue', 'red', 'green', 'yellow', 'blue', 'green', 'yellow', 'red', 'green', 'red']),
    zipRow(ASC, ['red', 'green', 'blue', 'yellow', 'green', 'red', 'blue', 'green', 'yellow', 'blue', 'yellow']),
    zipRow(DESC, ['blue', 'red', 'green', 'blue', 'yellow', 'green', 'red', 'blue', 'yellow', 'red', 'green']),
    zipRow(DESC, ['green', 'yellow', 'blue', 'red', 'red', 'yellow', 'blue', 'red', 'green', 'yellow', 'blue']),
  ],
  scoreBy: 'row',
};

/**
 * gemixxt / Qwixx Mixx 变体 B：四行仍是整行单色，但行内数字乱序；
 * 锁定数字按官方卡面为红 11、黄 10、绿 3、蓝 4；计分按行（官方规则）。
 * 行内数字的具体排列为本项目自拟（官方仅确认最右端数字），非官方卡面扫描。
 */
export const GEMIXXT_B_BOARD: BoardDef = {
  id: 'gemixxt-b',
  name: 'gemixxt 变体 B（单色·数字乱序）',
  rows: [
    row('red', [5, 2, 9, 6, 12, 3, 8, 10, 4, 7, 11]),
    row('yellow', [8, 11, 3, 6, 9, 2, 12, 5, 7, 4, 10]),
    row('green', [10, 5, 12, 7, 4, 9, 2, 11, 6, 8, 3]),
    row('blue', [7, 12, 9, 3, 11, 2, 10, 6, 8, 5, 4]),
  ],
  scoreBy: 'row',
};

function zipRow(numbers: number[], colors: Color[]): RowDef {
  if (numbers.length !== colors.length) throw new Error('row definition length mismatch');
  const cells: Cell[] = numbers.map((n, i) => ({ color: colors[i]!, number: n }));
  return { cells, lockColor: cells[cells.length - 1]!.color };
}

/**
 * 随机混排记分卡生成器（非官方 house 变体）：
 * 每种颜色恰好出现 11 次、每行数字为 2..12 的一个排列，按行计分。
 */
export function randomMixedBoard(seed: number): BoardDef {
  let s = seed | 0;
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const r = nextRand(s);
      s = r.state;
      const j = Math.floor(r.value * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const colorPool: Color[] = shuffle(COLORS.flatMap((c) => Array<Color>(11).fill(c)));
  const rows: RowDef[] = [];
  for (let r = 0; r < 4; r++) {
    const numbers = shuffle(ASC);
    const colors = colorPool.slice(r * 11, (r + 1) * 11);
    rows.push(zipRow(numbers, colors));
  }
  return { id: `random-${seed}`, name: `随机混排 #${seed}`, rows, scoreBy: 'row' };
}

export const BOARD_PRESETS: Record<string, BoardDef> = {
  classic: CLASSIC_BOARD,
  'gemixxt-a': GEMIXXT_A_BOARD,
  'gemixxt-b': GEMIXXT_B_BOARD,
};

/** 校验棋盘定义的基本合法性（行数、格数、颜色计数）。 */
export function validateBoard(board: BoardDef): void {
  if (board.rows.length !== 4) throw new Error('board must have 4 rows');
  for (const r of board.rows) {
    if (r.cells.length !== 11) throw new Error('each row must have 11 cells');
    for (const c of r.cells) {
      if (c.number < 2 || c.number > 12) throw new Error('cell numbers must be 2..12');
    }
  }
  if (board.scoreBy === 'color') {
    const counts = new Map<Color, number>();
    for (const r of board.rows) for (const c of r.cells) counts.set(c.color, (counts.get(c.color) ?? 0) + 1);
    for (const c of COLORS) {
      if (counts.get(c) !== 11) throw new Error(`color ${c} must appear exactly 11 times`);
    }
  }
}
