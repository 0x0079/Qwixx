/** mulberry32：小巧的确定性 PRNG，状态为单个 32 位整数，便于存进 GameState 复现对局。 */

export function nextRand(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { value, state: t };
}

/** 掷一个 faces 面骰（点数 1..faces；经典 6，Longo 8）。 */
export function rollDie(state: number, faces = 6): { value: number; state: number } {
  const { value, state: s } = nextRand(state);
  return { value: 1 + Math.floor(value * faces), state: s };
}

/** 由任意整数种子生成初始 RNG 状态。 */
export function seedToState(seed: number): number {
  return seed | 0;
}
