import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraPermission, useFrameOutput } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { scheduleOnRN } from 'react-native-worklets';
import AROverlay, { EMPTY_OVERLAY, OverlayState } from './AROverlay';
import {
  getBoardCorners, Pt, computeHomography, screenToSquare,
} from '../lib/homography';
import { extractFeatures } from '../vision/scanner';
import { detectBoard } from '../vision/detector';
import { BUF_H, BUF_W, CAM_ASPECT, SAMPLE_INSET, SAMPLE_N } from '../config';

/**
 * The camera + frame output live in their own component and are re-mounted (via `key`)
 * whenever the calibration changes. That guarantees the worklet closure always holds the
 * current homography `hBuf` without relying on cross-thread shared state.
 */
function ScannerCamera(props: {
  active: boolean;
  hBuf: number[] | null; // board -> BUF_W x BUF_H pixels
  emit: (feats: number[]) => void; // stable identity
  detect?: boolean;
  emitDetect?: (corners: number[], feats: number[]) => void;
}) {
  const { active, hBuf, emit, detect, emitDetect } = props;
  const { resizer } = useResizer({
    width: BUF_W,
    height: BUF_H,
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
            const d = detectBoard(pixelBuf, BUF_W, BUF_H);
            if (d) {
              const feats = extractFeatures(
                pixelBuf,
                BUF_W,
                BUF_H,
                d.h,
                SAMPLE_N,
                SAMPLE_INSET
              );
              scheduleOnRN(emitDetect, d.corners, feats);
            }
          }

          if (hBuf) {
            const feats = extractFeatures(
              pixelBuf,
              BUF_W,
              BUF_H,
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
    />
  );
}

type Props = {
  active?: boolean;
  /** 0..4 corners as fractions of the camera box. 4 corners => grid + scanning. */
  corners: Pt[] | null;
  perspective?: 'w' | 'b';
  onFeatures: (feats: number[]) => void;
  /** Called on every tap: the square under the finger (if calibrated) and the normalised point. */
  onTap?: (sq: string | null, p: Pt) => void;
  overlay?: Partial<OverlayState>;
  isAdjustingCorners?: boolean;
  onCornersChange?: (corners: Pt[]) => void;
  detect?: boolean;
  onDetect?: (corners: number[], feats: number[]) => void;
};

export default function CameraBoard({
  active = true,
  corners,
  perspective = 'w',
  onFeatures,
  onTap,
  overlay,
  isAdjustingCorners = false,
  onCornersChange,
  detect = false,
  onDetect,
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
  const key =
    (full ? full.map((c) => `${Math.round(c.x * 1e4)},${Math.round(c.y * 1e4)}`).join('|') + perspective : 'none') +
    (detect ? '-detect' : '');

  const boardCorners = useMemo(() => getBoardCorners(perspective), [perspective]);

  const hBuf = useMemo(
    () => (full ? computeHomography(boardCorners, full.map((c) => ({ x: c.x * BUF_W, y: c.y * BUF_H }))) : null),
    [full, boardCorners]
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
      <View style={[styles.box, styles.center]}>
        <Text style={styles.msg}>Camera permission venum</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={styles.box}
      onLayout={onLayout}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <ScannerCamera
          key={key}
          active={active}
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
          H={H}
          cornerPx={cornerPx}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: CAM_ASPECT, backgroundColor: '#000', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  msg: { color: '#fff', marginBottom: 12 },
  btn: { backgroundColor: '#2563eb', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '600' },
});
