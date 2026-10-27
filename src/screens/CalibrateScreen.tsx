import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chess } from 'chess.js';
import CameraBoard from '../components/CameraBoard';
import { Btn, TOP, colors } from '../components/ui';
import { useStore } from '../store/useStore';
import type { Pt } from '../lib/homography';
import { classify, learnModel, modelQuality } from '../vision/scanner';
import { Occ, mismatch, occupancyOf } from '../chess/occupancy';
import type { Screen } from '../../App';

const LABELS = [
  'a1: White-oda queen-side rook irukkura corner (White paarkkum bodhu left-bottom)',
  'h1: White-oda king-side rook corner (right-bottom)',
  'h8: Black-oda king-side rook corner (right-top)',
  'a8: Black-oda queen-side rook corner (left-top)',
];

const AUTO_MIN_QUALITY = 2.0; // automatic learning only when the start position is clearly visible
const MANUAL_MIN_QUALITY = 1.0;

export default function CalibrateScreen({ go }: { go: (s: Screen) => void }) {
  const { corners, model, setCorners, setModel } = useStore();
  const [taps, setTaps] = useState<Pt[]>(corners ?? []);
  const [occ, setOcc] = useState<Occ | null>(null);
  const [msg, setMsg] = useState('');
  const [justLearned, setJustLearned] = useState(false);
  const last = useRef<number[] | null>(null);
  const lastUi = useRef(0);

  const onFeatures = useCallback(
    (f: number[]) => {
      last.current = f;
      const now = Date.now();
      if (model && now - lastUi.current > 300) {
        lastUi.current = now;
        setOcc(classify(f, model));
      }
    },
    [model]
  );

  const onTap = (_sq: string | null, p: Pt) => {
    if (taps.length >= 4) return;
    const next = [...taps, p];
    setTaps(next);
    if (next.length === 4) {
      last.current = null; // drop frames computed with the old calibration
      setCorners(next); // also clears the old colour model
      setMsg('');
    }
  };

  const reset = () => {
    last.current = null;
    setTaps([]);
    setCorners(null);
    setOcc(null);
    setMsg('');
    setJustLearned(false);
  };

  // Learn what the 4 square/piece classes look like from a frame showing the starting position.
  const tryLearn = (auto: boolean) => {
    const f = last.current;
    if (!f) {
      if (!auto) setMsg('Camera frame innum varala. Oru nimisham wait pannunga.');
      return false;
    }
    const start = occupancyOf(new Chess());
    const m = learnModel(f, start);
    if (!m) return false;
    const q = modelQuality(m);
    const wrong = mismatch(classify(f, m), start);
    if (q < (auto ? AUTO_MIN_QUALITY : MANUAL_MIN_QUALITY) || wrong > 4) {
      setMsg(
        `Starting position innum clear-a theriyala (score ${q.toFixed(1)}). ` +
          'Ella 32 pieces-um vachirukkeengala? Kai board mela illama, nalla light irukkanum.'
      );
      return false;
    }
    setModel(m);
    setJustLearned(true);
    setMsg('✓ Ready! Game start aagudhu…');
    return true;
  };

  // Once all 4 corners are tapped, keep trying automatically until the start position is seen.
  useEffect(() => {
    if (taps.length < 4 || model) return;
    const id = setInterval(() => tryLearn(true), 700);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taps.length, model]);

  // Freshly calibrated => straight into the game with the camera on.
  useEffect(() => {
    if (!justLearned) return;
    const id = setTimeout(() => go('game'), 1200);
    return () => clearTimeout(id);
  }, [justLearned, go]);

  const step = taps.length < 4 ? 1 : !model ? 2 : 3;

  return (
    <View style={styles.root}>
      <View style={{ height: TOP }} />
      <CameraBoard
        corners={taps}
        onFeatures={onFeatures}
        onTap={onTap}
        overlay={{ occ: model ? occ : null }}
      />
      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 16, gap: 10 }}>
        {step === 1 && (
          <>
            <Text style={styles.h}>Step 1: board corners ({taps.length}/4)</Text>
            <Text style={styles.t}>Phone-a stand la fix pannunga. Board-oda 4 corners-a order-la tap pannunga:</Text>
            <Text style={styles.t}>{LABELS[taps.length]}</Text>
          </>
        )}
        {step === 2 && (
          <>
            <Text style={styles.h}>Step 2: pieces vainga</Text>
            <Text style={styles.t}>
              Ella pieces-um starting position la vainga. Camera paarthadhum thaanaaga colours learn aagi game start aagum, vera button press panna venam.
            </Text>
          </>
        )}
        {step === 3 && (
          <>
            <Text style={styles.h}>Ready</Text>
            <Text style={styles.t}>Vella dot = white piece, grey dot = black piece. Ellam sariya irundha Done press pannunga.</Text>
          </>
        )}
        {!!msg && <Text style={[styles.t, { color: msg.startsWith('✓') ? colors.ok : colors.warn }]}>{msg}</Text>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn flex label="Reset corners" kind="ghost" onPress={reset} />
          <Btn flex label="Learn now" kind="ghost" onPress={() => tryLearn(false)} disabled={taps.length < 4} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn flex label="Menu" kind="ghost" onPress={() => go('home')} />
          <Btn flex label="Play" onPress={() => go('game')} disabled={!model} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  panel: { flex: 1 },
  h: { color: '#fff', fontWeight: '700', fontSize: 16 },
  t: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
