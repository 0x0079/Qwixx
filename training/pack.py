#!/usr/bin/env python3
"""把竞技场 JSONL 轨迹打包成压缩 npz，供训练快速加载。

竞技场吐的是流式 JSONL（可 grep、易合并分片），但每次训练都要重新解析
298MB 文本（约 35s），且 obs 有 91% 是零。本脚本一次性把它转成 float16
压缩 npz：298MB→约 4MB，加载 35s→0.65s（zeros 被 deflate 免费吃掉）。
不耦合观测布局，无 numpy 之外的依赖。

用法：
    python3 training/pack.py --data "out/bc2-*.jsonl,out/mp-*.jsonl" --out out/train.npz
"""
import argparse
import glob
import json

import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="out/bc2-*.jsonl,out/mp-*.jsonl")
    ap.add_argument("--out", default="out/train.npz")
    ap.add_argument("--actions", type=int, default=94, help="动作空间大小（classic=94），用于合法掩码宽度")
    ap.add_argument("--reward-scale", type=float, default=30.0)
    args = ap.parse_args()

    files = sorted(f for part in args.data.split(",") for f in glob.glob(part))
    if not files:
        raise SystemExit(f"没有匹配 {args.data} 的数据文件")

    obs, act, ret, mask = [], [], [], []
    for f in files:
        with open(f) as fh:
            for line in fh:
                if not line.strip():
                    continue
                d = json.loads(line)
                legal = d["legal"]
                if len(legal) < 2:  # 无决策价值的时刻
                    continue
                obs.append(d["obs"])
                act.append(d["action"])
                ret.append(d.get("ret", 0.0) / args.reward_scale)
                m = np.zeros(args.actions, dtype=bool)
                m[legal] = True
                mask.append(m)

    X = np.asarray(obs, dtype=np.float16)  # obs 在 [0,1]、4 位小数，float16 无损够用
    A = np.asarray(act, dtype=np.int16)
    R = np.asarray(ret, dtype=np.float16)
    # 合法掩码按位打包（94→12 字节/样本），deflate 后几乎不占空间
    Mpacked = np.packbits(np.asarray(mask, dtype=bool), axis=1)

    np.savez_compressed(args.out, obs=X, act=A, ret=R, mask=Mpacked, n_actions=args.actions)
    import os

    print(f"打包 {len(files)} 文件 → {len(X)} 样本，obs 维 {X.shape[1]}，动作 {args.actions}")
    print(f"写入 {args.out}（{os.path.getsize(args.out) / 1e6:.1f}MB）")


if __name__ == "__main__":
    main()
