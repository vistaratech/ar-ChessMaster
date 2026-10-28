import type { Occ } from '../chess/occupancy';

// Per-square features: mean R, G, B and luminance std-dev ("texture", pieces have edges).
export const NF = 4;
const VAR_FLOOR = [225, 225, 225, 64];

/**
 * Runs inside the camera worklet. Samples an N x N grid inside every square, projecting
 * board coordinates through the homography `h` (board -> buffer pixels).
 * `buf` is interleaved RGB uint8, bw x bh.
 */
export function extractFeatures(
  buf: Uint8Array,
  bw: number,
  bh: number,
  h: number[],
  n: number,
  inset: number
): number[] {
  'worklet';
  const out: number[] = new Array(64 * NF);
  const span = 1 - 2 * inset;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const bx = file + inset + (span * (i + 0.5)) / n;
          const by = rank + inset + (span * (j + 0.5)) / n;
          const w = h[6] * bx + h[7] * by + 1;
          let px = Math.round((h[0] * bx + h[1] * by + h[2]) / w);
          let py = Math.round((h[3] * bx + h[4] * by + h[5]) / w);
          if (px < 0) px = 0; else if (px > bw - 1) px = bw - 1;
          if (py < 0) py = 0; else if (py > bh - 1) py = bh - 1;
          const o = (py * bw + px) * 3;
          const r = buf[o], g = buf[o + 1], b = buf[o + 2];
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          sr += r; sg += g; sb += b; sl += l; sl2 += l * l;
        }
      }
      const cnt = n * n;
      const ml = sl / cnt;
      const sd = Math.sqrt(Math.max(0, sl2 / cnt - ml * ml));
      const k = (rank * 8 + file) * NF;
      out[k] = sr / cnt;
      out[k + 1] = sg / cnt;
      out[k + 2] = sb / cnt;
      out[k + 3] = sd;
    }
  }
  return out;
}

// ---- JS-thread part: colour model + classifier -------------------------------------

/** Classes: 0 = empty light square, 1 = empty dark square, 2 = white piece, 3 = black piece. */
export type ColorModel = { mean: number[][]; vari: number[][] };

/** Built-in general color model for wooden/vinyl boards so scanning works out of the box without manual training. */
export const DEFAULT_COLOR_MODEL: ColorModel = {
  mean: [
    [210, 200, 180, 6],   // 0: empty light square
    [110, 85, 65, 6],     // 1: empty dark square
    [230, 225, 215, 24],  // 2: white piece
    [45, 45, 45, 24],     // 3: black piece
  ],
  vari: [
    [400, 400, 400, 80],
    [400, 400, 400, 80],
    [600, 600, 600, 180],
    [600, 600, 600, 180],
  ],
};

export const isDark = (file: number, rank: number) => {
  'worklet';
  return (file + rank) % 2 === 0; // a1 is dark
};

/**
 * Learn the 4 classes from a frame where the position is KNOWN (e.g. the starting position).
 * Returns null if some class has fewer than 2 samples.
 */
export function learnModel(feats: number[], occ: Occ): ColorModel | null {
  'worklet';
  const n = [0, 0, 0, 0];
  const s = [0, 1, 2, 3].map(() => new Array(NF).fill(0));
  const q = [0, 1, 2, 3].map(() => new Array(NF).fill(0));
  for (let sq = 0; sq < 64; sq++) {
    const f = sq % 8, r = Math.floor(sq / 8);
    const cls = occ[sq] === 0 ? (isDark(f, r) ? 1 : 0) : occ[sq] === 1 ? 2 : 3;
    n[cls]++;
    for (let k = 0; k < NF; k++) {
      const v = feats[sq * NF + k];
      s[cls][k] += v;
      q[cls][k] += v * v;
    }
  }
  if (n.some((c) => c < 2)) return null;
  const mean = s.map((row, c) => row.map((v) => v / n[c]));
  const vari = q.map((row, c) =>
    row.map((v, k) => Math.max(VAR_FLOOR[k], v / n[c] - mean[c][k] * mean[c][k]))
  );
  return { mean, vari };
}

/** Diagonal-Gaussian classifier. A square can only be: its own empty colour, white, or black. */
export function classify(feats: number[], model: ColorModel): Occ {
  const occ = new Uint8Array(64);
  for (let sq = 0; sq < 64; sq++) {
    const f = sq % 8, r = Math.floor(sq / 8);
    const empty = isDark(f, r) ? 1 : 0;
    let bestCls = empty;
    let bestScore = Infinity;
    for (const cls of [empty, 2, 3]) {
      let score = 0;
      for (let k = 0; k < NF; k++) {
        const d = feats[sq * NF + k] - model.mean[cls][k];
        score += (d * d) / model.vari[cls][k] + Math.log(model.vari[cls][k]);
      }
      if (score < bestScore) {
        bestScore = score;
        bestCls = cls;
      }
    }
    occ[sq] = bestCls < 2 ? 0 : bestCls === 2 ? 1 : 2;
  }
  return occ;
}

/**
 * How well separated the learned classes are (min pairwise distance, in "sigmas").
 * An empty board labelled as "starting position" produces classes that all look alike => low value.
 */
export function modelQuality(m: ColorModel): number {
  'worklet';
  const pairs = [[0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  let min = Infinity;
  for (const [a, b] of pairs) {
    let s = 0;
    for (let k = 0; k < NF; k++) {
      const d = m.mean[a][k] - m.mean[b][k];
      s += (d * d) / ((m.vari[a][k] + m.vari[b][k]) / 2);
    }
    min = Math.min(min, Math.sqrt(s));
  }
  return min;
}
