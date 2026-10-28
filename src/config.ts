// Central tuning knobs. Most "it doesn't detect properly" issues are fixed here.

// Size of the RGB buffer used by the simulation scripts. The live camera derives its buffer
// from the preview aspect (480 px tall) so the homography matches what the user sees.
export const BUF_W = 240;
export const BUF_H = 320;
export const CAM_ASPECT = BUF_W / BUF_H;

// Per-square sampling: N x N points inside the square, ignoring `INSET` of each edge.
export const SAMPLE_N = 5;
export const SAMPLE_INSET = 0.2;

// Vision loop
export const SCAN_INTERVAL_MS = 250; // ~4 scans / second
export const STABLE_SCANS = 3; // same detected move N scans in a row => commit
export const MAX_MISMATCH = 2; // squares allowed to disagree with a legal move
export const OUT_OF_SYNC_SCANS = 16; // ~4 s of "no legal move matches" => warn

// Engine
export const CHESS_API_URL = 'https://chess-api.com/v1';
export const MAX_DEPTH = 18;
