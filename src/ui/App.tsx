import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Action, BonusSymbol, CellRef, Color, GameState } from '../core/types';
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
import { computeScore, pointsForCount, type ScoreBreakdown } from '../core/scoring';
import { nextRand, seedToState } from '../core/rng';
import {
  chainLinks,
  chainPartner,
  doubleCandidates,
  nextRewardColor,
  rewardTrack,
  sheetLabel,
  swapSlots,
  symbolPairAt,
  symbolPairs,
} from '../core/variants';
import { BOT_REGISTRY, makeRand, type Bot } from '../ai/bots';

type PlayerKind = 'human' | 'random' | 'greedy' | 'heuristic' | 'policy' | 'rollout-lite' | 'rollout';

interface PlayerSetup {
  name: string;
  kind: PlayerKind;
}

interface Setup {
  players: PlayerSetup[];
  boardId: string;
  seed: string;
  /** 开局时按本局种子确定性打乱座位（会连带影响 Connected 变体的卡面分配）。 */
  randomSeats: boolean;
  /** 开局时按本局种子随机指定先手玩家；不移动座位，只改变谁先掷骰。默认开启。 */
  randomFirstPlayer: boolean;
}

interface BoardOption {
  id: string;
  title: string;
  tag: string;
  description: string;
  meta: string;
  /** 该记分卡的连锁/特殊机制，开局前先讲清楚。 */
  mechanics?: string[];
}

type SpecialMarkerKind = 'multiplier' | 'trigger' | 'symbol' | 'steps' | 'chain';

interface SpecialMarker {
  text: string;
  kind: SpecialMarkerKind;
  description: string;
  legend: string;
}

/** 一个格子上的变体信息：角标、配对关系与说明文字。 */
interface CellHint {
  marker?: SpecialMarker;
  /** 互为一对的格子（符号对、连锁对）。 */
  peers?: CellRef[];
  /** 这一对已经凑齐。 */
  paired?: boolean;
  /** 覆盖角标自带说明的完整描述。 */
  description?: string;
}

const BONUS_SYMBOL_MARKERS: Record<BonusSymbol, SpecialMarker> = {
  circle: { text: '○', kind: 'symbol', description: '圆形奖励：集齐一对后在最少行追加 2 格', legend: '最少行 +2' },
  diamond: { text: '◇', kind: 'symbol', description: '菱形奖励：集齐一对后四行各追加 1 格', legend: '每行 +1' },
  square: { text: '□', kind: 'symbol', description: '方形奖励：集齐一对后最低行终局分数翻倍', legend: '最低行 ×2' },
  octagon: { text: '⬡', kind: 'symbol', description: '八边形奖励：集齐一对后终局加 13 分', legend: '终局 +13' },
  star: { text: '✹', kind: 'symbol', description: '星形奖励：集齐一对后免除失误扣分', legend: '免失误扣分' },
};

const SYMBOL_ORDER: BonusSymbol[] = ['circle', 'diamond', 'square', 'octagon', 'star'];

const KIND_LABEL: Record<PlayerKind, string> = {
  human: '人类玩家',
  random: '随机 AI',
  greedy: '贪心 AI',
  heuristic: '启发式 AI',
  policy: '神经网络 AI（最强·推荐）',
  'rollout-lite': '前瞻 AI',
  rollout: '深度前瞻 AI（较慢）',
};

