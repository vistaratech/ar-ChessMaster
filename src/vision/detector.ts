// Automatic chessboard finder. Pure TypeScript, no OpenCV. Every function is a worklet so it
// can run on the camera thread.
//
// Idea: a chessboard is a checkerboard. For a candidate quadrilateral (the 8x8 playing area) we
// look at the 49 inner grid vertices. Around each vertex the four neighbouring squares must
// alternate dark / light / light / dark. Patches are sampled near the vertices, away from the
// square centres where the pieces stand, so pieces barely disturb the score.
//
// Search: (1) gradient orientation gives the board's in-plane rotation, (2) the extent of
// aligned edges gives a first rough quad, (3) random restarts + coordinate descent on the 8
// corner coordinates maximise the checker score (coarse patches first, then fine patches).
// Afterwards the corner labelling (a1,h1,h8,a8) is fixed using the checker parity and the
// brightness of the white pieces (a1 side = the lighter side in the starting position).

import { extractFeatures, learnModel, modelQuality } from './scanner';

export type Detection = {
  /** x,y of a1, h1, h8, a8 in buffer pixels. */
  corners: number[];
  /** Start-position fit: how well the 4 classes (empty light/dark, white, black) separate. */
  score: number;
  /** Homography board(0..8) -> buffer pixels, same format as computeHomography. */
  h: number[];
};

export function quadToBoardHomography(q: number[]): number[] {
  'worklet';
  // Heckbert: unit square -> quad (p0..p3 = images of (0,0),(1,0),(1,1),(0,1)); board = 8 * unit.
  const x0 = q[0], y0 = q[1], x1 = q[2], y1 = q[3], x2 = q[4], y2 = q[5], x3 = q[6], y3 = q[7];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g: number, hh: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; d = y1 - y0; e = y3 - y0; g = 0; hh = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3;
  }
  return [a / 8, b / 8, x0, d / 8, e / 8, y0, g / 8, hh / 8];
}

