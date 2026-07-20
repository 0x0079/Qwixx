import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { newGame, currentActor, applyAction, configForBoard } from '../src/core/engine';
import { BOARD_PRESETS } from '../src/core/board';
import { HeuristicBot, makeRand, type Bot } from '../src/ai/bots';
import { MLP } from '../src/ai/mlp';
import { PolicyBot } from '../src/ai/policy';
import weights from '../src/ai/weights/policy-classic.json';

function playFullGame(bots: Bot[], board: string, seed: number) {
  let state = newGame(configForBoard(BOARD_PRESETS[board]!, bots.length, seed));
  const rands = bots.map((_, i) => makeRand(seed * 7919 + i));
  let steps = 0;
  while (state.phase !== 'gameOver') {
    if (++steps > 100000) throw new Error('game did not terminate');
    const actor = currentActor(state);
    state = applyAction(state, bots[actor]!.chooseAction(state, actor, rands[actor]!));
  }
  return state;
}

describe('前向一致性（TS 推理 vs Python 训练）', () => {
  it('同一权重下 TS forward 的 logits/value 与 torch 一致', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/policy-parity.json', 'utf8')) as {
      obs: number[];
      logits: number[];
      value: number;
    };
    const mlp = MLP.deserialize(weights as never);
    const { logits, value } = mlp.forward(Float32Array.from(fixture.obs));
    for (let i = 0; i < fixture.logits.length; i++) {
      expect(Math.abs(logits[i]! - fixture.logits[i]!)).toBeLessThan(2e-3);
    }
    expect(Math.abs(value - fixture.value)).toBeLessThan(2e-3);
  });
});

describe('PolicyBot', () => {
  it('整局动作全部合法且可复现（classic）', () => {
    const run = () => playFullGame([new PolicyBot(), new HeuristicBot()], 'classic', 17);
    const a = run();
    const b = run();
    expect(a.phase).toBe('gameOver');
    expect(a.finalScores).toEqual(b.finalScores);
  });

  it('未训练的棋盘回退到 heuristic 并能走完整局', () => {
    const state = playFullGame([new PolicyBot(), new HeuristicBot()], 'longo', 5);
    expect(state.phase).toBe('gameOver');
  });
});
