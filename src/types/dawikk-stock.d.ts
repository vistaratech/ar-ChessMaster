declare module 'dawikk-stock' {
  const Stockfish: {
    init(): Promise<boolean>;
    setConfig(cfg: unknown): void;
    sendCommand(cmd: string): Promise<void>;
    addMessageListener(cb: (msg: string) => void): () => void;
    addBestMoveListener(cb: (d: { move: string; ponder?: string }) => void): () => void;
    stopAnalysis(): Promise<void>;
    shutdown(): Promise<void>;
  };
  export default Stockfish;
}
