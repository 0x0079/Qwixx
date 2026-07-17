import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameState } from '../core/types';
import {
  newGame,
  currentActor,
  legalActions,
  applyAction,
  whiteSum,
  DEFAULT_RULES,
} from '../core/engine';
import { BOARD_PRESETS, randomMixedBoard } from '../core/board';
import { computeScore } from '../core/scoring';
import { BOT_REGISTRY, makeRand, type Bot } from '../ai/bots';

type PlayerKind = 'human' | 'random' | 'greedy' | 'heuristic';

interface PlayerSetup {
  name: string;
  kind: PlayerKind;
}

interface Setup {
  players: PlayerSetup[];
  boardId: string;
  seed: number;
}

const KIND_LABEL: Record<PlayerKind, string> = {
  human: '人类',
  random: 'AI·随机',
  greedy: 'AI·贪心',
  heuristic: 'AI·启发式',
};

const COLOR_CSS: Record<string, string> = {
  red: '#d33f49',
  yellow: '#e0a500',
  green: '#3a9d5d',
  blue: '#3b6fd4',
};

const AI_DELAY_MS = 650;

export function App() {
  const [setup, setSetup] = useState<Setup>({
    players: [
      { name: '玩家 1', kind: 'human' },
      { name: '玩家 2', kind: 'heuristic' },
    ],
    boardId: 'classic',
    seed: Math.floor(Math.random() * 1_000_000),
  });
  const [game, setGame] = useState<GameState | null>(null);
  const [log, setLog] = useState<string[]>([]);

  if (!game) {
    return <SetupScreen setup={setup} setSetup={setSetup} onStart={() => {
      const board = setup.boardId === 'random'
        ? randomMixedBoard(setup.seed)
        : BOARD_PRESETS[setup.boardId]!;
      setLog([]);
      setGame(newGame({ ...DEFAULT_RULES, board, numPlayers: setup.players.length, seed: setup.seed }));
    }} />;
  }
  return (
    <GameScreen
      game={game}
      setGame={setGame}
      setup={setup}
      log={log}
      setLog={setLog}
      onExit={() => setGame(null)}
    />
  );
}

function SetupScreen({ setup, setSetup, onStart }: {
  setup: Setup;
  setSetup: (s: Setup) => void;
  onStart: () => void;
}) {
  const setPlayer = (i: number, p: Partial<PlayerSetup>) => {
    const players = setup.players.map((pl, j) => (j === i ? { ...pl, ...p } : pl));
    setSetup({ ...setup, players });
  };
  return (
    <div className="setup">
      <h1>Qwixx 快可思</h1>
      <p className="subtitle">经典骰子桌游电子版 · 支持人类与 AI 同桌对局</p>

      <section>
        <h2>玩家（1–5 人）</h2>
        {setup.players.map((p, i) => (
          <div className="player-row" key={i}>
            <input
              value={p.name}
              onChange={(e) => setPlayer(i, { name: e.target.value })}
            />
            <select value={p.kind} onChange={(e) => setPlayer(i, { kind: e.target.value as PlayerKind })}>
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <button
              disabled={setup.players.length <= 1}
              onClick={() => setSetup({ ...setup, players: setup.players.filter((_, j) => j !== i) })}
            >移除</button>
          </div>
        ))}
        <button
          disabled={setup.players.length >= 5}
          onClick={() => setSetup({
            ...setup,
            players: [...setup.players, { name: `玩家 ${setup.players.length + 1}`, kind: 'heuristic' }],
          })}
        >+ 添加玩家</button>
      </section>

      <section>
        <h2>记分卡</h2>
        <select value={setup.boardId} onChange={(e) => setSetup({ ...setup, boardId: e.target.value })}>
          <option value="classic">经典 Qwixx</option>
          <option value="gemixxt-a">gemixxt 变体 A（混色·数字有序）</option>
          <option value="gemixxt-b">gemixxt 变体 B（单色·数字乱序）</option>
          <option value="random">随机混排（每局不同）</option>
        </select>
      </section>

      <section>
        <h2>随机种子</h2>
        <div className="player-row">
          <input
            type="number"
            value={setup.seed}
            onChange={(e) => setSetup({ ...setup, seed: parseInt(e.target.value || '0', 10) })}
          />
          <button onClick={() => setSetup({ ...setup, seed: Math.floor(Math.random() * 1_000_000) })}>换一个</button>
        </div>
        <p className="hint">相同的种子 + 相同的选择 = 完全相同的一局（方便复盘与 AI 对比）。</p>
      </section>

      <button className="primary" onClick={onStart}>开始游戏</button>

      <details className="rules">
        <summary>规则速览</summary>
        <ul>
          <li>主动玩家掷 6 骰（2 白 + 4 彩）。<b>白骰之和</b>所有人都可以选择划记（每人至多一格）。</li>
          <li>之后<b>只有主动玩家</b>可再用「1 白 + 1 彩」之和划对应颜色的格子。</li>
          <li>每行只能<b>从左往右</b>划，跳过的格子不能回头。</li>
          <li>行内已划满 5 格才能划最右端数字并<b>锁定</b>该行（锁定格额外 +1 计数，对应彩骰移除）。</li>
          <li>主动玩家两步都没划 → 记 1 次<b>失误</b>（-5 分）。非主动玩家跳过无代价。</li>
          <li>锁定 2 行或有人 4 次失误 → 游戏立即结束；划 n 格得 n(n+1)/2 分。</li>
        </ul>
      </details>
    </div>
  );
}

