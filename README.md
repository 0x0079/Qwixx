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
  **Qwixx Big Points**（双色奖励行、每行封顶 15 计数）/ 随机混排生成器；
  失误上限、锁行门槛、骰面数等规则参数均可配置。
- **AI 机器人**（`src/ai`）：random / greedy / heuristic 三档基线，统一 `Bot` 接口，
  全部支持上述所有变体（含幸运数字与奖励格动作估值）。
- **自对弈竞技场**（`src/cli/arena.ts`）：批量对局统计胜率与均分，可导出 JSONL 轨迹。
- **RL 训练接口**（`src/ai/encode.ts`）：按棋盘生成的固定维度离散动作空间（经典 94 维）、
  定长归一化观测向量、合法动作掩码；同种子对局完全可复现。
- **网页 UI**（`src/ui`）：本地热座，1–5 名玩家任意混合人类/AI，中文界面。

## 快速开始

```bash
npm install

npm run dev        # 启动网页版（人类 vs AI 对局）
npm test           # 引擎规则测试（vitest）
npm run arena -- --games 1000 --bots heuristic,greedy,random   # 机器人对战统计
npm run arena -- --games 100 --bots heuristic,heuristic --traj out/traj.jsonl  # 导出训练轨迹
npm run build      # 类型检查 + 生产构建（dist/ 为纯静态站点）
```

## 训练 AI 玩家

引擎为强化学习/模仿学习设计：

1. **离线数据**：`arena --traj` 导出 `{obs, action, ...}` JSONL，直接喂 Python 训练管线；
2. **在线自对弈**：在 Node 侧用 `newGame / legalActions / applyActionInPlace / encodeObservation /
   legalActionMask` 搭 self-play 循环（毫秒级/局，见 arena 实测）；
3. 训练出的策略实现 `Bot` 接口即可接入网页 UI 与竞技场，和人类或其他机器人对战。

详细架构与接口说明见 [`docs/design.md`](docs/design.md)；
各版本规则调研（含官方规则 PDF 来源）见 [`docs/rules-research.md`](docs/rules-research.md)。

## 项目结构

```
src/core/   规则引擎（types / rng / board / engine / scoring）
src/ai/     机器人与 RL 编码
src/cli/    自对弈竞技场
src/ui/     Vite + React 网页界面
tests/      引擎规则测试
docs/       规则调研报告、架构设计
```
