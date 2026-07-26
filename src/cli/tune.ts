/**
 * HeuristicBot 权重调参器：以对战胜率为适应度做两阶段搜索（粗网格 → 局部细化），
 * 最后在保留种子集上验证，避免过拟合搜索用的种子。
 *
 * 用法：
 *   pnpm tune                                        # 默认：classic，对手 heuristic,greedy
 *   pnpm tune -- --games 400 --board classic --opponents heuristic,greedy --seed 1
 */
import { newGame, currentActor, applyActionInPlace, configForBoard } from '../core/engine';
import { BOARD_PRESETS } from '../core/board';
import { BOT_REGISTRY, HeuristicBot, makeRand, type Bot } from '../ai/bots';

interface Args {
  games: number;
  board: string;
  seed: number;
  opponents: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { games: 400, board: 'classic', seed: 1, opponents: ['heuristic', 'greedy'] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    if (a === '--games') args.games = parseInt(next(), 10);
    else if (a === '--board') args.board = next();
    else if (a === '--seed') args.seed = parseInt(next(), 10);
    else if (a === '--opponents') args.opponents = next().split(',');
  }
  return args;
}

interface Params {
  wSkip: number;
  markBonus: number;
  baseMaxSkip: number;
}

function paramsKey(p: Params): string {
  return `wSkip=${p.wSkip.toFixed(2)} markBonus=${p.markBonus.toFixed(2)} baseMaxSkip=${p.baseMaxSkip}`;
}

function playGame(bots: [Bot, Bot], board: string, seed: number): number[] {
  const boardDef = BOARD_PRESETS[board] ?? BOARD_PRESETS['classic']!;
  const state = newGame(configForBoard(boardDef, 2, seed));
  const rands = bots.map((_, i) => makeRand(seed * 7919 + i));
  let steps = 0;
  while (state.phase !== 'gameOver') {
    if (++steps > 100000) throw new Error('game did not terminate');
    const actor = currentActor(state);
    applyActionInPlace(state, bots[actor]!.chooseAction(state, actor, rands[actor]!));
  }
  return state.finalScores!;
}

/** 候选参数 vs 单个对手：轮换座位打 games 局，返回胜率与平均分差。 */
function evalVsOpponent(
  p: Params,
  opponent: string,
  games: number,
  board: string,
  seedBase: number,
): { winRate: number; avgDiff: number } {
  let wins = 0;
  let diff = 0;
  for (let g = 0; g < games; g++) {
    const candidate = new HeuristicBot(p.wSkip, p.markBonus, p.baseMaxSkip);
    const opp = BOT_REGISTRY[opponent]!();
    const seat = g % 2; // 轮换座位消除先手优势
    const bots: [Bot, Bot] = seat === 0 ? [candidate, opp] : [opp, candidate];
    const scores = playGame(bots, board, seedBase + g);
    const mine = scores[seat]!;
    const theirs = scores[1 - seat]!;
    if (mine > theirs) wins += 1;
    else if (mine === theirs) wins += 0.5;
    diff += mine - theirs;
  }
  return { winRate: wins / games, avgDiff: diff / games };
}

/** 适应度：对所有对手的平均胜率（分差作展示/破平参考）。 */
function fitness(
  p: Params,
  opponents: string[],
  games: number,
  board: string,
  seedBase: number,
): { winRate: number; avgDiff: number } {
  let wr = 0;
  let ad = 0;
  for (const opp of opponents) {
    const r = evalVsOpponent(p, opp, games, board, seedBase);
    wr += r.winRate;
    ad += r.avgDiff;
  }
  return { winRate: wr / opponents.length, avgDiff: ad / opponents.length };
}

function searchStage(
  candidates: Params[],
  label: string,
  args: Args,
  games: number,
  seedBase: number,
): { p: Params; winRate: number; avgDiff: number }[] {
  console.log(`\n[${label}] ${candidates.length} 组参数 × 每对手 ${games} 局 × ${args.opponents.length} 对手`);
  const t0 = Date.now();
  const results = candidates.map((p) => ({ p, ...fitness(p, args.opponents, games, args.board, seedBase) }));
  results.sort((a, b) => b.winRate - a.winRate || b.avgDiff - a.avgDiff);
  console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，前 5 名：`);
  for (const r of results.slice(0, 5)) {
    console.log(`  ${paramsKey(r.p)}  胜率 ${(r.winRate * 100).toFixed(1)}%  分差 ${r.avgDiff.toFixed(2)}`);
  }
  return results;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  for (const b of args.opponents) {
    if (!BOT_REGISTRY[b]) {
      console.error(`未知对手 "${b}"，可选：${Object.keys(BOT_REGISTRY).join(', ')}`);
      process.exit(1);
    }
  }
  console.log(`棋盘: ${args.board}  对手: ${args.opponents.join(', ')}  基准局数/评估: ${args.games}`);

  // 阶段 1：粗网格。
  const coarse: Params[] = [];
  for (const wSkip of [0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2]) {
    for (const markBonus of [0, 0.5, 1, 1.5, 2]) {
      for (const baseMaxSkip of [0, 1, 2]) {
        coarse.push({ wSkip, markBonus, baseMaxSkip });
      }
    }
  }
  const stage1 = searchStage(coarse, '粗网格', args, args.games, args.seed);

  // 阶段 2：围绕前 3 名做邻域细化（步长减半），双倍局数复评。
  const seen = new Set<string>();
  const refined: Params[] = [];
  for (const { p } of stage1.slice(0, 3)) {
    for (const dw of [-0.2, 0, 0.2]) {
      for (const dm of [-0.25, 0, 0.25]) {
        const q: Params = {
          wSkip: Math.max(0, +(p.wSkip + dw).toFixed(2)),
          markBonus: Math.max(0, +(p.markBonus + dm).toFixed(2)),
          baseMaxSkip: p.baseMaxSkip,
        };
        const k = paramsKey(q);
        if (!seen.has(k)) {
          seen.add(k);
          refined.push(q);
        }
      }
    }
  }
  const stage2 = searchStage(refined, '细化', args, args.games * 2, args.seed + 1_000_000);

  // 阶段 3：前 3 名 + 当前默认参数，在保留种子集上大样本验证。
  const finalists = stage2.slice(0, 3).map((r) => r.p);
  const defaults: Params = { wSkip: 1.8, markBonus: 1, baseMaxSkip: 1 };
  if (!finalists.some((p) => paramsKey(p) === paramsKey(defaults))) finalists.push(defaults);
  const stage3 = searchStage(finalists, '保留集验证', args, args.games * 5, args.seed + 2_000_000);

  const best = stage3[0]!;
  console.log(`\n最优参数：${paramsKey(best.p)}`);
  console.log(`保留集成绩：胜率 ${(best.winRate * 100).toFixed(1)}%  平均分差 ${best.avgDiff.toFixed(2)}`);
  console.log('如需固化，将上述参数写入 HeuristicBot 构造函数默认值。');
}

main();
