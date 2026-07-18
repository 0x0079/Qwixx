import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Action, GameState } from '../core/types';
import {
  newGame,
  currentActor,
  legalActions,
  applyAction,
  whiteSum,
  rightmostMark,
  configForBoard,
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
  seed: string;
}

interface BoardOption {
  id: string;
  title: string;
  tag: string;
  description: string;
  meta: string;
}

const KIND_LABEL: Record<PlayerKind, string> = {
  human: '人类玩家',
  random: '随机 AI',
  greedy: '贪心 AI',
  heuristic: '启发式 AI',
};

const KIND_SHORT: Record<PlayerKind, string> = {
  human: '人类',
  random: '随机',
  greedy: '贪心',
  heuristic: '启发式',
};

const BOARD_OPTIONS: BoardOption[] = [
  {
    id: 'classic',
    title: '经典 Qwixx',
    tag: '推荐入门',
    description: '标准四色记分卡，规则直观，适合第一次对局。',
    meta: '2–12 · 经典规则',
  },
  {
    id: 'gemixxt-a',
    title: 'gemixxt A',
    tag: '策略变化',
    description: '数字依旧有序，但颜色在每行中交错分布。',
    meta: '混色 · 数字有序',
  },
  {
    id: 'gemixxt-b',
    title: 'gemixxt B',
    tag: '进阶',
    description: '每行保持单色，数字顺序被重新打乱。',
    meta: '单色 · 数字乱序',
  },
  {
    id: 'longo',
    title: 'Qwixx Longo',
    tag: '长局',
    description: '更长的数字行、八面骰与专属幸运数字。',
    meta: '2–16 · 幸运数字',
  },
  {
    id: 'big-points',
    title: 'Qwixx Big Points',
    tag: '高分',
    description: '加入双色奖励行，制造更多连锁得分机会。',
    meta: '奖励行 · 15 格计分',
  },
  {
    id: 'random',
    title: '随机混排',
    tag: '每局不同',
    description: '数字与颜色都由种子生成，考验临场判断。',
    meta: '自定义变体 · 可复现',
  },
];

const COLOR_CSS: Record<string, string> = {
  red: '#d94752',
  yellow: '#e0a312',
  green: '#2d9560',
  blue: '#3971ce',
};

