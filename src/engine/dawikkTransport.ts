import { NativeModules } from 'react-native';
import type { UciTransport } from './localEngine';

/**
 * Check if the native Stockfish bridge is actually linked and present in the runtime.
 * This prevents fatal crashes on start in Expo Go or unlinked builds.
 */
export function isLocalStockfishAvailable(): boolean {
  try {
    return !!NativeModules?.RNStockfishModule;
  } catch {
    return false;
  }
}

let stockfishInstance: any = null;
function getStockfish() {
  if (stockfishInstance) return stockfishInstance;
  if (!isLocalStockfishAvailable()) {
    throw new Error('Stockfish native module (RNStockfishModule) is not available');
  }
  // Lazy require so module is never evaluated if native module is absent
  const mod = require('dawikk-stock');
  stockfishInstance = mod.default ?? mod;
  return stockfishInstance;
}

/**
 * Adapter for the `dawikk-stock` native module (Stockfish 17 on Android/iOS).
 * Raw lines come from the message listener; `bestmove` comes only from the dedicated
 * listener (never throttled), so it is filtered out of the raw stream to avoid duplicates.
 */
export const dawikkTransport: UciTransport = {
  async start() {
    const Stockfish = getStockfish();
    Stockfish.setConfig({
      throttling: { analysisInterval: 200, messageInterval: 100 },
      events: { emitMessage: true, emitAnalysis: false, emitBestMove: true },
    });
    await Stockfish.init();
  },
  send: (cmd) => getStockfish().sendCommand(cmd),
  onLine(cb) {
    const Stockfish = getStockfish();
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

