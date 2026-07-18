# 引擎 API 参考

`src/core` 为零依赖纯逻辑引擎，`src/ai` 提供机器人与 RL 编码。所有状态均为纯数据
（可 `structuredClone` / `JSON.stringify` 序列化），任何时刻的 `GameState` 都可以存档、
回放或作为训练样本。

## 核心类型（src/core/types.ts）

```ts
type Color = 'red' | 'yellow' | 'green' | 'blue';

interface Cell { color: Color; number: number }        // 记分卡格子
interface RowDef { cells: Cell[]; lockColor: Color }   // 一行；锁定时移除 lockColor 骰
interface BonusRowDef {                                 // Big Points 奖励行
  adjacent: [number, number];                           // 相邻的两个行号
  numbers: number[];                                    // 每格数字（与相邻行按下标对齐）
}

interface BoardDef {
  id: string;
  name: string;
  rows: RowDef[];                 // 恒为 4 行，行长一致（经典 11，Longo 15）
  scoreBy: 'row' | 'color';       // 官方各版本均为 'row'；'color' 为自定义模式
  lockableTail?: number;          // 行尾可锁定格数（缺省 1，Longo 2）
  scoreCap?: number;              // 每组计分封顶（Big Points 15）
  bonusRows?: BonusRowDef[];      // 奖励行（Big Points）
  rulesOverrides?: Partial<Pick<RulesConfig, 'dieFaces' | 'minMarksToLock'>>;
  luckyNumbers?: boolean;         // 是否启用幸运数字（Longo）
  variant?: BoardVariant;         // Double / Bonus / Connected / X-Change 元数据
}

interface RulesConfig {
  board: BoardDef;
  numPlayers: number;             // 1–5
  maxPenalties: number;           // 失误上限（4）
  penaltyPoints: number;          // 每失误扣分（5）
  minMarksToLock: number;         // 锁行门槛（经典 5，Longo 6）
  locksToEnd: number;             // 锁几行结束（2）
  dieFaces: number;               // 骰面数（经典 6，Longo 8）
  luckyNumbers?: number[][];      // 每名玩家的幸运数字（Longo）
  seed: number;                   // 完全决定骰子序列
}

interface GameState {
  config: RulesConfig;
  players: { marks: boolean[][]; secondMarks: boolean[][]; bonusMarks: boolean[][]; variantState: object; penalties: number }[];
  lockedRows: boolean[];
  removedColors: Color[];
  activePlayer: number;
  dice: { white: [number, number]; colors: Partial<Record<Color, number>> };
  phase: 'whiteChoice' | 'colorChoice' | 'bonusChoice' | 'gameOver';
  whiteQueue: number[];           // 白骰窗口中尚未决策的玩家（队首为当前决策者）
  activeMarked: boolean;
  turn: number;
  rngState: number;
  finalScores?: number[];         // gameOver 时填充
  winners?: number[];
}

type Action =
  | { type: 'markWhite'; row: number; cell: number }     // 动作 1：白骰和
  | { type: 'markDoubleWhite'; row: number; cell: number }
  | { type: 'markWhiteExchange'; row: number; cell: number; swap: number }
  | { type: 'markLucky'; row: number }                   // 动作 1：幸运数字（Longo）
  | { type: 'markBonusWhite'; bonus: number; cell: number } // 动作 1：奖励格（Big Points）
  | { type: 'skipWhite' }
  | { type: 'markColor'; row: number; cell: number }     // 动作 2：白 + 彩
  | { type: 'markDoubleColor'; row: number; cell: number }
  | { type: 'markBonusColor'; bonus: number; cell: number } // 动作 2：奖励格
  | { type: 'markForced'; row: number; cell: number }    // Bonus A/B 强制追加
  | { type: 'skipColor' };
```

## 引擎函数（src/core/engine.ts）

| 函数 | 说明 |
|---|---|
| `configForBoard(board, numPlayers, seed)` | 生成完整 `RulesConfig`：合并 `DEFAULT_RULES` 与棋盘的 `rulesOverrides`，Longo 时从种子确定性生成每人 2 个幸运数字。**推荐入口**。 |
| `newGame(config)` | 创建初始状态（校验棋盘、掷第一把骰子）。 |
| `currentActor(state)` | 当前需要行动的玩家下标；游戏结束返回 -1。 |
| `legalActions(state)` | 当前决策者的全部合法动作（跳过恒在末位）。 |
| `applyAction(state, action)` | 校验合法性，返回**新状态**（原状态不变）；非法动作抛错。 |
| `applyActionInPlace(state, action)` | 原地应用（不校验），供高吞吐自对弈；配合 `legalActions` 使用。 |
| `whiteSum(state)` | 双白骰之和。 |
| `rightmostMark(state, player, row)` | 该行最右划记位置（无则 -1）。 |
| `isLegal(state, action)` | 动作合法性判断。 |
| `DEFAULT_RULES` | 经典默认参数（不含 board/numPlayers/seed）。 |

