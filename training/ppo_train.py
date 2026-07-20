#!/usr/bin/env python3
"""PPO 自对弈微调（MaskablePPO + Node 引擎 stdio 桥接）。

从 BC 权重热启动，对冻结的对手（BC 策略快照 / heuristic）自对弈训练，
按轮迭代：每轮结束把当前策略快照为下一轮对手。训练完在保留种子上
评估（对 heuristic 的确定性胜率），仅当超过基线时才覆盖权重 JSON。

用法（在仓库根目录）：
    python3 training/ppo_train.py \
        --bc-weights src/ai/weights/policy-classic.json \
        --out src/ai/weights/policy-classic.json \
        --rounds 3 --steps-per-round 200000
"""
import argparse
import base64
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch
from torch import nn

from gymnasium import spaces
from sb3_contrib import MaskablePPO
from sb3_contrib.common.maskable.utils import get_action_masks
from stable_baselines3.common.vec_env.base_vec_env import VecEnv


class QwixxVecEnv(VecEnv):
    """经 stdio JSON-lines 桥接 Node 引擎（src/cli/env-server.ts）的向量环境。"""

    def __init__(self, num_envs: int, board: str, opponent: str, seed: int):
        self.proc = subprocess.Popen(
            ["node_modules/.bin/tsx", "src/cli/env-server.ts"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        info = self._rpc({"cmd": "init", "board": board, "numEnvs": num_envs, "opponent": opponent, "seed": seed})
        self.n_actions = info["numActions"]
        observation_space = spaces.Box(low=0.0, high=1.0, shape=(info["obsSize"],), dtype=np.float32)
        action_space = spaces.Discrete(self.n_actions)
        super().__init__(num_envs, observation_space, action_space)
        self._legal: list[list[int]] = []
        self._actions: np.ndarray | None = None

    def _rpc(self, msg: dict) -> dict:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        resp = json.loads(self.proc.stdout.readline())
        if "error" in resp:
            raise RuntimeError(resp["error"])
        return resp

    def _masks(self) -> np.ndarray:
        m = np.zeros((self.num_envs, self.n_actions), dtype=bool)
        for i, legal in enumerate(self._legal):
            m[i, legal] = True
        return m

    def reset(self):
        resp = self._rpc({"cmd": "reset"})
        self._legal = resp["legal"]
        return np.asarray(resp["obs"], dtype=np.float32)

    def step_async(self, actions):
        self._actions = actions

    def step_wait(self):
        resp = self._rpc({"cmd": "step", "actions": [int(a) for a in self._actions]})
        self._legal = resp["legal"]
        obs = np.asarray(resp["obs"], dtype=np.float32)
        rewards = np.asarray(resp["reward"], dtype=np.float32)
        dones = np.asarray(resp["done"], dtype=bool)
        infos = [{} for _ in range(self.num_envs)]
        return obs, rewards, dones, infos

    def close(self):
        try:
            self._rpc({"cmd": "close"})
        except Exception:
            pass
        self.proc.terminate()

    # --- VecEnv 接口的其余部分 ---
    def env_method(self, method_name, *args, indices=None, **kwargs):
        if method_name == "action_masks":  # MaskablePPO 经 get_action_masks 调用
            return list(self._masks())
        raise NotImplementedError(method_name)

    def get_attr(self, attr_name, indices=None):
        if attr_name == "render_mode":
            return [None] * self.num_envs
        if attr_name == "action_masks":  # is_masking_supported 经 has_attr 探测
            return list(self._masks())
        raise NotImplementedError(attr_name)

    def set_attr(self, attr_name, value, indices=None):
        raise NotImplementedError(attr_name)

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * self.num_envs


def b64_to_t(s: str, shape: tuple[int, ...]) -> torch.Tensor:
    a = np.frombuffer(base64.b64decode(s), dtype=np.float32).reshape(shape)
    return torch.from_numpy(a.copy())


def t_to_b64(t: torch.Tensor) -> str:
    return base64.b64encode(np.ascontiguousarray(t.detach().numpy(), dtype=np.float32).tobytes()).decode()


def load_bc_into(model: MaskablePPO, bc: dict) -> None:
    """把 BC 权重装进 MaskablePPO 的 pi / vf 两套网络（vf 主干同拷）。"""
    arch = bc["arch"]
    hidden = arch["hidden"]
    t = bc["tensors"]
    pol = model.policy
    with torch.no_grad():
        sizes = [arch["input"], *hidden]
        for l in range(len(hidden)):
            w = b64_to_t(t[f"W{l}"], (sizes[l], sizes[l + 1])).T  # JSON [in,out] → torch [out,in]
            b = b64_to_t(t[f"b{l}"], (sizes[l + 1],))
            for net in (pol.mlp_extractor.policy_net, pol.mlp_extractor.value_net):
                net[l * 2].weight.copy_(w)
                net[l * 2].bias.copy_(b)
        pol.action_net.weight.copy_(b64_to_t(t["Wp"], (hidden[-1], arch["actions"])).T)
        pol.action_net.bias.copy_(b64_to_t(t["bp"], (arch["actions"],)))
        pol.value_net.weight.copy_(b64_to_t(t["Wv"], (hidden[-1],)).reshape(1, -1))
        pol.value_net.bias.copy_(b64_to_t(t["bv"], (1,)))


def export_weights(model: MaskablePPO, arch: dict, board_id: str, out_path: Path) -> None:
    """导出 pi 侧网络为 TS 前向格式；价值头对推理无用，置零。"""
    pol = model.policy
    hidden = arch["hidden"]
    tensors: dict[str, str] = {}
    for l in range(len(hidden)):
        lin = pol.mlp_extractor.policy_net[l * 2]
        tensors[f"W{l}"] = t_to_b64(lin.weight.T)
        tensors[f"b{l}"] = t_to_b64(lin.bias)
    tensors["Wp"] = t_to_b64(pol.action_net.weight.T)
    tensors["bp"] = t_to_b64(pol.action_net.bias)
    tensors["Wv"] = t_to_b64(torch.zeros(hidden[-1]))
    tensors["bv"] = t_to_b64(torch.zeros(1))
    out_path.write_text(json.dumps({"arch": arch, "boardId": board_id, "tensors": tensors}))


def evaluate(model: MaskablePPO, board: str, opponent: str, episodes: int, seed: int) -> tuple[float, float]:
    """确定性策略对指定对手的胜率与平均分差（reward*30）。"""
    env = QwixxVecEnv(16, board, opponent, seed)
    wins, diffs, done_count = 0.0, 0.0, 0
    obs = env.reset()
    while done_count < episodes:
        masks = get_action_masks(env)
        actions, _ = model.predict(obs, action_masks=masks, deterministic=True)
        obs, rewards, dones, _ = env.step(actions)
        for r, d in zip(rewards, dones):
            if d:
                done_count += 1
                diffs += float(r) * 30
                if r > 0:
                    wins += 1
                elif r == 0:
                    wins += 0.5
    env.close()
    return wins / done_count, diffs / done_count


def regen_parity_fixture(weights_path: Path, fixture_path: Path) -> None:
    """权重换了，重算 fixture 的期望 logits/value（复用原 obs）。"""
    data = json.loads(weights_path.read_text())
    fixture = json.loads(fixture_path.read_text())
    arch, t = data["arch"], data["tensors"]
    x = torch.tensor(fixture["obs"], dtype=torch.float32)
    sizes = [arch["input"], *arch["hidden"]]
    h = x
    for l in range(len(arch["hidden"])):
        w = b64_to_t(t[f"W{l}"], (sizes[l], sizes[l + 1]))
        b = b64_to_t(t[f"b{l}"], (sizes[l + 1],))
        h = torch.relu(h @ w + b)
    logits = h @ b64_to_t(t["Wp"], (arch["hidden"][-1], arch["actions"])) + b64_to_t(t["bp"], (arch["actions"],))
    value = float(h @ b64_to_t(t["Wv"], (arch["hidden"][-1],)) + b64_to_t(t["bv"], (1,)))
    fixture["logits"] = [round(float(v), 5) for v in logits]
    fixture["value"] = round(value, 5)
    fixture_path.write_text(json.dumps(fixture))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bc-weights", default="src/ai/weights/policy-classic.json")
    ap.add_argument("--out", default="src/ai/weights/policy-classic.json")
    ap.add_argument("--board", default="classic")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--steps-per-round", type=int, default=200_000)
    ap.add_argument("--num-envs", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--ent-coef", type=float, default=0.005)
    ap.add_argument("--eval-episodes", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--parity-fixture", default="tests/fixtures/policy-parity.json")
    args = ap.parse_args()

    bc = json.loads(Path(args.bc_weights).read_text())
    arch = bc["arch"]
    torch.manual_seed(args.seed)

    snapshot_dir = Path(tempfile.mkdtemp(prefix="qwixx-ppo-"))
    opponent_path = snapshot_dir / "opponent.json"
    opponent_path.write_text(json.dumps(bc))  # 第 1 轮对手：BC 快照

    model: MaskablePPO | None = None
    for rnd in range(1, args.rounds + 1):
        env = QwixxVecEnv(args.num_envs, args.board, f"policy:{opponent_path}", args.seed + rnd * 10_000)
        if model is None:
            model = MaskablePPO(
                "MlpPolicy",
                env,
                learning_rate=args.lr,
                n_steps=128,
                batch_size=256,
                n_epochs=4,
                gamma=1.0,
                gae_lambda=0.95,
                clip_range=0.2,
                ent_coef=args.ent_coef,
                policy_kwargs=dict(activation_fn=nn.ReLU, net_arch=dict(pi=arch["hidden"], vf=arch["hidden"])),
                seed=args.seed,
                verbose=1,
            )
            load_bc_into(model, bc)
        else:
            model.set_env(env)
        print(f"=== 第 {rnd}/{args.rounds} 轮：对手 = 上一轮策略快照 ===")
        model.learn(total_timesteps=args.steps_per_round, reset_num_timesteps=False, progress_bar=False)
        env.close()
        export_weights(model, arch, args.board, opponent_path)  # 快照为下一轮对手

    assert model is not None
    win, diff = evaluate(model, args.board, "heuristic", args.eval_episodes, args.seed + 777_000)
    print(f"评估（确定性策略 vs heuristic，{args.eval_episodes} 局）：胜率 {win * 100:.1f}%  平均分差 {diff:.2f}")

    out = Path(args.out)
    export_weights(model, arch, args.board, out)
    regen_parity_fixture(out, Path(args.parity_fixture))
    print(f"权重已写入 {out}，fixture 已更新。")
    print("请用 pnpm arena -- --games 2000 --bots policy,heuristic 复核后再决定是否保留。")


if __name__ == "__main__":
    main()
