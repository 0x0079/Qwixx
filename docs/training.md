# AI 训练指南

引擎从设计上即面向强化学习 / 模仿学习：确定性种子、纯数据状态、固定维度的
动作空间与观测编码、合法动作掩码、毫秒级对局速度（经典棋盘约 0.5ms/局）。
API 细节见 [api.md](api.md)。

## 任务形式化

- **多智能体回合制**，序列化为单决策流：任意时刻恰有一名玩家（`currentActor`）
  需要从 `legalActions` 中选一个动作；
- **部分随机**：骰子由种子决定；同种子 + 同策略 ⇒ 完全相同对局（引擎测试保证）；
- **回报**：终局 `finalScores` 给出各玩家总分。常用奖励设计：
  - 胜负奖励：`winners.includes(me) ? +1 : -1`（并列可给 1/并列数）；
  - 分差奖励：`myScore - max(otherScores)`，更平滑；
  - 也可用势函数塑形：`computeScore(state, me).total` 的逐步差分。
- **对手**：训练时可用内置 `random / greedy / heuristic` 做课程式对手池，
  或自对弈（self-play）共享同一策略。

## 路线一：在线自对弈（Node 侧）

```ts
import { configForBoard, newGame, currentActor, legalActions, applyActionInPlace } from './src/core/engine';
import { BOARD_PRESETS } from './src/core/board';
import { makeCodec, encodeObservation, legalActionMask } from './src/ai/encode';
import { computeScore } from './src/core/scoring';

const board = BOARD_PRESETS['classic']!;
const codec = makeCodec(board);

function playEpisode(policy: (obs: Float32Array, mask: Uint8Array) => number, seed: number) {
  const state = newGame(configForBoard(board, 2, seed));
  const transitions: { player: number; obs: Float32Array; action: number }[] = [];
  while (state.phase !== 'gameOver') {
    const p = currentActor(state);
    const obs = encodeObservation(state, p);
    const mask = legalActionMask(state, codec);
    const a = policy(obs, mask);               // 策略必须只在 mask=1 的动作中选择
    transitions.push({ player: p, obs, action: a });
    applyActionInPlace(state, codec.indexToAction(a));
  }
  return { transitions, finalScores: state.finalScores! };
}
```

要点：

- **必须应用动作掩码**（softmax 前把非法 logits 置 -∞）：动作空间大部分位置在多数
  状态下非法；
- `applyActionInPlace` 不校验合法性——策略侧用掩码保证，或在调试期改用 `applyAction`；
- 想并行采样，直接在多个 worker 里跑不同种子即可，引擎无共享状态。

训练框架自选：可在 Node 内用 tfjs / onnxruntime，也可把上面的循环包装成
stdio/HTTP 服务由 Python 驱动（状态与动作都是 JSON 可序列化的）。

## 路线二：离线数据（JSONL → Python）

用竞技场批量生成教师轨迹（行为克隆 / 离线 RL）：

```bash
pnpm arena -- --games 5000 --bots heuristic,heuristic --traj out/traj.jsonl
```

### 现成的 BC 管线（training/bc_train.py）

仓库已带一条完整的行为克隆管线（`policy` 机器人即由此产出）：

```bash
# 1) rollout 教师自对弈生成数据（可开多进程分片，约 3s/局）
for i in 0 1 2 3; do
  pnpm arena -- --games 300 --bots rollout,rollout \
    --traj out/bc-$i.jsonl --seed $((10000 + i * 300)) &
done; wait

# 2) 打包成压缩 npz（一次性，298MB JSONL → ~5MB，加载 35s → 0.65s）
pip install -r training/requirements.txt
python3 training/pack.py --data "out/bc-*.jsonl" --out out/train.npz

# 3) 训练（torch，CPU 几分钟）并导出 TS 可加载的权重 + 前向一致性 fixture
python3 training/bc_train.py --data out/train.npz \
  --out src/ai/weights/policy-classic.json --board classic

# 4) 验证与评估
pnpm test                                           # 含 TS↔torch 前向一致性回归
pnpm arena -- --games 2000 --bots policy,heuristic
```

数据格式：竞技场吐流式 JSONL（可 grep、易合并分片）；`pack.py` 转成 float16
压缩 npz 供训练快速加载（obs 有 91% 是零，被 npz 的 deflate 免费吃掉；
不耦合观测布局）。`bc_train.py --data` 同时接受 `.npz` 与 `.jsonl`（按扩展名
识别，可混用），跳过打包直接喂 JSONL 也可，只是每次训练多花约 35s 解析。
导出格式见 `src/ai/mlp.ts` 头注释（W 为 [in, out] 行主序、Float32 base64）。

当前权重（v3）的训练配置与实测：
- 数据 29.2 万决策 = 2 人局 16.5 万（v2 的 rollout 自对弈 + DAgger）
  **+ 3/4/5 人局各约 4.2 万**（`--bots rollout×N` 自对弈 + `--label-bot
  rollout` 的 DAgger，policy 驱动走出多人状态分布）。观测编码以 viewer
  相对座位补零到 5 人，各人数维度一致（471），故不同人数数据可直接混合；
- 架构 256×256 + 联合训练价值头（终局分差回归，val-V-MAE ≈ 14 分）；
  val-acc 75.4%；
- 多人局战绩（各 1200 局、轮换座位，`pnpm exec tsx
  scripts/eval-multiplayer.ts`）：

  | 人数 | v3 胜率 | 均分基准 | 倍率 | v2（仅 2 人训练） |
  |---|---|---|---|---|
  | 2 人 | 68.0% | 50.0% | 1.36x | 66.8% |
  | 3 人 | 53.3% | 33.3% | 1.60x | 49.0% |
  | 4 人 | 45.5% | 25.0% | 1.82x | 41.1% |
  | 5 人 | 40.2% | 20.0% | 2.01x | 36.6% |

  每个人数都超均分基准并优于只在 2 人局训练的 v2（多人局 +3.6~4.4pp，
  2 人局不退反升）。推理微秒级，比 rollout 教师快约 350 倍。

