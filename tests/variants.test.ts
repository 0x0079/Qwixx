import { describe, it, expect } from 'vitest';
import { applyAction, configForBoard, newGame } from '../src/core/engine';
import {
  BONUS_A_BOARD,
  BONUS_B_BOARD,
  CONNECTED_CHAIN_BOARD,
  CONNECTED_STEPS_BOARD,
  DOUBLE_A_BOARD,
  X_CHANGE_BOARD,
  CLASSIC_BOARD,
} from '../src/core/board';
import { computeScore } from '../src/core/scoring';
import {
  chainLinks,
  chainPartner,
  doubleCandidates,
  nextRewardColor,
  nextRewardIndex,
  rewardTrack,
  sheetLabel,
  stepCells,
  swapSlots,
  symbolPairAt,
  symbolPairs,
} from '../src/core/variants';
import type { Color, GameState } from '../src/core/types';

function setDice(state: GameState, white: [number, number], colors: Partial<Record<Color, number>>): void {
  state.dice = { white, colors };
}

describe('奖励轨查询（Bonus A）', () => {
  it('下标推进顺序与引擎消费顺序一致', () => {
    expect(nextRewardIndex([])).toBe(-1);
    expect(nextRewardIndex([false, false])).toBe(0);
    expect(nextRewardIndex([true, false])).toBe(1);
    expect(nextRewardIndex([true, true])).toBe(-1);
  });

  it('引擎触发奖励格后，面板读到的"下一格"随之前移', () => {
    const s = newGame(configForBoard(BONUS_A_BOARD, 1, 1));
    const before = rewardTrack(s, 0);
    expect(before).toHaveLength(12);
    expect(before[0]!.isNext).toBe(true);
    expect(nextRewardColor(s, 0)).toBe('red');

    setDice(s, [1, 2], { red: 1 }); // 红3 是奖励触发格
    const pending = applyAction(s, { type: 'markWhite', row: 0, cell: 1 });
    const after = rewardTrack(pending, 0);
    expect(after[0]!.used).toBe(true);
    expect(after[0]!.isNext).toBe(false);
    expect(after[1]!.isNext).toBe(true);
    expect(nextRewardColor(pending, 0)).toBe(after[1]!.color);
  });

  it('锁行作废的格子与"用掉"的格子可以区分开', () => {
    const s = newGame(configForBoard(BONUS_A_BOARD, 1, 1));
    s.lockedRows[2] = true; // 绿行
    const variant = BONUS_A_BOARD.variant;
    if (variant?.kind !== 'bonus-a') throw new Error('invalid bonus-a fixture');
    s.players[0]!.variantState.bonusTrackUsed = variant.rewardTrack
      .map((color, index) => color === 'green' || index === 0);
    const track = rewardTrack(s, 0);
    expect(track[0]!.used && !track[0]!.voided).toBe(true); // 红：真的用掉了
    for (const slot of track.filter((item) => item.color === 'green')) {
      expect(slot.voided).toBe(true);
    }
  });

  it('每个奖励轨格子的行号与追加划记落到的行一致', () => {
    const s = newGame(configForBoard(BONUS_A_BOARD, 1, 1));
    for (const slot of rewardTrack(s, 0)) {
      expect(BONUS_A_BOARD.rows[slot.row]!.lockColor).toBe(slot.color);
    }
  });

  it('非 Bonus A 棋盘没有奖励轨', () => {
    const s = newGame(configForBoard(CLASSIC_BOARD, 1, 1));
    expect(rewardTrack(s, 0)).toEqual([]);
    expect(nextRewardColor(s, 0)).toBeUndefined();
  });
});