const KIND_SHORT: Record<PlayerKind, string> = {
  human: '人类',
  random: '随机',
  greedy: '贪心',
  heuristic: '启发式',
  policy: '神经网络',
  'rollout-lite': '前瞻',
  rollout: '深度前瞻',
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
    mechanics: [
      '每名玩家开局分到 2 个专属幸运数字（卡片右上角标出）。',
      '白骰和等于幸运数字时，可改划“划记最少的行”的下一格。',
      '行尾两格任一可锁行，锁行门槛提高到已划 6 格。',
    ],
  },
  {
    id: 'big-points',
    title: 'Qwixx Big Points',
    tag: '高分',
    description: '加入双色奖励行，制造更多连锁得分机会。',
    meta: '奖励行 · 15 格计分',
    mechanics: [
      '奖励行的圆格夹在两行之间，上下半圆就是它相邻的两行颜色。',
      '先划过相邻的普通格，之后再掷出同一个数字才能划奖励格。',
      '一个奖励格同时计入上下两行的划记数，每行最多计 15 个。',
    ],
  },
  {
    id: 'double-a',
    title: 'Qwixx Double A',
    tag: '双重划记',
    description: '每行最近划下的数字可以再次命中，单行最高 136 分。',
    meta: '重复最近格 · 锁行门槛 7',
    mechanics: [
      '每行“最右侧那个已划的数字”可以被划第二次（显示为 ××）。',
      '第二个叉照常计分，但不推进位置、也不解锁更靠右的格子。',
      '卡片上会实时列出当前可再划的格子。',
    ],
  },
  {
    id: 'double-b',
    title: 'Qwixx Double B',
    tag: '乘数格',
    description: '每行四个官方双倍格，一次命中会计作两个叉。',
    meta: '四个双倍格 · 16 格计分',
    mechanics: [
      '带 ×2 角标的格子划一次直接计作两个叉，无需额外操作。',
      '双倍不改变锁行门槛之外的位置规则，仍然从左到右。',
    ],
  },
  {
    id: 'bonus-a',
    title: 'Qwixx Bonus A',
    tag: '连锁',
    description: '命中奖励格后按颜色轨立刻追加划记，并可能连续触发。',
    meta: '12 个奖励格 · 强制追加',
    mechanics: [
      '划下带 ◆ 的格子会消费“奖励轨”最左边还没用掉的一格。',
      '拿到的颜色由奖励轨顺序决定，与你划的是哪个 ◆ 无关。',
      '追加划记是强制的，且可能再次踩到 ◆ 形成连锁。',
      '某色行一旦被锁定，奖励轨上该颜色的格子全部作废。',
    ],
  },
  {
    id: 'bonus-b',
    title: 'Qwixx Bonus B',
    tag: '组合',
    description: '凑齐成对符号，解锁追加划记、加分、翻倍或免扣分。',
    meta: '5 种成对符号',
    mechanics: [
      '同一个符号在卡面上出现两次，两个都划到才会激活效果。',
      '○ 最少行 +2、◇ 每行 +1、□ 最低行翻倍、⬡ +13 分、✹ 免失误扣分。',
      '○ 与 ◇ 的追加划记是强制的，会立即打断当前选择。',
    ],
  },
  {
    id: 'connected-steps',
    title: 'Connected A',
    tag: '阶梯',
    description: '每名玩家使用不同 A–E 卡，阶梯格组成第五个计分组。',
    meta: '11 个阶梯格 · 额外计分',
    mechanics: [
      '每个座位拿到不同卡面（A–E），阶梯格位置因此各不相同。',
      '带“阶”角标的 11 个格子既计入所在颜色行，又另组成第五个计分组。',
      '阶梯组沿用同一张积分表，全部划满 66 分。',
    ],
  },
  {
    id: 'connected-chain',
    title: 'Connected B',
    tag: '连线',
    description: '划下连锁格时，另一端无视常规限制自动划下。',
    meta: 'A–E 卡面 · 自动连锁',
    mechanics: [
      '卡面上有 5 对连锁格，带相同编号的两格互为一对。',
      '划下其中一端，另一端立刻自动划下——不受从左到右的限制。',
      '每个座位卡面不同，连锁对的位置也不同。',
    ],
  },
  {
    id: 'x-change',
    title: 'Qwixx X-Change',
    tag: '换数',
    description: '白骰阶段可按顺序使用九组交换，改变自己本次的和值。',
    meta: '9 次有序交换机会',
    mechanics: [
      '交换轨上有 9 组数字，例如 8↔5：掷出 8 时可当作 5 来划。',
      '只能从左到右按顺序取用，越过的交换直接作废。',
      '交换只改变本次可划的数字，不影响计分方式。',
    ],
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

/** Bonus A 奖励轨按颜色追加划记，颜色到行号的映射与引擎的 COLORS 顺序一致。 */
const COLOR_ROW: Record<Color, number> = { red: 0, yellow: 1, green: 2, blue: 3 };

const AI_DELAY_MS = 300;
const randomSeed = () => Math.floor(Math.random() * 1_000_000);

/**
 * 用给定种子确定性地打乱座位（Fisher–Yates）。
 * 走核心 RNG 而不是 Math.random，"同一个种子重现同一局"这个约定才对随机座位同样成立。
 */
function shuffleSeats(players: PlayerSetup[], seed: number): PlayerSetup[] {
  const out = [...players];
  let s = seedToState(seed ^ 0x2f6b1d05);
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextRand(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * 用给定种子确定性地选出先手玩家下标（不改变座位数组，只挑一个起始下标）。
 * 用独立的种子扰动，避免和 shuffleSeats 产生同源的重复结果。
 */
function pickFirstPlayer(count: number, seed: number): number {
  if (count <= 1) return 0;
  const r = nextRand(seedToState(seed ^ 0x4a17c2e9));
  return Math.floor(r.value * count);
}

export function App() {
  const [setup, setSetup] = useState<Setup>({
    players: [
      { name: '玩家 1', kind: 'human' },
      { name: '小 Q', kind: 'policy' },
    ],
    boardId: 'classic',
    seed: '',
    randomSeats: false,
    randomFirstPlayer: true,
  });
  const [game, setGame] = useState<GameState | null>(null);
  /** 本局实际就座顺序（可能与设置页顺序不同）。 */
  const [roster, setRoster] = useState<PlayerSetup[]>(setup.players);
  const [log, setLog] = useState<string[]>([]);

  const startGame = () => {
    const explicitSeed = Number.parseInt(setup.seed, 10);
    const matchSeed = setup.seed.trim() === '' || !Number.isFinite(explicitSeed)
      ? randomSeed()
      : explicitSeed;
    const board = setup.boardId === 'random'
      ? randomMixedBoard(matchSeed)
      : BOARD_PRESETS[setup.boardId]!;
    const seated = setup.randomSeats ? shuffleSeats(setup.players, matchSeed) : setup.players;
    const startingPlayer = setup.randomFirstPlayer ? pickFirstPlayer(seated.length, matchSeed) : 0;
    setRoster(seated);
    const entries: string[] = [];
    if (setup.randomSeats) {
      entries.push(`🎲 座位已随机：${seated.map((player, i) => `${i + 1}. ${player.name}`).join(' → ')}`);
    }
    if (setup.randomFirstPlayer) {
      entries.push(`🎯 先手已随机：${seated[startingPlayer]!.name}（座位 ${startingPlayer + 1}）`);
    }
    setLog(entries);
    setGame(newGame(configForBoard(board, seated.length, matchSeed), startingPlayer));
  };

  if (!game) {
    return <SetupScreen setup={setup} setSetup={setSetup} onStart={startGame} />;
  }

  return (
    <GameScreen
      game={game}
      setGame={setGame}
      roster={roster}
      seatsShuffled={setup.randomSeats}
      setup={setup}
      setSetup={setSetup}
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

            <div className="seat-controls">
              <div className="seat-controls-copy">
                <strong>座位顺序</strong>
                <small>Connected 变体按座位分配 A–E 卡面；先手另见下方设置。</small>
              </div>
              <button
                type="button"
                className="secondary-button seat-shuffle"
                disabled={setup.players.length < 2}
                title={setup.players.length < 2 ? '至少 2 名玩家才能调整座位' : '立即打乱当前座位顺序'}
                onClick={() => setSetup({ ...setup, players: shuffleSeats(setup.players, randomSeed()) })}
              >
                <Icon name="shuffle" /> 随机座位
              </button>
              <label className="seat-toggle">
                <input
                  type="checkbox"
                  checked={setup.randomSeats}
                  onChange={(e) => setSetup({ ...setup, randomSeats: e.target.checked })}
                />
                <span>每局开始时随机</span>
              </label>
            </div>

            <div className="seat-controls first-player-controls">
              <div className="seat-controls-copy">
                <strong>先手顺序</strong>
                <small>先手只决定谁先掷骰，不会移动座位，也不影响 Connected 卡面分配。</small>
              </div>
              <label className="seat-toggle">
                <input
                  type="checkbox"
                  checked={setup.randomFirstPlayer}
                  onChange={(e) => setSetup({ ...setup, randomFirstPlayer: e.target.checked })}
                />
                <span>每局开始时随机先手</span>
              </label>
            </div>

            <div className="player-list">
              {setup.players.map((player, i) => (
                <div className="player-row" key={i}>
                  <div className={`player-avatar avatar-${i % 5}`} aria-hidden="true">
                    {player.name.trim().charAt(0) || i + 1}
                  </div>
                  <div className="player-identity">
                    <label htmlFor={`player-name-${i}`}>
                      座位 {i + 1}
                      {i === 0 && !setup.randomFirstPlayer && <em className="seat-first">先手</em>}
                    </label>
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
                players: [...setup.players, { name: `玩家 ${setup.players.length + 1}`, kind: 'policy' }],
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

            {selectedBoard.mechanics && (
              <ul className="mechanics-brief" aria-label={`${selectedBoard.title} 的特殊机制`}>
                {selectedBoard.mechanics.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}

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
              <p className="roster-seat-note">
                {setup.randomSeats
                  ? '开始时会按本局种子随机就座（Connected 卡面随之变化）。'
                  : '按当前顺序就座。'}
                {' '}
                {setup.randomFirstPlayer
                  ? '先手也会随机决定，座位不受影响。'
                  : `${setup.players[0]?.name.trim() || '座位 1'} 先手。`}
              </p>
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

function GameScreen({ game, setGame, roster, seatsShuffled, setup, setSetup, log, setLog, onExit, onRestart }: {
  game: GameState;
  setGame: (g: GameState) => void;
  roster: PlayerSetup[];
  seatsShuffled: boolean;
  setup: Setup;
  setSetup: (s: Setup) => void;
  log: string[];
  setLog: (l: string[]) => void;
  onExit: () => void;
  onRestart: () => void;
}) {
  const bots = useRef<(Bot | null)[]>([]);
  const rands = useRef<(() => number)[]>([]);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSeatSettings, setShowSeatSettings] = useState(false);
  /** 没有可划记格子时是否自动跳过，省得每个人都要手动点一次。 */
  const [autoSkip, setAutoSkip] = useState(false);

  useEffect(() => {
    bots.current = roster.map((p) => (p.kind === 'human' ? null : BOT_REGISTRY[p.kind]!()));
    rands.current = roster.map((_, i) => makeRand(game.config.seed * 31 + i));
  }, [game.config.seed, roster]);

  useEffect(() => {
    if (!showExitConfirm && !showSeatSettings) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowExitConfirm(false);
      setShowSeatSettings(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showExitConfirm, showSeatSettings]);

  const actor = currentActor(game);
  const legal = useMemo(() => legalActions(game), [game]);
  const isHumanTurn = actor >= 0 && roster[actor]!.kind === 'human';
  const legalMarks = legal.filter((action) => !action.type.startsWith('skip')).length;

  const describe = (playerIdx: number, action: Action, before: GameState): string => {
    const name = roster[playerIdx]!.name;
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
      case 'markDoubleWhite':
      case 'markDoubleColor': {
        const cell = before.config.board.rows[action.row]!.cells[action.cell]!;
        return `${name} 再次划记 ${colorName(cell.color)}色 ${cell.number}`;
      }
      case 'markWhiteExchange': {
        const cell = before.config.board.rows[action.row]!.cells[action.cell]!;
        const swap = before.config.board.variant?.kind === 'x-change' ? before.config.board.variant.swaps[action.swap] : undefined;
        return `${name} 用 X-Change ${swap?.join('↔')} 划记 ${colorName(cell.color)}色 ${cell.number}`;
      }
      case 'markForced': {
        const cell = before.config.board.rows[action.row]!.cells[action.cell]!;
        return `${name} 用奖励追加划记 ${colorName(cell.color)}色 ${cell.number}`;
      }
      default: {
        const cell = before.config.board.rows[action.row]!.cells[action.cell]!;
        const via = action.type === 'markWhite' ? '白骰' : '白骰 + 彩骰';
        return `${name} 用${via}划记 ${colorName(cell.color)}色 ${cell.number}`;
      }
    }
  };

  /**
   * 变体的连锁效果由引擎默默执行（自动划另一端、消费奖励轨、激活符号）。
   * 记录里把它们逐条写出来，玩家才能把“我点了这一格”和“棋盘上多出来的叉”对上号。
   */
  const chainReactions = (before: GameState, next: GameState, playerIdx: number, action: Action): string[] => {
    const board = before.config.board;
    const variant = board.variant;
    const entries: string[] = [];
    const own = markedCellRef(before, playerIdx, action);
    const beforePlayer = before.players[playerIdx]!;
    const nextPlayer = next.players[playerIdx]!;

    board.rows.forEach((rowDef, row) => {
      rowDef.cells.forEach((cell, index) => {
        if (!nextPlayer.marks[row]![index] || beforePlayer.marks[row]![index]) return;
        if (own && own.row === row && own.cell === index) return;
        entries.push(`🔗 连锁自动划记 ${colorName(cell.color)}色 ${cell.number}`);
      });
    });

    if (variant?.kind === 'double-b' && own
      && nextPlayer.secondMarks[own.row]![own.cell] && !beforePlayer.secondMarks[own.row]![own.cell]) {
      entries.push('✖️ ×2 格：这一次计作两个叉');
    }

    if (variant?.kind === 'bonus-a') {
      const wasUsed = beforePlayer.variantState.bonusTrackUsed ?? [];
      const nowUsed = nextPlayer.variantState.bonusTrackUsed ?? [];
      let voided = 0;
      nowUsed.forEach((used, index) => {
        if (!used || wasUsed[index]) return;
        const color = variant.rewardTrack[index]!;
        if (next.lockedRows[COLOR_ROW[color]] && !before.lockedRows[COLOR_ROW[color]]) voided += 1;
        else entries.push(`🎁 奖励轨第 ${index + 1} 格：${colorName(color)}行强制追加 1 格`);
      });
      if (voided > 0) entries.push(`🚫 锁行使奖励轨上 ${voided} 个格子作废`);
    }

    if (variant?.kind === 'bonus-b') {
      const was = beforePlayer.variantState.bonusSymbols ?? {};
      const now = nextPlayer.variantState.bonusSymbols ?? {};
      for (const symbol of SYMBOL_ORDER) {
        if (now[symbol] && !was[symbol]) {
          const marker = BONUS_SYMBOL_MARKERS[symbol];
          entries.push(`✨ 集齐 ${marker.text}：${marker.legend}`);
        }
      }
    }

    return entries;
  };

  const step = (action: Action) => {
    const before = game;
    const next = applyAction(before, action);
    const entries = [describe(actor, action, before), ...chainReactions(before, next, actor, action)];
    next.lockedRows.forEach((locked, row) => {
      if (locked && !before.lockedRows[row]) {
        entries.push(`🔒 ${colorName(before.config.board.rows[row]!.lockColor)}行被锁定，对应彩骰移出`);
      }
    });
    next.players.forEach((player, i) => {
      if (player.penalties > before.players[i]!.penalties) {
        entries.push(`⚠️ ${roster[i]!.name} 记 1 次失误（-${before.config.penaltyPoints} 分）`);
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
      if (action.type === 'markWhite' || action.type === 'markColor'
        || action.type === 'markDoubleWhite' || action.type === 'markDoubleColor'
        || action.type === 'markWhiteExchange' || action.type === 'markForced') {
        const key = `${action.row}:${action.cell}`;
        if (!markable.has(key)) markable.set(key, action);
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

  useEffect(() => {
    if (game.phase === 'gameOver') return;
    if (!autoSkip || !isHumanTurn || legalMarks > 0 || !skipAction) return;
    const timer = window.setTimeout(() => step(skipAction), AI_DELAY_MS);
    return () => window.clearTimeout(timer);
    // step follows the current immutable game snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, autoSkip]);

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
          <button
            type="button"
            className="ghost-button"
            title="调整座位与先手随机规则（下一局生效）"
            onClick={() => setShowSeatSettings(true)}
          >
            <Icon name="shuffle" /> 座位 · 先手
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowExitConfirm(true)}>
            <Icon name="exit" /> 退出对局
          </button>
        </div>
      </header>

      {game.phase === 'gameOver' ? (
        <GameOverPanel game={game} roster={roster} onRestart={onRestart} onExit={onExit} />
      ) : (
        <>
          <section className="turn-overview" aria-label="当前回合">
            <div className="turn-owner">
              <span className={`player-avatar avatar-${game.activePlayer % 5}`} aria-hidden="true">
                {roster[game.activePlayer]!.name.charAt(0)}
              </span>
              <div><span>主动玩家</span><strong>{roster[game.activePlayer]!.name}</strong></div>
            </div>
            <div className="phase-steps" aria-label="回合进度">
              <div className={`phase-step ${game.phase === 'whiteChoice' || (game.phase === 'bonusChoice' && game.pendingBonus?.resume === 'whiteChoice') ? 'current' : 'done'}`}>
                <span>{game.phase === 'whiteChoice' || (game.phase === 'bonusChoice' && game.pendingBonus?.resume === 'whiteChoice') ? '1' : <Icon name="check" />}</span>
                <div><strong>全员选择</strong><small>两颗白骰之和</small></div>
              </div>
              <i />
              <div className={`phase-step ${game.phase === 'colorChoice' || (game.phase === 'bonusChoice' && game.pendingBonus?.resume === 'colorChoice') ? 'current' : ''}`}>
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
              <strong>{actionTitle(game, roster, actor, legalMarks, isHumanTurn)}</strong>
              <small>{actionDescription(game, legalMarks, isHumanTurn, autoSkip)}</small>
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
              <strong>{roster[i]!.name}</strong>
              <em>{game.players[i]!.penalties > 0 ? `${game.players[i]!.penalties} 次失误` : KIND_SHORT[roster[i]!.kind]}</em>
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
            name={roster[i]!.name}
            kind={roster[i]!.kind}
            isActor={i === actor && game.phase !== 'gameOver'}
            isActive={i === game.activePlayer && game.phase !== 'gameOver'}
            markable={i === actor ? markable : new Map()}
            onMark={step}
            onSkip={i === actor && isHumanTurn && skipAction ? () => step(skipAction) : undefined}
            skipLabel={game.phase === 'whiteChoice' ? '本次跳过' : '结束回合'}
            showAutoSkip={i === actor && isHumanTurn && legalMarks === 0 && !!skipAction}
            autoSkip={autoSkip}
            onAutoSkipChange={setAutoSkip}
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

      <ScoreReference game={game} />

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

      {showSeatSettings && (
        <div className="modal-backdrop" onMouseDown={() => setShowSeatSettings(false)}>
          <section
            className="seat-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="seat-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="dialog-icon seat-settings-icon"><Icon name="shuffle" /></span>
            <h2 id="seat-settings-title">座位与先手</h2>
            <p>当前对局不受影响；调整后从下一局（点击"再来一局"或重新开始）起生效。</p>

            <div className="seat-settings-body">
              <div className="seat-controls">
                <div className="seat-controls-copy">
                  <strong>座位顺序</strong>
                  <small>Connected 变体按座位分配 A–E 卡面。</small>
                </div>
                <label className="seat-toggle">
                  <input
                    type="checkbox"
                    checked={setup.randomSeats}
                    onChange={(e) => setSetup({ ...setup, randomSeats: e.target.checked })}
                  />
                  <span>每局开始时随机</span>
                </label>
              </div>

              <div className="seat-controls first-player-controls">
                <div className="seat-controls-copy">
                  <strong>先手顺序</strong>
                  <small>先手只决定谁先掷骰，不会移动座位，也不影响 Connected 卡面分配。</small>
                </div>
                <label className="seat-toggle">
                  <input
                    type="checkbox"
                    checked={setup.randomFirstPlayer}
                    onChange={(e) => setSetup({ ...setup, randomFirstPlayer: e.target.checked })}
                  />
                  <span>每局开始时随机先手</span>
                </label>
              </div>
            </div>

            <div className="seat-settings-actions">
              <button type="button" className="secondary-button" autoFocus onClick={() => setShowSeatSettings(false)}>完成</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function ScoreReference({ game }: { game: GameState }) {
  const board = game.config.board;
  const maxCount = board.scoreCap ?? 12;
  const counts = Array.from({ length: maxCount }, (_, index) => index + 1);
  const notes = [
    '锁定符号计作 1 个额外划记。',
    `每次失误扣 ${game.config.penaltyPoints} 分。`,
  ];

  if (board.id === 'longo') {
    notes.push('Longo 每行最多计 15 个划记（120 分）。');
  }
  if (board.bonusRows?.length) {
    notes.push('双色奖励格同时计入相邻两行；每行最多计 15 个划记。');
  }

  switch (board.variant?.kind) {
    case 'double-a':
      notes.push('第二叉照常计分；每行最多计 16 个划记（136 分）。');
      break;
    case 'double-b':
      notes.push('×2 格一次计作两个划记；每行最多计 16 个划记（136 分）。');
      break;
    case 'bonus-a':
      notes.push('奖励轨追加的划记按所在颜色行正常计分。');
      break;
    case 'bonus-b':
      notes.push('○/◇追加叉正常计分；□将最低行分翻倍；⬡ +13 分；✹免除失误扣分。');
      break;
    case 'connected-steps':
      notes.push('11 个阶梯格另组成一个计分组，沿用本表，最高 66 分。');
      break;
    case 'connected-chain':
      notes.push('自动连锁划下的格子按所在颜色行正常计分。');
      break;
    case 'x-change':
      notes.push('交换只改变可划的白骰和值，不改变计分方式。');
      break;
  }

  return (
    <section className="score-reference" aria-labelledby="score-reference-title">
      <div className="score-reference-heading">
        <div><Icon name="chart" /><h2 id="score-reference-title">本局积分表</h2></div>
        <span>{board.name}</span>
      </div>
      <div className="score-reference-scroll" tabIndex={0} aria-label="积分表，可横向滚动">
        <table>
          <tbody>
            <tr>
              <th scope="row">划记数</th>
              {counts.map((count) => <td key={count}>{count}</td>)}
            </tr>
            <tr>
              <th scope="row">得分</th>
              {counts.map((count) => <td key={count}><strong>{pointsForCount(count)}</strong></td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="score-reference-notes">
        {notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </section>
  );
}

function GameOverPanel({ game, roster, onRestart, onExit }: {
  game: GameState;
  roster: PlayerSetup[];
  onRestart: () => void;
  onExit: () => void;
}) {
  const winnerNames = game.winners!.map((winner) => roster[winner]!.name).join('、');
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

function PlayerCard({ game, playerIdx, name, kind, isActor, isActive, markable, onMark, onSkip, skipLabel, showAutoSkip, autoSkip, onAutoSkipChange }: {
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
  /** 本回合没有可划记格子，可以在跳过按钮旁边打开自动跳过。 */
  showAutoSkip?: boolean;
  autoSkip?: boolean;
  onAutoSkipChange?: (v: boolean) => void;
}) {
  const player = game.players[playerIdx]!;
  const board = game.config.board;
  const score = computeScore(game, playerIdx);
  const lucky = game.config.luckyNumbers?.[playerIdx];
  /** 变体面板悬停时点亮记分卡上对应的格子（`row:cell`）。 */
  const [highlight, setHighlight] = useState<string[]>([]);
  const totalMarks = player.marks.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
    + player.secondMarks.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
    + player.bonusMarks.reduce((sum, row) => sum + row.filter(Boolean).length, 0);

  const variantStatus = (() => {
    const variant = board.variant;
    if (variant?.kind === 'x-change') return `↔ 已用 ${(player.variantState.xChangeThrough ?? -1) + 1}/${variant.swaps.length}`;
    if (variant?.kind === 'bonus-a') return `奖励轨 ${player.variantState.bonusTrackUsed!.filter(Boolean).length}/${variant.rewardTrack.length}`;
    if (variant?.kind === 'bonus-b') return `符号 ${Object.values(player.variantState.bonusSymbols ?? {}).filter(Boolean).length}/5`;
    const sheet = sheetLabel(board, playerIdx);
    return sheet ? `卡面 ${sheet}` : undefined;
  })();

  /** 触发 ◆ 拿到的颜色只取决于奖励轨进度，所以所有 ◆ 当前都指向同一个颜色。 */
  const nextReward = nextRewardColor(game, playerIdx);
  const doubleReady = doubleCandidates(game, playerIdx);

  const cellHint = (row: number, cell: number): CellHint => {
    const variant = board.variant;
    if (variant?.kind === 'double-b' && variant.multiplierCells.includes(cell)) {
      return { marker: { text: '×2', kind: 'multiplier', description: '双倍格：划一次直接计作两个叉', legend: '一次计 2 叉' } };
    }
    if (variant?.kind === 'bonus-a' && variant.triggerCells.some((ref) => ref.row === row && ref.cell === cell)) {
      return {
        marker: { text: '◆', kind: 'trigger', legend: '触发奖励轨', description: '' },
        description: nextReward
          ? `奖励格：划下后消费奖励轨的下一格，当前是${colorName(nextReward)} —— 强制在${colorName(nextReward)}行追加 1 格`
          : '奖励格：奖励轨已用尽，划下不再有追加效果',
      };
    }
    if (variant?.kind === 'bonus-b') {
      const pair = symbolPairAt(board, { row, cell });
      if (pair) {
        const peer = pair.ends.find((end) => end.row !== row || end.cell !== cell)!;
        const marker = BONUS_SYMBOL_MARKERS[pair.symbol];
        const activated = player.variantState.bonusSymbols?.[pair.symbol] ?? false;
        return {
          marker,
          peers: pair.ends,
          paired: activated,
          description: `${marker.description}；配对格是 ${cellLabel(game, peer)}${activated ? '（已集齐）' : '（尚未集齐）'}`,
        };
      }
    }
    if (variant?.kind === 'connected-steps') {
      if (variant.sheets[playerIdx % variant.sheets.length]!.some((ref) => ref.row === row && ref.cell === cell)) {
        return { marker: { text: '阶', kind: 'steps', description: '阶梯格：既计入所在颜色行，又计入单独的阶梯组', legend: '另计阶梯组' } };
      }
    }
    if (variant?.kind === 'connected-chain') {
      const peer = chainPartner(board, playerIdx, { row, cell });
      if (peer) {
        const index = chainLinks(board, playerIdx)
          .findIndex((link) => link.ends.some((end) => end.row === row && end.cell === cell));
        const done = player.marks[peer.row]![peer.cell]!;
        return {
          marker: { text: `链${index + 1}`, kind: 'chain', legend: '自动划配对端', description: '' },
          peers: [{ row, cell }, peer],
          paired: done,
          description: `连锁 ${index + 1}：划下这格会自动划记 ${cellLabel(game, peer)}（不受从左到右限制）`,
        };
      }
    }
    return {};
  };

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
                <span className="cell-value">{player.bonusMarks[bonus]![cell] ? '×' : number}</span>
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
          {variantStatus && <span className="variant-badge">{variantStatus}</span>}
          {onSkip && (
            <button className="card-skip-button" type="button" aria-label={`${skipLabel}，${name}`} onClick={onSkip}>
              {skipLabel}<Icon name="skip" />
            </button>
          )}
          {showAutoSkip && (
            <label className="card-auto-skip" title="没有可划记的格子时自动跳过，无需每次手动点击">
              <input
                type="checkbox"
                checked={!!autoSkip}
                onChange={(e) => onAutoSkipChange?.(e.target.checked)}
              />
              <span>自动跳过</span>
            </label>
          )}
        </div>
        <div className="card-score"><strong>{score.total}</strong><span>分</span></div>
      </div>

      <VariantPanel game={game} playerIdx={playerIdx} score={score} onHighlight={setHighlight} />

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
                    const second = player.secondMarks[row]![cellIndex];
                    const hint = cellHint(row, cellIndex);
                    const badge = hint.marker;
                    const note = hint.description ?? badge?.description;
                    const canDouble = doubleReady.some((ref) => ref.row === row && ref.cell === cellIndex);
                    const linked = highlight.includes(key);
                    const title = [
                      action ? actionTooltip(action, game) : undefined,
                      note,
                      canDouble && !action ? '本行最近的划记：掷出同一数字即可划第二次' : undefined,
                    ].filter(Boolean).join(' · ') || undefined;
                    return (
                      <button
                        key={cellIndex}
                        className={[
                          'cell',
                          marked ? 'marked' : '',
                          second ? 'second-marked' : '',
                          badge ? 'special-cell' : '',
                          hint.paired ? 'pair-done' : '',
                          canDouble ? 'can-double' : '',
                          linked ? 'linked' : '',
                          action ? 'clickable' : '',
                          viaLucky ? 'lucky' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ background: COLOR_CSS[cell.color] }}
                        disabled={!action}
                        title={title}
                        aria-label={`${colorName(cell.color)}色 ${cell.number}${note ? `，${note}` : ''}${marked ? '，已划记' : action ? '，可以选择' : ''}`}
                        data-row={row}
                        data-cell={cellIndex}
                        data-color={cell.color}
                        data-number={cell.number}
                        data-marks={second ? 2 : marked ? 1 : 0}
                        data-special={badge ? hint.marker!.kind : undefined}
                        data-selectable={action ? 'true' : 'false'}
                        onClick={() => action && onMark(action)}
                      >
                        <span className="cell-value">{second ? '××' : marked ? '×' : cell.number}</span>
                        {badge && <small className={`cell-marker marker-${badge.kind}`}>{badge.text}</small>}
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
        <span className="score-detail">行分 {score.groupPoints.join(' + ')}{score.variantBonusPoints > 0 ? ` + ${score.variantBonusPoints}` : ''} <b>− {score.penaltyPoints}</b></span>
      </footer>
    </article>
  );
}

function refKey(ref: CellRef): string {
  return `${ref.row}:${ref.cell}`;
}

type HoverProps = ReturnType<typeof makeHoverProps>;

/** 变体面板的统一外框：标题 + 一句话规则 + 内容 + 补充说明。 */
function VariantFrame({ kind, title, rule, note, locate, children }: {
  kind: string;
  title: string;
  rule: string;
  note?: ReactNode;
  locate?: { label: string; refs: CellRef[]; hover: (refs: CellRef[]) => HoverProps };
  children: ReactNode;
}) {
  return (
    <section className="variant-panel" data-variant={kind} aria-label={title}>
      <div className="variant-panel-head">
        <strong>{title}</strong>
        <small>{rule}</small>
        {locate && locate.refs.length > 0 && (
          <button type="button" className="locate-chip" {...locate.hover(locate.refs)}>
            <Icon name="target" /> {locate.label}
          </button>
        )}
      </div>
      {children}
      {note && <p className="variant-note">{note}</p>}
    </section>
  );
}

/**
 * 悬停点亮记分卡上的对应格子；点击则钉住，离开鼠标也不消失。
 * 触摸屏没有 hover，钉住是那里唯一能用的方式。
 */
function makeHoverProps(
  refs: CellRef[],
  pinned: string[],
  setPinned: (keys: string[]) => void,
  onHighlight: (keys: string[]) => void,
) {
  const keys = refs.map(refKey);
  const isPinned = keys.length === pinned.length && keys.every((key, i) => key === pinned[i]);
  return {
    'aria-pressed': isPinned,
    onMouseEnter: () => onHighlight(keys),
    onMouseLeave: () => onHighlight(pinned),
    onFocus: () => onHighlight(keys),
    onBlur: () => onHighlight(pinned),
    onClick: () => {
      const next = isPinned ? [] : keys;
      setPinned(next);
      onHighlight(next);
    },
  };
}

/**
 * 变体状态面板：把引擎里那些"看不见的连锁"摊开成看得见的进度。
 * 角标解释了单个格子的效果，这里解释的是效果之间的顺序关系——
 * 奖励轨轮到第几格、下一次触发拿什么颜色、哪几组交换还没作废。
 * 悬停或聚焦任意一项，会点亮记分卡上对应的格子。
 */
function VariantPanel({ game, playerIdx, score, onHighlight }: {
  game: GameState;
  playerIdx: number;
  score: ScoreBreakdown;
  onHighlight: (keys: string[]) => void;
}) {
  const board = game.config.board;
  const variant = board.variant;
  const player = game.players[playerIdx]!;
  const [pinned, setPinned] = useState<string[]>([]);
  const hoverProps = (refs: CellRef[]) => makeHoverProps(refs, pinned, setPinned, onHighlight);

  if (variant?.kind === 'bonus-a') {
    const track = rewardTrack(game, playerIdx);
    const next = track.find((slot) => slot.isNext);
    return (
      <VariantFrame
        kind="bonus-a"
        title="奖励轨"
        rule="划下 ◆ 就取走轨上最左边还没用掉的一格，在那个颜色的行强制追加 1 格"
        locate={{ label: '◆ 触发格', refs: variant.triggerCells, hover: hoverProps }}
        note={
          <>
            所有 ◆ 现在都指向同一格，与你划的是哪个无关；
            某色行被锁定时，轨上该颜色的格子全部作废。
          </>
        }
      >
        {/* 轨道是"下一次拿什么颜色"的唯一出处：格子上的 ◆ 恒为同一个样式，
            会变的那部分只在这里出现一次，人和读屏/截图的机器都只需要看这一处。 */}
        <p className="track-readout" data-next-color={next?.color ?? 'none'}>
          <span>下一次触发</span>
          {next ? (
            <b style={{ background: COLOR_CSS[next.color] }}>{colorName(next.color)}行 +1 格</b>
          ) : (
            <b className="is-empty">奖励轨已用尽</b>
          )}
          <em>剩余 {track.filter((slot) => !slot.used).length} / {track.length} 格</em>
        </p>
        <ol className="reward-track">
          {track.map((slot) => {
            const state = slot.voided ? 'voided' : slot.used ? 'used' : slot.isNext ? 'next' : 'open';
            const stateText = { voided: '锁行作废', used: '已用', next: '下一个', open: '待用' }[state];
            return (
              <li
                key={slot.index}
                className={`reward-slot ${state}`}
                style={{ background: COLOR_CSS[slot.color] }}
                data-index={slot.index}
                data-color={slot.color}
                data-row={slot.row}
                data-state={state}
                title={`第 ${slot.index + 1} 格 · ${colorName(slot.color)}行 · ${stateText}`}
                aria-label={`第 ${slot.index + 1} 格，${colorName(slot.color)}行，${stateText}`}
              >
                <span>{slot.voided ? '✕' : slot.used ? '✓' : colorName(slot.color)}</span>
              </li>
            );
          })}
        </ol>
      </VariantFrame>
    );
  }

  if (variant?.kind === 'bonus-b') {
    return (
      <VariantFrame
        kind="bonus-b"
        title="成对符号"
        rule="同一个符号的两个格子都划到才会激活效果，把鼠标放到下面任一项可定位这两格"
        note="○ 与 ◇ 的追加划记是强制的，会立刻打断当前选择。"
      >
        <ul className="variant-chips">
          {symbolPairs(board).map(({ symbol, ends }) => {
            const marker = BONUS_SYMBOL_MARKERS[symbol];
            const activated = player.variantState.bonusSymbols?.[symbol] ?? false;
            const have = ends.filter((end) => player.marks[end.row]![end.cell]).length;
            return (
              <li key={symbol}>
                <button
                  type="button"
                  className={`variant-chip ${activated ? 'is-done' : ''}`}
                  data-symbol={symbol}
                  data-progress={`${have}/2`}
                  data-state={activated ? 'active' : 'pending'}
                  {...hoverProps(ends)}
                >
                  <i className="legend-marker marker-symbol">{marker.text}</i>
                  <span>{marker.legend}</span>
                  <em>{ends.map((end) => cellLabel(game, end)).join(' + ')}</em>
                  <b>{activated ? '已激活' : `${have}/2`}</b>
                </button>
              </li>
            );
          })}
        </ul>
      </VariantFrame>
    );
  }

  if (variant?.kind === 'connected-chain') {
    const links = chainLinks(board, playerIdx);
    return (
      <VariantFrame
        kind="connected-chain"
        title={`连锁对 · 卡面 ${sheetLabel(board, playerIdx)}`}
        rule="带相同编号的两格互为一对：划下任意一端，另一端立刻自动划下"
        note="自动划下的一端不受“从左到右”限制，但同样可能触发锁行。"
      >
        <ul className="variant-chips">
          {links.map(({ index, ends }) => {
            const done = ends.every((end) => player.marks[end.row]![end.cell]);
            return (
              <li key={index}>
                <button
                  type="button"
                  className={`variant-chip ${done ? 'is-done' : ''}`}
                  data-link={index + 1}
                  data-state={done ? 'linked' : 'open'}
                  {...hoverProps(ends)}
                >
                  <i className="legend-marker marker-chain">链{index + 1}</i>
                  <span>{cellLabel(game, ends[0])} ⇄ {cellLabel(game, ends[1])}</span>
                  <b>{done ? '已连' : '未连'}</b>
                </button>
              </li>
            );
          })}
        </ul>
      </VariantFrame>
    );
  }

  if (variant?.kind === 'connected-steps') {
    const cells = variant.sheets[playerIdx % variant.sheets.length]!;
    const stepIndex = score.groupLabels.indexOf('steps');
    const count = stepIndex >= 0 ? score.groupCounts[stepIndex]! : 0;
    return (
      <VariantFrame
        kind="connected-steps"
        title={`阶梯组 · 卡面 ${sheetLabel(board, playerIdx)}`}
        rule="带“阶”角标的 11 个格子既计入所在颜色行，又单独组成第五个计分组"
        locate={{ label: '阶梯格', refs: cells, hover: hoverProps }}
        note={<>阶梯组沿用同一张积分表：当前 <b>{count}/11 格 · {stepIndex >= 0 ? score.groupPoints[stepIndex] : 0} 分</b>，划满 66 分。</>}
      >
        <ul className="variant-chips steps-chips">
          {cells.map((ref, index) => (
            <li key={index}>
              <button
                type="button"
                className={`variant-chip compact ${player.marks[ref.row]![ref.cell] ? 'is-done' : ''}`}
                data-state={player.marks[ref.row]![ref.cell] ? 'marked' : 'open'}
                {...hoverProps([ref])}
              >
                <span>{cellLabel(game, ref)}</span>
              </button>
            </li>
          ))}
        </ul>
      </VariantFrame>
    );
  }

  if (variant?.kind === 'x-change') {
    const slots = swapSlots(game, playerIdx, whiteSum(game));
    const next = slots.find((slot) => slot.isNext);
    const live = slots.filter((slot) => slot.usableNow);
    return (
      <VariantFrame
        kind="x-change"
        title="交换轨"
        rule="掷出交换组里的一个数字，就能当成另一个数字来划；只能从左到右按顺序取用"
        note={
          live.length > 0
            ? <>本次白骰和 <b>{whiteSum(game)}</b> 命中 {live.map((slot) => `${slot.pair[0]}↔${slot.pair[1]}`).join('、')}，可改划 <b>{[...new Set(live.map((slot) => slot.exchangedTo))].join(' / ')}</b>。用掉之后，它和它左边的交换会一起作废。</>
            : <>取用第 {(next?.index ?? slots.length) + 1} 组后，它和它左边的交换会一起作废。</>
        }
      >
        <ol className="swap-track">
          {slots.map((slot) => {
            const state = slot.spent ? 'spent' : slot.usableNow ? 'usable' : slot.isNext ? 'next' : 'open';
            const stateText = {
              spent: '已作废',
              usable: '现在可用',
              next: '下一组',
              open: '待用',
            }[state];
            return (
              <li
                key={slot.index}
                className={`swap-slot ${state}`}
                data-index={slot.index}
                data-from={slot.pair[0]}
                data-to={slot.pair[1]}
                data-state={state}
                title={`第 ${slot.index + 1} 组 ${slot.pair[0]}↔${slot.pair[1]} · ${stateText}`}
                aria-label={`第 ${slot.index + 1} 组，${slot.pair[0]} 换 ${slot.pair[1]}，${stateText}`}
              >
                {slot.spent && <s aria-hidden="true">✕</s>}
                {slot.pair[0]}<i>↔</i>{slot.pair[1]}
                {(state === 'usable' || state === 'next') && <b>{stateText}</b>}
              </li>
            );
          })}
        </ol>
      </VariantFrame>
    );
  }

  if (variant?.kind === 'double-a') {
    const ready = doubleCandidates(game, playerIdx);
    return (
      <VariantFrame
        kind="double-a"
        title="可再划的格子"
        rule="每行最右侧那个已划的数字可以被划第二次（显示为 ××）"
        note="第二个叉照常计分，但不推进位置，也不会解锁更靠右的格子。"
      >
        {ready.length === 0 ? (
          <p className="variant-empty">还没有可再划的格子——先在任意一行划下第一个数字。</p>
        ) : (
          <ul className="variant-chips">
            {ready.map((ref) => (
              <li key={refKey(ref)}>
                <button type="button" className="variant-chip" {...hoverProps([ref])}>
                  <span>{cellLabel(game, ref)}</span>
                  <em>掷出 {board.rows[ref.row]!.cells[ref.cell]!.number} 即可再划</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </VariantFrame>
    );
  }

  if (variant?.kind === 'double-b') {
    const cells = board.rows.flatMap((_, row) => variant.multiplierCells.map((cell) => ({ row, cell })));
    const hit = cells.filter((ref) => player.marks[ref.row]![ref.cell]).length;
    return (
      <VariantFrame
        kind="double-b"
        title="双倍格"
        rule="带 ×2 角标的格子划一次直接计作两个叉，不需要额外操作"
        locate={{ label: '×2 格', refs: cells, hover: hoverProps }}
        note={<>已命中 <b>{hit}/{cells.length}</b> 个双倍格；每行最多计 16 个划记（136 分）。</>}
      >
        <ul className="variant-chips">
          {board.rows.map((rowDef, row) => {
            const rowHit = variant.multiplierCells.filter((cell) => player.marks[row]![cell]).length;
            return (
              <li key={row}>
                <button
                  type="button"
                  className={`variant-chip compact ${rowHit === variant.multiplierCells.length ? 'is-done' : ''}`}
                  {...hoverProps(variant.multiplierCells.map((cell) => ({ row, cell })))}
                >
                  <i className="legend-marker marker-multiplier" style={{ background: COLOR_CSS[rowDef.lockColor], borderColor: COLOR_CSS[rowDef.lockColor] }}>×2</i>
                  <span>{variant.multiplierCells.map((cell) => rowDef.cells[cell]!.number).join(' · ')}</span>
                  <b>{rowHit}/{variant.multiplierCells.length}</b>
                </button>
              </li>
            );
          })}
        </ul>
      </VariantFrame>
    );
  }

  if (board.bonusRows?.length) {
    return (
      <VariantFrame
        kind="big-points"
        title="双色奖励行"
        rule="圆格的上下半圆就是它相邻的两行颜色：先划过其中一格，之后再掷出同一个数字才能划它"
        note="一个奖励格同时计入上下两行的划记数，每行最多计 15 个；只划奖励格不算失误。"
      >
        <ul className="variant-chips">
          {board.bonusRows.map((bonusDef, bonus) => {
            const marked = player.bonusMarks[bonus]!.filter(Boolean).length;
            const ready = bonusDef.numbers.filter((_, cell) => !player.bonusMarks[bonus]![cell]
              && bonusDef.adjacent.some((adj) => player.marks[adj]![cell])).length;
            const colors = bonusDef.adjacent.map((adj) => colorName(board.rows[adj]!.lockColor)).join(' / ');
            return (
              <li key={bonus}>
                <span className="variant-chip static">
                  <i
                    className="legend-marker"
                    style={{
                      background: `linear-gradient(180deg, ${COLOR_CSS[board.rows[bonusDef.adjacent[0]]!.lockColor]} 50%, ${COLOR_CSS[board.rows[bonusDef.adjacent[1]]!.lockColor]} 50%)`,
                      borderRadius: '50%',
                    }}
                  />
                  <span>{colors} 之间</span>
                  <em>{ready} 格已解锁待触发</em>
                  <b>{marked}/{bonusDef.numbers.length}</b>
                </span>
              </li>
            );
          })}
        </ul>
      </VariantFrame>
    );
  }

  if (board.luckyNumbers) {
    const lucky = game.config.luckyNumbers?.[playerIdx] ?? [];
    return (
      <VariantFrame
        kind="lucky"
        title="幸运数字"
        rule="白骰和等于自己的幸运数字时，可以改划“当前划记最少的那一行”的下一格"
        note="改划的格子会绕过数字限制，但仍然只能往右走一格。"
      >
        <ul className="variant-chips">
          {lucky.map((number) => (
            <li key={number}>
              <span className={`variant-chip static ${whiteSum(game) === number ? 'is-live' : ''}`}>
                <i className="legend-marker marker-trigger">⭐</i>
                <span>{number}</span>
                {whiteSum(game) === number && <b>本次命中</b>}
              </span>
            </li>
          ))}
        </ul>
      </VariantFrame>
    );
  }

  return null;
}

function actionTitle(game: GameState, roster: PlayerSetup[], actor: number, legalMarks: number, isHumanTurn: boolean): string {
  const name = roster[actor]!.name;
  if (!isHumanTurn) return `${name} 正在思考…`;
  if (legalMarks === 0) return `${name}，当前没有可划记的格子`;
  if (game.phase === 'bonusChoice') return `${name}，请选择奖励追加格`;
  return game.phase === 'whiteChoice'
    ? `${name}，请选择数字 ${whiteSum(game)}`
    : `${name}，选择一个白骰 + 彩骰组合`;
}

function actionDescription(game: GameState, legalMarks: number, isHumanTurn: boolean, autoSkip: boolean): string {
  if (!isHumanTurn) return 'AI 完成选择后会自动继续，请稍候。';
  if (game.phase === 'bonusChoice') return '奖励划记必须执行；可选格已用绿色描边标出。';
  if (legalMarks === 0) {
    const base = game.phase === 'whiteChoice' ? '跳过不会受到惩罚。' : '结束回合；若本回合没有划记，将记录一次失误。';
    return autoSkip ? `${base}已开启自动跳过，即将自动继续。` : base;
  }
  return game.phase === 'whiteChoice'
    ? '记分卡上带绿色描边的格子可以点击；非主动玩家跳过无惩罚。'
    : '只可划对应彩骰颜色的格子，也可以选择结束本回合。';
}

function actionTooltip(action: Action, game: GameState): string {
  if (action.type === 'markLucky') return '使用幸运数字划记下一格';
  if (action.type === 'markForced') return '使用已触发的奖励追加划记';
  if (action.type === 'markDoubleWhite' || action.type === 'markDoubleColor') return '把本行最近的数字划记第二次';
  if (action.type === 'markWhiteExchange') {
    const swap = game.config.board.variant?.kind === 'x-change' ? game.config.board.variant.swaps[action.swap] : undefined;
    return `使用 X-Change ${swap?.join(' ↔ ')}`;
  }
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
  | 'history' | 'flag' | 'chart';

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
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function colorName(color: string): string {
  return { red: '红', yellow: '黄', green: '绿', blue: '蓝' }[color] ?? color;
}

/** 动作直接划下的普通格；不划普通格（跳过、二次划记、奖励格）时为 undefined。 */
function markedCellRef(state: GameState, player: number, action: Action): CellRef | undefined {
  switch (action.type) {
    case 'markWhite':
    case 'markColor':
    case 'markWhiteExchange':
    case 'markForced':
      return { row: action.row, cell: action.cell };
    case 'markLucky':
      return { row: action.row, cell: rightmostMark(state, player, action.row) + 1 };
    default:
      return undefined;
  }
}

/** 把格子说成人话：`红 8`。 */
function cellLabel(game: GameState, ref: CellRef): string {
  const cell = game.config.board.rows[ref.row]!.cells[ref.cell]!;
  return `${colorName(cell.color)} ${cell.number}`;
}
