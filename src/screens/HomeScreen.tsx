import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStore, HintMode } from '../store/useStore';
import type { EngineKind } from '../engine';
import { Btn, Seg, TOP, colors } from '../components/ui';
import type { Screen } from '../../App';

export default function HomeScreen({ go }: { go: (s: Screen) => void }) {
  const { corners, model, settings, moves, patchSettings, newGame } = useStore();
  const [side, setSide] = useState<'w' | 'b'>(settings.myColor);
  const calibrated = !!corners && corners.length === 4 && !!model;

  const start = () => {
    newGame(side);
    go(calibrated ? 'game' : 'calibrate');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingTop: TOP + 16, gap: 16 }}>
      <Text style={styles.title}>♞ AR Chess Coach</Text>
      <Text style={styles.sub}>Real board mela camera vachaa, next best move AR-la kaatum.</Text>

      <View style={styles.card}>
        <Text style={styles.h}>Setup</Text>
        <Text style={[styles.row, { color: corners?.length === 4 ? colors.ok : colors.warn }]}>
          {corners?.length === 4 ? '✓' : '○'} Board corners
        </Text>
        <Text style={[styles.row, { color: model ? colors.ok : colors.warn }]}>
          {model ? '✓' : '○'} Piece colours learned
        </Text>
        <Btn label={calibrated ? 'Re-calibrate board' : 'Calibrate board'} kind="ghost" onPress={() => go('calibrate')} />
      </View>

      <View style={styles.card}>
        <Text style={styles.h}>New game</Text>
        <Text style={styles.label}>I am playing</Text>
        <Seg value={side} onChange={setSide} options={[{ v: 'w', label: 'White' }, { v: 'b', label: 'Black' }]} />
        <Btn label="Start new game" onPress={start} />
        {moves.length > 0 && <Btn label={`Continue game (${moves.length} moves)`} kind="ghost" onPress={() => go('game')} disabled={!calibrated} />}
      </View>

      <View style={styles.card}>
        <Text style={styles.h}>Settings</Text>
        <Text style={styles.label}>Show hints</Text>
        <Seg<HintMode>
          value={settings.hints}
          onChange={(hints) => patchSettings({ hints })}
          options={[{ v: 'mine', label: 'My turn' }, { v: 'always', label: 'Always' }, { v: 'off', label: 'Off' }]}
        />
        <Text style={styles.label}>Top moves to show in AR (on-device engine)</Text>
        <Seg
          value={String(settings.suggestions ?? 3)}
          onChange={(v) => patchSettings({ suggestions: Number(v) })}
          options={[{ v: '1', label: '1' }, { v: '2', label: '2' }, { v: '3', label: '3' }]}
        />
        <Text style={styles.label}>Engine</Text>
        <Seg<EngineKind>
          value={settings.engine ?? 'auto'}
          onChange={(engine) => patchSettings({ engine })}
          options={[{ v: 'auto', label: 'Auto' }, { v: 'local', label: 'On-device' }, { v: 'cloud', label: 'Cloud' }]}
        />
        <Text style={styles.label}>Engine depth: {settings.depth} (higher = stronger, slower)</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn flex label="−" kind="ghost" onPress={() => patchSettings({ depth: Math.max(6, settings.depth - 2) })} />
          <Btn flex label="+" kind="ghost" onPress={() => patchSettings({ depth: Math.min(20, settings.depth + 2) })} />
        </View>
        <Text style={styles.label}>When a pawn promotes, assume</Text>
        <Seg
          value={settings.promo}
          onChange={(promo) => patchSettings({ promo })}
          options={[{ v: 'q', label: 'Queen' }, { v: 'r', label: 'Rook' }, { v: 'b', label: 'Bishop' }, { v: 'n', label: 'Knight' }]}
        />
        <Text style={styles.label}>Show what the camera sees (debug dots)</Text>
        <Seg
          value={settings.debug ? 'on' : 'off'}
          onChange={(v) => patchSettings({ debug: v === 'on' })}
          options={[{ v: 'off', label: 'Off' }, { v: 'on', label: 'On' }]}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  sub: { color: colors.dim, marginBottom: 4 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 10 },
  h: { color: '#fff', fontWeight: '700', fontSize: 16 },
  label: { color: colors.dim, fontSize: 13, marginTop: 4 },
  row: { fontSize: 14 },
});
