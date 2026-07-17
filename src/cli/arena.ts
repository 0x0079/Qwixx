/**
 * 自对弈竞技场：让机器人互相对战，统计胜率与平均分，可导出轨迹用于 AI 训练。
 *
 * 用法：
 *   npm run arena -- --games 1000 --bots heuristic,greedy,random --board classic --seed 42
 *   npm run arena -- --games 100 --bots heuristic,heuristic --traj out/traj.jsonl
 */
import { mkdirSync, createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { newGame, currentActor, applyActionInPlace, legalActions, DEFAULT_RULES } from '../core/engine';
import { BOARD_PRESETS, randomMixedBoard } from '../core/board';
import type { GameState } from '../core/types';
import { BOT_REGISTRY, makeRand, type Bot } from '../ai/bots';
import { encodeObservation, actionToIndex } from '../ai/encode';

interface Args {
  games: number;
  bots: string[];
  board: string;
  seed: number;
  traj?: string;
  rotate: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { games: 100, bots: ['heuristic', 'random'], board: 'classic', seed: 1, rotate: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i]!;
    if (a === '--games') args.games = parseInt(next(), 10);
    else if (a === '--bots') args.bots = next().split(',');
    else if (a === '--board') args.board = next();
    else if (a === '--seed') args.seed = parseInt(next(), 10);
    else if (a === '--traj') args.traj = next();
    else if (a === '--no-rotate') args.rotate = false;
  }
  return args;
}

function playGame(
  bots: Bot[],
  board: string,
  seed: number,
  trajOut?: NodeJS.WritableStream,
): GameState {
  const boardDef = board.startsWith('random')
    ? randomMixedBoard(seed)
    : BOARD_PRESETS[board] ?? BOARD_PRESETS['classic']!;
  const state = newGame({
    ...DEFAULT_RULES,
    board: boardDef,
    numPlayers: bots.length,
    seed,
  });
  const rands = bots.map((_, i) => makeRand(seed * 7919 + i));
  let steps = 0;
  while (state.phase !== 'gameOver') {
    if (++steps > 100000) throw new Error('game did not terminate');
    const actor = currentActor(state);
    const action = bots[actor]!.chooseAction(state, actor, rands[actor]!);
    if (trajOut) {
      trajOut.write(
        JSON.stringify({
          seed,
          turn: state.turn,
          actor,
          bot: bots[actor]!.name,
          obs: Array.from(encodeObservation(state, actor)),
          action: actionToIndex(action),
        }) + '\n',
      );
    }
    applyActionInPlace(state, action);
  }
  return state;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const botNames = args.bots;
  for (const b of botNames) {
    if (!BOT_REGISTRY[b]) {
      console.error(`未知机器人 "${b}"，可选：${Object.keys(BOT_REGISTRY).join(', ')}`);
      process.exit(1);
    }
  }

  let trajStream: NodeJS.WritableStream | undefined;
  if (args.traj) {
    mkdirSync(dirname(args.traj), { recursive: true });
    trajStream = createWriteStream(args.traj);
  }

  const n = botNames.length;
  const wins = new Array<number>(n).fill(0);
  const scoreSum = new Array<number>(n).fill(0);
  const penaltySum = new Array<number>(n).fill(0);
  let totalTurns = 0;

  const t0 = Date.now();
  for (let g = 0; g < args.games; g++) {
    // 轮换座位消除先手优势：第 g 局第 i 个座位由 bot[(i+g)%n] 执掌。
    const offset = args.rotate ? g % n : 0;
    const seatBots = botNames.map((_, i) => BOT_REGISTRY[botNames[(i + offset) % n]!]!());
    const final = playGame(seatBots, args.board, args.seed + g, trajStream);
    totalTurns += final.turn;
    final.finalScores!.forEach((s, seat) => {
      const botIdx = (seat + offset) % n;
      scoreSum[botIdx]! += s;
      penaltySum[botIdx]! += final.players[seat]!.penalties;
    });
    for (const w of final.winners!) {
      wins[(w + offset) % n]! += 1 / final.winners!.length;
    }
  }
  const ms = Date.now() - t0;
  if (trajStream) trajStream.end();

  console.log(`\n对局数: ${args.games}  棋盘: ${args.board}  用时: ${ms}ms  平均回合数: ${(totalTurns / args.games).toFixed(1)}\n`);
  console.log('机器人        胜率      平均分    平均失误');
  botNames.forEach((b, i) => {
    console.log(
      `${b.padEnd(12)}  ${((wins[i]! / args.games) * 100).toFixed(1).padStart(5)}%   ${(scoreSum[i]! / args.games).toFixed(1).padStart(6)}    ${(penaltySum[i]! / args.games).toFixed(2)}`,
    );
  });
  if (args.traj) console.log(`\n轨迹已写入 ${args.traj}`);
}

main();
