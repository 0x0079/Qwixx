import type { Action, BoardDef, GameState } from '../core/types';
import { legalActions } from '../core/engine';
import { makeCodec, encodeObservation, type ActionCodec } from './encode';
import { MLP, maskedArgmax, type SerializedMLP } from './mlp';
import { HeuristicBot, type Bot } from './bots';
import policyClassicWeights from './weights/policy-classic.json';

/**
 * 神经网络策略机器人：加载 training/ 导出的 MLP 权重，前向推理 + 掩码 argmax。
 * 推理微秒级，UI 实时对局无感。权重与训练棋盘绑定（boardId / 维度校验），
 * 在未训练的棋盘上自动回退到 heuristic。
 */
export class PolicyBot implements Bot {
  readonly name: string;
  private readonly mlp: MLP;
  private readonly boardId?: string;
  private readonly fallback = new HeuristicBot();
  private codec?: ActionCodec;
  private codecBoard?: BoardDef;

  constructor(weights: SerializedMLP = policyClassicWeights as SerializedMLP, name = 'policy') {
    this.mlp = MLP.deserialize(weights);
    this.boardId = weights.boardId;
    this.name = name;
  }

  chooseAction(state: GameState, playerId: number, rand: () => number): Action {
    const legal = legalActions(state);
    if (legal.length === 1) return legal[0]!;

    const board = state.config.board;
    if (this.boardId !== undefined && board.id !== this.boardId) {
      return this.fallback.chooseAction(state, playerId, rand);
    }
    if (this.codecBoard !== board) {
      this.codec = makeCodec(board);
      this.codecBoard = board;
    }
    const codec = this.codec!;
    const obs = encodeObservation(state, playerId);
    if (obs.length !== this.mlp.arch.input || codec.numActions !== this.mlp.arch.actions) {
      return this.fallback.chooseAction(state, playerId, rand);
    }

    const mask = new Uint8Array(codec.numActions);
    for (const a of legal) mask[codec.actionToIndex(a)] = 1;
    const { logits } = this.mlp.forward(obs);
    return codec.indexToAction(maskedArgmax(logits, mask));
  }
}
