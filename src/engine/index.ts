import { CloudEngine, Engine, FallbackEngine } from './cloudEngine';
import { LocalEngine } from './localEngine';
import { dawikkTransport } from './dawikkTransport';

export type EngineKind = 'auto' | 'local' | 'cloud';

// The native Stockfish is a process-wide singleton, so keep exactly one LocalEngine.
let local: LocalEngine | null = null;

export function createEngine(kind: EngineKind, depth: number, multipv = 1): Engine {
  const cloud = new CloudEngine(depth);
  if (kind === 'cloud') return cloud;
  if (!local) local = new LocalEngine(dawikkTransport, depth);
  local.depth = depth;
  local.multipv = Math.max(1, Math.min(5, multipv));
  return kind === 'local' ? local : new FallbackEngine(local, cloud);
}
