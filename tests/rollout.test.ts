import { describe, it, expect } from 'vitest';
import { newGame, currentActor, applyAction, configForBoard } from '../src/core/engine';
import { BOARD_PRESETS } from '../src/core/board';
import { HeuristicBot, makeRand, type Bot } from '../src/ai/bots';
import { RolloutBot, cloneForSearch } from '../src/ai/rollout';

/** 用会校验合法性的 applyAction 驱动整局（非法动作会抛错）。 */
function playFullGame(bots: Bot[], board: string, seed: number) {
  const state0 = newGame(configForBoard(BOARD_PRESETS[board]!, bots.length, seed));
  const rands = bots.map((_, i) => makeRand(seed * 7919 + i));
  let state = state0;
  const actions: string[] = [];
  let steps = 0;
  while (state.phase !== 'gameOver') {
    if (++steps > 100000) throw new Error('game did not terminate');
    const actor = currentActor(state);
    const action = bots[actor]!.chooseAction(state, actor, rands[actor]!);
    actions.push(JSON.stringify(action));
    state = applyAction(state, action);
  }
  return { state, actions };
}

describe('cloneForSearch', () => {
  it('克隆与原状态独立：改克隆不影响原状态', () => {
    const state = newGame(configForBoard(BOARD_PRESETS['classic']!, 2, 42));
    const clone = cloneForSearch(state);
    clone.players[0]!.marks[0]![3] = true;
    clone.lockedRows[1] = true;
    clone.dice.white[0] = 6;
    expect(state.players[0]!.marks[0]![3]).toBe(false);
    expect(state.lockedRows[1]).toBe(false);
    expect(clone.config).toBe(state.config); // config 共享引用
  });
});

describe('RolloutBot', () => {
  it('整局动作全部合法（classic，rollout vs heuristic）', () => {
    const bots: Bot[] = [new RolloutBot(4), new HeuristicBot()];
    const { state } = playFullGame(bots, 'classic', 7);
    expect(state.phase).toBe('gameOver');
    expect(state.finalScores).toHaveLength(2);
  });

  it('同种子完全可复现', () => {
    const run = () => playFullGame([new RolloutBot(4), new HeuristicBot()], 'classic', 11);
    const a = run();
    const b = run();
    expect(a.actions).toEqual(b.actions);
    expect(a.state.finalScores).toEqual(b.state.finalScores);
  });

  it('变体棋盘冒烟：longo / big-points 可正常走完整局', () => {
    for (const board of ['longo', 'big-points']) {
      const { state } = playFullGame([new RolloutBot(2), new HeuristicBot()], board, 3);
      expect(state.phase).toBe('gameOver');
    }
  });
});
