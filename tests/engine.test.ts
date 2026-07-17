import { describe, it, expect } from 'vitest';
import {
  newGame,
  currentActor,
  legalActions,
  applyAction,
  applyActionInPlace,
  whiteSum,
  DEFAULT_RULES,
} from '../src/core/engine';
import { CLASSIC_BOARD, GEMIXXT_A_BOARD, GEMIXXT_B_BOARD, randomMixedBoard, validateBoard } from '../src/core/board';
import { computeScore, pointsForCount } from '../src/core/scoring';
import type { Action, GameState } from '../src/core/types';
import { RandomBot, GreedyBot, HeuristicBot, makeRand } from '../src/ai/bots';
import { encodeObservation, legalActionMask, actionToIndex, indexToAction, NUM_ACTIONS, observationSize } from '../src/ai/encode';

function makeGame(numPlayers = 2, seed = 42): GameState {
  return newGame({ ...DEFAULT_RULES, board: CLASSIC_BOARD, numPlayers, seed });
}

/** 强行设置骰子便于构造场景（绕过 RNG）。 */
function setDice(state: GameState, white: [number, number], colors: Partial<Record<'red' | 'yellow' | 'green' | 'blue', number>>): void {
  state.dice = { white, colors };
}

describe('棋盘定义', () => {
  it('内置棋盘均通过校验', () => {
    validateBoard(CLASSIC_BOARD);
    validateBoard(GEMIXXT_A_BOARD);
    validateBoard(GEMIXXT_B_BOARD);
    validateBoard(randomMixedBoard(7));
  });
  it('随机棋盘可复现', () => {
    expect(randomMixedBoard(5)).toEqual(randomMixedBoard(5));
    expect(randomMixedBoard(5)).not.toEqual(randomMixedBoard(6));
  });
});

describe('回合流程', () => {
  it('新游戏从主动玩家的白骰阶段开始', () => {
    const s = makeGame(3);
    expect(s.phase).toBe('whiteChoice');
    expect(currentActor(s)).toBe(0);
    expect(s.whiteQueue).toEqual([0, 1, 2]);
  });

  it('白骰之和所有玩家依次决策，然后进入主动玩家彩骰阶段', () => {
    let s = makeGame(3);
    s = applyAction(s, { type: 'skipWhite' });
    expect(currentActor(s)).toBe(1);
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipWhite' });
    expect(s.phase).toBe('colorChoice');
    expect(currentActor(s)).toBe(0);
  });

  it('主动玩家两阶段均不划记则记 1 次失误，非主动玩家跳过无失误', () => {
    let s = makeGame(2);
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipColor' });
    expect(s.players[0]!.penalties).toBe(1);
    expect(s.players[1]!.penalties).toBe(0);
    expect(s.activePlayer).toBe(1);
    expect(s.turn).toBe(2);
  });

  it('主动玩家白骰阶段划记后，彩骰阶段跳过不算失误', () => {
    const s = makeGame(2);
    setDice(s, [3, 4], { red: 1, yellow: 1, green: 1, blue: 1 });
    let s2 = applyAction(s, { type: 'markWhite', row: 0, cell: 5 }); // 红7
    s2 = applyAction(s2, { type: 'skipWhite' });
    s2 = applyAction(s2, { type: 'skipColor' });
    expect(s2.players[0]!.penalties).toBe(0);
  });
});

