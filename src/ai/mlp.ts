/**
 * 零依赖 MLP 前向推理：加载 Python 侧（training/）训练导出的权重 JSON，
 * 在 Node 与浏览器中做微秒级策略推理。训练一律在 Python（torch）完成，
 * 此处只有前向传播——保持 UI 无运行时依赖。
 *
 * 权重格式（SerializedMLP）：
 *   arch: { input, hidden[], actions }
 *   tensors: 名称 → Float32 字节的 base64。
 *   命名/布局约定（与 training/bc_train.py 的导出一致）：
 *     W{l}: [in, out] 行主序展平（W[i*out+j]），b{l}: [out]
 *     Wp/bp: 策略头；Wv/bv: 价值头（标量）。
 */

export interface MLPArch {
  input: number;
  hidden: number[];
  actions: number;
}

export interface SerializedMLP {
  arch: MLPArch;
  /** 训练时的棋盘 id，加载方用于校验适用性。 */
  boardId?: string;
  tensors: Record<string, string>;
}

function base64ToF32(s: string): Float32Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(s, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class MLP {
  readonly arch: MLPArch;
  private readonly tensors: Record<string, Float32Array>;

  constructor(arch: MLPArch, tensors: Record<string, Float32Array>) {
    this.arch = arch;
    this.tensors = tensors;
    const sizes = [arch.input, ...arch.hidden];
    const hLast = arch.hidden[arch.hidden.length - 1]!;
    const expect: Record<string, number> = { Wp: hLast * arch.actions, bp: arch.actions, Wv: hLast, bv: 1 };
    for (let l = 0; l < arch.hidden.length; l++) {
      expect[`W${l}`] = sizes[l]! * sizes[l + 1]!;
      expect[`b${l}`] = sizes[l + 1]!;
    }
    for (const [name, len] of Object.entries(expect)) {
      if (tensors[name]?.length !== len) throw new Error(`权重张量 ${name} 缺失或尺寸不符`);
    }
  }

  static deserialize(data: SerializedMLP): MLP {
    const tensors: Record<string, Float32Array> = {};
    for (const [name, b64] of Object.entries(data.tensors)) tensors[name] = base64ToF32(b64);
    return new MLP(data.arch, tensors);
  }

  forward(x: Float32Array): { logits: Float32Array; value: number } {
    const { hidden, actions } = this.arch;
    let cur = x;
    for (let l = 0; l < hidden.length; l++) {
      const W = this.tensors[`W${l}`]!;
      const b = this.tensors[`b${l}`]!;
      const out = new Float32Array(hidden[l]!);
      const nIn = cur.length;
      for (let j = 0; j < out.length; j++) {
        let acc = b[j]!;
        for (let i = 0; i < nIn; i++) acc += cur[i]! * W[i * out.length + j]!;
        out[j] = acc > 0 ? acc : 0; // relu
      }
      cur = out;
    }
    const Wp = this.tensors['Wp']!;
    const bp = this.tensors['bp']!;
    const logits = new Float32Array(actions);
    for (let j = 0; j < actions; j++) {
      let acc = bp[j]!;
      for (let i = 0; i < cur.length; i++) acc += cur[i]! * Wp[i * actions + j]!;
      logits[j] = acc;
    }
    const Wv = this.tensors['Wv']!;
    let value = this.tensors['bv']![0]!;
    for (let i = 0; i < cur.length; i++) value += cur[i]! * Wv[i]!;
    return { logits, value };
  }
}

/** 掩码 softmax：非法位（mask=0）概率为 0，仅在合法位上归一化。 */
export function maskedSoftmax(logits: Float32Array, mask: Uint8Array): Float32Array {
  const probs = new Float32Array(logits.length);
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (mask[i] && logits[i]! > max) max = logits[i]!;
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    if (mask[i]) {
      probs[i] = Math.exp(logits[i]! - max);
      sum += probs[i]!;
    }
  }
  for (let i = 0; i < logits.length; i++) probs[i]! /= sum;
  return probs;
}

/** 掩码 argmax：返回合法位中 logits 最大的下标。 */
export function maskedArgmax(logits: Float32Array, mask: Uint8Array): number {
  let best = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (mask[i] && logits[i]! > bestVal) {
      bestVal = logits[i]!;
      best = i;
    }
  }
  return best;
}
