// Run: npm i -D tsx stockfish && npx tsx scripts/enginetest.ts
// Drives the REAL LocalEngine against a real Stockfish process (Stockfish.js, UCI over stdio).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';
import { LocalEngine, UciTransport } from '../src/engine/localEngine';

declare const process: { exit(code?: number): never; execPath: string };

const enginePath = require.resolve('stockfish/bin/stockfish-19-lite-single.js');
const child = spawn(process.execPath, [enginePath], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: child.stdout! });

const transport: UciTransport = {
  async start() {},
  send: (c) => void child.stdin!.write(c + '\n'),
  onLine(cb) {
    rl.on('line', cb);
    return () => rl.off('line', cb);
  },
};

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${extra}`);
};
const legal = (fen: string, uci: string) =>
  new Chess(fen).moves({ verbose: true }).some((m) => m.from === uci.slice(0, 2) && m.to === uci.slice(2, 4));

(async () => {
  const eng = new LocalEngine(transport, 12, 600);

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const h1 = await eng.analyze(START);
  check('start position: legal move', legal(START, h1.uci), `(${h1.uci}, depth ${h1.depth}, eval ${h1.evalPawns})`);
  check('start position: eval near 0', h1.evalPawns !== null && Math.abs(h1.evalPawns) < 1.5);

  const BLACK_UP_QUEEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR b KQkq - 0 1';
  const h2 = await eng.analyze(BLACK_UP_QUEEN);
  check('black to move & winning => eval negative (white POV)', h2.evalPawns !== null && h2.evalPawns < -4, `(${h2.evalPawns})`);

  const MATE1 = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  const h3 = await eng.analyze(MATE1);
  check('mate in 1 found', h3.uci === 'a1a8' && h3.mate === 1, `(${h3.uci}, mate ${h3.mate})`);

  // abort mid-search, then make sure the next search is not polluted by the stale bestmove
  const ac = new AbortController();
  const fastDepth = eng.depth, fastTime = eng.movetime;
  eng.depth = 40; eng.movetime = 5000; // slow search so the abort really lands mid-search
  const t0 = Date.now();
  const FEN_A = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const FEN_B = 'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 2';
  const pA = eng.analyze(FEN_A, ac.signal).then(() => 'resolved', (e) => String(e.message));
  setTimeout(() => ac.abort(), 150);
  const outcome = await pA;
  const took = Date.now() - t0;
  eng.depth = fastDepth; eng.movetime = fastTime;
  check('aborted search rejects', outcome === 'aborted', `(${outcome}, ${took} ms)`);
  check('abort stops the search early (not the full 5 s)', took < 2000);
  const hB = await eng.analyze(FEN_B);
  check('search after abort is for the right position', legal(FEN_B, hB.uci), `(${hB.uci})`);

  // concurrent requests are serialised
  const F1 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const F2 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
  const [r1, r2] = await Promise.all([eng.analyze(F1), eng.analyze(F2)]);
  check('concurrent analyses both correct', legal(F1, r1.uci) && legal(F2, r2.uci), `(${r1.uci}, ${r2.uci})`);

  // MultiPV: top-3 moves, distinct, legal, and best-first in White's point of view
  {
    eng.multipv = 3;
    const MP = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const m = await eng.analyze(MP);
    const all = [m, ...(m.alts ?? [])];
    const uniq = new Set(all.map((x) => x.uci)).size === all.length;
    check('multipv returns 3 distinct legal moves', all.length === 3 && uniq && all.every((x) => legal(MP, x.uci)), `(${all.map((x) => x.uci).join(', ')})`);
    check('best move has the highest eval for the mover', all.every((x) => x.evalPawns !== null) && all[0].evalPawns! >= all[2].evalPawns! - 0.01, `(${all.map((x) => x.evalPawns).join(', ')})`);

    const MB = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4';
    const b = await eng.analyze(MB);
    const ball = [b, ...(b.alts ?? [])];
    check('black to move: best has the LOWEST white-POV eval', ball.length === 3 && ball[0].evalPawns! <= ball[2].evalPawns! + 0.01, `(${ball.map((x) => x.evalPawns).join(', ')})`);

    eng.multipv = 1;
    const one = await eng.analyze(START.replace('w KQkq - 0 1', 'w KQkq - 0 1 '));
    check('multipv=1 gives no alternatives', (one.alts ?? []).length === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
