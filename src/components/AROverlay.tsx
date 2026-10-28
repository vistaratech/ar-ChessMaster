import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Pt, applyHomography, squareCenter, squareQuad, squareSize } from '../lib/homography';
import type { Occ } from '../chess/occupancy';

export type OverlayState = {
  hint: { from: string; to: string } | null;
  hintPiece: { type: string; color: 'w' | 'b' } | null;
  alts: { from: string; to: string }[];
  lastMove: { from: string; to: string } | null;
  selected: string | null;
  targets: string[];
  check: string | null;
  occ: Occ | null;
  showGrid: boolean;
  isAdjustingCorners: boolean;
};

export const EMPTY_OVERLAY: OverlayState = {
  hint: null,
  hintPiece: null,
  alts: [],
  lastMove: null,
  selected: null,
  targets: [],
  check: null,
  occ: null,
  showGrid: false,
  isAdjustingCorners: false,
};

type Props = OverlayState & {
  width: number;
  height: number;
  H: number[] | null;
  cornerPx: Pt[];
  /** Screen-space insets the move chip must stay clear of (status bar / bottom dock). */
  safeTop?: number;
  safeBottom?: number;
};

/** Reference palette: neon green move markers on a cyan board trace. */
const GREEN = '#5CFF6A';
const GREEN_CORE = 'rgba(124,255,138,0.98)';
const GREEN_GLOW = 'rgba(70,255,92,0.34)';
const GREEN_FILL = 'rgba(74,255,72,0.84)';
const ORIGIN_FILL = 'rgba(74,255,72,0.19)';
const CYAN = 'rgba(43,247,229,0.96)';
const CYAN_MID = 'rgba(43,247,229,0.24)';
const CYAN_SOFT = 'rgba(43,247,229,0.10)';

/** Approximate rendered height of the move chip; keeps the connector flush with its base. */
const CHIP_H = 42;

const PIECE_NAME: Record<string, string> = {
  p: 'PAWN',
  n: 'KNIGHT',
  b: 'BISHOP',
  r: 'ROOK',
  q: 'QUEEN',
  k: 'KING',
};

const WHITE_GLYPH: Record<string, string> = {
  k: '\u2654',
  q: '\u2655',
  r: '\u2656',
  b: '\u2657',
  n: '\u2658',
  p: '\u2659',
};

const BLACK_GLYPH: Record<string, string> = {
  k: '\u265A',
  q: '\u265B',
  r: '\u265C',
  b: '\u265D',
  n: '\u265E',
  p: '\u265F\uFE0E',
};

type CastlePlan = { side: 'KINGSIDE' | 'QUEENSIDE'; rookFrom: string; rookTo: string };

const CASTLES: Record<string, CastlePlan> = {
  e1g1: { side: 'KINGSIDE', rookFrom: 'h1', rookTo: 'f1' },
  e1c1: { side: 'QUEENSIDE', rookFrom: 'a1', rookTo: 'd1' },
  e8g8: { side: 'KINGSIDE', rookFrom: 'h8', rookTo: 'f8' },
  e8c8: { side: 'QUEENSIDE', rookFrom: 'a8', rookTo: 'd8' },
};

function getSkia() {
  try {
    const api = (globalThis as any).SkiaApi ?? Skia;
    return api && typeof api?.Path?.Make === 'function' ? api : null;
  } catch {
    return null;
  }
}

function poly(pts: Pt[]) {
  if (!pts || pts.length < 3) return null;
  const sk = getSkia();
  if (!sk) return null;
  try {
    const p = sk.Path.Make();
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
    return p;
  } catch {
    return null;
  }
}

function expandQuad(pts: Pt[], by: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by };
  });
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type QuadMark = {
  key: string;
  sq: string;
  path: any;
  fill?: string;
  stroke?: string;
  width?: number;
  glow?: string;
};