describe('划记合法性', () => {
  it('白骰阶段只能划点数等于白骰之和的格子', () => {
    const s = makeGame(2);
    setDice(s, [2, 3], { red: 6 });
    const legal = legalActions(s);
    const marks = legal.filter((a) => a.type === 'markWhite') as Extract<Action, { type: 'markWhite' }>[];
    // 经典棋盘：每行恰有一个 5（红黄在 index 3，绿蓝在 index 7）。
    expect(marks).toHaveLength(4);
    for (const m of marks) {
      expect(s.config.board.rows[m.row]!.cells[m.cell]!.number).toBe(5);
    }
  });

  it('只能从左往右划：左侧格子不可再划', () => {
    let s = makeGame(1);
    setDice(s, [4, 4], { red: 6 });
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 6 }); // 红8
    // 下一回合（单人）——构造白骰和为5，红行 index 3 在已划 8 左侧，不可划。
    setDice(s, [2, 3], { red: 6, yellow: 6, green: 6, blue: 6 });
    s.phase = 'whiteChoice';
    s.whiteQueue = [0];
    const marks = legalActions(s).filter((a) => a.type === 'markWhite') as Extract<Action, { type: 'markWhite' }>[];
    expect(marks.some((m) => m.row === 0)).toBe(false);
    expect(marks.some((m) => m.row === 1)).toBe(true);
  });

  it('最右端格子需本行已划满 5 格才能划（锁定门槛）', () => {
    const s = makeGame(1);
    // 手动给红行划 4 格。
    for (const i of [0, 1, 2, 3]) s.players[0]!.marks[0]![i] = true;
    setDice(s, [6, 6], { red: 6 });
    let marks = legalActions(s).filter((a) => a.type === 'markWhite') as Extract<Action, { type: 'markWhite' }>[];
    expect(marks.some((m) => m.row === 0 && m.cell === 10)).toBe(false);
    // 划满 5 格后可以。
    s.players[0]!.marks[0]![4] = true;
    marks = legalActions(s).filter((a) => a.type === 'markWhite') as Extract<Action, { type: 'markWhite' }>[];
    expect(marks.some((m) => m.row === 0 && m.cell === 10)).toBe(true);
  });

  it('彩骰阶段：任一白骰 + 任一在场彩骰，颜色须匹配', () => {
    let s = makeGame(2);
    setDice(s, [1, 2], { red: 3, blue: 6 });
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipWhite' });
    expect(s.phase).toBe('colorChoice');
    const marks = legalActions(s).filter((a) => a.type === 'markColor') as Extract<Action, { type: 'markColor' }>[];
    const targets = marks.map((m) => {
      const c = s.config.board.rows[m.row]!.cells[m.cell]!;
      return `${c.color}${c.number}`;
    });
    // 红: 1+3=4, 2+3=5；蓝: 1+6=7, 2+6=8。
    expect(new Set(targets)).toEqual(new Set(['red4', 'red5', 'blue7', 'blue8']));
  });

  it('主动玩家可在同一回合先划白骰再划彩骰（两格且第二格更靠右）', () => {
    let s = makeGame(1);
    setDice(s, [3, 4], { red: 5 });
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 5 }); // 红7（白骰和）
    expect(s.phase).toBe('colorChoice');
    // 红 3+5=8 或 4+5=9，都在 7 右侧。
    const marks = legalActions(s).filter((a) => a.type === 'markColor') as Extract<Action, { type: 'markColor' }>[];
    expect(marks.some((m) => m.row === 0 && m.cell === 6)).toBe(true); // 红8
    expect(marks.some((m) => m.row === 0 && m.cell === 7)).toBe(true); // 红9
    // 白骰和刚划的 7 已被占用且不在右侧候选。
    expect(marks.some((m) => m.cell <= 5 && m.row === 0)).toBe(false);
  });

  it('非法动作抛错', () => {
    const s = makeGame(2);
    setDice(s, [2, 3], { red: 6 });
    expect(() => applyAction(s, { type: 'markWhite', row: 0, cell: 10 })).toThrow();
    expect(() => applyAction(s, { type: 'markColor', row: 0, cell: 3 })).toThrow();
  });
});

