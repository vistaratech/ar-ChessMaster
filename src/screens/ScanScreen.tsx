import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chess } from 'chess.js';
import CameraBoard from '../components/CameraBoard';
import { Btn, TOP, colors } from '../components/ui';
import { useStore } from '../store/useStore';
import type { Pt } from '../lib/homography';
import { classify, learnModel, modelQuality, ColorModel } from '../vision/scanner';
import { mismatch, occupancyOf } from '../chess/occupancy';
import type { Screen } from '../../App';

const MIN_QUALITY = 2.5; // the start position must be clearly visible
const SAME_PX = 0.02; // two detections this close (normalised) count as the same board

/** Open the app, show the board to the camera, pick your colour. That is all. */
export default function ScanScreen({ go }: { go: (s: Screen) => void }) {
  const { setCorners, setModel, newGame } = useStore();
  const [found, setFound] = useState<{ corners: Pt[]; model: ColorModel } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const prev = useRef<number[] | null>(null);
  const hits = useRef(0);
  const noop = useCallback(() => {}, []);

  useEffect(() => {
    if (found) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [found]);

  const onDetect = useCallback((c: number[], feats: number[]) => {
    const start = occupancyOf(new Chess());
    const model = learnModel(feats, start);
    if (!model) return;
    // the known starting position is the check: wrong alignment => classes do not separate
    if (modelQuality(model) < MIN_QUALITY || mismatch(classify(feats, model), start) > 4) {
      hits.current = 0;
      prev.current = null;
      return;
    }
    const p = prev.current;
    const same = !!p && c.every((v, i) => Math.abs(v - p[i]) < SAME_PX);
    prev.current = c;
    hits.current = same ? hits.current + 1 : 1;
    if (hits.current >= 2) {
      setFound({
        corners: [0, 1, 2, 3].map((k) => ({ x: c[k * 2], y: c[k * 2 + 1] })),
        model,
      });
    }
  }, []);

  const choose = (color: 'w' | 'b') => {
    if (!found) return;
    setCorners(found.corners); // clears the old colour model...
    setModel(found.model); // ...so set the freshly learned one after it
    newGame(color);
    go('game');
  };

  return (
    <View style={styles.root}>
      <View style={{ height: TOP }} />
      <CameraBoard
        corners={found ? found.corners : null}
        detect={!found}
        onDetect={onDetect}
        onFeatures={noop}
      />
      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {!found ? (
          <>
            <Text style={styles.h}>Board-a theda pannudhu…</Text>
            <Text style={styles.t}>
              Board muzhusa camera-la theriyara maathiri phone-a vainga. Ella 32 pieces-um start position la irukkanum. Phone asaiyaama pidinga.
            </Text>
            {seconds > 15 && (
              <Text style={{ color: colors.warn }}>
                Innum kidaikkala. Light check pannunga, board muzhusa frame kulla irukka paarunga. Illana corners-a neengale tap pannalam.
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={[styles.h, { color: colors.ok }]}>Board kidaichiduchu ✓</Text>
            <Text style={styles.t}>Green grid board mela sariya irukka paarunga. Appuram neenga entha colour nu sollunga:</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Btn flex label="White" onPress={() => choose('w')} />
              <Btn flex label="Black" onPress={() => choose('b')} />
            </View>
          </>
        )}
        <Btn
          label={found ? 'Grid sariya illa: corners-a tap panren' : 'Corners-a neengale tap panren'}
          kind="ghost"
          onPress={() => go('calibrate')}
        />
        <Btn label="Menu" kind="ghost" onPress={() => go('home')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  panel: { flex: 1 },
  h: { color: '#fff', fontWeight: '800', fontSize: 18 },
  t: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
