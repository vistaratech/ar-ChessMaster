import { CHESS_API_URL, MAX_DEPTH } from '../config';

export type AltMove = {
  uci: string;
  from: string;
  to: string;
  promotion?: string;
  san?: string;
  evalPawns: number | null;
  mate: number | null;
};

export type Hint = {
  uci: string;
  from: string;
  to: string;
  promotion?: string;
  san?: string;
  evalPawns: number | null; // white's point of view, like an eval bar
  mate: number | null;
  depth: number;
  /** 2nd, 3rd... best moves (only the on-device engine provides these). */
  alts?: AltMove[];
};

export interface Engine {
  analyze(fen: string, signal?: AbortSignal): Promise<Hint>;
}

/** Tries `primary`; if it fails (not aborted), asks `secondary`. */
export class FallbackEngine implements Engine {
  constructor(private primary: Engine, private secondary: Engine) {}
  async analyze(fen: string, signal?: AbortSignal): Promise<Hint> {
    try {
      return await this.primary.analyze(fen, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      return this.secondary.analyze(fen, signal);
    }
  }
}

export function parseEngineResponse(j: any): Hint {
  const uci: string | undefined =
    typeof j?.move === 'string'
      ? j.move
      : typeof j?.bestmove === 'string'
      ? j.bestmove.replace(/^bestmove\s+/, '').split(' ')[0]
      : undefined;
  if (!uci || uci.length < 4) throw new Error(j?.text || j?.message || 'Engine returned no move');
  return {
    uci,
    from: typeof j.from === 'string' ? j.from : uci.slice(0, 2),
    to: typeof j.to === 'string' ? j.to : uci.slice(2, 4),
    promotion: typeof j.promotion === 'string' ? j.promotion : uci.length > 4 ? uci[4] : undefined,
    san: typeof j.san === 'string' ? j.san : undefined,
    evalPawns: typeof j.eval === 'number' ? j.eval : null,
    mate: typeof j.mate === 'number' ? j.mate : null,
    depth: typeof j.depth === 'number' ? j.depth : 0,
  };
}

/**
 * Stockfish over HTTP (chess-api.com). Swap this class for an on-device engine later;
 * the rest of the app only needs `analyze(fen) -> Hint`.
 */
export class CloudEngine implements Engine {
  private cache = new Map<string, Hint>();
  constructor(private depth = 14, private url = CHESS_API_URL) {}

  async analyze(fen: string, signal?: AbortSignal): Promise<Hint> {
    const depth = Math.min(this.depth, MAX_DEPTH);
    const key = `${depth}|${fen}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, depth }),
      signal,
    });
    if (!res.ok) throw new Error(`Engine HTTP ${res.status}`);
    const hint = parseEngineResponse(await res.json());
    this.cache.set(key, hint);
    if (this.cache.size > 512) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    return hint;
  }
}