const AI_DELAY_MS = 300;
const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export function App() {
  const [setup, setSetup] = useState<Setup>({
    players: [
      { name: '玩家 1', kind: 'human' },
      { name: '小 Q', kind: 'heuristic' },
    ],
    boardId: 'classic',
    seed: '',
  });
  const [game, setGame] = useState<GameState | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const startGame = () => {
    const explicitSeed = Number.parseInt(setup.seed, 10);
    const matchSeed = setup.seed.trim() === '' || !Number.isFinite(explicitSeed)
      ? randomSeed()
      : explicitSeed;
    const board = setup.boardId === 'random'
      ? randomMixedBoard(matchSeed)
      : BOARD_PRESETS[setup.boardId]!;
    setLog([]);
    setGame(newGame(configForBoard(board, setup.players.length, matchSeed)));
  };

  if (!game) {
    return <SetupScreen setup={setup} setSetup={setSetup} onStart={startGame} />;
  }

  return (
    <GameScreen
      game={game}
      setGame={setGame}
      setup={setup}
      log={log}
      setLog={setLog}
      onExit={() => setGame(null)}
      onRestart={startGame}
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
  const selectedBoard = BOARD_OPTIONS.find((board) => board.id === setup.boardId)!;
  const humanCount = setup.players.filter((player) => player.kind === 'human').length;
  const blankNames = setup.players.some((player) => !player.name.trim());

  return (
    <main className="setup-page">
      <header className="setup-hero">
        <BrandMark />
        <div className="hero-copy">
          <div className="eyebrow">经典骰子桌游 · 数字版</div>
          <h1>Qwixx <span>快可思</span></h1>
          <p>掷骰、取舍、锁行。和朋友或 AI 开始一场节奏轻快的策略对局。</p>
        </div>
        <div className="hero-dice" aria-hidden="true">
          <span className="mini-die die-red">4</span>
          <span className="mini-die die-white">2</span>
          <span className="mini-die die-blue">6</span>
        </div>
      </header>

      <div className="setup-layout">
        <div className="setup-main">
          <section className="panel setup-section" aria-labelledby="players-title">
            <div className="section-heading">
              <span className="step-number">1</span>
              <div>
                <h2 id="players-title">选择玩家</h2>
                <p>支持 1–5 人热座，也可以邀请不同风格的 AI。</p>
              </div>
              <span className="section-count">{setup.players.length} / 5</span>
            </div>

            <div className="player-list">
              {setup.players.map((player, i) => (
                <div className="player-row" key={i}>
                  <div className={`player-avatar avatar-${i % 5}`} aria-hidden="true">
                    {player.name.trim().charAt(0) || i + 1}
                  </div>
                  <div className="player-identity">
                    <label htmlFor={`player-name-${i}`}>座位 {i + 1}</label>
                    <input
                      id={`player-name-${i}`}
                      value={player.name}
                      aria-invalid={!player.name.trim()}
                      placeholder={`玩家 ${i + 1}`}
                      maxLength={20}
                      onChange={(e) => setPlayer(i, { name: e.target.value })}
                    />
                  </div>
                  <div className="player-type">
                    <label className="sr-only" htmlFor={`player-kind-${i}`}>玩家类型</label>
                    <select
                      id={`player-kind-${i}`}
                      value={player.kind}
                      onChange={(e) => setPlayer(i, { kind: e.target.value as PlayerKind })}
                    >
                      {Object.entries(KIND_LABEL).map(([kind, label]) => (
                        <option key={kind} value={kind}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="icon-button danger-ghost"
                    type="button"
                    aria-label={`移除${player.name || `玩家 ${i + 1}`}`}
                    title="移除玩家"
                    disabled={setup.players.length <= 1}
                    onClick={() => setSetup({ ...setup, players: setup.players.filter((_, j) => j !== i) })}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
            </div>

            <button
              className="add-player"
              type="button"
              disabled={setup.players.length >= 5}
              onClick={() => setSetup({
                ...setup,
                players: [...setup.players, { name: `玩家 ${setup.players.length + 1}`, kind: 'heuristic' }],
              })}
            >
              <Icon name="plus" />
              添加玩家
              <span>{setup.players.length >= 5 ? '已达上限' : '人类或 AI'}</span>
            </button>
          </section>

          <section className="panel setup-section" aria-labelledby="board-title">
            <div className="section-heading">
              <span className="step-number">2</span>
              <div>
                <h2 id="board-title">选择记分卡</h2>
                <p>从经典规则开始，或尝试更具变化的扩展玩法。</p>
              </div>
            </div>

            <div className="board-grid" role="radiogroup" aria-label="记分卡类型">
              {BOARD_OPTIONS.map((board) => {
                const selected = setup.boardId === board.id;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`board-option ${selected ? 'selected' : ''}`}
                    key={board.id}
                    onClick={() => setSetup({ ...setup, boardId: board.id })}
                  >
                    <span className="board-swatch" aria-hidden="true">
                      <i /><i /><i /><i />
                    </span>
                    <span className="board-copy">
                      <span className="board-title-row">
                        <strong>{board.title}</strong>
                        <small>{board.tag}</small>
                      </span>
                      <span>{board.description}</span>
                      <em>{board.meta}</em>
                    </span>
                    <span className="radio-check" aria-hidden="true"><Icon name="check" /></span>
                  </button>
                );
              })}
            </div>
          </section>

        </div>

        <aside className="setup-aside">
          <section className="panel match-summary">
            <div className="summary-kicker"><Icon name="sparkles" /> 对局预览</div>
            <h2>{selectedBoard.title}</h2>
            <p>{selectedBoard.description}</p>

            <div className="summary-stats">
              <div><span>玩家</span><strong>{setup.players.length} 人</strong></div>
              <div><span>人类</span><strong>{humanCount} 位</strong></div>
              <div><span>AI</span><strong>{setup.players.length - humanCount} 位</strong></div>
            </div>

            <div className="roster-preview">
              {setup.players.map((player, i) => (
                <div key={i}>
                  <span className={`roster-dot dot-${i % 5}`} />
                  <strong>{player.name.trim() || `座位 ${i + 1}`}</strong>
                  <em>{KIND_SHORT[player.kind]}</em>
                </div>
              ))}
            </div>

            <div className="start-seed">
              <div className="start-seed-heading">
                <label htmlFor="game-seed">随机种子 <span>可选</span></label>
                <small>{setup.seed ? `固定复现 #${setup.seed}` : '每次开始自动生成'}</small>
              </div>
              <div className="seed-entry">
                <input
                  id="game-seed"
                  type="number"
                  value={setup.seed}
                  aria-describedby="seed-hint"
                  placeholder="留空则每局随机"
                  step="1"
                  onChange={(e) => setSetup({ ...setup, seed: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-button"
                  title="生成可复现种子"
                  aria-label="生成可复现随机种子"
                  onClick={() => setSetup({ ...setup, seed: String(randomSeed()) })}
                >
                  <Icon name="shuffle" />
                </button>
              </div>
              <p id="seed-hint">
                {setup.seed ? '使用这个数字即可重现同一骰序。' : '保持留空，每次开始都会是新局。'}
              </p>
            </div>

            <button className="primary start-button" type="button" disabled={blankNames} onClick={onStart}>
              开始游戏
              <Icon name="arrow" />
            </button>
            {blankNames ? (
              <p className="form-error" role="alert">请先为每个座位填写玩家名称。</p>
            ) : (
              <p className="ready-note"><Icon name="check" /> 已准备好，祝你手气不错</p>
            )}
          </section>

          <section className="panel rules" aria-labelledby="rules-title">
            <div className="rules-heading"><Icon name="book" /><h2 id="rules-title">规则速览</h2></div>
            <ol>
              <li><b>全员行动：</b>所有玩家都可用两颗白骰之和划一格。</li>
              <li><b>主动加码：</b>主动玩家可再用一白一彩之和划对应颜色。</li>
              <li><b>从左到右：</b>跳过的数字不能回头，选择要谨慎。</li>
              <li><b>结束条件：</b>锁定 2 行或任一玩家累计 4 次失误。</li>
            </ol>
          </section>
        </aside>
      </div>

      <footer className="setup-footer">本地对局 · 无需登录 · 游戏进度仅保留在当前页面</footer>
    </main>
  );
}

function GameScreen({ game, setGame, setup, log, setLog, onExit, onRestart }: {
  game: GameState;
  setGame: (g: GameState) => void;
  setup: Setup;
  log: string[];
  setLog: (l: string[]) => void;
  onExit: () => void;
  onRestart: () => void;
}) {
  const bots = useRef<(Bot | null)[]>([]);
  const rands = useRef<(() => number)[]>([]);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  useEffect(() => {
    bots.current = setup.players.map((p) => (p.kind === 'human' ? null : BOT_REGISTRY[p.kind]!()));
    rands.current = setup.players.map((_, i) => makeRand(game.config.seed * 31 + i));
  }, [game.config.seed, setup.players]);

  useEffect(() => {
    if (!showExitConfirm) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowExitConfirm(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showExitConfirm]);

  const actor = currentActor(game);
  const legal = useMemo(() => legalActions(game), [game]);
  const isHumanTurn = actor >= 0 && setup.players[actor]!.kind === 'human';
  const legalMarks = legal.filter((action) => !action.type.startsWith('skip')).length;

  const describe = (playerIdx: number, action: Action, before: GameState): string => {
    const name = setup.players[playerIdx]!.name;
    switch (action.type) {
      case 'skipWhite':
        return playerIdx === before.activePlayer ? `${name} 跳过白骰选择` : `${name} 选择跳过`;
      case 'skipColor':
        return `${name} 结束本回合`;
      case 'markLucky': {
        const target = rightmostMark(before, playerIdx, action.row) + 1;
        const cell = before.config.board.rows[action.row]!.cells[target]!;
        return `${name} ⭐ 用幸运数字划记 ${colorName(cell.color)}色 ${cell.number}`;
      }
      case 'markBonusWhite':
      case 'markBonusColor': {
        const n = before.config.board.bonusRows![action.bonus]!.numbers[action.cell]!;
        return `${name} 划记奖励格 ${n}`;
      }
      default: {
        const cell = before.config.board.rows[action.row]!.cells[action.cell]!;
        const via = action.type === 'markWhite' ? '白骰' : '白骰 + 彩骰';
        return `${name} 用${via}划记 ${colorName(cell.color)}色 ${cell.number}`;
      }
    }
  };

  const step = (action: Action) => {
    const before = game;
    const next = applyAction(before, action);
    const entries = [describe(actor, action, before)];
    next.lockedRows.forEach((locked, row) => {
      if (locked && !before.lockedRows[row]) entries.push(`🔒 第 ${row + 1} 行被锁定`);
    });
    next.players.forEach((player, i) => {
      if (player.penalties > before.players[i]!.penalties) {
        entries.push(`⚠️ ${setup.players[i]!.name} 记 1 次失误（-5 分）`);
      }
    });
    if (next.phase === 'gameOver') entries.push('🏁 游戏结束，最终得分已结算');
    setLog([...log, ...entries].slice(-60));
    setGame(next);
  };

  useEffect(() => {
    if (game.phase === 'gameOver') return;
    const current = currentActor(game);
    const bot = bots.current[current];
    if (!bot) return;
    const timer = window.setTimeout(() => {
      step(bot.chooseAction(game, current, rands.current[current]!));
    }, AI_DELAY_MS);
    return () => window.clearTimeout(timer);
    // step follows the current immutable game snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const markable = new Map<string, Action>();
  if (isHumanTurn) {
    for (const action of legal) {
      if (action.type === 'markWhite' || action.type === 'markColor') {
        markable.set(`${action.row}:${action.cell}`, action);
      } else if (action.type === 'markBonusWhite' || action.type === 'markBonusColor') {
        markable.set(`b:${action.bonus}:${action.cell}`, action);
      }
    }
    for (const action of legal) {
      if (action.type === 'markLucky') {
        const key = `${action.row}:${rightmostMark(game, actor, action.row) + 1}`;
        if (!markable.has(key)) markable.set(key, action);
      }
    }
  }
  const skipAction = legal.find((action) => action.type === 'skipWhite' || action.type === 'skipColor');
  const lockedCount = game.lockedRows.filter(Boolean).length;

  return (
    <main className="game-page">
      <header className="game-header">
        <div className="game-brand"><BrandMark compact /><strong>Qwixx</strong></div>
        <div className="game-title">
          <span>{game.config.board.name}</span>
          <strong>第 {game.turn} 回合</strong>
        </div>
        <div className="game-meta">
          <span className="seed-meta" title={`本局随机种子：${game.config.seed}`}><Icon name="shuffle" /> 种子 {game.config.seed}</span>
          <span className="lock-meta"><Icon name="lock" /> {lockedCount} / {game.config.locksToEnd} 行锁定</span>
          <button type="button" className="ghost-button" onClick={() => setShowExitConfirm(true)}>
            <Icon name="exit" /> 退出对局
          </button>
        </div>
      </header>

      {game.phase === 'gameOver' ? (
        <GameOverPanel game={game} setup={setup} onRestart={onRestart} onExit={onExit} />
      ) : (
        <>
          <section className="turn-overview" aria-label="当前回合">
            <div className="turn-owner">
              <span className={`player-avatar avatar-${game.activePlayer % 5}`} aria-hidden="true">
                {setup.players[game.activePlayer]!.name.charAt(0)}
              </span>
              <div><span>主动玩家</span><strong>{setup.players[game.activePlayer]!.name}</strong></div>
            </div>
            <div className="phase-steps" aria-label="回合进度">
              <div className={`phase-step ${game.phase === 'whiteChoice' ? 'current' : 'done'}`}>
                <span>{game.phase === 'whiteChoice' ? '1' : <Icon name="check" />}</span>
                <div><strong>全员选择</strong><small>两颗白骰之和</small></div>
              </div>
              <i />
              <div className={`phase-step ${game.phase === 'colorChoice' ? 'current' : ''}`}>
                <span>2</span>
                <div><strong>主动加码</strong><small>一白骰 + 一彩骰</small></div>
              </div>
            </div>
          </section>

          <DicePanel game={game} />

          <section className={`action-banner ${isHumanTurn ? 'human-action' : 'ai-action'}`} aria-live="polite">
            <span className="action-icon"><Icon name={isHumanTurn ? 'target' : 'bot'} /></span>
            <div className="action-copy">
              <span>{isHumanTurn ? '轮到你行动' : '等待玩家行动'}</span>
              <strong>{actionTitle(game, setup, actor, legalMarks, isHumanTurn)}</strong>
              <small>{actionDescription(game, legalMarks, isHumanTurn)}</small>
            </div>
            {isHumanTurn && legalMarks > 0 && <span className="choice-count">{legalMarks} 个可选格</span>}
            {!isHumanTurn && <span className="thinking"><i /><i /><i /></span>}
          </section>
        </>
      )}

      <section className="scoreboard-strip" aria-label="实时比分">
        {game.players
          .map((_, i) => ({ i, score: computeScore(game, i).total }))
          .sort((a, b) => b.score - a.score)
          .map(({ i, score }, rank) => (
            <div className={`${i === actor && game.phase !== 'gameOver' ? 'is-actor' : ''}`} key={i}>
              <span>{rank + 1}</span>
              <span className={`roster-dot dot-${i % 5}`} />
              <strong>{setup.players[i]!.name}</strong>
              <em>{game.players[i]!.penalties > 0 ? `${game.players[i]!.penalties} 次失误` : KIND_SHORT[setup.players[i]!.kind]}</em>
              <b>{score}</b>
            </div>
          ))}
      </section>

      <section className="cards" aria-label="玩家记分卡">
        {game.players.map((_, i) => (
          <PlayerCard
            key={i}
            game={game}
            playerIdx={i}
            name={setup.players[i]!.name}
            kind={setup.players[i]!.kind}
            isActor={i === actor && game.phase !== 'gameOver'}
            isActive={i === game.activePlayer && game.phase !== 'gameOver'}
            markable={i === actor ? markable : new Map()}
            onMark={step}
            onSkip={i === actor && isHumanTurn && skipAction ? () => step(skipAction) : undefined}
            skipLabel={game.phase === 'whiteChoice' ? '本次跳过' : '结束回合'}
          />
        ))}
      </section>

      <section className="log-panel">
        <div className="log-heading">
          <div><Icon name="history" /><h2>对局记录</h2></div>
          <span>{log.length > 0 ? `最近 ${log.length} 条` : '等待第一步'}</span>
        </div>
        {log.length === 0 ? (
          <div className="empty-log"><Icon name="sparkles" /> 第一条行动记录会出现在这里</div>
        ) : (
          <ol className="log-list">
            {log.slice().reverse().map((entry, i) => (
              <li key={log.length - i} className={i === 0 ? 'latest' : ''}>
                <span>{log.length - i}</span><p>{entry}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="sr-only" aria-live="polite">{log.at(-1) ?? ''}</div>

      {showExitConfirm && (
        <div className="modal-backdrop" onMouseDown={() => setShowExitConfirm(false)}>
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="dialog-icon"><Icon name="exit" /></span>
            <h2 id="exit-title">退出当前对局？</h2>
            <p>本局进度尚未保存，退出后将返回玩家与记分卡设置。</p>
            <div>
              <button type="button" className="secondary-button" autoFocus onClick={() => setShowExitConfirm(false)}>继续游戏</button>
              <button type="button" className="danger-button" onClick={onExit}>退出对局</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function GameOverPanel({ game, setup, onRestart, onExit }: {
  game: GameState;
  setup: Setup;
  onRestart: () => void;
  onExit: () => void;
}) {
  const winnerNames = game.winners!.map((winner) => setup.players[winner]!.name).join('、');
  return (
    <section className="game-over-panel">
      <span className="trophy"><Icon name="trophy" /></span>
      <div className="game-over-copy">
        <span>对局结束</span>
        <h1>{winnerNames} 获胜！</h1>
        <p>最终比分已结算。可以用相同设置再来一局，或返回调整阵容。</p>
      </div>
      <div className="game-over-actions">
        <button className="primary" type="button" onClick={onRestart}><Icon name="repeat" /> 再来一局</button>
        <button className="secondary-button" type="button" onClick={onExit}>返回设置</button>
      </div>
    </section>
  );
}

function DicePanel({ game }: { game: GameState }) {
  return (
    <section className="dice-panel" aria-label="本回合骰子">
      <div className="dice-group white-dice-group">
        <div className="dice-label"><span>公共骰</span><strong>所有玩家可用</strong></div>
        <div className="dice-pair">
          <span className="sum-card"><small>白骰和</small><strong>{whiteSum(game)}</strong></span>
          <span className="sum-sign" aria-hidden="true">=</span>
          <Die value={game.dice.white[0]} color="white" />
          <span className="sum-sign" aria-hidden="true">+</span>
          <Die value={game.dice.white[1]} color="white" />
        </div>
      </div>
      <div className="dice-divider" />
      <div className="dice-group">
        <div className="dice-label"><span>彩色骰</span><strong>仅主动玩家可组合</strong></div>
        <div className="color-dice">
          {(['red', 'yellow', 'green', 'blue'] as const).map((color) => {
            const value = game.dice.colors[color];
            return <Die key={color} value={value ?? null} color={color} />;
          })}
        </div>
      </div>
    </section>
  );
}

function Die({ value, color }: { value: number | null; color: string }) {
  const background = color === 'white' ? '#fff' : COLOR_CSS[color];
  const foreground = color === 'white' || color === 'yellow' ? '#17201a' : '#fff';
  const label = color === 'white' ? '白骰' : `${colorName(color)}色骰`;
  return (
    <span
      className={`die ${value === null ? 'removed' : ''}`}
      style={{ background: value === null ? '#d7d7d0' : background, color: foreground }}
      title={value === null ? `${label}已移除` : `${label}：${value}`}
      aria-label={value === null ? `${label}已移除` : `${label}点数 ${value}`}
    >
      {value ?? '×'}
    </span>
  );
}

function PlayerCard({ game, playerIdx, name, kind, isActor, isActive, markable, onMark, onSkip, skipLabel }: {
  game: GameState;
  playerIdx: number;
  name: string;
  kind: PlayerKind;
  isActor: boolean;
  isActive: boolean;
  markable: Map<string, Action>;
  onMark: (a: Action) => void;
  onSkip?: () => void;
  skipLabel: string;
}) {
  const player = game.players[playerIdx]!;
  const board = game.config.board;
  const score = computeScore(game, playerIdx);
  const lucky = game.config.luckyNumbers?.[playerIdx];
  const totalMarks = player.marks.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
    + player.bonusMarks.reduce((sum, row) => sum + row.filter(Boolean).length, 0);

  const renderBonusRow = (bonus: number) => {
    const bonusDef = board.bonusRows![bonus]!;
    const bonusCount = player.bonusMarks[bonus]!.filter(Boolean).length;
    return (
      <div className="score-row bonus-row" key={`b${bonus}`}>
        <div
          className="row-cells"
          style={{ gridTemplateColumns: `repeat(${bonusDef.numbers.length}, minmax(31px, 44px))` }}
        >
          {bonusDef.numbers.map((number, cell) => {
            const key = `b:${bonus}:${cell}`;
            const action = markable.get(key);
            const cTop = COLOR_CSS[board.rows[bonusDef.adjacent[0]]!.cells[cell]!.color];
            const cBottom = COLOR_CSS[board.rows[bonusDef.adjacent[1]]!.cells[cell]!.color];
            return (
              <button
                key={cell}
                className={`cell bonus ${player.bonusMarks[bonus]![cell] ? 'marked' : ''} ${action ? 'clickable' : ''}`}
                style={{ background: `linear-gradient(180deg, ${cTop} 50%, ${cBottom} 50%)` }}
                disabled={!action}
                title={action ? actionTooltip(action, game) : undefined}
                aria-label={`${player.bonusMarks[bonus]![cell] ? '已划记' : '奖励格'} ${number}${action ? '，可以选择' : ''}`}
                onClick={() => action && onMark(action)}
              >
                {player.bonusMarks[bonus]![cell] ? '×' : number}
              </button>
            );
          })}
        </div>
        <span className="lock-flag" />
        <span className="row-progress bonus-progress" aria-label={`${bonusCount} 个奖励格已划记`}>
          <b>{bonusCount}</b><small>奖励</small>
        </span>
      </div>
    );
  };

  const long = board.rows[0]!.cells.length > 12;
  return (
    <article className={`card ${isActor ? 'actor' : ''} ${isActive ? 'active' : ''} ${long ? 'long' : ''}`}>
      <div className="card-head">
        <span className={`player-avatar avatar-${playerIdx % 5}`} aria-hidden="true">{name.charAt(0)}</span>
        <div className="card-player">
          <div className="player-name-line">
            <strong>{name}</strong>
            {isActive && <span className="badge active-player-badge">主动玩家</span>}
          </div>
          <span>{KIND_LABEL[kind]} · {totalMarks} 次划记</span>
        </div>
        <div className="card-badges">
          {isActor && <span className="badge actor-badge">正在选择</span>}
          {lucky && <span className="lucky-badge">⭐ {lucky.join(' / ')}</span>}
          {onSkip && (
            <button className="card-skip-button" type="button" aria-label={`${skipLabel}，${name}`} onClick={onSkip}>
              {skipLabel}<Icon name="skip" />
            </button>
          )}
        </div>
        <div className="card-score"><strong>{score.total}</strong><span>分</span></div>
      </div>

      <div className="sheet-scroll" tabIndex={long ? 0 : undefined} aria-label={long ? `${name} 的记分卡，可横向滚动` : undefined}>
        <div className="score-sheet">
          {board.rows.map((rowDef, row) => (
            <div key={row}>
              <div className={`score-row ${game.lockedRows[row] ? 'locked' : ''}`}>
                <div
                  className="row-cells"
                  style={{ gridTemplateColumns: `repeat(${rowDef.cells.length}, minmax(31px, 44px))` }}
                >
                  {rowDef.cells.map((cell, cellIndex) => {
                    const key = `${row}:${cellIndex}`;
                    const action = markable.get(key);
                    const viaLucky = action?.type === 'markLucky';
                    const marked = player.marks[row]![cellIndex];
                    return (
                      <button
                        key={cellIndex}
                        className={`cell ${marked ? 'marked' : ''} ${action ? 'clickable' : ''} ${viaLucky ? 'lucky' : ''}`}
                        style={{ background: COLOR_CSS[cell.color] }}
                        disabled={!action}
                        title={action ? actionTooltip(action, game) : undefined}
                        aria-label={`${colorName(cell.color)}色 ${cell.number}${marked ? '，已划记' : action ? '，可以选择' : ''}`}
                        onClick={() => action && onMark(action)}
                      >
                        {marked ? '×' : cell.number}
                      </button>
                    );
                  })}
                </div>
                <span className="lock-flag" title={game.lockedRows[row] ? '此行已锁定' : '锁定格'}>
                  {game.lockedRows[row] ? <Icon name="lock" /> : <Icon name="flag" />}
                </span>
                {board.scoreBy === 'row' && (
                  <span
                    className={`row-progress ${game.lockedRows[row] ? 'is-locked' : ''}`}
                    aria-label={`第 ${row + 1} 行计分 ${score.groupCounts[row]} 格，${score.groupPoints[row]} 分`}
                  >
                    <b>{score.groupCounts[row]}</b><small>格</small><em>{score.groupPoints[row]} 分</em>
                  </span>
                )}
              </div>
              {(board.bonusRows ?? []).map((bonusDef, bonus) => (
                bonusDef.adjacent[0] === row ? renderBonusRow(bonus) : null
              ))}
            </div>
          ))}
        </div>
      </div>

      <footer className="card-foot">
        <div className="penalties" aria-label={`${player.penalties} 次失误`}>
          <span>失误</span>
          {Array.from({ length: game.config.maxPenalties }, (_, i) => (
            <i className={i < player.penalties ? 'filled' : ''} key={i}>{i < player.penalties ? '×' : ''}</i>
          ))}
        </div>
        <span className="score-detail">行分 {score.groupPoints.join(' + ')} <b>− {score.penaltyPoints}</b></span>
      </footer>
    </article>
  );
}

function actionTitle(game: GameState, setup: Setup, actor: number, legalMarks: number, isHumanTurn: boolean): string {
  const name = setup.players[actor]!.name;
  if (!isHumanTurn) return `${name} 正在思考…`;
  if (legalMarks === 0) return `${name}，当前没有可划记的格子`;
  return game.phase === 'whiteChoice'
    ? `${name}，请选择数字 ${whiteSum(game)}`
    : `${name}，选择一个白骰 + 彩骰组合`;
}

function actionDescription(game: GameState, legalMarks: number, isHumanTurn: boolean): string {
  if (!isHumanTurn) return 'AI 完成选择后会自动继续，请稍候。';
  if (legalMarks === 0) return game.phase === 'whiteChoice' ? '跳过不会受到惩罚。' : '结束回合；若本回合没有划记，将记录一次失误。';
  return game.phase === 'whiteChoice'
    ? '记分卡上带绿色描边的格子可以点击；非主动玩家跳过无惩罚。'
    : '只可划对应彩骰颜色的格子，也可以选择结束本回合。';
}

function actionTooltip(action: Action, game: GameState): string {
  if (action.type === 'markLucky') return '使用幸运数字划记下一格';
  if (action.type === 'markWhite') return `使用两颗白骰之和 ${whiteSum(game)}`;
  if (action.type === 'markColor') {
    const cell = game.config.board.rows[action.row]!.cells[action.cell]!;
    const colorDie = game.dice.colors[cell.color]!;
    const whites = [...new Set(game.dice.white.filter((white) => white + colorDie === cell.number))];
    return `使用白骰 ${whites.join(' 或 ')} + ${colorName(cell.color)}色骰 ${colorDie}`;
  }
  return action.type === 'markBonusWhite' ? '使用白骰和划记奖励格' : '使用白骰 + 彩骰划记奖励格';
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark ${compact ? 'compact' : ''}`} aria-hidden="true">
      <span /><span /><span /><span />
      <b>Q</b>
    </div>
  );
}

type IconName = 'plus' | 'trash' | 'check' | 'repeat' | 'shuffle' | 'sparkles' | 'arrow'
  | 'book' | 'chevron' | 'lock' | 'exit' | 'target' | 'bot' | 'skip' | 'trophy'
  | 'history' | 'flag';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    repeat: <><path d="M17 2l3 3-3 3" /><path d="M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3" /><path d="M21 13v2a4 4 0 0 1-4 4H4" /></>,
    shuffle: <><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" /><path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 12l.7 1.8 1.8.7-1.8.7L19 17l-.7-1.8-1.8-.7 1.8-.7L19 12Z" /></>,
    arrow: <><path d="M5 12h14M14 6l6 6-6 6" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" /></>,
    chevron: <path d="m7 9 5 5 5-5" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    exit: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></>,
    bot: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" /></>,
    skip: <><path d="m5 5 9 7-9 7V5ZM16 5v14" /></>,
    trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM10 15h4M12 13v6M8 21h8" /><path d="M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    flag: <><path d="M6 22V4" /><path d="M6 5h10l-2 4 2 4H6" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function colorName(color: string): string {
  return { red: '红', yellow: '黄', green: '绿', blue: '蓝' }[color] ?? color;
}
