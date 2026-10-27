declare const process: { exit(code?: number): never };
// Run: npx tsx scripts/selftest.ts   (needs `npm i chess.js`)
// Renders a synthetic perspective chessboard, runs the REAL scanner + classifier +
// legal-move inference on it, and checks that every move is recognised.
import { Chess } from 'chess.js';
import { computeHomography, applyHomography, BOARD_CORNERS, squareCenter } from '../src/lib/homography';
import { extractFeatures, learnModel, classify, modelQuality } from '../src/vision/scanner';
import { occupancyOf, inferMove, mismatch, Occ } from '../src/chess/occupancy';
import { BUF_W, BUF_H, SAMPLE_N, SAMPLE_INSET } from '../src/config';

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = (a: number) => (rnd() - 0.5) * 2 * a;

const screen = [{ x: 30, y: 300 }, { x: 215, y: 292 }, { x: 196, y: 52 }, { x: 52, y: 60 }];
const Hfwd = computeHomography(BOARD_CORNERS, screen);
const Hinv = computeHomography(screen, BOARD_CORNERS);

function render(occ: Occ, noiseAmp = 10): Uint8Array {
  const buf = new Uint8Array(BUF_W * BUF_H * 3);
  for (let y = 0; y < BUF_H; y++) {
    for (let x = 0; x < BUF_W; x++) {
      const b = applyHomography(Hinv, { x, y });
      let r = 70, g = 80, bl = 90;
      if (b.x >= 0 && b.x < 8 && b.y >= 0 && b.y < 8) {
        const f = Math.floor(b.x), rk = Math.floor(b.y);
        const dark = (f + rk) % 2 === 0;
        [r, g, bl] = dark ? [140, 100, 60] : [222, 196, 150];
        const o = occ[rk * 8 + f];
        const dx = b.x - f - 0.5, dy = b.y - rk - 0.5;
        if (o && Math.hypot(dx, dy) < 0.34) {
          const stripe = Math.sin((dx + dy) * 40) * 12;
          [r, g, bl] = o === 1 ? [236 + stripe, 232 + stripe, 224 + stripe] : [32 + stripe, 32 + stripe, 38 + stripe];
        }
      }
      const i = (y * BUF_W + x) * 3;
      const n = noise(noiseAmp);
      buf[i] = r + n; buf[i + 1] = g + n; buf[i + 2] = bl + n;
    }
  }
  return buf;
}

const feats = (occ: Occ, amp?: number) =>
  extractFeatures(render(occ, amp), BUF_W, BUF_H, Hfwd, SAMPLE_N, SAMPLE_INSET);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};

// 1) homography round trip
const c = applyHomography(Hfwd, squareCenter('e4'));
const back = applyHomography(Hinv, c);
check('homography round-trip e4', Math.abs(back.x - 4.5) < 1e-6 && Math.abs(back.y - 3.5) < 1e-6);

// 2) learn colours from the start position, classify it back
const start = new Chess();
const model = learnModel(feats(occupancyOf(start)), occupancyOf(start))!;
check('learnModel returns a model', !!model);
check('start position classified 64/64', mismatch(classify(feats(occupancyOf(start)), model), occupancyOf(start)) === 0);

// 2b) model quality: a real start position is well separated, an empty board is not
{
  const emptyOcc = new Uint8Array(64);
  const bad = learnModel(feats(emptyOcc), occupancyOf(start))!;
  const qGood = modelQuality(model), qBad = modelQuality(bad);
  console.log(`      quality good=${qGood.toFixed(1)} empty-board=${qBad.toFixed(1)}`);
  check('modelQuality separates real start from empty board', qGood > 2.5 && qBad < 1.5);
}

// 3) scripted game: castling, captures, en passant, promotion
const script = ['e4','d5','exd5','Nf6','Bb5+','c6','dxc6','Qd7','cxb7','Qd8','bxa8=Q','e5','f4','Bd6','Nf3','O-O','O-O','exf4','Qe1','a6','e5'.length ? 'Nc3' : '', 'Re8'].filter(Boolean);
const g = new Chess();
let ok = 0, tot = 0;
for (const san of script) {
  const before = new Chess(g.fen());
  let mv;
  try { mv = g.move(san); } catch { break; }
  const obs = classify(feats(occupancyOf(g)), model);
  const inf = inferMove(before, obs);
  tot++;
  const good = inf.kind === 'move' && inf.move.from === mv.from && inf.move.to === mv.to;
  if (good) ok++;
  else console.log('   missed', san, inf.kind, 'mismatch', inf.mismatch);
}
check(`scripted game ${ok}/${tot} moves recognised`, ok === tot);

// 4) en passant + black castling explicit
{
  const e = new Chess('rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  const m1 = e.move('O-O'); const m2 = e.move('O-O');
  const b2 = new Chess('rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4');
  const obs = classify(feats(occupancyOf(e)), model);
  const inf = inferMove(b2, obs);
  check('black short castle detected', inf.kind === 'move' && inf.move.san === 'O-O' && !!m1 && !!m2);
  const ep = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const epAfter = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'); epAfter.move('exd6');
  const inf2 = inferMove(ep, classify(feats(occupancyOf(epAfter)), model));
  check('en passant detected', inf2.kind === 'move' && inf2.move.san === 'exd6');
}

// 5) one wrongly-classified square is tolerated
{
  const g2 = new Chess(); g2.move('e4'); g2.move('e5'); g2.move('Nf3');
  const before = new Chess(g2.fen()); g2.move('Nc6');
  const obs = classify(feats(occupancyOf(g2)), model);
  obs[27] = obs[27] === 0 ? 1 : 0; // corrupt d4
  const inf = inferMove(before, obs);
  check('single noisy square tolerated', inf.kind === 'move' && inf.move.san === 'Nc6');
}

// 6) hand over the board (garbage) is NOT committed
{
  const before = new Chess(); before.move('e4');
  const garbage = new Uint8Array(64); for (let i = 0; i < 64; i++) garbage[i] = Math.floor(rnd() * 3);
  check('garbage occupancy => no move', inferMove(before, garbage).kind !== 'move');
}

// 7) every legal move in many random positions is uniquely recoverable from occupancy
{
  let positions = 0, bad = 0;
  for (let game = 0; game < 4; game++) {
    const rg = new Chess();
    for (let ply = 0; ply < 50 && !rg.isGameOver(); ply++) {
      const legal = rg.moves({ verbose: true });
      for (const mv of legal) {
        if (mv.promotion && mv.promotion !== 'q') continue;
        const probe = new Chess(rg.fen());
        probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
        const inf = inferMove(new Chess(rg.fen()), occupancyOf(probe));
        positions++;
        if (!(inf.kind === 'move' && inf.move.from === mv.from && inf.move.to === mv.to)) bad++;
      }
      rg.move(legal[Math.floor(rnd() * legal.length)].san);
    }
  }
  check(`unique occupancy for ${positions} random legal moves`, bad === 0, `(ambiguous: ${bad})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