describe('连锁对查询（Connected B）', () => {
  it('配对关系对称，且指向引擎真正自动划下的那一格', () => {
    const chain = newGame(configForBoard(CONNECTED_CHAIN_BOARD, 1, 1));
    const ends = chainLinks(CONNECTED_CHAIN_BOARD, 0)[0]!.ends;
    const [first, second] = ends;
    expect(chainPartner(CONNECTED_CHAIN_BOARD, 0, first)).toEqual(second);
    expect(chainPartner(CONNECTED_CHAIN_BOARD, 0, second)).toEqual(first);

    const number = chain.config.board.rows[first.row]!.cells[first.cell]!.number;
    setDice(chain, [1, number - 1], {});
    const linked = applyAction(chain, { type: 'markWhite', ...first });
    expect(linked.players[0]!.marks[second.row]![second.cell]).toBe(true);
  });

  it('不在连锁对上的格子没有配对端', () => {
    const off = chainLinks(CONNECTED_CHAIN_BOARD, 0).flatMap((link) => link.ends.map((end) => `${end.row}:${end.cell}`));
    const free = { row: 0, cell: 0 };
    expect(off).not.toContain('0:0');
    expect(chainPartner(CONNECTED_CHAIN_BOARD, 0, free)).toBeUndefined();
  });

  it('不同座位拿到不同卡面', () => {
    expect(sheetLabel(CONNECTED_CHAIN_BOARD, 0)).toBe('A');
    expect(sheetLabel(CONNECTED_CHAIN_BOARD, 4)).toBe('E');
    expect(sheetLabel(CONNECTED_CHAIN_BOARD, 5)).toBe('A');
    expect(chainLinks(CONNECTED_CHAIN_BOARD, 0)).not.toEqual(chainLinks(CONNECTED_CHAIN_BOARD, 1));
    expect(sheetLabel(CLASSIC_BOARD, 0)).toBeUndefined();
  });
});

describe('符号对查询（Bonus B）', () => {
  it('五种符号各自成对，任一端都能查到同一对', () => {
    const pairs = symbolPairs(BONUS_B_BOARD);
    expect(pairs).toHaveLength(5);
    for (const pair of pairs) {
      for (const end of pair.ends) {
        expect(symbolPairAt(BONUS_B_BOARD, end)).toEqual(pair);
      }
    }
  });

  it('没有符号的格子返回 undefined', () => {
    expect(symbolPairAt(BONUS_B_BOARD, { row: 0, cell: 0 })).toBeUndefined();
    expect(symbolPairs(CLASSIC_BOARD)).toEqual([]);
  });
});

describe('交换轨查询（X-Change）', () => {
  it('标出已越过、下一组，以及本次白骰和真正能用的那几组', () => {
    const s = newGame(configForBoard(X_CHANGE_BOARD, 1, 1));
    const slots = swapSlots(s, 0, 11); // 第 3 组是 [11, 3]
    expect(slots).toHaveLength(9);
    expect(slots.every((slot) => !slot.spent)).toBe(true);
    expect(slots[0]!.isNext).toBe(true);
    expect(slots[2]!.usableNow).toBe(true);
    expect(slots[2]!.exchangedTo).toBe(3);
    expect(slots[0]!.usableNow).toBe(false);
  });

  it('用掉某一组后，它和它左边的组都不再可用', () => {
    const s = newGame(configForBoard(X_CHANGE_BOARD, 1, 1));
    setDice(s, [5, 6], { red: 1 }); // 11 → 3，走第 3 组
    const next = applyAction(s, { type: 'markWhiteExchange', row: 0, cell: 1, swap: 2 });
    const slots = swapSlots(next, 0, 11);
    expect(slots.slice(0, 3).every((slot) => slot.spent)).toBe(true);
    expect(slots[2]!.usableNow).toBe(false);
    expect(slots[3]!.isNext).toBe(true);
  });

  it('非 X-Change 棋盘没有交换轨', () => {
    const s = newGame(configForBoard(CLASSIC_BOARD, 1, 1));
    expect(swapSlots(s, 0, 7)).toEqual([]);
  });
});

describe('阶梯格与二次划记候选', () => {
  it('阶梯格集合与第五个计分组一致', () => {
    const s = newGame(configForBoard(CONNECTED_STEPS_BOARD, 1, 1));
    const cells = stepCells(CONNECTED_STEPS_BOARD, 0);
    expect(cells).toHaveLength(11);
    for (const ref of cells) s.players[0]!.marks[ref.row]![ref.cell] = true;
    const score = computeScore(s, 0);
    expect(score.groupLabels[4]).toBe('steps');
    expect(score.groupCounts[4]).toBe(cells.length);
  });

  it('Double A 只把每行最右的已划格算作可再划，划过第二次后移除', () => {
    const s = newGame(configForBoard(DOUBLE_A_BOARD, 1, 1));
    expect(doubleCandidates(s, 0)).toEqual([]);

    s.players[0]!.marks[0]![1] = true;
    s.players[0]!.marks[0]![4] = true;
    expect(doubleCandidates(s, 0)).toEqual([{ row: 0, cell: 4 }]);

    s.players[0]!.secondMarks[0]![4] = true;
    expect(doubleCandidates(s, 0)).toEqual([]);

    s.players[0]!.marks[1]![2] = true;
    s.lockedRows[1] = true;
    expect(doubleCandidates(s, 0)).toEqual([]); // 锁定行不能再划
  });
});