export function detectBoard(rgb: Uint8Array, w: number, h: number): Detection | null {
  'worklet';
  const n = w * h;

  // ---- luminance + 3x3 box blur ------------------------------------------------
  const L0 = new Float32Array(n);
  for (let i = 0; i < n; i++) L0[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  const L = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      L[i] = (L0[i - w - 1] + L0[i - w] + L0[i - w + 1] + L0[i - 1] + L0[i] + L0[i + 1] + L0[i + w - 1] + L0[i + w] + L0[i + w + 1]) / 9;
    }
  }

  // ---- integral image ----------------------------------------------------------
  const W1 = w + 1;
  const II = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += L[y * w + x];
      II[(y + 1) * W1 + x + 1] = II[y * W1 + x + 1] + row;
    }
  }
  const boxMean = (cx: number, cy: number, r: number): number => {
    let x0 = Math.round(cx - r), x1 = Math.round(cx + r), y0 = Math.round(cy - r), y1 = Math.round(cy + r);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > w - 1) x1 = w - 1; if (y1 > h - 1) y1 = h - 1;
    if (x1 < x0 || y1 < y0) return 0;
    const s = II[(y1 + 1) * W1 + x1 + 1] - II[y0 * W1 + x1 + 1] - II[(y1 + 1) * W1 + x0] + II[y0 * W1 + x0];
    return s / ((x1 - x0 + 1) * (y1 - y0 + 1));
  };

  // ---- quad helpers ------------------------------------------------------------
  const quadValid = (q: number[]): boolean => {
    // convex, sane area, sane side ratios
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const ax = q[(i * 2 + 2) % 8] - q[i * 2], ay = q[(i * 2 + 3) % 8] - q[i * 2 + 1];
      const bx = q[(i * 2 + 4) % 8] - q[(i * 2 + 2) % 8], by = q[(i * 2 + 5) % 8] - q[(i * 2 + 3) % 8];
      const c = ax * by - ay * bx;
      if (c === 0) return false;
      if (sign === 0) sign = c > 0 ? 1 : -1;
      else if ((c > 0 ? 1 : -1) !== sign) return false;
    }
    let area = 0;
    for (let i = 0; i < 4; i++) area += q[i * 2] * q[(i * 2 + 3) % 8] - q[(i * 2 + 2) % 8] * q[i * 2 + 1];
    area = Math.abs(area) / 2;
    if (area < 0.12 * n || area > 0.98 * n) return false;
    const s0 = Math.hypot(q[2] - q[0], q[3] - q[1]), s1 = Math.hypot(q[4] - q[2], q[5] - q[3]);
    const s2 = Math.hypot(q[6] - q[4], q[7] - q[5]), s3 = Math.hypot(q[0] - q[6], q[1] - q[7]);
    const mx = Math.max(s0, s1, s2, s3), mn = Math.min(s0, s1, s2, s3);
    return mn > 0 && mx / mn < 2.4;
  };

  // signed checker score for a quad; delta/radius are fractions of a square
  const checker = (q: number[], delta: number, rad: number): number => {
    const t = quadToBoardHomography(q); // board -> px
    const sq = (Math.hypot(q[2] - q[0], q[3] - q[1]) + Math.hypot(q[4] - q[2], q[5] - q[3]) +
      Math.hypot(q[6] - q[4], q[7] - q[5]) + Math.hypot(q[0] - q[6], q[1] - q[7])) / 32;
    const r = Math.max(1, rad * sq);
    let sum = 0;
    for (let j = 1; j < 8; j++) {
      for (let i = 1; i < 8; i++) {
        const m = (bx: number, by: number) => {
          const wv = t[6] * bx + t[7] * by + 1;
          return boxMean((t[0] * bx + t[1] * by + t[2]) / wv, (t[3] * bx + t[4] * by + t[5]) / wv, r);
        };
        const ll = m(i - delta, j - delta), lr = m(i + delta, j - delta);
        const ul = m(i - delta, j + delta), ur = m(i + delta, j + delta);
        const tn = (ll + ur - lr - ul) / (ll + ur + lr + ul + 8);
        sum += (i + j) % 2 === 0 ? -tn : tn;
      }
    }
    return sum / 49;
  };

  const objective = (q: number[], delta: number, rad: number): number => Math.abs(checker(q, delta, rad));

  // coordinate descent on the 8 corner coordinates
  const optimise = (q0: number[], delta: number, rad: number, steps: number[]): { q: number[]; s: number } => {
    let q = q0.slice();
    let best = quadValid(q) ? objective(q, delta, rad) : -1;
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];
      for (let sweep = 0; sweep < 6; sweep++) {
        let improved = false;
        for (let k = 0; k < 8; k++) {
          for (let dir = -1; dir <= 1; dir += 2) {
            const c = q.slice();
            c[k] += dir * step;
            if (!quadValid(c)) continue;
            const s = objective(c, delta, rad);
            if (s > best + 1e-6) { best = s; q = c; improved = true; }
          }
        }
        if (!improved) break;
      }
    }
    return { q, s: best };
  };

  // ---- 1. in-plane rotation from gradient orientations (mod 90 deg) -------------------
  let zx = 0, zy = 0;
  const gmag = new Float32Array(n);
  const gang = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - 1] + L[i + w - 1]);
      const gy = (L[i + w - 1] + 2 * L[i + w] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - w] + L[i - w + 1]);
      const m = Math.sqrt(gx * gx + gy * gy);
      const a = Math.atan2(gy, gx);
      gmag[i] = m;
      gang[i] = a;
      const wgt = m > 400 ? 400 : m; // cap so single hard edges do not dominate
      zx += wgt * Math.cos(4 * a);
      zy += wgt * Math.sin(4 * a);
    }
  }
  if (zx * zx + zy * zy < 1) return null;
  const th0 = Math.atan2(zy, zx) / 4;
  const ct = Math.cos(th0), st = Math.sin(th0);

  // ---- 2. candidate grid vertices ("saddles"): the 2x2 patches around a vertex alternate ---
  // Done for a few assumed cell sizes (px). Vertices whose lattice neighbours (one cell away
  // along the board axes) have the OPPOSITE polarity form the board's 7x7 inner lattice.
  const ux = ct, uy = st, vx = -st, vy = ct;
  const inits: number[][] = [];
  const cellSizes = [14, 18, 23, 29, 36];
  for (let ci = 0; ci < cellSizes.length; ci++) {
    const c = cellSizes[ci];
    const d = 0.16 * c, rad = Math.max(1, 0.11 * c);
    const step = 2;
    const pts: { x: number; y: number; r: number }[] = [];
    const margin = Math.ceil(c * 0.4);
    const vals: number[] = [];
    for (let y = margin; y < h - margin; y += step) {
      for (let x = margin; x < w - margin; x += step) {
        const m = (a: number, b: number) => boxMean(x + a * ux + b * vx, y + a * uy + b * vy, rad);
        const ll = m(-d, -d), lr = m(d, -d), ul = m(-d, d), ur = m(d, d);
        const r = (ll + ur - lr - ul) / (ll + ur + lr + ul + 8);
        if (Math.abs(r) > 0.03) { pts.push({ x, y, r }); vals.push(Math.abs(r)); }
      }
    }
    if (pts.length < 20) continue;
    vals.sort((p1, p2) => p1 - p2);
    const ref = vals[Math.floor(vals.length * 0.97)];
    const thr = Math.max(0.04, 0.4 * ref);
    const strong = pts.filter((p) => Math.abs(p.r) >= thr).sort((p1, p2) => Math.abs(p2.r) - Math.abs(p1.r));
    const kept: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < strong.length && kept.length < 500; i++) {
      let ok = true;
      for (let k = 0; k < kept.length; k++) {
        if (Math.hypot(kept[k].x - strong[i].x, kept[k].y - strong[i].y) < 0.6 * c) { ok = false; break; }
      }
      if (ok) kept.push(strong[i]);
    }
    const nK = kept.length;
    if (nK < 12) continue;
    // lattice links (opposite polarity, one cell away along +-u / +-v)
    const adj: number[][] = [];
    for (let i = 0; i < nK; i++) adj.push([]);
    const dirs = [[ux, uy], [vx, vy]];
    for (let i = 0; i < nK; i++) {
      for (let di = 0; di < 2; di++) {
        const tx = kept[i].x + dirs[di][0] * c, ty = kept[i].y + dirs[di][1] * c;
        let bj = -1, bd = 0.4 * c;
        for (let j = 0; j < nK; j++) {
          if (j === i || kept[j].r * kept[i].r >= 0) continue;
          const dd = Math.hypot(kept[j].x - tx, kept[j].y - ty);
          if (dd < bd) { bd = dd; bj = j; }
        }
        if (bj >= 0) { adj[i].push(bj); adj[bj].push(i); }
      }
    }
    // largest connected component of vertices that have >= 2 links
    const seen = new Array(nK).fill(false);
    let bestComp: number[] = [];
    for (let i = 0; i < nK; i++) {
      if (seen[i] || adj[i].length < 2) continue;
      const comp: number[] = [i];
      seen[i] = true;
      for (let qi = 0; qi < comp.length; qi++) {
        for (const j of adj[comp[qi]]) {
          if (!seen[j] && adj[j].length >= 2) { seen[j] = true; comp.push(j); }
        }
      }
      if (comp.length > bestComp.length) bestComp = comp;
    }
    if (bestComp.length < 10) continue;
    let pmin = 1e9, pmax = -1e9, qmin = 1e9, qmax = -1e9;
    for (const i of bestComp) {
      const pp = kept[i].x * ct + kept[i].y * st, qq = -kept[i].x * st + kept[i].y * ct;
      if (pp < pmin) pmin = pp; if (pp > pmax) pmax = pp;
      if (qq < qmin) qmin = qq; if (qq > qmax) qmax = qq;
    }
    const pc = (pmin + pmax) / 2, qc = (qmin + qmax) / 2, hw = 4 * c;
    const q: number[] = [];
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const pp = pc + cs[k][0] * hw, qq = qc + cs[k][1] * hw;
      q.push(pp * ct - qq * st, pp * st + qq * ct);
    }
    if (quadValid(q)) inits.push(q);
  }

  // ---- 3. refine every candidate (plus a few jittered copies), keep the best ----------
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cands: { q: number[]; s: number }[] = [];
  for (let k = 0; k < inits.length; k++) {
    cands.push({ q: inits[k], s: objective(inits[k], 0.2, 0.22) });
    for (let rep = 0; rep < 5; rep++) {
      const jq = inits[k].map((v) => v + (rnd() - 0.5) * 16);
      if (quadValid(jq)) cands.push({ q: jq, s: objective(jq, 0.2, 0.22) });
    }
  }
  cands.sort((a, b) => b.s - a.s);
  const results: { q: number[]; s: number }[] = [];
  const top = Math.min(8, cands.length);
  for (let c = 0; c < top; c++) {
    let r = optimise(cands[c].q, 0.2, 0.22, [8, 4, 2]);
    r = optimise(r.q, 0.17, 0.13, [2, 1, 0.5]);
    let dup = false;
    for (let k = 0; k < results.length; k++) {
      let dsum = 0;
      for (let i = 0; i < 8; i++) dsum += Math.abs(results[k].q[i] - r.q[i]);
      if (dsum < 24) { dup = true; if (r.s > results[k].s) results[k] = r; break; }
    }
    if (!dup) results.push(r);
  }
  if (results.length === 0) return null;
  results.sort((a, b) => b.s - a.s);

  // ---- 4. resolve shift / rotation with the START POSITION --------------------------------
  // A checkerboard looks the same when shifted by whole squares or turned by 90 degrees, but
  // the starting position does not: with the right alignment the 16 squares of ranks 1-2 are
  // one piece colour, ranks 7-8 the other, and ranks 3-6 are empty. So for every candidate
  // (best quads, shifted by -1/0/+1 squares, all 4 rotations) learn the 4 classes from the
  // known start layout and keep the candidate whose classes are the best separated.
  const startOcc = new Uint8Array(64);
  for (let i = 0; i < 16; i++) startOcc[i] = 1;
  for (let i = 48; i < 64; i++) startOcc[i] = 2;
  const rot = (qq: number[], k: number) => {
    const out: number[] = [];
    for (let i = 0; i < 4; i++) { out.push(qq[((i + k) % 4) * 2], qq[((i + k) % 4) * 2 + 1]); }
    return out;
  };
  // fit of one quad over the 4 rotations (best rotation + 180-degree fix by piece brightness)
  const evalQuad = (q: number[]): { fit: number; cand: number[] } | null => {
    let bf = -1;
    let bc: number[] | null = null;
    for (let rk = 0; rk < 4; rk++) {
      const qr = rot(q, rk);
      const model = learnModel(extractFeatures(rgb, w, h, quadToBoardHomography(qr), 5, 0.2), startOcc);
      if (!model) continue;
      const fit = modelQuality(model);
      const lw = 0.299 * model.mean[2][0] + 0.587 * model.mean[2][1] + 0.114 * model.mean[2][2];
      const lb = 0.299 * model.mean[3][0] + 0.587 * model.mean[3][1] + 0.114 * model.mean[3][2];
      if (fit > bf) { bf = fit; bc = lw < lb ? rot(qr, 2) : qr; } // white pieces are the lighter ones
    }
    return bc ? { fit: bf, cand: bc } : null;
  };
  const fromExtents = (t0: number[], e: number[]): number[] => {
    const pts = [[e[0], e[2]], [e[1], e[2]], [e[1], e[3]], [e[0], e[3]]];
    const q: number[] = [];
    for (let k = 0; k < 4; k++) {
      const wv = t0[6] * pts[k][0] + t0[7] * pts[k][1] + 1;
      q.push((t0[0] * pts[k][0] + t0[1] * pts[k][1] + t0[2]) / wv, (t0[3] * pts[k][0] + t0[4] * pts[k][1] + t0[5]) / wv);
    }
    return q;
  };

  let bestFit = -1;
  let bestQ: number[] | null = null;
  const nBase = Math.min(3, results.length);
  const shifts = [-1, 0, 1];
  for (let bi = 0; bi < nBase; bi++) {
    let base = results[bi].q.slice();
    const cr = (base[2] - base[0]) * (base[5] - base[3]) - (base[3] - base[1]) * (base[4] - base[2]);
    if (cr > 0) base = [base[0], base[1], base[6], base[7], base[4], base[5], base[2], base[3]]; // visual CCW = a1,h1,h8,a8
    const t0 = quadToBoardHomography(base);
    for (let yi = 0; yi < shifts.length; yi++) {
      for (let xi = 0; xi < shifts.length; xi++) {
        if (bi > 0 && (shifts[xi] !== 0 || shifts[yi] !== 0)) continue; // shifts only for the best quad
        const q = fromExtents(t0, [shifts[xi], 8 + shifts[xi], shifts[yi], 8 + shifts[yi]]);
        if (!quadValid(q)) continue;
        const r = evalQuad(q);
        if (r && r.fit > bestFit) { bestFit = r.fit; bestQ = r.cand; }
      }
    }
  }
  if (!bestQ || bestFit < 1.2) return null;
  const q = bestQ;
  return { corners: q, score: bestFit, h: quadToBoardHomography(q) };
}
