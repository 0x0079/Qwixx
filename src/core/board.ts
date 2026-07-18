import type { BoardDef, Cell, CellRef, Color, RowDef } from './types';
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

const LONGO_ASC = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LONGO_DESC = [...LONGO_ASC].reverse();

/**
 * Qwixx Longo（NSV 2021，官方规则 QwixxLongo_GB.pdf）：
 * 八面骰（1..8）；四行 2→16 / 16→2 共 15 格；行尾最后两个数字任一可锁行，
 * 锁行门槛提高为已划 ≥6；每名玩家有 2 个幸运数字——白骰和等于幸运数字时，
 * 可改划"当前划记最少的行"的下一个可划格。计分表延续三角数（15x = 120）。
 */
export const LONGO_BOARD: BoardDef = {
  id: 'longo',
  name: 'Qwixx Longo（2–16 · 八面骰 · 幸运数字）',
  rows: [row('red', LONGO_ASC), row('yellow', LONGO_ASC), row('green', LONGO_DESC), row('blue', LONGO_DESC)],
  scoreBy: 'row',
  scoreCap: 15,
  lockableTail: 2,
  luckyNumbers: true,
  rulesOverrides: { dieFaces: 8, minMarksToLock: 6 },
};

/**
 * Qwixx Big Points（NSV，官方规则 QwixxBP_GB.pdf）：
 * 经典四行之外，红/黄行之间与绿/蓝行之间各有一条圆形奖励行（数字与相邻列相同）。
 * 已划过某个相邻普通格后，再次掷出同样的数（对应彩骰组合或白骰和）即可划奖励格；
 * 奖励格计入相邻两行的划记数（每行最多计 15 个），不参与锁行门槛，只划奖励格不算失误。
 */
export const BIG_POINTS_BOARD: BoardDef = {
  id: 'big-points',
  name: 'Qwixx Big Points（双色奖励行）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  scoreCap: 15,
  bonusRows: [
    { adjacent: [0, 1], numbers: [...ASC] },
    { adjacent: [2, 3], numbers: [...DESC] },
  ],
};

/** Qwixx Double A: the rightmost crossed number may be crossed a second time. */
export const DOUBLE_A_BOARD: BoardDef = {
  id: 'double-a',
  name: 'Qwixx Double A（最近格可再划）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  scoreCap: 16,
  rulesOverrides: { minMarksToLock: 7 },
  variant: { kind: 'double-a' },
};

/** Qwixx Double B: the printed 3/5/9/11 (or 10/8/6/4) cells count twice. */
export const DOUBLE_B_BOARD: BoardDef = {
  id: 'double-b',
  name: 'Qwixx Double B（四个双倍格）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  scoreCap: 16,
  rulesOverrides: { minMarksToLock: 7 },
  variant: { kind: 'double-b', multiplierCells: [1, 3, 7, 9] },
};

const refs = (entries: [number, number][]): CellRef[] => entries.map(([row, cell]) => ({ row, cell }));

/** Qwixx Bonus A official trigger cells and twelve-colour reward track. */
export const BONUS_A_BOARD: BoardDef = {
  id: 'bonus-a',
  name: 'Qwixx Bonus A（连锁奖励）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  variant: {
    kind: 'bonus-a',
    triggerCells: refs([
      [0, 1], [0, 4], [0, 7],
      [1, 3], [1, 6], [1, 9],
      [2, 1], [2, 5], [2, 8],
      [3, 2], [3, 4], [3, 7],
    ]),
    rewardTrack: ['red', 'yellow', 'green', 'blue', 'green', 'red', 'blue', 'yellow', 'red', 'yellow', 'blue', 'green'],
  },
};

/** Qwixx Bonus B official paired symbols. */
export const BONUS_B_BOARD: BoardDef = {
  id: 'bonus-b',
  name: 'Qwixx Bonus B（成对符号）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  variant: {
    kind: 'bonus-b',
    symbols: {
      circle: [{ row: 1, cell: 9 }, { row: 2, cell: 3 }],
      diamond: [{ row: 1, cell: 5 }, { row: 3, cell: 5 }],
      square: [{ row: 0, cell: 6 }, { row: 3, cell: 2 }],
      octagon: [{ row: 0, cell: 4 }, { row: 3, cell: 8 }],
      star: [{ row: 1, cell: 1 }, { row: 2, cell: 7 }],
    },
  },
};

/*
 * Connected pads contain five different A-E sheets. The digital sheets keep the
 * official invariant (eleven step cells / five linked pairs per player) and rotate
 * the printed pattern by seat, so hot-seat players always receive different cards.
 */
const STEP_PATTERNS = [
  [0, 1, 1, 0, 2, 3, 3, 2, 0, 1, 2],
  [1, 0, 2, 3, 1, 2, 0, 3, 2, 3, 1],
  [2, 3, 0, 1, 3, 0, 2, 1, 3, 0, 2],
  [3, 2, 1, 0, 2, 1, 3, 0, 1, 2, 3],
  [0, 2, 3, 1, 0, 3, 1, 2, 3, 1, 0],
].map((rows) => rows.map((row, cell) => ({ row, cell })));

