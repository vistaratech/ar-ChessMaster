import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraPermission, useFrameOutput } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { scheduleOnRN } from 'react-native-worklets';
import AROverlay, { EMPTY_OVERLAY, OverlayState } from './AROverlay';
import {
  BOARD_CORNERS, Pt, computeHomography, screenToSquare,
} from '../lib/homography';
import { extractFeatures } from '../vision/scanner';
import { detectBoard } from '../vision/detector';
import { CAM_ASPECT, SAMPLE_INSET, SAMPLE_N } from '../config';

/**
 * The camera + frame output live in their own component and are re-mounted (via `key`)
 * whenever the calibration changes. That guarantees the worklet closure always holds the
 * current homography `hBuf` without relying on cross-thread shared state.
 */
function ScannerCamera(props: {
  active: boolean;
  bufW: number;
  bufH: number;
  hBuf: number[] | null; // board -> bufW x bufH pixels
  emit: (feats: number[]) => void; // stable identity
  detect?: boolean;
  /** Corners are emitted as fractions of the buffer (same field of view as the preview). */
  emitDetect?: (corners: number[], feats: number[]) => void;
}) {
  const { active, bufW, bufH, hBuf, emit, detect, emitDetect } = props;
  const { resizer } = useResizer({
    width: bufW,
    height: bufH,
    channelOrder: 'rgb',
    dataType: 'uint8',
    pixelLayout: 'interleaved',
    scaleMode: 'cover',
  });

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    enablePhysicalBufferRotation: false,
    onFrame(frame) {
      'worklet';
      try {
        if (!resizer) return;
        const gpu = resizer.resize(frame);
        try {
          const pixelBuf = new Uint8Array(gpu.getPixelBuffer());

          if (detect && emitDetect) {
            const d = detectBoard(pixelBuf, bufW, bufH);
            if (d) {
              const feats = extractFeatures(
                pixelBuf,
                bufW,
                bufH,
                d.h,
                SAMPLE_N,
                SAMPLE_INSET
              );
              const normalised = d.corners.map((v, i) => (i % 2 === 0 ? v / bufW : v / bufH));
              scheduleOnRN(emitDetect, normalised, feats);
            }
          }

          if (hBuf) {
            const feats = extractFeatures(
              pixelBuf,
              bufW,
              bufH,
              hBuf,
              SAMPLE_N,
              SAMPLE_INSET
            );
            scheduleOnRN(emit, feats);
          }
        } finally {
          gpu.dispose();
        }
      } finally {
        frame.dispose();
      }
    },
  });

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device="back"
      isActive={active}
      outputs={[frameOutput]}
      resizeMode="cover"
      onError={(e) => console.warn('[VisionCamera] error:', e)}
    />
  );
}

type Props = {
  active?: boolean;
  /** 0..4 corners as fractions of the camera box, in physical board order a1,h1,h8,a8. */
  corners: Pt[] | null;
  onFeatures: (feats: number[]) => void;
  /** Called on every tap: the square under the finger (if calibrated) and the normalised point. */
  onTap?: (sq: string | null, p: Pt) => void;
  overlay?: Partial<OverlayState>;
  isAdjustingCorners?: boolean;
  onCornersChange?: (corners: Pt[]) => void;
  detect?: boolean;
  onDetect?: (corners: number[], feats: number[]) => void;
  /** Fill the parent instead of keeping the default 3:4 camera box. */
  fullscreen?: boolean;
  /** Insets passed to the overlay so the move chip avoids the status bar and bottom dock. */
  safeTop?: number;
  safeBottom?: number;
};

