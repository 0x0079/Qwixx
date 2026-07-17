# 架构设计与 AI 训练接口

## 总览

```
src/
  core/      纯逻辑游戏引擎（零依赖、确定性、可序列化）
    types.ts     类型定义（棋盘、状态、动作）
    rng.ts       mulberry32 种子随机数（状态存于 GameState，可复现）
    board.ts     记分卡定义：经典 / gemixxt A / gemixxt B / 随机混排生成器
    engine.ts    回合状态机：newGame / legalActions / applyAction / applyActionInPlace
    scoring.ts   计分（按行或按颜色分组、锁定奖励、失误扣分）
  ai/
    bots.ts      基线机器人：random / greedy / heuristic（统一 Bot 接口）
    encode.ts    RL 编码：固定 90 维离散动作空间 + 定长观测向量 + 合法动作掩码
  cli/
    arena.ts     自对弈竞技场：胜率统计、轨迹导出（JSONL）
  ui/            Vite + React 网页界面（本地热座：人类与 AI 任意混合）
tests/           引擎与规则边界用例（vitest）
docs/
  rules-research.md  各版本规则调研报告（含官方来源链接）
```

## 引擎状态机

引擎把官方"动作 1 全员同时决策"序列化为一个决策队列（`whiteQueue`，从主动玩家起
按座位顺序），**锁定与彩骰移除在队列清空后统一结算**，因此序列化不影响规则语义
（后决策的玩家不会被同窗口先决策者锁定的行封锁）。

```
whiteChoice（按 whiteQueue 依次：markWhite | skipWhite）
  └─ 队列清空 → resolveLocks → 终局? → colorChoice
colorChoice（仅主动玩家：markColor | skipColor）
  └─ 失误判定 → resolveLocks → 终局? → 下一回合（换主动玩家、重掷）
```

关键裁定（依据 docs/rules-research.md §2.3、§5）：

- 锁定在**动作 1 窗口结算完毕后立即生效**：动作 2 不能再用被移除的彩骰或被锁的行；
- 动作 1 结算后立即检查终局；若已锁满 2 行，动作 2 不执行、不记失误；
- 同一窗口内多名玩家可同时锁同一行/不同行（各自需满足"该行已划 ≥5"）；
- 锁定格划记计入计分组数量（+1）；
- 主动玩家两步皆未划 → 强制记失误（-5），非主动玩家跳过无代价；
- 平局：并列共同获胜（官方未规定）。

所有状态均为纯数据（可 `structuredClone` / JSON 序列化），`applyAction` 返回新状态，
`applyActionInPlace` 供高吞吐自对弈使用。

## 变体支持

记分卡抽象为 `cell(row, index) = {color, number}` 二维表 + 每行 `lockColor`，
一套合法性判断覆盖经典版与 gemixxt A/B：

| 预设 | 数字 | 颜色 | 特殊机制 | 计分 |
|---|---|---|---|---|
| `classic` | 红黄 2→12，绿蓝 12→2 | 整行单色 | — | 按行 |
| `gemixxt-a` | 同经典 | 行内混色（同一数字四行四色各一） | — | 按行 |
| `gemixxt-b` | 行内乱序（锁定数字：红11/黄10/绿3/蓝4） | 整行单色 | — | 按行 |
| `longo` | 2→16 / 16→2（15 格） | 整行单色 | 八面骰、行尾两格皆可锁（门槛 6）、每人 2 个幸运数字 | 按行（15x=120） |
| `big-points` | 同经典 | 整行单色 | 两条圆形双色奖励行，计入相邻两行、每行封顶 15 | 按行 |
| `randomMixedBoard(seed)` | 行内乱序 | 混色（每色恰 11 格） | — | 按行 |

Longo / Big Points 的实现依据官方英文规则 PDF（QwixxLongo_GB.pdf / QwixxBP_GB.pdf），
关键裁定：Longo 幸运数字只在动作 1（白骰和等于幸运数字）可用，改划"当前划记最少的
未锁定行"的下一个可划格（不跳格），并可依常规条件锁行；Big Points 奖励格需相邻普通格
已划过 + 再次掷出同数（白骰和任何人可用；彩骰组合须与已划相邻格同色同数，仅主动玩家），
奖励行独立遵守从左到右，不计入锁行门槛，只划奖励格不算失误。

注：gemixxt 预设的格子排布满足官方结构约束，但具体排列为本项目自拟（官方卡面
无公开电子数据）；引擎另支持 `scoreBy: 'color'` 作为自定义计分模式。
规则参数（失误上限、扣分、锁行门槛、骰面数、终局锁数）都在 `RulesConfig` 中可调，
`configForBoard()` 会自动应用棋盘预设的规则覆盖并生成幸运数字。

## AI 训练接口（src/ai/encode.ts）

- **动作空间**：`makeCodec(board)` 按棋盘生成固定维度离散编解码器——
  markWhite / markColor（4×行长）、markLucky（4）、markBonusWhite / markBonusColor
  （奖励格数）、2 个跳过；经典棋盘 94 维，Longo 126 维，Big Points 138 维。
  `legalActionMask(state, codec)` 返回 0/1 掩码。
- **观测**：`encodeObservation(state, viewer, maxPlayers=5)` 定长 Float32Array（维度由
  `observationSize(config)` 给出），含各玩家划记/奖励格/失误（以 viewer 为基准的相对
  座位序）、锁行、移除骰色、骰值（按骰面数归一化）、阶段、是否主动/当前决策者、
  幸运数字；全部归一化到 [0,1]。
- **确定性**：种子完全决定骰子序列；同种子 + 同策略 ⇒ 完全相同对局（有测试保证）。
- **轨迹导出**：`npm run arena -- --games N --bots a,b --traj out/traj.jsonl`
  每行一条 `{seed, turn, actor, bot, obs, action}`，可直接喂给 Python 训练管线
  （行为克隆/离线 RL）；在线 RL 可直接在 Node 侧用 `newGame/legalActions/applyActionInPlace`
  搭 self-play 循环，或将引擎经由 JSON 协议桥接到 Python。

### 基线机器人

| 名称 | 策略 | 定位 |
|---|---|---|
| `random` | 合法动作均匀随机 | 下限基线 |
| `greedy` | 跳格 ≤1 时取边际得分最高的划记；主动玩家避免失误 | 强基线 |
| `heuristic` | 边际得分 − 跳格代价（随进度放宽）+ 锁行奖励 + 硬性跳格上限 | 最强基线，参数经扫描调优 |

实测（500 局，经典棋盘，轮换座位）：heuristic ≈ greedy ≫ random。

## 网页 UI

Vite + React 本地热座对局：任意人数（1–5）人类/AI 混合、三种棋盘预设、可设种子。
AI 决策自动播放；人类回合点击格子/按钮行动。`npm run dev` 启动。