function GameScreen({ game, setGame, setup, log, setLog, onExit }: {
  game: GameState;
  setGame: (g: GameState) => void;
  setup: Setup;
  log: string[];
  setLog: (l: string[]) => void;
  onExit: () => void;
}) {
  const bots = useRef<(Bot | null)[]>([]);
  const rands = useRef<(() => number)[]>([]);
  useEffect(() => {
    bots.current = setup.players.map((p) => (p.kind === 'human' ? null : BOT_REGISTRY[p.kind]!()));
    rands.current = setup.players.map((_, i) => makeRand(setup.seed * 31 + i));
  }, [setup]);

  const actor = currentActor(game);
  const legal = useMemo(() => legalActions(game), [game]);
  const isHumanTurn = actor >= 0 && setup.players[actor]!.kind === 'human';

  const describe = (playerIdx: number, a: Action, before: GameState): string => {
    const name = setup.players[playerIdx]!.name;
    if (a.type === 'skipWhite') {
      return playerIdx === before.activePlayer ? `${name} 白骰阶段跳过` : `${name} 跳过`;
    }
    if (a.type === 'skipColor') return `${name} 彩骰阶段跳过`;
    const cell = before.config.board.rows[a.row]!.cells[a.cell]!;
    const via = a.type === 'markWhite' ? '白骰' : '白+彩';
    return `${name} 用${via}划记 ${colorName(cell.color)}${cell.number}`;
  };

  const step = (a: Action) => {
    const before = game;
    const next = applyAction(before, a);
    const entries = [describe(actor, a, before)];
    // 报告新锁定与失误
    next.lockedRows.forEach((locked, r) => {
      if (locked && !before.lockedRows[r]) entries.push(`🔒 第 ${r + 1} 行被锁定`);
    });
    next.players.forEach((p, i) => {
      if (p.penalties > before.players[i]!.penalties) {
        entries.push(`⚠️ ${setup.players[i]!.name} 记 1 次失误（-5 分）`);
      }
    });
    if (next.phase === 'gameOver') entries.push('🏁 游戏结束！');
    setLog([...log, ...entries].slice(-60));
    setGame(next);
  };

  // AI 自动行动
  useEffect(() => {
    if (game.phase === 'gameOver') return;
    const a = currentActor(game);
    const bot = bots.current[a];
    if (!bot) return;
    const timer = setTimeout(() => {
      step(bot.chooseAction(game, a, rands.current[a]!));
    }, AI_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const markable = new Map<string, Action>();
  if (isHumanTurn) {
    for (const a of legal) {
      if (a.type === 'markWhite' || a.type === 'markColor') markable.set(`${a.row}:${a.cell}`, a);
    }
  }
  const skipAction = legal.find((a) => a.type === 'skipWhite' || a.type === 'skipColor');

  return (
    <div className="game">
      <header>
        <h1>Qwixx</h1>
        <span className="board-name">{game.config.board.name} · 第 {game.turn} 回合</span>
        <button onClick={onExit}>返回设置</button>
      </header>

      <DicePanel game={game} />

      <div className="status">
        {game.phase === 'gameOver' ? (
          <b>
            🏁 游戏结束 —— 胜者：{game.winners!.map((w) => setup.players[w]!.name).join('、')}
          </b>
        ) : (
          <>
            <b>{setup.players[game.activePlayer]!.name}</b> 的回合 ·{' '}
            {game.phase === 'whiteChoice'
              ? `白骰阶段（和 = ${whiteSum(game)}）：等待 ${setup.players[actor]!.name} 决定`
              : `彩骰阶段：${setup.players[actor]!.name} 可用 1 白 + 1 彩组合`}
            {isHumanTurn && skipAction && (
              <button className="skip" onClick={() => step(skipAction)}>
                {game.phase === 'whiteChoice' ? '跳过' : '跳过（结束回合）'}
              </button>
            )}
          </>
        )}
      </div>

      <div className="cards">
        {game.players.map((_, i) => (
          <PlayerCard
            key={i}
            game={game}
            playerIdx={i}
            name={`${setup.players[i]!.name}（${KIND_LABEL[setup.players[i]!.kind]}）`}
            isActor={i === actor && game.phase !== 'gameOver'}
            isActive={i === game.activePlayer && game.phase !== 'gameOver'}
            markable={i === actor ? markable : new Map()}
            onMark={step}
          />
        ))}
      </div>

      <div className="log">
        <h3>对局记录</h3>
        <ul>
          {log.slice().reverse().map((l, i) => <li key={log.length - i}>{l}</li>)}
        </ul>
      </div>
    </div>
  );
}

function DicePanel({ game }: { game: GameState }) {
  return (
    <div className="dice">
      {game.dice.white.map((v, i) => (
        <Die key={`w${i}`} value={v} color="white" />
      ))}
      {(['red', 'yellow', 'green', 'blue'] as const).map((c) => {
        const v = game.dice.colors[c];
        return v === undefined
          ? <Die key={c} value={null} color={c} />
          : <Die key={c} value={v} color={c} />;
      })}
      <span className="white-sum">白骰和 = {whiteSum(game)}</span>
    </div>
  );
}

function Die({ value, color }: { value: number | null; color: string }) {
  const bg = color === 'white' ? '#fff' : COLOR_CSS[color];
  const fg = color === 'white' || color === 'yellow' ? '#222' : '#fff';
  return (
    <span
      className={`die ${value === null ? 'removed' : ''}`}
      style={{ background: value === null ? '#ccc' : bg, color: fg }}
      title={value === null ? '骰子已移除' : undefined}
    >
      {value ?? '✕'}
    </span>
  );
}

function PlayerCard({ game, playerIdx, name, isActor, isActive, markable, onMark }: {
  game: GameState;
  playerIdx: number;
  name: string;
  isActor: boolean;
  isActive: boolean;
  markable: Map<string, Action>;
  onMark: (a: Action) => void;
}) {
  const p = game.players[playerIdx]!;
  const score = computeScore(game, playerIdx);
  return (
    <div className={`card ${isActor ? 'actor' : ''} ${isActive ? 'active' : ''}`}>
      <div className="card-head">
        <b>{name}</b>
        {isActive && <span className="badge">主动</span>}
        <span className="score">{score.total} 分</span>
      </div>
      {game.config.board.rows.map((rowDef, r) => (
        <div className={`row ${game.lockedRows[r] ? 'locked' : ''}`} key={r}>
          {rowDef.cells.map((cell, i) => {
            const key = `${r}:${i}`;
            const clickable = markable.has(key);
            return (
              <button
                key={i}
                className={`cell ${p.marks[r]![i] ? 'marked' : ''} ${clickable ? 'clickable' : ''}`}
                style={{ background: COLOR_CSS[cell.color] }}
                disabled={!clickable}
                onClick={() => onMark(markable.get(key)!)}
              >
                {p.marks[r]![i] ? '✗' : cell.number}
              </button>
            );
          })}
          <span className="lock-flag">{game.lockedRows[r] ? '🔒' : ''}</span>
        </div>
      ))}
      <div className="card-foot">
        失误：{'✗'.repeat(p.penalties)}{'○'.repeat(Math.max(0, game.config.maxPenalties - p.penalties))}
        <span className="score-detail">
          {score.groupPoints.join(' + ')} − {score.penaltyPoints}
        </span>
      </div>
    </div>
  );
}

function colorName(c: string): string {
  return { red: '红', yellow: '黄', green: '绿', blue: '蓝' }[c] ?? c;
}