describe('锁定与游戏结束', () => {
  function nearLockState(): GameState {
    const s = makeGame(2);
    // 玩家0 红行划好 2,3,4,5,6（index 0..4）。
    for (const i of [0, 1, 2, 3, 4]) s.players[0]!.marks[0]![i] = true;
    return s;
  }

  it('白骰窗口结算完毕后锁定立即生效，对应彩骰移除', () => {
    let s = nearLockState();
    setDice(s, [6, 6], { red: 1, yellow: 1, green: 1, blue: 1 });
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 10 }); // 红12，锁定
    expect(s.lockedRows[0]).toBe(false); // 白骰窗口未结算完（玩家1 还没决定）
    s = applyAction(s, { type: 'skipWhite' });
    expect(s.phase).toBe('colorChoice');
    expect(s.lockedRows[0]).toBe(true); // 动作 1 结束即锁定
    expect(s.removedColors).toContain('red');
    expect(s.dice.colors.red).toBeUndefined();
    s = applyAction(s, { type: 'skipColor' });
    expect(s.phase).toBe('whiteChoice'); // 只锁 1 行，游戏继续
  });

  it('动作 1 中锁行后，主动玩家动作 2 不能再用该彩骰或该行', () => {
    let s = nearLockState();
    setDice(s, [6, 6], { red: 2, yellow: 1, green: 1, blue: 1 });
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 10 }); // 玩家0 锁红行
    s = applyAction(s, { type: 'skipWhite' });
    const marks = legalActions(s).filter((a) => a.type === 'markColor') as Extract<Action, { type: 'markColor' }>[];
    expect(marks.every((m) => m.row !== 0)).toBe(true); // 红行不可再划
    for (const m of marks) {
      expect(s.config.board.rows[m.row]!.cells[m.cell]!.color).not.toBe('red'); // 红骰已移出
    }
  });

  it('动作 1 中锁满两行游戏立即结束，动作 2 不执行且不记失误', () => {
    let s = nearLockState();
    for (const i of [0, 1, 2, 3, 4]) s.players[1]!.marks[1]![i] = true; // 玩家1 黄行备好
    setDice(s, [6, 6], { red: 1, yellow: 1, green: 1, blue: 1 });
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 10 }); // 玩家0 锁红
    s = applyAction(s, { type: 'markWhite', row: 1, cell: 10 }); // 玩家1 同窗口锁黄
    expect(s.phase).toBe('gameOver');
    expect(s.players[0]!.penalties).toBe(0);
    expect(s.players[1]!.penalties).toBe(0);
  });

  it('同一回合内其他满足条件的玩家也能划锁定格（同时生效）', () => {
    let s = nearLockState();
    for (const i of [0, 1, 2, 3, 4]) s.players[1]!.marks[0]![i] = true;
    setDice(s, [6, 6], { red: 1, yellow: 1, green: 1, blue: 1 });
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 10 });
    // 玩家1 同回合也可划红12。
    const marks = legalActions(s).filter((a) => a.type === 'markWhite') as Extract<Action, { type: 'markWhite' }>[];
    expect(marks.some((m) => m.row === 0 && m.cell === 10)).toBe(true);
  });

  it('两行锁定游戏立即结束并计分', () => {
    let s = nearLockState();
    for (const i of [0, 1, 2, 3, 4]) s.players[0]!.marks[1]![i] = true; // 黄行也备好
    setDice(s, [6, 6], { red: 1, yellow: 6, green: 1, blue: 1 });
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 10 }); // 红12
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'markColor', row: 1, cell: 10 }); // 黄 6+6=12
    expect(s.phase).toBe('gameOver');
    expect(s.finalScores).toBeDefined();
    // 玩家0：红 6 划 + 锁定奖励 = 7 → 28 分；黄同样 7 → 28；共 56。
    expect(s.finalScores![0]).toBe(56);
    expect(s.winners).toEqual([0]);
  });

  it('第 4 次失误立即结束游戏', () => {
    let s = makeGame(2);
    s.players[0]!.penalties = 3;
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipColor' });
    expect(s.players[0]!.penalties).toBe(4);
    expect(s.phase).toBe('gameOver');
  });
});