回合状态机（序列化语义与官方"同时结算"等价）：

```
whiteChoice（whiteQueue 依次决策：markWhite | markLucky | markBonusWhite | skipWhite）
  └─ 队列清空 → 锁定结算(resolveLocks) → 终局? → colorChoice
colorChoice（仅主动玩家：markColor | markBonusColor | skipColor）
  └─ 失误判定 → 锁定结算 → 终局? → 下一回合
bonusChoice（Bonus A/B 暂停原动作：markForced）
  └─ 强制效果队列清空 → 恢复并完成原 whiteChoice / colorChoice
```

## 棋盘（src/core/board.ts）

```ts
BOARD_PRESETS: { classic, 'gemixxt-a', 'gemixxt-b', longo, 'big-points',
  'double-a', 'double-b', 'bonus-a', 'bonus-b', 'connected-steps',
  'connected-chain', 'x-change' }
randomMixedBoard(seed): BoardDef   // 随机混排生成器（非官方）
validateBoard(board): void          // 结构校验，不合法抛错
```

自定义棋盘：任何满足 `validateBoard` 的 `BoardDef` 都可直接用于 `configForBoard`，
引擎的合法性判断与计分完全由数据驱动。

## 计分（src/core/scoring.ts）

```ts
pointsForCount(n)                 // n(n+1)/2
computeScore(state, player)       // => ScoreBreakdown（含 variantBonusPoints）
effectiveRowCount(state, player, row)  // 行划记数 + 奖励格贡献（封顶前），供 AI 估值
```

## 机器人（src/ai/bots.ts）

```ts
interface Bot {
  readonly name: string;
  chooseAction(state: GameState, playerId: number, rand: () => number): Action;
}

makeRand(seed)     // 种子化 rand() 闭包，保证对局可复现
BOT_REGISTRY       // { random, greedy, heuristic } 工厂表
```

自定义机器人只需实现 `Bot` 接口并注册进 `BOT_REGISTRY`（竞技场与 UI 会自动可选）。
三个内置机器人：

- `RandomBot`：合法动作均匀随机（下限基线）；
- `GreedyBot(maxSkip=1)`：跳格 ≤1 时取边际得分最高的划记，主动玩家兜底避免失误；
- `HeuristicBot(wSkip=1.8, markBonus=1, baseMaxSkip=1)`：边际得分 − 跳格代价（随进度放宽）
  + 锁行奖励 + 硬性跳格上限，参数经对战扫描调优。

## RL 编码（src/ai/encode.ts）

```ts
makeCodec(board): ActionCodec
//   { numActions, cellsPerRow, totalBonusCells, actionToIndex(a), indexToAction(i) }
legalActionMask(state, codec): Uint8Array          // 0/1 掩码，长度 numActions
observationSize(config, maxPlayers=5): number
encodeObservation(state, viewer, maxPlayers=5): Float32Array
```

动作空间布局（C = 行长，B = 奖励格总数）：

| 区间 | 含义 |
|---|---|
| `[0, 4C)` | markWhite（`row*C + cell`） |
| `[4C, 8C)` | markColor |
| `[8C, 8C+4)` | markLucky（按行） |
| `[8C+4, 8C+4+B)` | markBonusWhite |
| `[8C+4+B, 8C+4+2B)` | markBonusColor |
| `8C+4+2B` / `+1` | skipWhite / skipColor |

经典 94 维、Longo 126 维、Big Points 138 维。

观测向量（全部归一化到 [0,1]，`maxPlayers` 空位补零）：

1. 每名玩家（从 viewer 起按相对座位序）：`4C` 格划记 + `B` 奖励格 + 失误数；
2. 全局：锁定行 4、移除骰色 4、白骰值 2、彩骰值 4、彩骰在场 4、白骰和 1、
   阶段 one-hot 2、viewer 是否主动 1、viewer 是否当前决策者 1、viewer 幸运数字 2。

## 竞技场 CLI（src/cli/arena.ts）

```bash
npm run arena -- [--games N] [--bots a,b,...] [--board ID] [--seed S] [--traj FILE] [--no-rotate]
```

| 参数 | 缺省 | 说明 |
|---|---|---|
| `--games` | 100 | 对局数 |
| `--bots` | heuristic,random | 逗号分隔的机器人名（决定玩家数） |
| `--board` | classic | 棋盘预设 id，或 `random`（每局用种子生成） |
| `--seed` | 1 | 基础种子（第 g 局用 seed+g） |
| `--traj` | — | 将每步决策写入 JSONL（见 [training.md](training.md)） |
| `--no-rotate` | — | 关闭座位轮换（默认轮换以消除先手优势） |

输出各机器人的胜率（并列平分）、平均分与平均失误。
