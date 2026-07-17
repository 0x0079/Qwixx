import type { Action, BoardDef, GameState, RulesConfig } from '../core/types';
import { COLORS } from '../core/types';
import { legalActions, whiteSum, currentActor } from '../core/engine';

/**
 * RL 训练接口：按棋盘配置生成固定维度的离散动作编解码器与观测编码。
 * 同一棋盘预设下所有对局的动作空间与观测维度完全一致。
 *
 * 动作空间布局（C = 每行格数，B = 奖励格总数）：
 *   [0, 4C)          markWhite，索引 = row*C + cell
 *   [4C, 8C)         markColor
 *   [8C, 8C+4)       markLucky（按行）
 *   [8C+4, 8C+4+B)   markBonusWhite（按奖励行展开）
 *   [8C+4+B, 8C+4+2B) markBonusColor
 *   8C+4+2B          skipWhite
 *   8C+4+2B+1        skipColor
 * 经典棋盘（C=11, B=0）共 94 个动作。
 */
export interface ActionCodec {
  numActions: number;
  cellsPerRow: number;
  totalBonusCells: number;
  actionToIndex(a: Action): number;
  indexToAction(i: number): Action;
}

export function makeCodec(board: BoardDef): ActionCodec {
  const C = board.rows[0]!.cells.length;
  const bonusSizes = (board.bonusRows ?? []).map((b) => b.numbers.length);
  const bonusOffsets: number[] = [];
  let B = 0;
  for (const s of bonusSizes) {
    bonusOffsets.push(B);
    B += s;
  }
  const base = {
    markColor: 4 * C,
    markLucky: 8 * C,
    markBonusWhite: 8 * C + 4,
    markBonusColor: 8 * C + 4 + B,
    skipWhite: 8 * C + 4 + 2 * B,
    skipColor: 8 * C + 4 + 2 * B + 1,
  };
  const numActions = base.skipColor + 1;

  const actionToIndex = (a: Action): number => {
    switch (a.type) {
      case 'markWhite':
        return a.row * C + a.cell;
      case 'markColor':
        return base.markColor + a.row * C + a.cell;
      case 'markLucky':
        return base.markLucky + a.row;
      case 'markBonusWhite':
        return base.markBonusWhite + bonusOffsets[a.bonus]! + a.cell;
      case 'markBonusColor':
        return base.markBonusColor + bonusOffsets[a.bonus]! + a.cell;
      case 'skipWhite':
        return base.skipWhite;
      case 'skipColor':
        return base.skipColor;
    }
  };

  const bonusFromOffset = (off: number): { bonus: number; cell: number } => {
    for (let b = bonusSizes.length - 1; b >= 0; b--) {
      if (off >= bonusOffsets[b]!) return { bonus: b, cell: off - bonusOffsets[b]! };
    }
    throw new Error('invalid bonus offset');
  };

  const indexToAction = (i: number): Action => {
    if (i < 0 || i >= numActions) throw new Error(`invalid action index ${i}`);
    if (i < base.markColor) return { type: 'markWhite', row: Math.floor(i / C), cell: i % C };
    if (i < base.markLucky) {
      const j = i - base.markColor;
      return { type: 'markColor', row: Math.floor(j / C), cell: j % C };
    }
    if (i < base.markBonusWhite) return { type: 'markLucky', row: i - base.markLucky };
    if (i < base.markBonusColor) return { type: 'markBonusWhite', ...bonusFromOffset(i - base.markBonusWhite) };
    if (i < base.skipWhite) return { type: 'markBonusColor', ...bonusFromOffset(i - base.markBonusColor) };
    if (i === base.skipWhite) return { type: 'skipWhite' };
    return { type: 'skipColor' };
  };

  return { numActions, cellsPerRow: C, totalBonusCells: B, actionToIndex, indexToAction };
}

/** 当前决策者的合法动作掩码（长度 codec.numActions，1=合法）。 */
export function legalActionMask(state: GameState, codec: ActionCodec): Uint8Array {
  const mask = new Uint8Array(codec.numActions);
  for (const a of legalActions(state)) mask[codec.actionToIndex(a)] = 1;
  return mask;
}

/**
 * 观测编码（以 viewer 视角，支持最多 maxPlayers 名玩家，空位补零）：
 * 每名玩家（从 viewer 起按相对座位序）：4C 格划记 + B 奖励格划记 + 失误数 → 4C+B+1 维；
 * 全局：锁定行 4 + 移除骰色 4 + 白骰 2 + 彩骰值 4 + 彩骰在场 4
 *      + 白骰和 + 阶段 one-hot 2 + 自己是否主动 1 + 自己是否当前决策者 1
 *      + viewer 的幸运数字 2（无则 0）。
 * 所有数值归一化到 [0,1]。
 */
export function observationSize(config: RulesConfig, maxPlayers = 5): number {
  const C = config.board.rows[0]!.cells.length;
  const B = (config.board.bonusRows ?? []).reduce((a, b) => a + b.numbers.length, 0);
  return maxPlayers * (4 * C + B + 1) + 4 + 4 + 2 + 4 + 4 + 1 + 2 + 1 + 1 + 2;
}

export function encodeObservation(state: GameState, viewer: number, maxPlayers = 5): Float32Array {
  const { config } = state;
  const n = config.numPlayers;
  const C = config.board.rows[0]!.cells.length;
  const B = (config.board.bonusRows ?? []).reduce((a, b) => a + b.numbers.length, 0);
  const maxSum = 2 * config.dieFaces;
  const obs = new Float32Array(observationSize(config, maxPlayers));
  let o = 0;
  for (let k = 0; k < maxPlayers; k++) {
    if (k < n) {
      const p = state.players[(viewer + k) % n]!;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < C; c++) obs[o++] = p.marks[r]![c] ? 1 : 0;
      }
      for (const bm of p.bonusMarks) for (const m of bm) obs[o++] = m ? 1 : 0;
      obs[o++] = p.penalties / config.maxPenalties;
    } else {
      o += 4 * C + B + 1;
    }
  }
  for (let r = 0; r < 4; r++) obs[o++] = state.lockedRows[r] ? 1 : 0;
  for (const c of COLORS) obs[o++] = state.removedColors.includes(c) ? 1 : 0;
  obs[o++] = state.dice.white[0] / config.dieFaces;
  obs[o++] = state.dice.white[1] / config.dieFaces;
  for (const c of COLORS) obs[o++] = (state.dice.colors[c] ?? 0) / config.dieFaces;
  for (const c of COLORS) obs[o++] = state.dice.colors[c] !== undefined ? 1 : 0;
  obs[o++] = whiteSum(state) / maxSum;
  obs[o++] = state.phase === 'whiteChoice' ? 1 : 0;
  obs[o++] = state.phase === 'colorChoice' ? 1 : 0;
  obs[o++] = state.activePlayer === viewer ? 1 : 0;
  obs[o++] = currentActor(state) === viewer ? 1 : 0;
  const lucky = config.luckyNumbers?.[viewer] ?? [];
  obs[o++] = (lucky[0] ?? 0) / maxSum;
  obs[o++] = (lucky[1] ?? 0) / maxSum;
  return obs;
}
