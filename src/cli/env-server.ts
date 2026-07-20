/**
 * RL 环境桥接服务：把 Node 侧规则引擎暴露为 stdio JSON-lines 向量环境，
 * 供 Python（training/ppo_train.py）驱动 PPO 训练。
 *
 * 协议（每行一个 JSON）：
 *   → {"cmd":"init","board":"classic","numEnvs":16,"opponent":"heuristic","seed":1}
 *   ← {"ok":true,"obsSize":471,"numActions":94}
 *   → {"cmd":"reset"}
 *   ← {"obs":[[...]],"legal":[[...]]}                      // 每个子环境的观测与合法动作下标
 *   → {"cmd":"step","actions":[a,...]}
 *   ← {"obs":[[...]],"legal":[[...]],"reward":[r,...],"done":[d,...]}
 *      // done=true 时 obs/legal 已是自动 reset 后新一局的初始决策点
 *
 * 智能体只在"需要真决策"（合法动作 ≥2）的时刻被询问；对手回合与单选时刻
 * 由服务端自动推进。座位按局数轮换以消除先手优势。奖励为终局分差/30。
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { newGame, currentActor, legalActions, applyActionInPlace, configForBoard } from '../core/engine';
import { BOARD_PRESETS } from '../core/board';
import type { BoardDef, GameState } from '../core/types';
import { BOT_REGISTRY, makeRand, type Bot } from '../ai/bots';
import { PolicyBot } from '../ai/policy';
import { makeCodec, encodeObservation, type ActionCodec } from '../ai/encode';
import type { SerializedMLP } from '../ai/mlp';

interface Env {
  state: GameState;
  agentSeat: number;
  episode: number;
  opponent: Bot;
  rand: () => number;
  seedBase: number;
}

let board: BoardDef;
let codec: ActionCodec;
let envs: Env[] = [];
let sharedOpponent: Bot;
const REWARD_SCALE = 30;

/** 内置机器人均无跨局状态，各环境共享一个实例即可。 */
function makeOpponent(spec: string): Bot {
  if (spec.startsWith('policy:')) {
    const weights = JSON.parse(readFileSync(spec.slice('policy:'.length), 'utf8')) as SerializedMLP;
    return new PolicyBot(weights, 'opponent-policy');
  }
  const factory = BOT_REGISTRY[spec];
  if (!factory) throw new Error(`未知对手 "${spec}"`);
  return factory();
}

function resetEnv(env: Env): void {
  const seed = env.seedBase + env.episode;
  env.state = newGame(configForBoard(board, 2, seed));
  env.agentSeat = env.episode % 2; // 座位轮换
  env.opponent = sharedOpponent;
  env.rand = makeRand(seed * 7919 + 13);
  env.episode += 1;
}

/**
 * 推进到下一个"智能体真决策点"或终局：对手决策交给对手机器人，
 * 智能体的单选时刻自动执行唯一合法动作。
 * 返回该局是否结束。
 */
function advance(env: Env): boolean {
  for (;;) {
    if (env.state.phase === 'gameOver') return true;
    const actor = currentActor(env.state);
    const legal = legalActions(env.state);
    if (actor === env.agentSeat) {
      if (legal.length >= 2) return false; // 需要智能体决策
      applyActionInPlace(env.state, legal[0]!);
    } else {
      applyActionInPlace(env.state, env.opponent.chooseAction(env.state, actor, env.rand));
    }
  }
}

function terminalReward(env: Env): number {
  const scores = env.state.finalScores!;
  return (scores[env.agentSeat]! - scores[1 - env.agentSeat]!) / REWARD_SCALE;
}

function obsOf(env: Env): number[] {
  return Array.from(encodeObservation(env.state, env.agentSeat), (v) => Math.round(v * 10000) / 10000);
}

function legalOf(env: Env): number[] {
  return legalActions(env.state).map((a) => codec.actionToIndex(a));
}

/** reset 后推进到首个决策点（开局即终局在正常规则下不可能出现）。 */
function resetToDecision(env: Env): void {
  do {
    resetEnv(env);
  } while (advance(env));
}

function handle(msg: Record<string, unknown>): unknown {
  const cmd = msg['cmd'];
  if (cmd === 'init') {
    board = BOARD_PRESETS[(msg['board'] as string) ?? 'classic']!;
    codec = makeCodec(board);
    sharedOpponent = makeOpponent((msg['opponent'] as string) ?? 'heuristic');
    const numEnvs = (msg['numEnvs'] as number) ?? 16;
    const seed = (msg['seed'] as number) ?? 1;
    envs = Array.from({ length: numEnvs }, (_, i) => {
      const env: Env = {
        state: undefined as unknown as GameState,
        agentSeat: 0,
        episode: 0,
        opponent: undefined as unknown as Bot,
        rand: () => 0,
        seedBase: seed + i * 1_000_000,
      };
      return env;
    });
    const obsSize = (() => {
      const probe = envs[0]!;
      resetToDecision(probe);
      return obsOf(probe).length;
    })();
    return { ok: true, obsSize, numActions: codec.numActions };
  }
  if (cmd === 'reset') {
    for (const env of envs) resetToDecision(env);
    return { obs: envs.map(obsOf), legal: envs.map(legalOf) };
  }
  if (cmd === 'step') {
    const actions = msg['actions'] as number[];
    const reward: number[] = [];
    const done: boolean[] = [];
    envs.forEach((env, i) => {
      applyActionInPlace(env.state, codec.indexToAction(actions[i]!));
      const over = advance(env);
      if (over) {
        reward.push(terminalReward(env));
        done.push(true);
        resetToDecision(env);
      } else {
        reward.push(0);
        done.push(false);
      }
    });
    return { obs: envs.map(obsOf), legal: envs.map(legalOf), reward, done };
  }
  if (cmd === 'close') {
    setImmediate(() => process.exit(0)); // 先让响应写出
    return { ok: true };
  }
  throw new Error(`未知命令 ${JSON.stringify(cmd)}`);
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    process.stdout.write(JSON.stringify(handle(JSON.parse(line))) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e) }) + '\n');
  }
});
