import Stockfish from 'dawikk-stock';
import type { UciTransport } from './localEngine';

/**
 * Adapter for the `dawikk-stock` native module (Stockfish 17 on Android/iOS).
 * Raw lines come from the message listener; `bestmove` comes only from the dedicated
 * listener (never throttled), so it is filtered out of the raw stream to avoid duplicates.
 */
export const dawikkTransport: UciTransport = {
  async start() {
    Stockfish.setConfig({
      throttling: { analysisInterval: 200, messageInterval: 100 },
      events: { emitMessage: true, emitAnalysis: false, emitBestMove: true },
    });
    await Stockfish.init();
  },
  send: (cmd) => Stockfish.sendCommand(cmd),
  onLine(cb) {
    const offRaw = Stockfish.addMessageListener((m: string) => {
      for (const l of String(m).split(/\r?\n/)) {
        const line = l.trim();
        if (line && !line.startsWith('bestmove')) cb(line);
      }
    });
    const offBest = Stockfish.addBestMoveListener((d: { move: string }) => cb(`bestmove ${d.move}`));
    return () => {
      offRaw();
      offBest();
    };
  },
};
