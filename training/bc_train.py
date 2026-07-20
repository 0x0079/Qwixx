#!/usr/bin/env python3
"""行为克隆（BC）训练器。

数据来自竞技场轨迹导出（含合法动作掩码）：
    pnpm arena -- --games 300 --bots rollout,rollout --traj out/bc-0.jsonl --seed 10000

训练掩码交叉熵分类器 obs -> action，导出 src/ai/mlp.ts 可加载的权重 JSON
（W 为 [in, out] 行主序，Float32 字节 base64），并写出一个前向一致性
fixture（tests/fixtures/policy-parity.json）供 TS 侧回归测试。

用法：
    python3 training/bc_train.py --data "out/bc-*.jsonl" \
        --out src/ai/weights/policy-classic.json --board classic
"""
import argparse
import base64
import glob
import json
import math
from pathlib import Path

import numpy as np
import torch
from torch import nn


class PolicyNet(nn.Module):
    """与 src/ai/mlp.ts 前向逻辑一一对应：hidden(relu)×k + 策略头 + 价值头。"""

    def __init__(self, n_in: int, hidden: list[int], n_actions: int):
        super().__init__()
        layers: list[nn.Module] = []
        prev = n_in
        for h in hidden:
            layers.append(nn.Linear(prev, h))
            layers.append(nn.ReLU())
            prev = h
        self.trunk = nn.Sequential(*layers)
        self.policy = nn.Linear(prev, n_actions)
        self.value = nn.Linear(prev, 1)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.trunk(x)
        return self.policy(h), self.value(h).squeeze(-1)


def load_dataset(pattern: str, reward_scale: float):
    files = sorted(f for part in pattern.split(",") for f in glob.glob(part))
    if not files:
        raise SystemExit(f"没有匹配 {pattern} 的数据文件")
    obs, actions, masks, rets = [], [], [], []
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
                actions.append(d["action"])
                masks.append(legal)
                rets.append(d.get("ret", 0.0) / reward_scale)
    X = np.asarray(obs, dtype=np.float32)
    y = np.asarray(actions, dtype=np.int64)
    R = np.asarray(rets, dtype=np.float32)
    print(f"读入 {len(files)} 个文件：{len(X)} 样本，obs 维度 {X.shape[1]}")
    return X, y, masks, R


def build_mask_matrix(masks: list[list[int]], n_actions: int) -> np.ndarray:
    M = np.zeros((len(masks), n_actions), dtype=bool)
    for i, legal in enumerate(masks):
        M[i, legal] = True
    return M


def f32_b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype=np.float32).tobytes()).decode()


def export_weights(model: PolicyNet, arch: dict, board_id: str, out_path: Path) -> None:
    tensors: dict[str, str] = {}
    linears = [m for m in model.trunk if isinstance(m, nn.Linear)]
    for l, lin in enumerate(linears):
        # torch Linear.weight 为 [out, in]；TS 侧期望 [in, out] 行主序
        tensors[f"W{l}"] = f32_b64(lin.weight.detach().numpy().T)
        tensors[f"b{l}"] = f32_b64(lin.bias.detach().numpy())
    tensors["Wp"] = f32_b64(model.policy.weight.detach().numpy().T)
    tensors["bp"] = f32_b64(model.policy.bias.detach().numpy())
    tensors["Wv"] = f32_b64(model.value.weight.detach().numpy().reshape(-1))
    tensors["bv"] = f32_b64(model.value.bias.detach().numpy())
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"arch": arch, "boardId": board_id, "tensors": tensors}))
    print(f"权重已写入 {out_path}（{out_path.stat().st_size // 1024} KB）")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="out/bc-*.jsonl")
    ap.add_argument("--out", default="src/ai/weights/policy-classic.json")
    ap.add_argument("--board", default="classic")
    ap.add_argument("--actions", type=int, default=94, help="动作空间大小（classic=94）")
    ap.add_argument("--hidden", default="256,256")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--vf-coef", type=float, default=0.5, help="价值头损失权重（0 关闭）")
    ap.add_argument("--reward-scale", type=float, default=30.0, help="ret 归一化除数（与 env-server 一致）")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--parity-fixture", default="tests/fixtures/policy-parity.json")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    X, y, masks, R = load_dataset(args.data, args.reward_scale)
    n_actions = args.actions
    M = build_mask_matrix(masks, n_actions)

    # 10% 验证集
    idx = np.random.permutation(len(X))
    n_val = len(X) // 10
    val, tr = idx[:n_val], idx[n_val:]

    hidden = [int(h) for h in args.hidden.split(",")]
    model = PolicyNet(X.shape[1], hidden, n_actions)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    Xt = torch.from_numpy(X)
    yt = torch.from_numpy(y)
    Mt = torch.from_numpy(M)
    Rt = torch.from_numpy(R)
    NEG = -1e9

    def forward_masked(batch_idx: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        logits, value = model(Xt[batch_idx])
        return logits.masked_fill(~Mt[batch_idx], NEG), value

    def validate() -> tuple[float, float]:
        model.eval()
        with torch.no_grad():
            hits, mae = 0, 0.0
            for s in range(0, len(val), 4096):
                b = torch.from_numpy(val[s : s + 4096])
                logits, value = forward_masked(b)
                hits += (logits.argmax(-1) == yt[b]).sum().item()
                mae += (value - Rt[b]).abs().sum().item()
        model.train()
        return hits / len(val), mae / len(val)

    best_acc, best_state = 0.0, None
    steps_per_epoch = math.ceil(len(tr) / args.batch)
    for epoch in range(1, args.epochs + 1):
        perm = np.random.permutation(tr)
        total_loss = 0.0
        for s in range(0, len(perm), args.batch):
            b = torch.from_numpy(perm[s : s + args.batch])
            logits, value = forward_masked(b)
            loss = nn.functional.cross_entropy(logits, yt[b])
            if args.vf_coef > 0:
                loss = loss + args.vf_coef * nn.functional.smooth_l1_loss(value, Rt[b])
            opt.zero_grad()
            loss.backward()
            opt.step()
            total_loss += loss.item()
        acc, vmae = validate()
        print(
            f"epoch {epoch}/{args.epochs}  loss {total_loss / steps_per_epoch:.4f}"
            f"  val-acc {acc * 100:.2f}%  val-V-MAE {vmae * args.reward_scale:.1f}分"
        )
        if acc > best_acc:
            best_acc = acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    assert best_state is not None
    model.load_state_dict(best_state)
    model.eval()
    print(f"最优 val-acc {best_acc * 100:.2f}%")

    arch = {"input": X.shape[1], "hidden": hidden, "actions": n_actions}
    export_weights(model, arch, args.board, Path(args.out))

    # 前向一致性 fixture：TS 侧加载同一份权重，logits 必须与此处一致
    sample = int(val[0])
    with torch.no_grad():
        logits, value = model(Xt[sample : sample + 1])
    fixture = {
        "obs": [round(float(v), 6) for v in X[sample]],
        "logits": [round(float(v), 5) for v in logits[0]],
        "value": round(float(value[0]), 5),
    }
    fp = Path(args.parity_fixture)
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(json.dumps(fixture))
    print(f"一致性 fixture 已写入 {fp}")


if __name__ == "__main__":
    main()
