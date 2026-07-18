import { describe, it, expect } from 'vitest';
import {
  newGame,
  currentActor,
  legalActions,
  applyAction,
  applyActionInPlace,
  whiteSum,
  configForBoard,
  DEFAULT_RULES,
} from '../src/core/engine';
import {
  CLASSIC_BOARD,
  GEMIXXT_A_BOARD,
  GEMIXXT_B_BOARD,
  LONGO_BOARD,
  BIG_POINTS_BOARD,
  DOUBLE_A_BOARD,
  DOUBLE_B_BOARD,
  BONUS_A_BOARD,
  BONUS_B_BOARD,
  CONNECTED_STEPS_BOARD,
  CONNECTED_CHAIN_BOARD,
  X_CHANGE_BOARD,
  BOARD_PRESETS,
  randomMixedBoard,
  validateBoard,
} from '../src/core/board';
import { computeScore, pointsForCount } from '../src/core/scoring';
import type { Action, GameState } from '../src/core/types';
import { RandomBot, GreedyBot, HeuristicBot, makeRand } from '../src/ai/bots';
import { encodeObservation, legalActionMask, makeCodec, observationSize } from '../src/ai/encode';

function makeGame(numPlayers = 2, seed = 42): GameState {
  return newGame({ ...DEFAULT_RULES, board: CLASSIC_BOARD, numPlayers, seed });
}

/** 强行设置骰子便于构造场景（绕过 RNG）。 */
function setDice(state: GameState, white: [number, number], colors: Partial<Record<'red' | 'yellow' | 'green' | 'blue', number>>): void {
  state.dice = { white, colors };
}

describe('棋盘定义', () => {
  it('内置棋盘均通过校验', () => {
    for (const board of Object.values(BOARD_PRESETS)) validateBoard(board);
    validateBoard(randomMixedBoard(7));
  });

  it('Connected B 每张卡的五对连线端点互不冲突', () => {
    const variant = CONNECTED_CHAIN_BOARD.variant;
    if (variant?.kind !== 'connected-chain') throw new Error('invalid chain fixture');
    for (const sheet of variant.sheets) {
      const endpoints = sheet.flat().map((ref) => `${ref.row}:${ref.cell}`);
      expect(sheet).toHaveLength(5);
      expect(new Set(endpoints).size).toBe(10);
    }
  });

  it('随机棋盘可复现', () => {
    expect(randomMixedBoard(5)).toEqual(randomMixedBoard(5));
    expect(randomMixedBoard(5)).not.toEqual(randomMixedBoard(6));
  });
});