export default function AROverlay(props: Props) {
  const {
    H,
    hint,
    hintPiece,
    alts = [],
    lastMove,
    selected,
    targets = [],
    check,
    occ,
    showGrid = false,
    isAdjustingCorners = false,
    cornerPx = [],
    width,
    height,
    safeTop = 10,
    safeBottom = 10,
  } = props;

  const skia = getSkia();

  const boardCorners = useMemo(() => {
    if (cornerPx.length === 4) return cornerPx;
    if (!H) return [];
    return [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ].map((p) => applyHomography(H, p));
  }, [cornerPx, H]);

  const border = useMemo(() => {
    if (!boardCorners.length || !skia) return null;
    return poly(expandQuad(boardCorners, 1.5));
  }, [boardCorners, skia]);

  const grid = useMemo(() => {
    if (!H || !skia || !(showGrid || isAdjustingCorners)) return null;
    try {
      const p = skia.Path.Make();
      for (let i = 0; i <= 8; i++) {
        const a = applyHomography(H, { x: i, y: 0 });
        const b = applyHomography(H, { x: i, y: 8 });
        const c = applyHomography(H, { x: 0, y: i });
        const d = applyHomography(H, { x: 8, y: i });
        p.moveTo(a.x, a.y);
        p.lineTo(b.x, b.y);
        p.moveTo(c.x, c.y);
        p.lineTo(d.x, d.y);
      }
      return p;
    } catch {
      return null;
    }
  }, [H, skia, showGrid, isAdjustingCorners]);

  const marks = useMemo(() => {
    if (!H || !skia) return [];
    const out: QuadMark[] = [];
    const add = (sq: string | null | undefined, fill: string | undefined, stroke: string | undefined, key: string, width = 2, glow?: string) => {
      if (!sq) return;
      try {
        const path = poly(squareQuad(H, sq));
        if (path) out.push({ key: key + sq, sq, path, fill, stroke, width, glow });
      } catch {
        // Degenerate homography; skip this frame.
      }
    };

    // Quiet context: what just happened / what is checked / what is selected.
    if (lastMove && !hint) {
      add(lastMove.from, 'rgba(160,255,190,0.10)', 'rgba(190,255,210,0.20)', 'lm', 1.5);
      add(lastMove.to, 'rgba(160,255,190,0.14)', 'rgba(190,255,210,0.26)', 'lm', 1.5);
    }
    add(check, 'rgba(255,70,70,0.24)', 'rgba(255,90,90,0.82)', 'ck', 2.5, 'rgba(255,60,60,0.22)');
    add(selected, 'rgba(90,230,255,0.16)', 'rgba(125,240,255,0.82)', 'sel', 2);

    // The reference move marker: soft green origin, solid neon destination.
    if (hint) {
      const castle = CASTLES[hint.from + hint.to];
      add(hint.from, ORIGIN_FILL, GREEN, 'hf', 2.6, GREEN_GLOW);
      add(hint.to, GREEN_FILL, GREEN_CORE, 'ht', 2.2, GREEN_GLOW);
      if (castle) {
        add(castle.rookFrom, ORIGIN_FILL, GREEN, 'rf', 2.6, GREEN_GLOW);
        add(castle.rookTo, GREEN_FILL, GREEN_CORE, 'rt', 2.2, GREEN_GLOW);
      }
    }
    return out;
  }, [H, skia, lastMove, check, selected, hint]);

  const targets2 = useMemo(() => {
    if (!H || !targets.length) return [];
    try {
      return targets.map((sq) => {
        const c = applyHomography(H, squareCenter(sq));
        return { key: 'tg' + sq, x: c.x, y: c.y, r: Math.max(3, squareSize(H, sq) * 0.09) };
      });
    } catch {
      return [];
    }
  }, [H, targets]);

  const altMarks = useMemo(() => {
    if (!H || !skia || !hint || !alts.length) return [];
    const seen = new Set<string>([hint.to]);
    const out: { key: string; x: number; y: number; r: number }[] = [];
    for (const a of alts) {
      if (!a || !a.to || seen.has(a.to)) continue;
      seen.add(a.to);
      try {
        const c = applyHomography(H, squareCenter(a.to));
        out.push({ key: 'alt' + a.to, x: c.x, y: c.y, r: Math.max(4, squareSize(H, a.to) * 0.11) });
      } catch {
        // Degenerate homography; skip this alternative.
      }
    }
    return out;
  }, [H, skia, hint, alts]);

  const occDots = useMemo(() => {
    if (!H || !occ) return [];
    try {
      const out: { key: string; x: number; y: number; w: boolean }[] = [];
      for (let i = 0; i < 64; i++) {
        if (!occ[i]) continue;
        const sq = String.fromCharCode(97 + (i % 8)) + (Math.floor(i / 8) + 1);
        const c = applyHomography(H, squareCenter(sq));
        out.push({ key: 'o' + i, x: c.x, y: c.y, w: occ[i] === 1 });
      }
      return out;
    } catch {
      return [];
    }
  }, [H, occ]);

  const castle = hint ? CASTLES[hint.from + hint.to] : undefined;

  const castlingPieces = useMemo(() => {
    if (!H || !hint || !castle || !hintPiece) return [];
    const color = hintPiece.color;
    const glyphs = color === 'w' ? WHITE_GLYPH : BLACK_GLYPH;
    return [
      { key: 'k', sq: hint.to },
      { key: 'r', sq: castle.rookTo },
    ].map(({ key, sq }) => {
      const c = applyHomography(H, squareCenter(sq));
      const size = squareSize(H, sq);
      return {
        key,
        x: c.x - size / 2,
        y: c.y - size / 2,
        size,
        glyph: glyphs[key === 'k' ? 'k' : 'r'],
        color: color === 'w' ? '#ffffff' : '#101410',
      };
    });
  }, [H, hint, castle, hintPiece]);

  const chip = useMemo(() => {
    if (!H || !hint) return null;
    try {
      const q = squareQuad(H, hint.to);
      const xs = q.map((p) => p.x);
      const ys = q.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const title = castle
        ? `CASTLE ${castle.side}`
        : `${(hintPiece && PIECE_NAME[hintPiece.type]) ?? 'MOVE'} ${hint.from} \u2192 ${hint.to}`;
      const w = clamp(title.length * 7.4 + 30, 132, 220);
      const left = clamp((minX + maxX) / 2 - w / 2, 10, Math.max(10, width - w - 10));
      const floor = Math.max(safeTop, 10);
      const ceiling = Math.max(floor, height - Math.max(safeBottom, 10) - CHIP_H);
      let top = minY - 56;
      let above = true;
      if (top < floor) {
        // No room above the square: try below it, but keep the chip clear of the dock.
        if (maxY + 10 <= ceiling) {
          top = maxY + 10;
          above = false;
        } else {
          top = floor;
        }
      }
      if (top > ceiling) top = ceiling;
      return { title, left, top, w, above, minY, maxY };
    } catch {
      return null;
    }
  }, [H, hint, castle, hintPiece, width, height, safeTop, safeBottom]);

  const fallback = useMemo(() => {
    if (skia || !H) return null;
    const squares: { key: string; x: number; y: number; s: number; fill: string; stroke?: string }[] = [];
    const push = (sq: string | null | undefined, fill: string, stroke: string | undefined, key: string) => {
      if (!sq) return;
      try {
        const c = applyHomography(H, squareCenter(sq));
        squares.push({ key: key + sq, x: c.x, y: c.y, s: squareSize(H, sq), fill, stroke });
      } catch {
        // ignore
      }
    };
    if (lastMove && !hint) {
      push(lastMove.from, 'rgba(160,255,190,0.10)', 'rgba(190,255,210,0.20)', 'lm');
      push(lastMove.to, 'rgba(160,255,190,0.14)', 'rgba(190,255,210,0.26)', 'lm');
    }
    push(check, 'rgba(255,70,70,0.24)', 'rgba(255,90,90,0.82)', 'ck');
    push(selected, 'rgba(90,230,255,0.16)', 'rgba(125,240,255,0.82)', 'sel');
    if (hint) {
      push(hint.from, ORIGIN_FILL, GREEN, 'hf');
      push(hint.to, GREEN_FILL, GREEN_CORE, 'ht');
      if (castle) {
        push(castle.rookFrom, ORIGIN_FILL, GREEN, 'rf');
        push(castle.rookTo, GREEN_FILL, GREEN_CORE, 'rt');
      }
    }
    return { squares, corners: boardCorners };
  }, [skia, H, lastMove, check, selected, hint, castle, boardCorners]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {skia ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {border && (
            <>
              <Path path={border} style="stroke" strokeWidth={22} color="rgba(43,247,229,0.055)" strokeJoin="round" strokeCap="round" />
              <Path path={border} style="stroke" strokeWidth={12} color="rgba(43,247,229,0.11)" strokeJoin="round" strokeCap="round" />
              <Path path={border} style="stroke" strokeWidth={6} color={CYAN_MID} strokeJoin="round" strokeCap="round" />
              <Path path={border} style="stroke" strokeWidth={2.2} color={CYAN} strokeJoin="round" strokeCap="round" />
            </>
          )}

          {grid && <Path path={grid} style="stroke" strokeWidth={1} color={CYAN_SOFT} />}

          {marks.map((m) => (
            <React.Fragment key={m.key}>
              {m.glow && (
                <Path path={m.path} style="stroke" strokeWidth={14} color={m.glow} strokeJoin="round" />
              )}
              {m.fill && <Path path={m.path} color={m.fill} />}
              {m.stroke && (
                <Path path={m.path} style="stroke" strokeWidth={m.width ?? 2} color={m.stroke} strokeJoin="round" />
              )}
            </React.Fragment>
          ))}

          {targets2.map((d) => (
            <React.Fragment key={d.key}>
              <Circle cx={d.x} cy={d.y} r={d.r} color="rgba(5,12,8,0.55)" />
              <Circle cx={d.x} cy={d.y} r={Math.max(2, d.r - 1.5)} color="rgba(140,255,160,0.95)" />
            </React.Fragment>
          ))}

          {altMarks.map((d) => (
            <React.Fragment key={d.key}>
              <Circle cx={d.x} cy={d.y} r={d.r} color="rgba(5,12,8,0.42)" />
              <Circle cx={d.x} cy={d.y} r={d.r} style="stroke" strokeWidth={2} color="rgba(92,255,106,0.72)" />
            </React.Fragment>
          ))}

          {occDots.map((d) => (
            <React.Fragment key={d.key}>
              <Circle cx={d.x} cy={d.y} r={5} color="rgba(0,0,0,0.55)" />
              <Circle cx={d.x} cy={d.y} r={3.2} color={d.w ? '#f4fff6' : '#4b554d'} />
            </React.Fragment>
          ))}

          {isAdjustingCorners &&
            cornerPx.map((p, i) => (
              <React.Fragment key={'c' + i}>
                <Circle cx={p.x} cy={p.y} r={30} color="rgba(43,247,229,0.14)" />
                <Circle cx={p.x} cy={p.y} r={19} style="stroke" strokeWidth={2.5} color={CYAN} />
                <Circle cx={p.x} cy={p.y} r={7} color="#eafffb" />
              </React.Fragment>
            ))}
        </Canvas>
      ) : (
        <View style={StyleSheet.absoluteFill}>
          {fallback?.corners &&
            fallback.corners.map((a, i) => {
              const b = fallback.corners[(i + 1) % fallback.corners.length];
              return <Line key={'bl' + i} a={a} b={b} width={2} color={CYAN} />;
            })}

          {fallback?.squares.map((s) => (
            <View
              key={s.key}
              style={{
                position: 'absolute',
                left: s.x - s.s / 2,
                top: s.y - s.s / 2,
                width: s.s,
                height: s.s,
                backgroundColor: s.fill,
                borderWidth: s.stroke ? 2 : 0,
                borderColor: s.stroke,
                borderRadius: 2,
              }}
            />
          ))}

          {targets2.map((d) => (
            <View
              key={d.key}
              style={{
                position: 'absolute',
                left: d.x - d.r,
                top: d.y - d.r,
                width: d.r * 2,
                height: d.r * 2,
                borderRadius: d.r,
                backgroundColor: 'rgba(140,255,160,0.95)',
              }}
            />
          ))}

          {isAdjustingCorners &&
            cornerPx.map((p, i) => (
              <View
                key={'fc' + i}
                style={{
                  position: 'absolute',
                  left: p.x - 14,
                  top: p.y - 14,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: 'rgba(43,247,229,0.85)',
                  borderWidth: 1,
                  borderColor: '#eafffb',
                }}
              />
            ))}
        </View>
      )}

      {isAdjustingCorners &&
        cornerPx.map((p, i) => (
          <View
            key={'cl' + i}
            style={[
              styles.cornerLabelWrap,
              {
                left: clamp(p.x - 16, 4, Math.max(4, width - 36)),
                top: clamp(p.y + 18, 4, Math.max(4, height - 26)),
              },
            ]}
          >
            <Text style={styles.cornerLabel}>{['a1', 'h1', 'h8', 'a8'][i] ?? ''}</Text>
          </View>
        ))}

      {castlingPieces.map((p) => (
        <Text
          key={'cp' + p.key}
          style={[
            styles.glyph,
            {
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              fontSize: p.size * 0.86,
              lineHeight: p.size,
              color: p.color,
              textShadowColor: p.color === '#ffffff' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)',
            },
          ]}
        >
          {p.glyph}
        </Text>
      ))}

      {chip && (
        <Animated.View
          key={'cc' + chip.title}
          entering={FadeIn.duration(150)}
          pointerEvents="none"
          style={[
            styles.chipConnector,
            {
              left: chip.left + chip.w / 2 - 1,
              top: chip.above ? chip.top + CHIP_H : chip.top - Math.max(4, chip.top - chip.maxY),
              height: chip.above
                ? Math.max(4, chip.minY - chip.top - CHIP_H)
                : Math.max(4, chip.top - chip.maxY),
            },
          ]}
        />
      )}

      {chip && (
        <Animated.View
          key={chip.title}
          entering={FadeIn.duration(150)}
          style={[styles.chip, { left: chip.left, top: chip.top, width: chip.w }]}
        >
          <Text style={styles.chipKicker}>NEXT MOVE</Text>
          <Text style={styles.chipTitle} numberOfLines={1} adjustsFontSizeToFit>
            {chip.title}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

function Line({ a, b, width, color }: { a: Pt; b: Pt; width: number; color: string }) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return (
    <View
      style={{
        position: 'absolute',
        left: (a.x + b.x) / 2 - len / 2,
        top: (a.y + b.y) / 2 - width / 2,
        width: len,
        height: width,
        backgroundColor: color,
        transform: [{ rotateZ: `${angle}rad` }],
      }}
    />
  );
}

const styles = StyleSheet.create({
  glyph: {
    position: 'absolute',
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  chip: {
    position: 'absolute',
    backgroundColor: 'rgba(5,9,7,0.90)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(140,255,155,0.34)',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingTop: 5,
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  chipKicker: {
    color: 'rgba(190,255,200,0.72)',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 2,
  },
  chipTitle: {
    color: '#f7fff8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  chipConnector: {
    position: 'absolute',
    width: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(120,255,140,0.85)',
  },
  cornerLabelWrap: {
    position: 'absolute',
    minWidth: 32,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(4,12,8,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(43,247,229,0.55)',
    alignItems: 'center',
  },
  cornerLabel: {
    color: '#d8fffa',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
