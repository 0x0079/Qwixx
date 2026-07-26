/**
 * 多人局评估：给定权重文件，测 policy 在 2/3/4/5 人局对 heuristic 的胜率，
 * 逐局轮换座位（消除先手优势），并单独报告首位/末位的座位差。
 *
 * 用法：pnpm exec tsx scripts/eval-multiplayer.ts [weights.json]
 * 省略参数则评估现役 src/ai/weights/policy-classic.json。
 */
import { readFileSync } from 'node:fs';
import { newGame, currentActor, applyActionInPlace, configForBoard } from '../src/core/engine';
import { BOARD_PRESETS } from '../src/core/board';
import { HeuristicBot, makeRand, type Bot } from '../src/ai/bots';
import { PolicyBot } from '../src/ai/policy';
import type { SerializedMLP } from '../src/ai/mlp';

const weightsPath = process.argv[2] ?? 'src/ai/weights/policy-classic.json';
const weights = JSON.parse(readFileSync(weightsPath, 'utf8')) as SerializedMLP;
const makePolicy = () => new PolicyBot(weights, 'policy');

function play(bots: Bot[], seed: number): { scores: number[] } {
  const state = newGame(configForBoard(BOARD_PRESETS['classic']!, bots.length, seed));
  const rands = bots.map((_, i) => makeRand(seed * 7919 + i));
  while (state.phase !== 'gameOver') {
    const actor = currentActor(state);
    applyActionInPlace(state, bots[actor]!.chooseAction(state, actor, rands[actor]!));
  }
  return { scores: state.finalScores! };
}

/** policy 占 policySeat，其余 heuristic；返回 policy 是否夺魁（并列计 1/并列数）。 */
function policyWin(n: number, policySeat: number, seed: number): number {
  const bots: Bot[] = Array.from({ length: n }, (_, i) => (i === policySeat ? makePolicy() : new HeuristicBot()));
  const { scores } = play(bots, seed);
  const best = Math.max(...scores);
  const winners = scores.filter((s) => s === best).length;
  return scores[policySeat] === best ? 1 / winners : 0;
}

console.log(`权重：${weightsPath}\n`);
console.log('人数   胜率    基准    倍率   首位   末位   座位差');
for (const n of [2, 3, 4, 5]) {
  const games = 1200;
  let wins = 0;
  for (let g = 0; g < games; g++) wins += policyWin(n, g % n, 5000 + g); // 轮换座位
  const rate = wins / games;

  const seatGames = 800;
  let first = 0;
  let last = 0;
  for (let g = 0; g < seatGames; g++) {
    first += policyWin(n, 0, 60000 + g);
    last += policyWin(n, n - 1, 60000 + g);
  }
  const baseline = 1 / n;
  console.log(
    `${n} 人   ${(rate * 100).toFixed(1).padStart(5)}%  ${(baseline * 100).toFixed(1).padStart(5)}%  ${(rate / baseline).toFixed(2)}x  ` +
      `${((first / seatGames) * 100).toFixed(1).padStart(5)}%  ${((last / seatGames) * 100).toFixed(1).padStart(5)}%  ` +
      `${(((first - last) / seatGames) * 100).toFixed(1).padStart(5)}pp`,
  );
}