演进：v1（1200 局、128×128、无 DAgger）对 heuristic 65.9%；v2（256×256
+ DAgger + 价值头）67~68%；v3 在 v2 基础上补齐 3/4/5 人局数据，修掉
「只在 2 人局训练、多人局与非首位座位偏弱」的覆盖缺陷。

### PPO 自对弈微调（training/ppo_train.py）

在 BC 权重上继续用 MaskablePPO（sb3-contrib）自对弈训练：

```bash
pip install -r training/requirements.txt
python3 training/ppo_train.py --rounds 3 --steps-per-round 300000 \
  --out out/ppo-candidate.json --parity-fixture out/ppo-parity.json
# 复核后再覆盖 src/ai/weights/policy-classic.json 与 tests/fixtures/
```

环境经 `src/cli/env-server.ts` stdio 桥接（见 api.md），按轮自对弈：
每轮对手固定为上一轮策略快照（第 1 轮为 BC 权重），轮末快照当前策略。
热启动把 BC 权重同时装进 pi / vf 两套网络；训练完在保留种子上对
heuristic 评估，只有超过 BC 基线才值得覆盖权重。奖励为终局分差/30、
gamma=1（回合制终局奖励），动作掩码贯穿采样与更新。

两轮实测均未超过 BC 起点，正式权重保持 BC 版本：
- v1（3 轮 × 30 万步、单一快照对手、稀疏终局奖励、无价值热启动）：
  对 BC 直接对战 47.3%；
- v2（4 轮 × 35 万步、对手池 heuristic+BC 锚点+快照、势函数塑形、
  价值头热启动、逐轮 lr 衰减）：对 BC v2 直接对战 49.6%、对
  heuristic 66.6%（BC v2 为 68.0%）——诸多正确性改进让 PPO 不再
  劣化策略，但仍无净增益。
结论：rollout 教师 + DAgger 的 BC 在该网络规模下已贴近这套观测编码
的天花板，PPO 的采样效率不足以在百万步级别再往上推。若要继续冲，
优先级依次：更强教师（加大 rollout N 或 MCTS 化）后重新蒸馏、
结构化观测编码（按行/按玩家分组的共享编码器）、10 倍以上训练步数。

每行一条决策记录：

```json
{
  "seed": 1234,          // 该局种子（可完整复现该局）
  "turn": 7,             // 回合号
  "actor": 0,            // 决策玩家座位
  "bot": "heuristic",    // 决策者名称
  "obs": [0, 1, ...],    // encodeObservation 的观测向量（4 位小数）
  "action": 42,          // codec.actionToIndex 的动作下标
  "legal": [3, 42, 93]   // 该时刻合法动作下标（训练时做掩码）
}
```

Python 侧读入即可训练分类器（行为克隆）：

```python
import json, numpy as np

X, y = [], []
for line in open('out/traj.jsonl'):
    d = json.loads(line)
    X.append(d['obs']); y.append(d['action'])
X, y = np.array(X, np.float32), np.array(y, np.int64)
# 任意框架训练 obs -> action 分类；预测时同样要做合法动作掩码
```

注意：JSONL 里只有决策时刻的 (obs, action)；如需回报标签，按 `seed` 分组把该局
终局分数（可用引擎按种子重放获得）回填到该局所有样本。

## 评估与接入

1. 把训练好的策略包成 `Bot`：

```ts
class PolicyBot implements Bot {
  readonly name = 'policy';
  chooseAction(state, playerId, _rand) {
    const obs = encodeObservation(state, playerId);
    const mask = legalActionMask(state, codec);
    return codec.indexToAction(argmaxMasked(model(obs), mask));
  }
}
BOT_REGISTRY['policy'] = () => new PolicyBot();
```

2. 用竞技场对战基线（座位自动轮换消除先手优势）：

```bash
pnpm arena -- --games 2000 --bots policy,heuristic
```

3. 注册后 UI 会自动出现该选项，可直接与人类对战。

## 基线成绩（供对比）

2 人局、轮换座位、500 局：

| 对阵 | 胜率 | 平均分 |
|---|---|---|
| heuristic vs greedy（classic） | 55% : 45% | 60 : 58 |
| heuristic vs random（classic） | 99.8% : 0.2% | 47 : 1 |
| heuristic vs greedy（longo，300 局） | 67% : 33% | 83 : 68 |
| heuristic vs greedy（big-points，300 局） | 50% : 50% | 170 : 171 |
| rollout vs heuristic（classic，100 局） | 69% : 31% | 70 : 58 |
| rollout-lite vs heuristic（classic，100 局） | 57% : 43% | 63 : 60 |
| policy vs heuristic（classic，2000 局） | 67% : 33% | 72 : 60 |
| policy vs rollout（classic，100 局） | 49% : 51% | 73 : 71 |

超过 heuristic 即说明策略学到了非平凡的跳格/锁行权衡；
`rollout`（蒙特卡洛前瞻，约 1.6s/局）是当前最强基线，可作为 RL 的教师策略
（`arena --traj` 导它的轨迹做行为克隆 warm start）与训练后的对战及格线。

heuristic 的默认权重可用 `pnpm tune` 重新搜索（例如换棋盘/对手池后）：
两阶段网格搜索 + 保留种子集验证，详见 [api.md](api.md) 调参 CLI 一节。
