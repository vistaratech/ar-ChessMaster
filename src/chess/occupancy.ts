import { Chess, Move } from 'chess.js';
import { MAX_MISMATCH } from '../config';

/** 64 entries, index = rank*8 + file (a1 = 0, h8 = 63). 0 empty, 1 white piece, 2 black piece. */
export type Occ = Uint8Array;

export function occupancyOf(chess: Chess): Occ {
  const occ = new Uint8Array(64);
  const board = chess.board(); // rows go rank 8 -> rank 1
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (cell) occ[(7 - r) * 8 + f] = cell.color === 'w' ? 1 : 2;
    }
  }
  return occ;
}

export function mismatch(a: Occ, b: Occ): number {
  let n = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++;
  return n;
}

export type Inference =
  | { kind: 'none'; mismatch: number } // board looks exactly like the current position
  | { kind: 'move'; move: Move; mismatch: number } // exactly one legal move explains the board
  | { kind: 'unknown'; mismatch: number }; // hand in view / noisy / out of sync

/**
 * The core trick: we never try to recognise piece TYPES from the image.
 * We only read "empty / white / black" per square and ask which LEGAL move
 * explains the change. Castling, en passant and captures all give distinct
 * occupancy patterns. Promotions look identical for Q/R/B/N, so queen is assumed here
 * (the caller applies the user's chosen promotion piece).
 */
export function inferMove(chess: Chess, observed: Occ, maxMismatch = MAX_MISMATCH): Inference {
  const m0 = mismatch(occupancyOf(chess), observed);
  let best: Move | null = null;
  let bestMM = 99;
  let secondMM = 99;
  for (const mv of chess.moves({ verbose: true })) {
    if (mv.promotion && mv.promotion !== 'q') continue; // same occupancy as the queen version
    chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    const mm = mismatch(occupancyOf(chess), observed);
    chess.undo();
    if (mm < bestMM) {
      secondMM = bestMM;
      bestMM = mm;
      best = mv;
    } else if (mm < secondMM) {
      secondMM = mm;
    }
  }
  if (best && bestMM <= maxMismatch && bestMM < m0 && bestMM < secondMM) {
    return { kind: 'move', move: best, mismatch: bestMM };
  }
  if (m0 <= maxMismatch && m0 <= bestMM) return { kind: 'none', mismatch: m0 };
  return { kind: 'unknown', mismatch: Math.min(m0, bestMM) };
}

export function replay(moves: string[]): Chess {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c;
}
