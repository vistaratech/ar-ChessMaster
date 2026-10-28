import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useStore } from '../store/useStore';
import { replay, inferMove, Occ } from '../chess/occupancy';
import { classify } from '../vision/scanner';
import type { Hint } from '../engine/cloudEngine';
import { createEngine } from '../engine';
import { SCAN_INTERVAL_MS, STABLE_SCANS, OUT_OF_SYNC_SCANS } from '../config';

export type Status = 'needs-colors' | 'tracking' | 'detecting' | 'waiting' | 'out-of-sync' | 'over';

export function useGame() {
  const { moves, model, settings, pushMove, undoMove } = useStore();
  const chess = useMemo(() => replay(moves), [moves]);
  const chessRef = useRef(chess);
  chessRef.current = chess;
  const movesRef = useRef(moves);
  movesRef.current = moves;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const engine = useMemo(
    () => createEngine(settings.engine ?? 'auto', settings.depth, settings.suggestions ?? 1),
    [settings.engine, settings.depth, settings.suggestions]
  );

  const [status, setStatus] = useState<Status>(model ? 'tracking' : 'needs-colors');
  const [detected, setDetected] = useState<string | null>(null);
  const [occ, setOcc] = useState<Occ | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [evalPawns, setEvalPawns] = useState<number | null>(null);
  const [mate, setMate] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const pending = useRef({ key: '', n: 0 });
  const unknownRun = useRef(0);
  const lastScan = useRef(0);

  // ---- committing a move (from camera or from a tap) ---------------------------------
  const commit = useCallback(
    (from: string, to: string, isPromotion: boolean) => {
      const c = replay(movesRef.current);
      try {
        const r = c.move({
          from,
          to,
          promotion: isPromotion ? settingsRef.current.promo : undefined,
        });
        pushMove(r.san);
        setSelected(null);
      } catch {
        /* illegal => ignore */
      }
    },
    [pushMove]
  );

  // ---- vision: called ~30x/s from the camera worklet, throttled here -----------------
  const onFeatures = useCallback(
    (feats: number[]) => {
      const now = Date.now();
      if (now - lastScan.current < SCAN_INTERVAL_MS) return;
      lastScan.current = now;
      const c = chessRef.current;
      if (!model) return setStatus('needs-colors');
      if (c.isGameOver()) return setStatus('over');

      const o = classify(feats, model);
      if (settingsRef.current.debug) setOcc(o);
      const inf = inferMove(c, o);

      if (inf.kind === 'move') {
        unknownRun.current = 0;
        const key = inf.move.from + inf.move.to;
        pending.current = pending.current.key === key ? { key, n: pending.current.n + 1 } : { key, n: 1 };
        setStatus('detecting');
        setDetected(inf.move.san);
        if (pending.current.n >= STABLE_SCANS) {
          pending.current = { key: '', n: 0 };
          commit(inf.move.from, inf.move.to, !!inf.move.promotion);
        }
      } else if (inf.kind === 'none') {
        pending.current = { key: '', n: 0 };
        unknownRun.current = 0;
        setDetected(null);
        setStatus('tracking');
      } else {
        pending.current = { key: '', n: 0 };
        unknownRun.current++;
        setDetected(null);
        setStatus(unknownRun.current > OUT_OF_SYNC_SCANS ? 'out-of-sync' : 'waiting');
      }
    },
    [model, commit]
  );

  // ---- manual correction: tap piece, tap destination ---------------------------------
  const tapSquare = useCallback(
    (sq: string) => {
      const c = chessRef.current;
      if (c.isGameOver()) return;
      if (selected) {
        const legal = c.moves({ square: selected as any, verbose: true }).filter((m) => m.to === sq);
        if (legal.length) return commit(selected, sq, !!legal[0].promotion);
      }
      const p = c.get(sq as any);
      setSelected(p && p.color === c.turn() && sq !== selected ? sq : null);
    },
    [selected, commit]
  );

  // ---- engine hint on every new position ---------------------------------------------
  const fen = chess.fen();
  const turn = chess.turn();
  const wantHint =
    settings.hints === 'always' || (settings.hints === 'mine' && turn === settings.myColor);
  useEffect(() => {
    setHint(null);
    setEngineError(null);
    if (!wantHint || chess.isGameOver()) return;
    const ac = new AbortController();
    setThinking(true);
    engine
      .analyze(fen, ac.signal)
      .then((h) => {
        const mv = chessRef.current
          .moves({ verbose: true })
          .find((m) => m.from === h.from && m.to === h.to && (!h.promotion || m.promotion === h.promotion));
        if (!mv) throw new Error('Engine suggested an illegal move (position mismatch)');
        const legalMoves = chessRef.current.moves({ verbose: true });
        const alts = (h.alts ?? []).flatMap((a) => {
          const m = legalMoves.find(
            (x) => x.from === a.from && x.to === a.to && (!a.promotion || x.promotion === a.promotion)
          );
          return m ? [{ ...a, san: m.san }] : [];
        });
        setHint({ ...h, san: mv.san, alts });
        setEvalPawns(h.evalPawns);
        setMate(h.mate);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setEngineError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setThinking(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, wantHint, engine, retry]);

  // ---- derived UI state ---------------------------------------------------------------
  const lastMove = useMemo(() => {
    const h = chess.history({ verbose: true });
    const m = h[h.length - 1];
    return m ? { from: m.from, to: m.to } : null;
  }, [chess]);

  const targets = useMemo(
    () => (selected ? chess.moves({ square: selected as any, verbose: true }).map((m) => m.to) : []),
    [selected, chess]
  );

  const checkSquare = useMemo(() => {
    if (!chess.inCheck()) return null;
    const board = chess.board();
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (cell && cell.type === 'k' && cell.color === chess.turn()) return cell.square;
      }
    return null;
  }, [chess]);

  const hintPiece = hint ? chess.get(hint.from as any) : null;

  const gameOverText = useMemo(() => {
    if (chess.isCheckmate()) return `Checkmate. ${chess.turn() === 'w' ? 'Black' : 'White'} wins`;
    if (chess.isStalemate()) return 'Stalemate';
    if (chess.isDraw()) return 'Draw';
    return null;
  }, [chess]);

  const undo = useCallback(() => {
    undoMove();
    setSelected(null);
    pending.current = { key: '', n: 0 };
  }, [undoMove]);

  const pgn = useCallback(() => {
    const c: Chess = replay(movesRef.current);
    return c.pgn();
  }, []);

  return {
    chess, fen, turn, moves, status, detected, occ,
    hint, alts: hint?.alts ?? [], hintPiece, evalPawns, mate, thinking, engineError,
    selected, targets, lastMove, checkSquare, gameOverText,
    onFeatures, tapSquare, undo, pgn,
    retryEngine: () => setRetry((n) => n + 1),
  };
}