describe('官方追加记分卡变体', () => {
  it('Longo 按官方积分表每行最多计 15 个划记', () => {
    const s = newGame(configForBoard(LONGO_BOARD, 1, 1));
    s.players[0]!.marks[0]!.fill(true);
    const score = computeScore(s, 0);
    expect(score.groupCounts[0]).toBe(15);
    expect(score.groupPoints[0]).toBe(120);
  });

  it('Double A 可把每行最近格再划一次，并计入锁行门槛与得分', () => {
    const s = newGame(configForBoard(DOUBLE_A_BOARD, 1, 1));
    for (const cell of [0, 1, 2]) s.players[0]!.marks[0]![cell] = true;
    setDice(s, [2, 2], { red: 2 }); // 白骰和 4 = 红行最近格
    expect(legalActions(s)).toContainEqual({ type: 'markDoubleWhite', row: 0, cell: 2 });
    const next = applyAction(s, { type: 'markDoubleWhite', row: 0, cell: 2 });
    expect(next.players[0]!.secondMarks[0]![2]).toBe(true);
    expect(computeScore(next, 0).groupCounts[0]).toBe(4);
    expect(next.config.minMarksToLock).toBe(7);
  });

  it('Double B 的官方乘数格一次计两个叉', () => {
    const s = newGame(configForBoard(DOUBLE_B_BOARD, 1, 1));
    setDice(s, [1, 2], { red: 1 }); // 红3（index 1）是双倍格
    const next = applyAction(s, { type: 'markWhite', row: 0, cell: 1 });
    expect(next.players[0]!.secondMarks[0]![1]).toBe(true);
    expect(computeScore(next, 0).groupCounts[0]).toBe(2);
  });

  it('X-Change 只能按顺序向右使用，并交换白骰和值', () => {
    const s = newGame(configForBoard(X_CHANGE_BOARD, 1, 1));
    setDice(s, [5, 6], { red: 1 }); // 11 可用第 3 格交换成 3
    expect(legalActions(s)).toContainEqual({ type: 'markWhiteExchange', row: 0, cell: 1, swap: 2 });
    const next = applyAction(s, { type: 'markWhiteExchange', row: 0, cell: 1, swap: 2 });
    expect(next.players[0]!.variantState.xChangeThrough).toBe(2);
    expect(next.players[0]!.marks[0]![1]).toBe(true);
  });

  it('Bonus A 命中奖励格后暂停原动作并强制完成颜色轨追加划记', () => {
    const s = newGame(configForBoard(BONUS_A_BOARD, 1, 1));
    setDice(s, [1, 2], { red: 1 }); // 红3 是奖励触发格
    const pending = applyAction(s, { type: 'markWhite', row: 0, cell: 1 });
    expect(pending.phase).toBe('bonusChoice');
    expect(pending.players[0]!.variantState.bonusTrackUsed![0]).toBe(true);
    expect(legalActions(pending).every((action) => action.type === 'markForced' && action.row === 0)).toBe(true);
    const resumed = applyAction(pending, { type: 'markForced', row: 0, cell: 2 });
    expect(resumed.phase).toBe('colorChoice');
    expect(resumed.players[0]!.marks[0]![2]).toBe(true);
  });

  it('Bonus B 凑齐菱形后依次在四行强制追加一格', () => {
    let s = newGame(configForBoard(BONUS_B_BOARD, 1, 1));
    s.players[0]!.marks[1]![5] = true; // 黄7（菱形）
    setDice(s, [1, 6], { blue: 1 });
    s = applyAction(s, { type: 'markWhite', row: 3, cell: 5 }); // 蓝7（另一菱形）
    expect(s.phase).toBe('bonusChoice');
    expect(s.players[0]!.variantState.bonusSymbols?.diamond).toBe(true);
    for (let row = 0; row < 4; row++) {
      const action = legalActions(s).find((candidate) => candidate.type === 'markForced' && candidate.row === row);
      expect(action).toBeDefined();
      s = applyAction(s, action!);
    }
    expect(s.phase).toBe('colorChoice');
  });

  it('Bonus B 结算翻倍、+13 与失误免扣分', () => {
    const s = newGame(configForBoard(BONUS_B_BOARD, 1, 1));
    [1, 2, 3, 4].forEach((count, row) => {
      for (let cell = 0; cell < count; cell++) s.players[0]!.marks[row]![cell] = true;
    });
    s.players[0]!.penalties = 2;
    s.players[0]!.variantState.bonusSymbols = { square: true, octagon: true, star: true };
    const score = computeScore(s, 0);
    expect(score.groupPoints).toEqual([2, 3, 6, 10]);
    expect(score.variantBonusPoints).toBe(13);
    expect(score.penaltyPoints).toBe(0);
    expect(score.total).toBe(34);
  });

  it('Connected 阶梯增加第五计分组，连锁自动划下另一端', () => {
    const steps = newGame(configForBoard(CONNECTED_STEPS_BOARD, 1, 1));
    const stepVariant = CONNECTED_STEPS_BOARD.variant;
    if (stepVariant?.kind !== 'connected-steps') throw new Error('invalid steps fixture');
    const stepSheet = stepVariant.sheets[0]!;
    for (const ref of stepSheet) steps.players[0]!.marks[ref.row]![ref.cell] = true;
    const stepScore = computeScore(steps, 0);
    expect(stepScore.groupCounts[4]).toBe(11);
    expect(stepScore.groupPoints[4]).toBe(66);

    const chain = newGame(configForBoard(CONNECTED_CHAIN_BOARD, 1, 1));
    const chainVariant = CONNECTED_CHAIN_BOARD.variant;
    if (chainVariant?.kind !== 'connected-chain') throw new Error('invalid chain fixture');
    const pair = chainVariant.sheets[0]![0]!;
    const first = pair[0]!;
    const number = chain.config.board.rows[first.row]!.cells[first.cell]!.number;
    setDice(chain, [1, number - 1], {});
    const linked = applyAction(chain, { type: 'markWhite', ...first });
    const second = pair[1]!;
    expect(linked.players[0]!.marks[second.row]![second.cell]).toBe(true);
  });

  it('新增变体动作编解码可逆', () => {
    for (const board of [DOUBLE_A_BOARD, DOUBLE_B_BOARD, BONUS_A_BOARD, BONUS_B_BOARD, CONNECTED_STEPS_BOARD, CONNECTED_CHAIN_BOARD, X_CHANGE_BOARD]) {
      const codec = makeCodec(board);
      for (let i = 0; i < codec.numActions; i++) expect(codec.actionToIndex(codec.indexToAction(i))).toBe(i);
    }
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
  it('动作索引双向一致（所有棋盘）', () => {
    for (const board of [CLASSIC_BOARD, LONGO_BOARD, BIG_POINTS_BOARD]) {
      const codec = makeCodec(board);
      for (let i = 0; i < codec.numActions; i++) {
        expect(codec.actionToIndex(codec.indexToAction(i))).toBe(i);
      }
    }
  });

  it('经典棋盘动作空间为 94（88 划记 + 4 幸运 + 2 跳过）', () => {
    expect(makeCodec(CLASSIC_BOARD).numActions).toBe(94);
    expect(makeCodec(LONGO_BOARD).numActions).toBe(8 * 15 + 4 + 2);
    expect(makeCodec(BIG_POINTS_BOARD).numActions).toBe(88 + 4 + 44 + 2);
  });

  it('合法动作掩码与 legalActions 一致', () => {
    const s = makeGame(2, 9);
    const codec = makeCodec(s.config.board);
    const mask = legalActionMask(s, codec);
    const legal = legalActions(s);
    expect(Array.from(mask).reduce((a, b) => a + b, 0)).toBe(legal.length);
    for (const a of legal) expect(mask[codec.actionToIndex(a)]).toBe(1);
  });

  it('观测维度固定且值域正常（含 Longo / Big Points）', () => {
    for (const board of [CLASSIC_BOARD, LONGO_BOARD, BIG_POINTS_BOARD]) {
      const s = newGame(configForBoard(board, 3, 5));
      const obs = encodeObservation(s, 1);
      expect(obs.length).toBe(observationSize(s.config, 5));
      for (const v of obs) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Qwixx Longo', () => {
  function longoGame(seed = 1, numPlayers = 2): GameState {
    return newGame(configForBoard(LONGO_BOARD, numPlayers, seed));
  }

  it('配置：八面骰、锁行门槛 6、每人 2 个不同幸运数字', () => {
    const s = longoGame(42);
    expect(s.config.dieFaces).toBe(8);
    expect(s.config.minMarksToLock).toBe(6);
    expect(s.config.luckyNumbers).toHaveLength(2);
    for (const pair of s.config.luckyNumbers!) {
      expect(pair).toHaveLength(2);
      expect(pair[0]).not.toBe(pair[1]);
      for (const n of pair) {
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(16);
      }
    }
  });

  it('骰子点数在 1..8，行长 15', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = longoGame(seed);
      for (const v of [...s.dice.white, ...Object.values(s.dice.colors)]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(8);
      }
    }
    expect(LONGO_BOARD.rows[0]!.cells).toHaveLength(15);
    expect(LONGO_BOARD.rows[0]!.cells[14]!.number).toBe(16);
    expect(LONGO_BOARD.rows[2]!.cells[14]!.number).toBe(2);
  });

  it('行尾最后两格都是锁定格：已划 <6 不可划，≥6 可划且划任一格即锁行', () => {
    let s = longoGame(1);
    for (const i of [0, 1, 2, 3, 4]) s.players[0]!.marks[0]![i] = true; // 红行 5 格
    s.dice = { white: [7, 8], colors: { red: 1, yellow: 1, green: 1, blue: 1 } }; // 和 15
    let marks = legalActions(s).filter((a) => a.type === 'markWhite') as Extract<Action, { type: 'markWhite' }>[];
    expect(marks.some((m) => m.row === 0 && m.cell === 13)).toBe(false); // 红15 是锁定格
    s.players[0]!.marks[0]![5] = true; // 第 6 格
    marks = legalActions(s).filter((a) => a.type === 'markWhite') as Extract<Action, { type: 'markWhite' }>[];
    expect(marks.some((m) => m.row === 0 && m.cell === 13)).toBe(true);
    // 划红 15（倒数第二格）也锁行
    s = applyAction(s, { type: 'markWhite', row: 0, cell: 13 });
    s = applyAction(s, { type: 'skipWhite' });
    expect(s.lockedRows[0]).toBe(true);
    expect(s.removedColors).toContain('red');
  });

  it('幸运数字：白骰和相等时可改划"划记最少的行"的下一格', () => {
    const s = longoGame(1);
    s.config.luckyNumbers = [[5, 8], [12, 13]];
    // 玩家0：红行已划 2 格，其余行 0 格 → 最少的是黄/绿/蓝三行
    s.players[0]!.marks[0]![0] = true;
    s.players[0]!.marks[0]![1] = true;
    s.dice = { white: [2, 3], colors: { red: 1, yellow: 1, green: 1, blue: 1 } }; // 和 5 = 幸运
    const lucky = legalActions(s).filter((a) => a.type === 'markLucky') as Extract<Action, { type: 'markLucky' }>[];
    expect(new Set(lucky.map((l) => l.row))).toEqual(new Set([1, 2, 3]));
    // 应用：绿行（12..2）的下一格是最左格 16
    const s2 = applyAction(s, { type: 'markLucky', row: 2 });
    expect(s2.players[0]!.marks[2]![0]).toBe(true);
    // 白骰和非幸运数字时无此动作
    s.dice = { white: [2, 4], colors: { red: 1, yellow: 1, green: 1, blue: 1 } };
    expect(legalActions(s).some((a) => a.type === 'markLucky')).toBe(false);
  });

  it('计分：13 数字 + 锁定格 + 锁定奖励 = 15 计数 = 120 分', () => {
    const s = longoGame(1);
    for (let i = 0; i < 13; i++) s.players[0]!.marks[0]![i] = true;
    s.players[0]!.marks[0]![14] = true; // 直接划 16 锁行
    const sc = computeScore(s, 0);
    expect(sc.groupCounts[0]).toBe(15);
    expect(sc.groupPoints[0]).toBe(120);
  });
});

describe('Qwixx Big Points', () => {
  function bpGame(seed = 1): GameState {
    return newGame(configForBoard(BIG_POINTS_BOARD, 2, seed));
  }

  it('未划过相邻普通格时不能划奖励格', () => {
    const s = bpGame();
    s.dice = { white: [2, 3], colors: { red: 1, yellow: 1, green: 1, blue: 1 } }; // 和 5
    expect(legalActions(s).some((a) => a.type === 'markBonusWhite')).toBe(false);
  });

  it('白骰和触发：已划红 5 后，再出白 5 可划相邻奖励格（任何玩家）', () => {
    const s = bpGame();
    s.players[0]!.marks[0]![3] = true; // 红5（row0 cell3）
    s.players[1]!.marks[1]![3] = true; // 玩家1 黄5
    s.dice = { white: [2, 3], colors: { red: 1, yellow: 1, green: 1, blue: 1 } };
    // 玩家0（主动）白骰阶段
    let bonus = legalActions(s).filter((a) => a.type === 'markBonusWhite') as Extract<Action, { type: 'markBonusWhite' }>[];
    expect(bonus).toEqual([{ type: 'markBonusWhite', bonus: 0, cell: 3 }]);
    // 玩家1 白骰阶段同样可划
    const s2 = applyAction(s, { type: 'skipWhite' });
    bonus = legalActions(s2).filter((a) => a.type === 'markBonusWhite') as Extract<Action, { type: 'markBonusWhite' }>[];
    expect(bonus).toEqual([{ type: 'markBonusWhite', bonus: 0, cell: 3 }]);
  });

  it('彩骰触发：需要"同色同数"的相邻格已划过', () => {
    let s = bpGame();
    s.players[0]!.marks[2]![2] = true; // 绿10（row2 cell2）
    s.dice = { white: [4, 1], colors: { green: 6, blue: 6 } }; // 绿 4+6=10，蓝 4+6=10
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipWhite' });
    expect(s.phase).toBe('colorChoice');
    const bonus = legalActions(s).filter((a) => a.type === 'markBonusColor') as Extract<Action, { type: 'markBonusColor' }>[];
    // 绿10 已划 → 绿组合可触发；蓝10 未划 → 蓝组合不算独立触发（同一格只列一次）
    expect(bonus).toEqual([{ type: 'markBonusColor', bonus: 1, cell: 2 }]);
    // 若只划过蓝 10 而掷出的组合只有绿能凑 10 → 不可触发
    const t = bpGame();
    t.players[0]!.marks[3]![2] = true; // 蓝10
    t.dice = { white: [4, 1], colors: { green: 6 } };
    let t2 = applyAction(t, { type: 'skipWhite' });
    t2 = applyAction(t2, { type: 'skipWhite' });
    expect(legalActions(t2).some((a) => a.type === 'markBonusColor')).toBe(false);
  });

  it('只划奖励格不算失误', () => {
    let s = bpGame();
    s.players[0]!.marks[0]![3] = true; // 红5
    s.dice = { white: [2, 3], colors: {} };
    s = applyAction(s, { type: 'markBonusWhite', bonus: 0, cell: 3 });
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipColor' });
    expect(s.players[0]!.penalties).toBe(0);
  });

  it('奖励行从左到右，跳过的奖励格不能回头', () => {
    const s = bpGame();
    s.players[0]!.marks[0]![3] = true; // 红5
    s.players[0]!.bonusMarks[0]![7] = true; // 已划奖励 9
    s.dice = { white: [2, 3], colors: {} }; // 和 5
    expect(legalActions(s).some((a) => a.type === 'markBonusWhite')).toBe(false);
  });

  it('奖励格不计入锁行门槛', () => {
    const s = bpGame();
    for (const i of [0, 1, 2, 3]) s.players[0]!.marks[0]![i] = true; // 红行 4 格
    for (const i of [0, 1, 2]) s.players[0]!.bonusMarks[0]![i] = true; // 奖励 3 格
    s.dice = { white: [6, 6], colors: {} };
    // 4 + 3 = 7 > 5，但奖励不计入 → 仍不能锁
    expect(legalActions(s).some((a) => a.type === 'markWhite' && a.row === 0 && a.cell === 10)).toBe(false);
  });

  it('相邻行锁定后奖励格仍可划', () => {
    let s = bpGame();
    for (const i of [0, 1, 2, 3, 4, 9]) s.players[0]!.marks[0]![i] = true; // 红行 6 格（含 11）
    s.players[0]!.marks[0]![10] = true; // 红12 → 锁定
    s.dice = { white: [5, 6], colors: {} };
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipWhite' });
    s = applyAction(s, { type: 'skipColor' });
    expect(s.lockedRows[0]).toBe(true);
    // 下一回合（主动玩家变为 1，先跳过）：白骰和 11，红 11 已划 → 奖励 11（bonus0 cell9）可划
    s.dice = { white: [5, 6], colors: s.dice.colors };
    s = applyAction(s, { type: 'skipWhite' }); // 玩家1
    const bonus = legalActions(s).filter((a) => a.type === 'markBonusWhite') as Extract<Action, { type: 'markBonusWhite' }>[];
    expect(bonus).toEqual([{ type: 'markBonusWhite', bonus: 0, cell: 9 }]);
  });

  it('计分：奖励格计入相邻两行，每行封顶 15', () => {
    const s = bpGame();
    // 红行满 11 格 + 锁定奖励 = 12；奖励行划 5 格 → 红 17 → 封顶 15；黄 0+5=5
    for (let i = 0; i < 11; i++) s.players[0]!.marks[0]![i] = true;
    for (let i = 0; i < 5; i++) s.players[0]!.bonusMarks[0]![i] = true;
    const sc = computeScore(s, 0);
    expect(sc.groupCounts[0]).toBe(15); // 11 + 1锁 + 5奖励 = 17 → 15
    expect(sc.groupPoints[0]).toBe(120);
    expect(sc.groupCounts[1]).toBe(5);
    expect(sc.groupPoints[1]).toBe(15);
  });
});
