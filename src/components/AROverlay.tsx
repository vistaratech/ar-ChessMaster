import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
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
  occ: Occ | null; // debug: what the camera thinks is on each square
  showGrid: boolean;
  isAdjustingCorners: boolean;
};

export const EMPTY_OVERLAY: OverlayState = {
  hint: null, hintPiece: null, alts: [], lastMove: null, selected: null,
  targets: [], check: null, occ: null, showGrid: true, isAdjustingCorners: false,
};

type Props = OverlayState & {
  width: number;
  height: number;
  H: number[] | null; // board -> box pixels
  cornerPx: Pt[]; // calibration taps so far
};

const GLYPH: Record<string, string> = {
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F\uFE0E',
};

const poly = (pts: Pt[]) => {
  const p = Skia.Path.Make();
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  p.close();
  return p;
};

const ALT_COLORS = ['rgba(96,165,250,0.85)', 'rgba(209,213,219,0.8)', 'rgba(244,114,182,0.8)', 'rgba(167,139,250,0.8)'];

function arrowGeo(H: number[], from: string, to: string) {
  const a = applyHomography(H, squareCenter(from));
  const b = applyHomography(H, squareCenter(to));
  const size = squareSize(H, from);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const headLen = Math.min(size * 0.7, len * 0.4);
  const base = { x: b.x - ux * headLen, y: b.y - uy * headLen };
  const w = headLen * 0.55;
  const shaft = Skia.Path.Make();
  shaft.moveTo(a.x, a.y);
  shaft.lineTo(base.x, base.y);
  const head = poly([
    b,
    { x: base.x - uy * w, y: base.y + ux * w },
    { x: base.x + uy * w, y: base.y - ux * w },
  ]);
  return { a, b, size, shaft, head };
}

