// Run: npx tsx scripts/detecttest.ts [scenes]
// Renders random synthetic scenes (rotation 0-360, perspective, wood-grain table, board frame,
// lighting gradient, noise, start-position pieces that lean in the image) and checks that
// detectBoard finds the 4 corners with the right a1/h1/h8/a8 labels.
import { computeHomography, applyHomography, BOARD_CORNERS } from '../src/lib/homography';
import { detectBoard } from '../src/vision/detector';
import { BUF_W as W, BUF_H as H } from '../src/config';

declare const process: { argv: string[]; exit(code?: number): never };

let seed = 20260428;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rr = (a: number, b: number) => a + rnd() * (b - a);

const PALETTES: [number[], number[]][] = [
  [[140, 100, 62], [224, 198, 152]], // wood
  [[118, 150, 86], [238, 238, 210]], // green / cream
  [[70, 70, 78], [215, 215, 220]], // black / white plastic
  [[160, 110, 80], [235, 210, 175]], // light wood
];

function scene() {
  const half = rr(62, 98);
  const tilt = rr(0, 0.32);
  const rot = rr(0, Math.PI * 2);
  const cx = W / 2 + rr(-12, 12), cy = H / 2 + rr(-14, 14);
  const local = [[-1, 1], [1, 1], [1, -1], [-1, -1]]; // a1, h1, h8, a8
  const gt: { x: number; y: number }[] = local.map(([lx, ly]) => {
    const x = lx * (1 + tilt * ly) * half, y = ly * half * (1 - tilt * 0.35);
    return { x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) };
  });
  const [dark, light] = PALETTES[Math.floor(rnd() * PALETTES.length)];
  const whiteL = rr(220, 248), blackL = rr(20, 60);
  const grainA = rr(0, Math.PI), grainF = rr(0.05, 0.25), grainAmp = rr(4, 16);
  const tableBase = [rr(90, 170), rr(70, 130), rr(40, 100)];
  const lightDir = rr(0, Math.PI * 2), lightAmt = rr(0, 0.28);
  const noise = rr(2, 8);
  return { gt, dark, light, whiteL, blackL, grainA, grainF, grainAmp, tableBase, lightDir, lightAmt, noise };
}

function render(sc: ReturnType<typeof scene>) {
  const buf = new Uint8Array(W * H * 3);
  const Hf = computeHomography(BOARD_CORNERS, sc.gt);
  const Hi = computeHomography(sc.gt, BOARD_CORNERS);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const b = applyHomography(Hi, { x, y });
      const grain = Math.sin((x * Math.cos(sc.grainA) + y * Math.sin(sc.grainA)) * sc.grainF) * sc.grainAmp;
      let col = [sc.tableBase[0] + grain, sc.tableBase[1] + grain * 0.8, sc.tableBase[2] + grain * 0.6];
      const inBoard = b.x >= 0 && b.x < 8 && b.y >= 0 && b.y < 8;
      const inFrame = b.x >= -0.45 && b.x < 8.45 && b.y >= -0.45 && b.y < 8.45;
      if (inBoard) col = (Math.floor(b.x) + Math.floor(b.y)) % 2 === 0 ? sc.dark.slice() : sc.light.slice();
      else if (inFrame) col = [sc.dark[0] * 0.65, sc.dark[1] * 0.6, sc.dark[2] * 0.55];
      const shade = 1 + sc.lightAmt * ((x - W / 2) * Math.cos(sc.lightDir) + (y - H / 2) * Math.sin(sc.lightDir)) / 160;
      const i = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) buf[i + k] = Math.max(0, Math.min(255, col[k] * shade + (rnd() - 0.5) * 2 * sc.noise));
    }
  }
  // pieces: leaning blobs in image space, drawn far rows first
  const pieces: { f: number; r: number; white: boolean }[] = [];
  for (let f = 0; f < 8; f++) for (const r of [0, 1, 6, 7]) pieces.push({ f, r, white: r < 2 });
  pieces.sort((a, b) => b.r - a.r); // far (high rank) first only matters visually
  for (const p of pieces) {
    const c = applyHomography(Hf, { x: p.f + 0.5, y: p.r + 0.5 });
    const e = applyHomography(Hf, { x: p.f + 1.5, y: p.r + 0.5 });
    const s = Math.hypot(e.x - c.x, e.y - c.y);
    const lum = p.white ? sc.whiteL : sc.blackL;
    const ax = 0.3 * s, ay = 0.5 * s, oy = -0.28 * s; // taller than wide, leaning up in the image
    for (let y = Math.floor(c.y + oy - ay - 2); y <= Math.ceil(c.y + oy + ay + 2); y++) {
      for (let x = Math.floor(c.x - ax - 2); x <= Math.ceil(c.x + ax + 2); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = ((x - c.x) / ax) ** 2 + ((y - (c.y + oy)) / ay) ** 2;
        if (d > 1) continue;
        const edge = d > 0.78 ? 0.75 : 1;
        const stripe = Math.sin(y * 0.9) * 6;
        const i = (y * W + x) * 3;
        for (let k = 0; k < 3; k++) buf[i + k] = Math.max(0, Math.min(255, (lum + stripe) * edge + (rnd() - 0.5) * 2 * sc.noise));
      }
    }
  }
  return buf;
}

const N = Number(process.argv[2] ?? 40);
let ok = 0, wrongLabel = 0, none = 0, tms = 0;
const fails: string[] = [];
for (let n = 0; n < N; n++) {
  const sc = scene();
  const buf = render(sc);
  const t0 = Date.now();
  const d = detectBoard(buf, W, H);
  tms += Date.now() - t0;
  const side = Math.hypot(sc.gt[1].x - sc.gt[0].x, sc.gt[1].y - sc.gt[0].y) / 8;
  if (!d) { none++; fails.push(`#${n} no detection`); continue; }
  const errs = sc.gt.map((g, k) => Math.hypot(d.corners[k * 2] - g.x, d.corners[k * 2 + 1] - g.y));
  const maxErr = Math.max(...errs);
  if (maxErr < 0.4 * side) ok++;
  else {
    // right quad but wrong labels?
    const shifted = [1, 2, 3].some((s) => sc.gt.every((g, k) => {
      const j = (k + s) % 4;
      return Math.hypot(d.corners[j * 2] - g.x, d.corners[j * 2 + 1] - g.y) < 0.4 * side;
    }));
    if (shifted) wrongLabel++;
    fails.push(`#${n} maxErr ${maxErr.toFixed(1)}px (sq ${side.toFixed(1)}px) ${shifted ? 'WRONG LABELS' : 'wrong quad'} score ${d.score.toFixed(2)}`);
  }
}
console.log(`correct ${ok}/${N}, wrong labels ${wrongLabel}, nothing found ${none}, avg ${(tms / N).toFixed(0)} ms per detection`);
fails.slice(0, 12).forEach((f) => console.log('  ' + f));
process.exit(ok >= N * 0.85 ? 0 : 1);