export default function CameraBoard({
  active = true,
  corners,
  onFeatures,
  onTap,
  overlay,
  isAdjustingCorners = false,
  onCornersChange,
  detect = false,
  onDetect,
  fullscreen = false,
  safeTop,
  safeBottom,
}: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [activeCorner, setActiveCorner] = useState<number | null>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Always call the latest handler, but give the worklet a function whose identity never changes.
  const handlerRef = useRef(onFeatures);
  handlerRef.current = onFeatures;
  const emit = useCallback((f: number[]) => handlerRef.current(f), []);

  const detectHandlerRef = useRef(onDetect);
  detectHandlerRef.current = onDetect;
  const emitDetect = useCallback(
    (c: number[], f: number[]) => detectHandlerRef.current?.(c, f),
    []
  );

  const full = corners && corners.length === 4 ? corners : null;

  // While the user drags the four handles, keep the vision pipeline on the last committed
  // calibration. Re-mounting the camera on every touch move would flicker and drop frames;
  // the overlay still follows the live handles, and the pipeline catches up on release.
  const scanRef = useRef<Pt[] | null>(full);
  if (!isAdjustingCorners) scanRef.current = full;
  const scanCorners = scanRef.current;

  // Match the vision buffer's aspect ratio to the preview so the homography is identical on
  // both sides. A 3:4 buffer inside a 9:19.5 preview would crop differently and make every
  // square sample drift away from the board.
  const bufDims = useMemo(() => {
    const aspect = size.w > 0 && size.h > 0 ? size.w / size.h : CAM_ASPECT;
    const h = 480;
    const w = Math.round(h * aspect) & ~1;
    return { w: Math.max(160, Math.min(480, w)), h };
  }, [size.w, size.h]);

  const key =
    (scanCorners ? scanCorners.map((c) => `${Math.round(c.x * 1e4)},${Math.round(c.y * 1e4)}`).join('|') : 'none') +
    (detect ? '-detect' : '') +
    `-${bufDims.w}x${bufDims.h}`;

  // Corners are always stored in physical board order (a1, h1, h8, a8), so the mapping is
  // independent of which side of the table the camera is on. The old `perspective` flip
  // rotated the board against the colour model and made Black-side auto-detect unreliable.
  const boardCorners = BOARD_CORNERS;

  const hBuf = useMemo(
    () => (scanCorners ? computeHomography(boardCorners, scanCorners.map((c) => ({ x: c.x * bufDims.w, y: c.y * bufDims.h }))) : null),
    [scanCorners, boardCorners, bufDims]
  );
  const px = useCallback((c: Pt) => ({ x: c.x * size.w, y: c.y * size.h }), [size]);
  const H = useMemo(
    () => (full && size.w ? computeHomography(boardCorners, full.map(px)) : null),
    [full, size, px, boardCorners]
  );
  const Hinv = useMemo(
    () => (full && size.w ? computeHomography(full.map(px), boardCorners) : null),
    [full, size, px, boardCorners]
  );
  const cornerPx = useMemo(() => (corners ?? []).map(px), [corners, px]);

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const onTouchStart = (e: GestureResponderEvent) => {
    if (!isAdjustingCorners || !size.w || !corners || corners.length !== 4) return;
    const { locationX, locationY } = e.nativeEvent;
    let closest = 0;
    let minDist = Infinity;
    corners.forEach((c, idx) => {
      const cx = c.x * size.w;
      const cy = c.y * size.h;
      const dist = Math.hypot(cx - locationX, cy - locationY);
      if (dist < minDist) {
        minDist = dist;
        closest = idx;
      }
    });
    if (minDist < 80) {
      setActiveCorner(closest);
    }
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    if (!isAdjustingCorners || activeCorner === null || !size.w || !onCornersChange || !corners) return;
    const { locationX, locationY } = e.nativeEvent;
    const nx = Math.max(0.01, Math.min(0.99, locationX / size.w));
    const ny = Math.max(0.01, Math.min(0.99, locationY / size.h));
    const next = [...corners];
    next[activeCorner] = { x: nx, y: ny };
    onCornersChange(next);
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    if (isAdjustingCorners) {
      setActiveCorner(null);
      return;
    }
    if (!size.w || !onTap) return;
    const { locationX, locationY } = e.nativeEvent;
    const sq = Hinv ? screenToSquare(Hinv, { x: locationX, y: locationY }) : null;
    onTap(sq, { x: locationX / size.w, y: locationY / size.h });
  };

  if (!hasPermission) {
    return (
      <View style={[fullscreen ? styles.fullscreen : styles.box, styles.center]}>
        <View style={styles.permissionCard}>
          <Text style={styles.permissionIcon}>◉</Text>
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionBody}>
            AR Chess watches the board through the camera. Nothing is uploaded.
          </Text>
          <Pressable style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Allow camera</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={fullscreen ? styles.fullscreen : styles.box}
      onLayout={onLayout}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <ScannerCamera
          key={key}
          active={active}
          bufW={bufDims.w}
          bufH={bufDims.h}
          hBuf={hBuf}
          emit={emit}
          detect={detect}
          emitDetect={emitDetect}
        />
      </View>
      {size.w > 0 && (
        <AROverlay
          {...EMPTY_OVERLAY}
          {...overlay}
          isAdjustingCorners={isAdjustingCorners}
          width={size.w}
          height={size.h}
          safeTop={safeTop}
          safeBottom={safeBottom}
          H={H}
          cornerPx={cornerPx}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: CAM_ASPECT, backgroundColor: '#000', overflow: 'hidden' },
  fullscreen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  permissionCard: {
    width: '82%',
    maxWidth: 330,
    backgroundColor: 'rgba(8,13,10,0.92)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(92,255,106,0.24)',
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: 'center',
  },
  permissionIcon: { color: '#5CFF6A', fontSize: 30, marginBottom: 8 },
  permissionTitle: { color: '#f4fff6', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  permissionBody: {
    color: 'rgba(226,255,233,0.62)',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 18,
  },
  btn: { backgroundColor: '#5CFF6A', paddingHorizontal: 22, paddingVertical: 11, borderRadius: 999 },
  btnText: { color: '#041007', fontWeight: '800', fontSize: 14 },
});
