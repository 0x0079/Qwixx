# 策略权重

`policy-classic.json` 是 `PolicyBot`（UI/竞技场里的「神经网络 AI」）实际加载的
现役权重。`policy-classic-v{1,2,3}.json` 是历史版本快照，仅作存档，不被代码
导入（故不进构建产物）。任意版本也可从 git 历史取回。

| 文件 | 架构 | 训练要点 | 对 heuristic（2 人局） |
|---|---|---|---|
| `-v1` | 128×128 | 1200 局 rollout 教师 BC，无价值头 | 65.9% |
| `-v2` | 256×256 | + DAgger、+ 联合价值头 | 67~68% |
| `-v3`（现役） | 256×256 | + 3/4/5 人局数据，修多人局覆盖缺陷 | 68.0% |

v3 在各人数下的战绩与生成配方见 [`docs/training.md`](../../../docs/training.md)。
训练数据不入库，用 `bash training/regen-data.sh` 确定性重生成。
