// Pure-TypeScript homography. Board space is (0..8, 0..8): x = file (a..h), y = rank (1..8).

export type Pt = { x: number; y: number };

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Degenerate corners');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** 4 src points -> 4 dst points. Returns h[0..7] (h8 = 1). */
export function computeHomography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  return solve(A, b);
}

export function applyHomography(h: number[], p: Pt): Pt {
  'worklet';
  const w = h[6] * p.x + h[7] * p.y + 1;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Board corners in board space (0..8, 0..8).
 * `BOARD_CORNERS` is the canonical order used by the app: a1(0,0), h1(8,0), h8(8,8), a8(0,8).
 * The `perspective` variant is kept for older callers/tests; the live camera always pairs
 * corners in physical board order (a1, h1, h8, a8), independent of the camera side.
 */
export function getBoardCorners(perspective: 'w' | 'b' = 'w'): Pt[] {
  if (perspective === 'b') {
    return [
      { x: 8, y: 8 },
      { x: 0, y: 8 },
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ];
  }
  return [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 8 },
    { x: 0, y: 8 },
  ];
}

export const BOARD_CORNERS: Pt[] = getBoardCorners('w');

export function squareName(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + (rank + 1);
}

export function squareCenter(sq: string): Pt {
  return { x: sq.charCodeAt(0) - 97 + 0.5, y: parseInt(sq[1], 10) - 1 + 0.5 };
}

export function squareQuad(h: number[], sq: string): Pt[] {
  const f = sq.charCodeAt(0) - 97;
  const r = parseInt(sq[1], 10) - 1;
  return [
    { x: f, y: r },
    { x: f + 1, y: r },
    { x: f + 1, y: r + 1 },
    { x: f, y: r + 1 },
  ].map((p) => applyHomography(h, p));
}

/** Approx. on-screen edge length of a square (used to size the ghost piece). */
export function squareSize(h: number[], sq: string): number {
  const q = squareQuad(h, sq);
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return s / 4;
}

/** Screen point -> square name, using the inverse homography (screen -> board). */
export function screenToSquare(hInv: number[], p: Pt): string | null {
  const b = applyHomography(hInv, p);
  if (b.x < 0 || b.x >= 8 || b.y < 0 || b.y >= 8) return null;
  return squareName(Math.floor(b.x), Math.floor(b.y));
}