const CHAIN_BASE: [CellRef, CellRef][] = [
  [{ row: 0, cell: 4 }, { row: 1, cell: 4 }],
  [{ row: 0, cell: 9 }, { row: 1, cell: 9 }],
  [{ row: 1, cell: 1 }, { row: 2, cell: 1 }],
  [{ row: 1, cell: 6 }, { row: 2, cell: 6 }],
  [{ row: 2, cell: 8 }, { row: 3, cell: 8 }],
];
const CHAIN_SHEETS = Array.from({ length: 5 }, (_, sheet) => CHAIN_BASE.map(([a, b]): [CellRef, CellRef] => {
  const move = (ref: CellRef): CellRef => ({ row: ref.row, cell: ((ref.cell - 1 + sheet * 2) % 9) + 1 });
  return [move(a), move(b)];
}));

export const CONNECTED_STEPS_BOARD: BoardDef = {
  id: 'connected-steps',
  name: 'Qwixx Connected A（阶梯）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  variant: { kind: 'connected-steps', sheets: STEP_PATTERNS },
};

export const CONNECTED_CHAIN_BOARD: BoardDef = {
  id: 'connected-chain',
  name: 'Qwixx Connected B（连锁）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  variant: { kind: 'connected-chain', sheets: CHAIN_SHEETS },
};

/** Qwixx X-Change official nine ordered white-sum swaps. */
export const X_CHANGE_BOARD: BoardDef = {
  id: 'x-change',
  name: 'Qwixx X-Change（白骰和值交换）',
  rows: [row('red', ASC), row('yellow', ASC), row('green', DESC), row('blue', DESC)],
  scoreBy: 'row',
  variant: {
    kind: 'x-change',
    swaps: [[8, 5], [9, 7], [11, 3], [7, 4], [10, 3], [8, 6], [10, 5], [11, 9], [6, 4]],
  },
};

export const BOARD_PRESETS: Record<string, BoardDef> = {
  classic: CLASSIC_BOARD,
  'gemixxt-a': GEMIXXT_A_BOARD,
  'gemixxt-b': GEMIXXT_B_BOARD,
  longo: LONGO_BOARD,
  'big-points': BIG_POINTS_BOARD,
  'double-a': DOUBLE_A_BOARD,
  'double-b': DOUBLE_B_BOARD,
  'bonus-a': BONUS_A_BOARD,
  'bonus-b': BONUS_B_BOARD,
  'connected-steps': CONNECTED_STEPS_BOARD,
  'connected-chain': CONNECTED_CHAIN_BOARD,
  'x-change': X_CHANGE_BOARD,
};

/** 校验棋盘定义的基本合法性（行数、格数、数字范围、奖励行、颜色计数）。 */
export function validateBoard(board: BoardDef): void {
  if (board.rows.length !== 4) throw new Error('board must have 4 rows');
  const len = board.rows[0]!.cells.length;
  for (const r of board.rows) {
    if (r.cells.length !== len) throw new Error('all rows must have the same length');
    if (r.cells.length < 2) throw new Error('rows too short');
    for (const c of r.cells) {
      if (c.number < 2 || c.number > 16) throw new Error('cell numbers must be 2..16');
    }
  }
  const tail = board.lockableTail ?? 1;
  if (tail < 1 || tail >= len) throw new Error('invalid lockableTail');
  for (const b of board.bonusRows ?? []) {
    if (b.numbers.length !== len) throw new Error('bonus row must match row length');
    for (const adj of b.adjacent) {
      if (adj < 0 || adj >= board.rows.length) throw new Error('invalid bonus adjacency');
    }
  }
  if (board.scoreBy === 'color') {
    const counts = new Map<Color, number>();
    for (const r of board.rows) for (const c of r.cells) counts.set(c.color, (counts.get(c.color) ?? 0) + 1);
    for (const c of COLORS) {
      if (counts.get(c) !== len) throw new Error(`color ${c} must appear exactly ${len} times`);
    }
  }
  const validRef = (ref: CellRef) => ref.row >= 0 && ref.row < 4 && ref.cell >= 0 && ref.cell < len;
  const variant = board.variant;
  if (variant?.kind === 'double-b' && variant.multiplierCells.some((cell) => cell < 0 || cell >= len)) {
    throw new Error('invalid multiplier cell');
  }
  if (variant?.kind === 'bonus-a' && variant.triggerCells.some((ref) => !validRef(ref))) {
    throw new Error('invalid bonus trigger');
  }
  if (variant?.kind === 'bonus-b' && Object.values(variant.symbols).flat().some((ref) => !validRef(ref))) {
    throw new Error('invalid bonus symbol');
  }
  if (variant?.kind === 'connected-steps' && variant.sheets.some((sheet) => sheet.length !== 11 || sheet.some((ref) => !validRef(ref)))) {
    throw new Error('invalid connected steps sheet');
  }
  if (variant?.kind === 'connected-chain' && variant.sheets.some((sheet) => {
    const endpoints = sheet.flat();
    const unique = new Set(endpoints.map((ref) => `${ref.row}:${ref.cell}`));
    return sheet.length !== 5 || endpoints.some((ref) => !validRef(ref)) || unique.size !== endpoints.length;
  })) {
    throw new Error('invalid connected chain sheet');
  }
}
