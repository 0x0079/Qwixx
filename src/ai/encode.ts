import type { Action, GameState } from '../core/types';
import { COLORS } from '../core/types';
import { legalActions, whiteSum, currentActor } from '../core/engine';

/**
 * RL 训练接口：固定维度的观测向量 + 固定 90 维离散动作空间 + 合法动作掩码。
 *
 * 动作空间布局（NUM_ACTIONS = 90）：
 *   [0, 44)   markWhite，索引 = row*11 + cell
 *   [44, 88)  markColor，索引 = 44 + row*11 + cell
 *   88        skipWhite
 *   89        skipColor
 */
export const CELLS_PER_ROW = 11;
export const NUM_ROWS = 4;
export const NUM_CELLS = NUM_ROWS * CELLS_PER_ROW;
export const NUM_ACTIONS = NUM_CELLS * 2 + 2;

export function actionToIndex(a: Action): number {
  switch (a.type) {
    case 'markWhite':
      return a.row * CELLS_PER_ROW + a.cell;
    case 'markColor':
      return NUM_CELLS + a.row * CELLS_PER_ROW + a.cell;
    case 'skipWhite':
      return NUM_CELLS * 2;
    case 'skipColor':
      return NUM_CELLS * 2 + 1;
  }
}

export function indexToAction(i: number): Action {
  if (i < NUM_CELLS) return { type: 'markWhite', row: Math.floor(i / CELLS_PER_ROW), cell: i % CELLS_PER_ROW };
  if (i < NUM_CELLS * 2) {
    const j = i - NUM_CELLS;
    return { type: 'markColor', row: Math.floor(j / CELLS_PER_ROW), cell: j % CELLS_PER_ROW };
  }
  if (i === NUM_CELLS * 2) return { type: 'skipWhite' };
  if (i === NUM_CELLS * 2 + 1) return { type: 'skipColor' };
  throw new Error(`invalid action index ${i}`);
}

/** 当前决策者的合法动作掩码（长度 NUM_ACTIONS，1=合法）。 */
export function legalActionMask(state: GameState): Uint8Array {
  const mask = new Uint8Array(NUM_ACTIONS);
  for (const a of legalActions(state)) mask[actionToIndex(a)] = 1;
  return mask;
}

/**
 * 观测编码（以 viewer 视角，支持最多 maxPlayers 名玩家，空位补零）：
 * 每名玩家（从 viewer 起按相对座位序）：44 格划记 + 失误数/4 → 45 维；
 * 全局：锁定行 4 + 移除骰色 4 + 白骰 2 + 彩骰值 4 + 彩骰在场 4
 *      + 白骰和/12 + 阶段 one-hot 2 + 自己是否主动 1 + 自己是否当前决策者 1。
 */
export function observationSize(maxPlayers: number): number {
  return maxPlayers * (NUM_CELLS + 1) + 4 + 4 + 2 + 4 + 4 + 1 + 2 + 1 + 1;
}

export function encodeObservation(state: GameState, viewer: number, maxPlayers = 5): Float32Array {
  const n = state.config.numPlayers;
  const obs = new Float32Array(observationSize(maxPlayers));
  let o = 0;
  for (let k = 0; k < maxPlayers; k++) {
    if (k < n) {
      const p = state.players[(viewer + k) % n]!;
      for (let r = 0; r < NUM_ROWS; r++) {
        for (let c = 0; c < CELLS_PER_ROW; c++) obs[o++] = p.marks[r]![c] ? 1 : 0;
      }
      obs[o++] = p.penalties / state.config.maxPenalties;
    } else {
      o += NUM_CELLS + 1;
    }
  }
  for (let r = 0; r < NUM_ROWS; r++) obs[o++] = state.lockedRows[r] ? 1 : 0;
  for (const c of COLORS) obs[o++] = state.removedColors.includes(c) ? 1 : 0;
  obs[o++] = state.dice.white[0] / 6;
  obs[o++] = state.dice.white[1] / 6;
  for (const c of COLORS) obs[o++] = (state.dice.colors[c] ?? 0) / 6;
  for (const c of COLORS) obs[o++] = state.dice.colors[c] !== undefined ? 1 : 0;
  obs[o++] = whiteSum(state) / 12;
  obs[o++] = state.phase === 'whiteChoice' ? 1 : 0;
  obs[o++] = state.phase === 'colorChoice' ? 1 : 0;
  obs[o++] = state.activePlayer === viewer ? 1 : 0;
  obs[o++] = currentActor(state) === viewer ? 1 : 0;
  return obs;
}
