# AR Chess Coach

Real chessboard + phone camera. The app watches the game, tracks every move (yours and your friend's),
asks Stockfish for the best move, and shows it on the board in AR: a growing arrow, a pulsing target square
and a ghost piece that glides from the start square to the destination.

## How it works

1. **Calibrate once**: tap the 4 board corners (a1, h1, h8, a8). A homography maps board squares to camera pixels.
2. **Colours are learned automatically** once the pieces are in the starting position. The app learns what "empty light square",
   "empty dark square", "white piece" and "black piece" look like under your lighting.
3. **Track moves**: every ~250 ms each square is classified as empty / white / black (no piece-type recognition
   needed). The app finds the single *legal* move that explains the change (castling, en passant and captures
   all have distinct patterns) and commits it after 3 stable scans.
4. **Hint** (best move + up to 3 candidate moves, shown as a gold arrow plus blue/grey arrows, ranked with their evals): the FEN goes to Stockfish and the best move is drawn in AR. Default is **Auto**: on-device Stockfish 17 (offline, no rate limit), falling back to chess-api.com if the native engine fails. Switch it in Settings.
5. **Fallback**: if the camera misreads, tap the piece and then its destination square on the live view.

## Setup (Windows, Android)

```bash
npx create-expo-app@latest ar-chess --template blank-typescript
cd ar-chess

npx expo install react-native-vision-camera react-native-vision-camera-worklets \
  react-native-vision-camera-resizer react-native-nitro-modules react-native-nitro-image \
  react-native-worklets react-native-reanimated @shopify/react-native-skia \
  @react-native-async-storage/async-storage

npm i chess.js zustand dawikk-stock
```

Copy `App.tsx`, `app.json`, `eas.json` and `src/` from this folder over the template.
(`app.json` already has the camera permission and Android package id.)

## Install on your phone

Vision Camera and the native Stockfish do not run in Expo Go, so the app must be built once.

**Option A: APK from the cloud (easiest on Windows, no Android Studio)**

```bash
npm i -g eas-cli
eas login                      # free Expo account
eas build -p android --profile preview
```

When the build finishes (about 10-20 min, queue time varies on the free plan) EAS prints a link.
Open that link on your phone, download the `.apk`, allow "Install unknown apps", install.

**Option B: build locally with USB debugging** (needs Android Studio + JDK)

```bash
npx expo prebuild --clean
npx expo run:android
```

## First run (about 1 minute)

1. Open the app. The camera starts by itself (allow the permission).
2. Put the phone on a stand over the board, whole board visible, good light.
3. Tap the 4 board corners in order: a1, h1, h8, a8 (White's left-bottom, then clockwise).
4. Put all pieces in the starting position. The app learns the colours automatically and jumps into the game.
5. From now on, opening the app goes **straight to the live camera + AR view**.
   On your turn the arrow, target square and ghost piece show the best move.
   Use "Nee: White/Black" in the game screen to say which side you play.

## Tuning (`src/config.ts`)

| Problem | Try |
|---|---|
| Dots on wrong squares | Re-tap corners; keep phone steady; confirm tap order a1, h1, h8, a8 |
| Misclassifies one colour of piece | Re-learn colours under the current light; avoid glare/shadows |
| Moves commit too slowly | lower `STABLE_SCANS` or `SCAN_INTERVAL_MS` |
| Wrong/ghost moves committed | raise `STABLE_SCANS`; lower `MAX_MISMATCH` |
| Small squares are noisy | raise `BUF_W/BUF_H` (keep 3:4) |

## Tests

`scripts/enginetest.ts` runs the real `LocalEngine` against a real Stockfish process (eval sign for Black,
mate detection, abort, serialised requests): `npm i -D stockfish && npx tsx scripts/enginetest.ts`.

`scripts/selftest.ts` renders a synthetic perspective board and runs the real scanner, classifier and
legal-move inference (castling, en passant, noise, hand occlusion, 5,900 random legal moves):

```bash
npm i -D tsx && npx tsx scripts/selftest.ts
```

## Known limits

* On-device engine uses `dawikk-stock` (Stockfish 17, GPL-3.0). If you ever distribute the app, the GPL applies.
  A hint takes ~1.5 s (`movetime` in `src/engine/localEngine.ts`).
* Cloud fallback (chess-api.com) needs internet and is rate limited.
* Under-promotion (to R/B/N) cannot be seen from occupancy; set the assumed piece in Settings.
* If two moves happen while the camera is blocked, use Undo or tap-move to resync.
