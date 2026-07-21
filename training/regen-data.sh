#!/usr/bin/env bash
# 确定性重生成 v3（多人局）BC 训练数据。
#
# 引擎是种子确定性的：同种子 + 同 bot ⇒ 逐字节相同的轨迹。因此这份脚本
# 就是「数据本体」——运行它即可精确复现 src/ai/weights/policy-classic.json
# （v3）所用的约 29 万条决策样本（约 298MB，写入 out/）。数据本身不入库
# （见 .gitignore），配方入库。
#
# ── 可复现性说明 ──────────────────────────────────────────────
# rollout 自对弈分片（*-r*.jsonl）：纯种子、无学习权重，字节级可复现。
# DAgger 分片（*-d*.jsonl）：由 `policy` bot 驱动走出「学生状态分布」，
#   而 policy 加载 src/ai/weights/policy-classic.json。原始 v3 训练集里，
#   bc2-d* 生成时 policy=v1、mp-d* 生成时 policy=v2（因数据是逐步产出的）。
#   本脚本默认用命名快照精确重放该依赖（policy-classic-v{1,2}.json 已入库）；
#   过程中临时替换 policy-classic.json，结束时无条件恢复。
# 注：原始 mp-d5 曾被一次容器重启截断（约 120 局中的一部分）；本脚本跑满
#   120 局，得到的是等价或更完整的超集——对训练无害。
#
# 用法：bash training/regen-data.sh        # 4 核并行，约 1 小时
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out
WEIGHTS=src/ai/weights/policy-classic.json

# 结束时（含出错/中断）恢复现役 v3 权重，避免脏状态残留。
restore_v3() { cp src/ai/weights/policy-classic-v3.json "$WEIGHTS"; }
trap restore_v3 EXIT

run() { echo "+ pnpm arena -- $*"; pnpm arena -- "$@"; }

# ── 波 1：2 人局数据（v2 集，policy 驱动的 DAgger 用 v1 快照）──────────
cp src/ai/weights/policy-classic-v1.json "$WEIGHTS"
(run --games 300 --bots rollout,rollout                      --traj out/bc2-r0.jsonl --seed 20000
 run --games 200 --bots policy,policy       --label-bot rollout --traj out/bc2-d0.jsonl --seed 30000) &
(run --games 300 --bots rollout,rollout                      --traj out/bc2-r1.jsonl --seed 20300
 run --games 200 --bots policy,policy       --label-bot rollout --traj out/bc2-d1.jsonl --seed 30200) &
(run --games 300 --bots rollout,rollout                      --traj out/bc2-r2.jsonl --seed 20600
 run --games 200 --bots policy,heuristic    --label-bot rollout --traj out/bc2-d2.jsonl --seed 30400) &
(run --games 300 --bots rollout,rollout                      --traj out/bc2-r3.jsonl --seed 20900
 run --games 200 --bots policy,rollout-lite --label-bot rollout --traj out/bc2-d3.jsonl --seed 30600) &
wait

# ── 波 2：3/4/5 人局数据（DAgger 用 v2 快照）─────────────────────────
cp src/ai/weights/policy-classic-v2.json "$WEIGHTS"
(run --games 250 --bots rollout,rollout,rollout                       --traj out/mp-r3.jsonl --seed 40000
 run --games 180 --bots policy,heuristic,rollout-lite --label-bot rollout --traj out/mp-d3.jsonl --seed 41000) &
(run --games 180 --bots rollout,rollout,rollout,rollout               --traj out/mp-r4.jsonl --seed 42000
 run --games 150 --bots policy,heuristic,heuristic,rollout-lite --label-bot rollout --traj out/mp-d4.jsonl --seed 43000) &
(run --games 140 --bots rollout,rollout,rollout,rollout,rollout       --traj out/mp-r5.jsonl --seed 44000
 run --games 120 --bots policy,heuristic,heuristic,heuristic,rollout-lite --label-bot rollout --traj out/mp-d5.jsonl --seed 45000) &
(run --games 200 --bots rollout,rollout                               --traj out/mp-r2.jsonl --seed 46000
 run --games 160 --bots policy,rollout-lite           --label-bot rollout --traj out/mp-d2.jsonl --seed 47000) &
wait

# ── 打包成压缩 npz（298MB JSONL → ~5MB，训练加载 35s → 0.65s）──────────
python3 training/pack.py --data "out/bc2-*.jsonl,out/mp-*.jsonl" --out out/train.npz

echo "完成。训练：python3 training/bc_train.py --data out/train.npz --out out/bc3-candidate.json"
