# Qwixx 快可思 · 电子版

经典骰子桌游 **Qwixx**（Steffen Benndorf，NSV / Gamewright）的电子实现：
纯逻辑规则引擎 + 基线 AI 机器人 + 自对弈竞技场 + 网页对局界面，
支持人类与 AI 同桌混合对局，并为后续训练 AI 玩家预留了完整接口。

## 功能

- **规则引擎**（`src/core`）：零依赖、确定性（种子随机）、纯数据状态、可序列化回放。
  严格实现官方规则的所有边界情况（动作 1 全员同时结算、锁定即时生效、
  动作 1 后立即终局检查、锁定格计分 +1、自愿失误等，详见 `docs/rules-research.md`）。
- **多版本记分卡**：经典 / gemixxt 变体 A（混色·数字有序）/ gemixxt 变体 B（单色·数字乱序）/
  **Qwixx Longo**（2–16 长行、八面骰、双锁定格、幸运数字）/
  **Big Points** / **Double A/B** / **Bonus A/B** / **Connected 阶梯/连锁** /
  **X-Change**，共 12 个官方预设，另有随机混排生成器；
  失误上限、锁行门槛、骰面数等规则参数均可配置。
- **AI 机器人**（`src/ai`）：random / greedy / heuristic 三档基线 +
  rollout / rollout-lite 两档蒙特卡洛前瞻搜索（公共随机数配对消方差）+
  **policy 神经网络策略**（Python 行为克隆蒸馏 rollout 教师 + DAgger，
  256×256 MLP，2/3/4/5 人局均训练，对 heuristic 各人数胜率 68/53/45/40%，
  推理微秒级、UI 零运行时依赖），统一 `Bot` 接口，
  全部支持上述所有变体（含幸运数字与奖励格动作估值）。
- **自对弈竞技场**（`src/cli/arena.ts`）：批量对局统计胜率与均分，可导出 JSONL 轨迹。
- **RL 训练接口**（`src/ai/encode.ts`）：按棋盘生成的固定维度离散动作空间（经典 94 维）、
  定长归一化观测向量、合法动作掩码；同种子对局完全可复现。
- **网页 UI**（`src/ui`）：本地热座，1–5 名玩家任意混合人类/AI，中文界面。

## 快速开始

```bash
pnpm install

pnpm dev        # 启动网页版（人类 vs AI 对局）
pnpm test       # 引擎规则测试（vitest）
pnpm arena -- --games 1000 --bots heuristic,greedy,random   # 机器人对战统计
pnpm arena -- --games 100 --bots heuristic,heuristic --traj out/traj.jsonl  # 导出训练轨迹
pnpm tune       # 搜索 HeuristicBot 权重（网格 + 保留集验证）
pnpm build      # 类型检查 + 生产构建（dist/ 为纯静态站点）
```

## 训练 AI 玩家

仓库自带一条**完整的、已产出现役 `policy` 机器人的训练管线**（`training/`，Python），
全流程可确定性复现。详见 [`docs/training.md`](docs/training.md)。

```bash
# 1) rollout 教师自对弈 + DAgger 生成数据（2/3/4/5 人局），一键确定性复现
bash training/regen-data.sh                          # 引擎种子确定，等价复现约 29 万决策
# 2) 打包成 float16 压缩 npz（298MB JSONL → ~5MB，训练加载 35s → 0.65s）
python3 training/pack.py --data "out/bc2-*.jsonl,out/mp-*.jsonl" --out out/train.npz
# 3) 行为克隆训练（torch），导出 TS 零依赖可加载的权重 + 前向一致性 fixture
python3 training/bc_train.py --data out/train.npz --out src/ai/weights/policy-classic.json
# 4) 评估：各人数胜率 + 座位差
pnpm exec tsx scripts/eval-multiplayer.ts
```

管线要点（完整设计与实测见 [`docs/training.md`](docs/training.md)）：

- **教师**：`rollout`（蒙特卡洛前瞻，公共随机数配对消方差）自对弈产出轨迹；
  **DAgger** 让 `policy` 自己驱动对局、教师在其访问的状态上标注，修正分布偏移；
- **数据**：竞技场吐流式 JSONL（含 `obs / action / legal / ret`），`pack.py` 转
  float16 压缩 npz（obs 91% 是零，被 deflate 免费吃掉）；数据不入库、`regen-data.sh`
  可确定性重生成；
- **模型**：256×256 MLP + 联合价值头，`src/ai/mlp.ts` 提供**零依赖 TS 前向**，
  UI 推理微秒级、无 NN 运行时依赖；权重按版本存档于 `src/ai/weights/`；
- **PPO 自对弈**（`training/ppo_train.py`）：MaskablePPO 经 stdio 桥接引擎微调，
  实测未超过 BC 起点，如实记录于文档；
- 训练出的策略实现 `Bot` 接口即可接入网页 UI 与竞技场，和人类或其他机器人对战。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/manual.md`](docs/manual.md) | 玩家手册：通用规则、全部官方记分卡变体、界面操作、FAQ |
| [`docs/api.md`](docs/api.md) | 开发者参考：核心类型、引擎/棋盘/计分/机器人/RL 编码 API、竞技场 CLI 参数 |
| [`docs/training.md`](docs/training.md) | **AI 训练指南**：BC 蒸馏管线（rollout 教师 + DAgger）、数据格式与 npz 打包、多人局权重演进、PPO 自对弈、生成性能调查结论、各人数基线成绩 |
| [`docs/design.md`](docs/design.md) | 架构设计：状态机、关键规则裁定、变体支持矩阵 |
| [`docs/rules-research.md`](docs/rules-research.md) | 各版本规则调研报告（含官方规则 PDF 来源与 FAQ 裁定） |

## 项目结构

```
src/core/   规则引擎（types / rng / board / engine / scoring）
src/ai/     机器人、RL 编码、MLP 前向、策略权重（weights/，按版本存档）
src/cli/    自对弈竞技场（arena）、权重调参（tune）、RL 环境桥接（env-server）
src/ui/     Vite + React 网页界面
scripts/    多人局评估等工具
training/   Python 训练管线：数据打包(pack)/行为克隆(bc_train)/PPO(ppo_train)/确定性重生成(regen-data.sh)
tests/      引擎规则、MLP 前向、策略前向一致性测试
docs/       训练指南、API、玩家手册、架构、规则调研
```