describe('计分', () => {
  it('得分表符合 n(n+1)/2', () => {
    expect([1, 2, 3, 12].map(pointsForCount)).toEqual([1, 3, 6, 78]);
  });

  it('失误扣 5 分', () => {
    const s = makeGame(1);
    s.players[0]!.marks[0]![0] = true;
    s.players[0]!.marks[0]![1] = true;
    s.players[0]!.penalties = 2;
    const sc = computeScore(s, 0);
    expect(sc.total).toBe(3 - 10);
  });

  it('自定义变体可按颜色计分', () => {
    const board = { ...GEMIXXT_A_BOARD, id: 'custom-color', scoreBy: 'color' as const };
    const s = newGame({ ...DEFAULT_RULES, board, numPlayers: 1, seed: 1 });
    // 找到两行中的红色格各划一格（保证合法性无关，直接置位）。
    let placed = 0;
    outer: for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 11; i++) {
        if (GEMIXXT_A_BOARD.rows[r]!.cells[i]!.color === 'red' && i < 10) {
          s.players[0]!.marks[r]![i] = true;
          if (++placed === 2) break outer;
        }
      }
    }
    const sc = computeScore(s, 0);
    const redIdx = sc.groupLabels.indexOf('red');
    expect(sc.groupCounts[redIdx]).toBe(2);
    expect(sc.total).toBe(3);
  });
});

describe('确定性与机器人', () => {
  function playOut(seed: number, botFactory: () => { chooseAction: Function }): GameState {
    const bots = [botFactory(), botFactory()];
    const s = newGame({ ...DEFAULT_RULES, board: CLASSIC_BOARD, numPlayers: 2, seed });
    const rands = [makeRand(seed), makeRand(seed + 1)];
    let steps = 0;
    while (s.phase !== 'gameOver') {
      if (++steps > 100000) throw new Error('no termination');
      const actor = currentActor(s);
      const a = (bots[actor]! as any).chooseAction(s, actor, rands[actor]!);
      applyActionInPlace(s, a);
    }
    return s;
  }

  it('相同种子对局完全可复现', () => {
    const a = playOut(123, () => new HeuristicBot());
    const b = playOut(123, () => new HeuristicBot());
    expect(a.finalScores).toEqual(b.finalScores);
    expect(a.turn).toBe(b.turn);
  });

  it('随机 / 贪心 / 启发式机器人都能正常终局（多种子）', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const f of [() => new RandomBot(), () => new GreedyBot(), () => new HeuristicBot()]) {
        const s = playOut(seed, f);
        expect(s.phase).toBe('gameOver');
        expect(s.finalScores).toHaveLength(2);
      }
    }
  });

  it('启发式明显强于随机（100 局平均分）', () => {
    let heuristicScore = 0;
    let randomScore = 0;
    for (let g = 0; g < 100; g++) {
      const bots = [new HeuristicBot(), new RandomBot()];
      const s = newGame({ ...DEFAULT_RULES, board: CLASSIC_BOARD, numPlayers: 2, seed: 1000 + g });
      const rands = [makeRand(g), makeRand(g + 1)];
      let steps = 0;
      while (s.phase !== 'gameOver') {
        if (++steps > 100000) throw new Error('no termination');
        const actor = currentActor(s);
        applyActionInPlace(s, bots[actor]!.chooseAction(s, actor, rands[actor]!));
      }
      heuristicScore += s.finalScores![0]!;
      randomScore += s.finalScores![1]!;
    }
    expect(heuristicScore / 100).toBeGreaterThan(randomScore / 100 + 10);
  });
});

describe('RL 编码', () => {
  it('动作索引双向一致', () => {
    for (let i = 0; i < NUM_ACTIONS; i++) {
      expect(actionToIndex(indexToAction(i))).toBe(i);
    }
  });

  it('合法动作掩码与 legalActions 一致', () => {
    const s = makeGame(2, 9);
    const mask = legalActionMask(s);
    const legal = legalActions(s);
    expect(Array.from(mask).reduce((a, b) => a + b, 0)).toBe(legal.length);
    for (const a of legal) expect(mask[actionToIndex(a)]).toBe(1);
  });

  it('观测维度固定且值域正常', () => {
    const s = makeGame(3, 5);
    const obs = encodeObservation(s, 1);
    expect(obs.length).toBe(observationSize(5));
    for (const v of obs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