export default function AROverlay(props: Props) {
  const { H, hint, hintPiece, alts, lastMove, selected, targets, check, occ, showGrid, isAdjustingCorners, cornerPx } = props;

  // ---- static geometry ------------------------------------------------------------
  const grid = useMemo(() => {
    if (!H || !showGrid) return null;
    const p = Skia.Path.Make();
    for (let i = 0; i <= 8; i++) {
      const a = applyHomography(H, { x: i, y: 0 }), b = applyHomography(H, { x: i, y: 8 });
      const c = applyHomography(H, { x: 0, y: i }), d = applyHomography(H, { x: 8, y: i });
      p.moveTo(a.x, a.y); p.lineTo(b.x, b.y);
      p.moveTo(c.x, c.y); p.lineTo(d.x, d.y);
    }
    return p;
  }, [H, showGrid]);

  const quads = useMemo(() => {
    if (!H) return [];
    const q: { key: string; path: ReturnType<typeof poly>; color: string }[] = [];
    const add = (sq: string | null | undefined, color: string, tag: string) =>
      sq && q.push({ key: tag + sq, path: poly(squareQuad(H, sq)), color });
    add(lastMove?.from, 'rgba(80,140,255,0.30)', 'lf');
    add(lastMove?.to, 'rgba(80,140,255,0.38)', 'lt');
    add(check, 'rgba(255,40,40,0.50)', 'ck');
    add(selected, 'rgba(255,255,255,0.40)', 'sel');
    add(hint?.from, 'rgba(255,196,0,0.50)', 'hf');
    add(hint?.to, 'rgba(46,204,113,0.55)', 'ht');
    return q;
  }, [H, lastMove, check, selected, hint]);

  const dots = useMemo(() => {
    if (!H) return [];
    return targets.map((sq) => {
      const c = applyHomography(H, squareCenter(sq));
      return { key: 'tg' + sq, x: c.x, y: c.y, r: squareSize(H, sq) * 0.14 };
    });
  }, [H, targets]);

  const occDots = useMemo(() => {
    if (!H || !occ) return [];
    const out: { key: string; x: number; y: number; w: boolean }[] = [];
    for (let i = 0; i < 64; i++) {
      if (!occ[i]) continue;
      const sq = String.fromCharCode(97 + (i % 8)) + (Math.floor(i / 8) + 1);
      const c = applyHomography(H, squareCenter(sq));
      out.push({ key: 'o' + i, x: c.x, y: c.y, w: occ[i] === 1 });
    }
    return out;
  }, [H, occ]);

  // ---- AR hint animation ----------------------------------------------------------
  const geo = useMemo(() => {
    if (!H || !hint) return null;
    const g = arrowGeo(H, hint.from, hint.to);
    return { ...g, ring: g.size * 0.42 };
  }, [H, hint]);

  const altArrows = useMemo(
    () =>
      H
        ? alts.map((m, i) => ({
            key: 'alt' + i + m.from + m.to,
            color: ALT_COLORS[i % ALT_COLORS.length],
            ...arrowGeo(H, m.from, m.to),
          }))
        : [],
    [H, alts]
  );

  const t = useSharedValue(0);
  const hintKey = hint ? hint.from + hint.to : '';
  useEffect(() => {
    cancelAnimation(t);
    t.value = 0;
    if (hintKey) {
      t.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1, false);
    }
    return () => cancelAnimation(t);
  }, [hintKey, t]);

  const shaftEnd = useDerivedValue(() => Math.min(1, t.value / 0.4));
  const headOpacity = useDerivedValue(() => Math.max(0, Math.min(1, (t.value - 0.35) / 0.1)));
  const ringR = useDerivedValue(
    () => (geo ? geo.ring : 0) * (1 + 0.16 * Math.sin(t.value * Math.PI * 6))
  );
  const ghostStyle = useAnimatedStyle(() => {
    if (!geo) return { opacity: 0 };
    const raw = Math.max(0, Math.min(1, (t.value - 0.25) / 0.55));
    const p = raw * raw * (3 - 2 * raw); // smoothstep
    const fadeIn = Math.min(1, t.value / 0.25);
    const fadeOut = t.value > 0.9 ? (1 - t.value) / 0.1 : 1;
    const gs = geo.size;
    return {
      opacity: 0.92 * fadeIn * fadeOut,
      transform: [
        { translateX: geo.a.x + (geo.b.x - geo.a.x) * p - gs / 2 },
        { translateY: geo.a.y + (geo.b.y - geo.a.y) * p - gs / 2 },
      ],
    };
  }, [geo]);

  const white = hintPiece?.color === 'w';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {quads.map((q) => (
          <Path key={q.key} path={q.path} color={q.color} />
        ))}
        {grid && (
          <Path path={grid} style="stroke" strokeWidth={1.5} color="rgba(0,255,150,0.75)" />
        )}
        {dots.map((d) => (
          <Circle key={d.key} cx={d.x} cy={d.y} r={d.r} color="rgba(255,255,255,0.85)" />
        ))}
        {altArrows.map((a) => (
          <React.Fragment key={a.key}>
            <Path path={a.shaft} style="stroke" strokeWidth={Math.max(4, a.size * 0.1)} strokeCap="round" color={a.color} />
            <Path path={a.head} color={a.color} />
          </React.Fragment>
        ))}
        {geo && (
          <>
            <Circle cx={geo.b.x} cy={geo.b.y} r={ringR} style="stroke" strokeWidth={4} color="#2ecc71" />
            <Path
              path={geo.shaft}
              style="stroke"
              strokeWidth={Math.max(6, geo.size * 0.16)}
              strokeCap="round"
              color="rgba(255,196,0,0.95)"
              start={0}
              end={shaftEnd}
            />
            <Path path={geo.head} color="rgba(255,196,0,0.95)" opacity={headOpacity} />
          </>
        )}
        {occDots.map((d) => (
          <React.Fragment key={d.key}>
            <Circle cx={d.x} cy={d.y} r={7} color="#000" />
            <Circle cx={d.x} cy={d.y} r={5} color={d.w ? '#fff' : '#555'} />
          </React.Fragment>
        ))}
        {cornerPx.map((p, i) => (
          <React.Fragment key={'c' + i}>
            {isAdjustingCorners ? (
              <>
                <Circle cx={p.x} cy={p.y} r={28} color="rgba(255, 212, 0, 0.25)" />
                <Circle cx={p.x} cy={p.y} r={20} style="stroke" strokeWidth={3} color="#FFD400" />
                <Circle cx={p.x} cy={p.y} r={8} color="#FFFFFF" />
              </>
            ) : (
              <>
                <Circle cx={p.x} cy={p.y} r={6} color="rgba(0,0,0,0.5)" />
                <Circle cx={p.x} cy={p.y} r={4} color="rgba(255, 212, 0, 0.7)" />
              </>
            )}
          </React.Fragment>
        ))}
      </Canvas>

      {geo && hintPiece && (
        <Animated.Text
          style={[
            styles.glyph,
            {
              width: geo.size,
              height: geo.size,
              fontSize: geo.size * 0.9,
              lineHeight: geo.size,
              color: white ? '#fff' : '#111',
              textShadowColor: white ? '#000' : '#fff',
            },
            ghostStyle,
          ]}
        >
          {GLYPH[hintPiece.type] ?? ''}
        </Animated.Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: {
    position: 'absolute',
    left: 0,
    top: 0,
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
});
