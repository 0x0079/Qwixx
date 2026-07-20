import type { GameState, Action } from '../core/types';
import { legalActions, applyActionInPlace, currentActor } from '../core/engine';
import { seedToState } from '../core/rng';
import { HeuristicBot, type Bot } from './bots';

/**
 * 搜索用快速克隆：config（含棋盘定义）不可变，共享引用；只深拷贝对局中会被
 * 修改的部分。比 structuredClone 快一个数量级以上，是 rollout 吞吐的关键。
 */
export function cloneForSearch(s: GameState): GameState {
  const clone: GameState = {
    config: s.config,
    players: s.players.map((p) => ({
      marks: p.marks.map((r) => r.slice()),
      bonusMarks: p.bonusMarks.map((r) => r.slice()),
      secondMarks: p.secondMarks.map((r) => r.slice()),
      variantState: {
        ...(p.variantState.bonusTrackUsed ? { bonusTrackUsed: p.variantState.bonusTrackUsed.slice() } : {}),
        ...(p.variantState.bonusSymbols ? { bonusSymbols: { ...p.variantState.bonusSymbols } } : {}),
        ...(p.variantState.xChangeThrough !== undefined ? { xChangeThrough: p.variantState.xChangeThrough } : {}),
      },
      penalties: p.penalties,
    })),
    lockedRows: s.lockedRows.slice(),
    removedColors: s.removedColors.slice(),
    activePlayer: s.activePlayer,
    dice: { white: [s.dice.white[0], s.dice.white[1]], colors: { ...s.dice.colors } },
    phase: s.phase,
    whiteQueue: s.whiteQueue.slice(),
    activeMarked: s.activeMarked,
    turn: s.turn,
    rngState: s.rngState,
  };
  if (s.pendingBonus) {
    clone.pendingBonus = {
      player: s.pendingBonus.player,
      resume: s.pendingBonus.resume,
      effects: s.pendingBonus.effects.map((e) => ({ ...e })),
    };
  }
  return clone;
}

/** 从当前状态用 policy 演完整局（原地修改 state）。 */
function playout(state: GameState, policy: Bot, rand: () => number): void {
  let steps = 0;
  while (state.phase !== 'gameOver') {
    if (++steps > 100000) throw new Error('playout did not terminate');
    const actor = currentActor(state);
    applyActionInPlace(state, policy.chooseAction(state, actor, rand));
  }
}

/** 终局价值（viewer 视角）：与最强对手的分差；单人局为自身得分。 */
function terminalValue(state: GameState, viewer: number): number {
  const scores = state.finalScores!;
  if (scores.length === 1) return scores[0]!;
  let bestOther = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (i !== viewer && scores[i]! > bestOther) bestOther = scores[i]!;
  }
  return scores[viewer]! - bestOther;
}

/**
 * 蒙特卡洛 rollout 机器人：对每个合法动作，重随机化后续骰子并用 rollout 策略
 * 模拟 N 局到终局，选平均分差最高的动作。当前骰面保持不变（已掷出、是已知信息），
 * 只有未来的骰子被重新采样，因此估的是该动作在骰运分布下的期望价值。
 *
 * 无训练即可显著超过单步启发式：它天然学会锁行时机、失误取舍与终局冲刺，
 * 也可作为 RL 训练的教师策略 / 陪练。代价是每步决策需 |动作| × N 次模拟。
 */
export class RolloutBot implements Bot {
  readonly name: string;

  /**
   * rollouts：每个候选动作的模拟局数（越大越强越慢）；
   * policy：模拟中所有玩家使用的快速策略（缺省 heuristic）。
   */
  constructor(
    private rollouts = 32,
    private policy: Bot = new HeuristicBot(),
    name = 'rollout',
  ) {
    this.name = name;
  }

  chooseAction(state: GameState, playerId: number, rand: () => number): Action {
    const legal = legalActions(state);
    if (legal.length === 1) return legal[0]!;

    // 公共随机数：所有候选动作共用同一组未来骰子种子，做成对比较以消除
    // 骰运方差——否则动作间约 1~3 分的真实差距会被 ±30 分的终局方差淹没。
    const seeds = Array.from({ length: this.rollouts }, () => (rand() * 0x100000000) | 0);

    let best = legal[0]!;
    let bestVal = -Infinity;
    for (const a of legal) {
      let sum = 0;
      for (let k = 0; k < this.rollouts; k++) {
        const sim = cloneForSearch(state);
        // 重随机化未来骰子：当前骰面在 sim.dice 中原样保留，不受影响。
        sim.rngState = seedToState(seeds[k]!);
        applyActionInPlace(sim, a);
        playout(sim, this.policy, rand);
        sum += terminalValue(sim, playerId);
      }
      const avg = sum / this.rollouts;
      if (avg > bestVal) {
        bestVal = avg;
        best = a;
      }
    }
    return best;
  }
}
