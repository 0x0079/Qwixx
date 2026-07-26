import { describe, it, expect } from 'vitest';
import { MLP, maskedSoftmax, maskedArgmax, type SerializedMLP } from '../src/ai/mlp';

const b64 = (values: number[]) => Buffer.from(new Float32Array(values).buffer).toString('base64');

describe('MLP 前向推理', () => {
  it('小网络前向输出与手算一致', () => {
    // 2 → 2(relu) → 3 actions；W 为 [in, out] 行主序
    const data: SerializedMLP = {
      arch: { input: 2, hidden: [2], actions: 3 },
      boardId: 'classic',
      tensors: {
        W0: b64([1, 0, 0, -1]), // h0 = relu(x0*1 + x1*0), h1 = relu(x0*0 + x1*-1)
        b0: b64([0, 0.5]),
        Wp: b64([1, 2, 3, 4, 5, 6]), // logit_j = h0*Wp[0*3+j] + h1*Wp[1*3+j] + bp[j]
        bp: b64([0.1, 0.2, 0.3]),
        Wv: b64([1, 1]),
        bv: b64([-0.5]),
      },
    };
    const mlp = MLP.deserialize(data);
    // x = [2, -1] → h = [relu(2), relu(1+0.5)] = [2, 1.5]
    const { logits, value } = mlp.forward(new Float32Array([2, -1]));
    expect(Array.from(logits).map((v) => +v.toFixed(4))).toEqual([
      +(2 * 1 + 1.5 * 4 + 0.1).toFixed(4),
      +(2 * 2 + 1.5 * 5 + 0.2).toFixed(4),
      +(2 * 3 + 1.5 * 6 + 0.3).toFixed(4),
    ]);
    expect(value).toBeCloseTo(2 + 1.5 - 0.5, 5);
  });

  it('张量缺失或尺寸不符时报错', () => {
    const bad: SerializedMLP = {
      arch: { input: 2, hidden: [2], actions: 3 },
      tensors: { W0: b64([1, 2, 3]) }, // 尺寸错且其余缺失
    };
    expect(() => MLP.deserialize(bad)).toThrow();
  });

  it('maskedSoftmax / maskedArgmax 只在合法位上生效', () => {
    const logits = new Float32Array([10, 1, 2, 5]);
    const mask = new Uint8Array([0, 1, 1, 1]);
    const probs = maskedSoftmax(logits, mask);
    expect(probs[0]).toBe(0);
    expect(probs[1]! + probs[2]! + probs[3]!).toBeCloseTo(1, 6);
    expect(maskedArgmax(logits, mask)).toBe(3); // 10 被掩掉
  });
});
