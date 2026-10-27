import type { AltMove, Engine, Hint } from './cloudEngine';

/** Minimal line-based UCI transport so the engine logic can be tested without React Native. */
export interface UciTransport {
  start(): Promise<void>;
  send(cmd: string): Promise<void> | void;
  /** Every raw UCI line coming from the engine (including `bestmove ...`). */
  onLine(cb: (line: string) => void): () => void;
}

/**
 * On-device Stockfish through any UCI transport. Searches are serialised (the native engine
 * is a singleton), aborts send `stop` and wait for the engine's `bestmove` so a stale result
 * can never leak into the next search. Scores are converted to White's point of view.
 */
export class LocalEngine implements Engine {
  depth: number;
  /** How many best moves to report (1 = only the best). */
  multipv = 1;
  private appliedMultiPv = 1;
  private starting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(line: string) => void>();
  private cache = new Map<string, Hint>();

  constructor(private t: UciTransport, depth = 14, public movetime = 1500) {
    this.depth = depth;
  }

  private on(cb: (line: string) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private waitFor(prefix: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const off = this.on((l) => {
        if (l.startsWith(prefix)) {
          off();
          clearTimeout(to);
          resolve(true);
        }
      });
      const to = setTimeout(() => {
        off();
        resolve(false);
      }, ms);
    });
  }

  private start(): Promise<void> {
    if (!this.starting) {
      this.starting = (async () => {
        await this.t.start();
        this.t.onLine((l) => this.listeners.forEach((f) => f(l)));
        // Handshake is best-effort: some bridges throttle raw lines, so don't fail hard here.
        const uciok = this.waitFor('uciok', 3000);
        await this.t.send('uci');
        await uciok;
        const ready = this.waitFor('readyok', 3000);
        await this.t.send('isready');
        await ready;
      })().catch((e) => {
        this.starting = null;
        throw e;
      });
    }
    return this.starting;
  }

  analyze(fen: string, signal?: AbortSignal): Promise<Hint> {
    const key = `${this.depth}|${this.multipv}|${fen}`;
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const run = this.queue.then(() => this.search(fen, key, signal));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async search(fen: string, key: string, signal?: AbortSignal): Promise<Hint> {
    if (signal?.aborted) throw new Error('aborted');
    await this.start();

    const sign = fen.split(' ')[1] === 'b' ? -1 : 1; // UCI scores are from the side to move
    type Line = { depth: number; uci: string; cp: number | null; mate: number | null };
    const lines = new Map<number, Line>();
    const offInfo = this.on((line) => {
      if (!line.startsWith('info') || line.includes('lowerbound') || line.includes('upperbound')) return;
      const d = /\bdepth (\d+)/.exec(line);
      const s = /\bscore (cp|mate) (-?\d+)/.exec(line);
      const pv = /\bpv (\S+)/.exec(line);
      if (!d || !s || !pv) return;
      const k = +(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1);
      const prev = lines.get(k);
      if (prev && prev.depth > +d[1]) return;
      lines.set(k, {
        depth: +d[1],
        uci: pv[1],
        cp: s[1] === 'cp' ? (+s[2] * sign) / 100 : null,
        mate: s[1] === 'mate' ? +s[2] * sign : null,
      });
    });

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      void this.t.send('stop');
    };
    signal?.addEventListener('abort', onAbort);

    try {
      if (this.appliedMultiPv !== this.multipv) {
        await this.t.send(`setoption name MultiPV value ${this.multipv}`);
        this.appliedMultiPv = this.multipv;
      }
      await this.t.send(`position fen ${fen}`);
      if (aborted || signal?.aborted) throw new Error('aborted');
      const best = new Promise<string>((resolve, reject) => {
        const off = this.on((l) => {
          if (l.startsWith('bestmove')) {
            off();
            clearTimeout(to);
            resolve(l.split(/\s+/)[1] ?? '');
          }
        });
        const to = setTimeout(() => {
          off();
          reject(new Error('Engine search timed out'));
        }, this.movetime + 4000);
      });
      await this.t.send(`go depth ${this.depth} movetime ${this.movetime}`);
      const uci = await best; // wait for bestmove even when aborted (keeps the engine in sync)
      if (aborted) throw new Error('aborted');
      if (!uci || uci === '(none)') throw new Error('No legal move');
      const top = lines.get(1);
      const alts: AltMove[] = [];
      for (let k = 2; k <= this.multipv; k++) {
        const l = lines.get(k);
        if (!l || l.uci === uci) continue;
        alts.push({
          uci: l.uci,
          from: l.uci.slice(0, 2),
          to: l.uci.slice(2, 4),
          promotion: l.uci.length > 4 ? l.uci[4] : undefined,
          evalPawns: l.cp,
          mate: l.mate,
        });
      }
      const hint: Hint = {
        uci,
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
        evalPawns: top ? top.cp : null,
        mate: top ? top.mate : null,
        depth: top ? top.depth : 0,
        alts,
      };
      this.cache.set(key, hint);
      if (this.cache.size > 512) {
        // Evict oldest entry (Map preserves insertion order)
        const first = this.cache.keys().next().value;
        if (first !== undefined) this.cache.delete(first);
      }
      return hint;
    } finally {
      offInfo();
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
