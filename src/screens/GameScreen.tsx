import React from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import CameraBoard from '../components/CameraBoard';
import { Btn, TOP, colors } from '../components/ui';
import { useStore } from '../store/useStore';
import { useGame, Status } from '../hooks/useGame';
import type { Screen } from '../../App';

const STATUS_TEXT: Record<Status, string> = {
  'needs-colors': 'Colours learn aagala. Calibrate screen la "Learn colours" pannunga.',
  tracking: 'Board-a paathukitte irukken…',
  detecting: 'Move detect aachu, confirm panren…',
  waiting: 'Board maariduchu. Kai-a edunga, clear view venum…',
  'out-of-sync': 'Board entha legal move-kum match aagala. Undo pannunga illa tap panni move podunga.',
  over: 'Game over',
};

const LINE_COLORS = ['#fbbf24', '#60a5fa', '#d1d5db', '#f472b6', '#a78bfa']; // match the AR arrow colours

function evalText(ev: number | null, mate: number | null) {
  if (mate !== null) return `Mate in ${Math.abs(mate)}`;
  if (ev === null) return '—';
  return (ev > 0 ? '+' : '') + ev.toFixed(2);
}

export default function GameScreen({ go }: { go: (s: Screen) => void }) {
  const { corners, settings, patchSettings, newGame } = useStore();
  const g = useGame();

  const winPct =
    g.mate !== null ? (g.mate > 0 ? 100 : 0)
    : g.evalPawns === null ? 50
    : 100 / (1 + Math.pow(10, -g.evalPawns / 4));

  const pairs: string[] = [];
  for (let i = 0; i < g.moves.length; i += 2) {
    pairs.push(`${i / 2 + 1}. ${g.moves[i]}${g.moves[i + 1] ? '  ' + g.moves[i + 1] : ''}`);
  }

  const cycleHints = () =>
    patchSettings({ hints: settings.hints === 'mine' ? 'always' : settings.hints === 'always' ? 'off' : 'mine' });

  const statusColor =
    g.status === 'out-of-sync' || g.status === 'needs-colors' ? colors.bad
    : g.status === 'waiting' ? colors.warn : colors.ok;

  return (
    <View style={styles.root}>
      <View style={{ height: TOP }} />
      <CameraBoard
        corners={corners}
        onFeatures={g.onFeatures}
        onTap={(sq) => sq && g.tapSquare(sq)}
        overlay={{
          hint: g.hint ? { from: g.hint.from, to: g.hint.to } : null,
          hintPiece: g.hintPiece ? { type: g.hintPiece.type, color: g.hintPiece.color } : null,
          alts: g.alts.map((a) => ({ from: a.from, to: a.to })),
          lastMove: g.lastMove,
          selected: g.selected,
          targets: g.targets,
          check: g.checkSquare,
          occ: settings.debug ? g.occ : null,
        }}
      />

      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 14, gap: 10 }}>
        <Text style={[styles.status, { color: g.gameOverText ? colors.warn : statusColor }]}>
          {g.gameOverText ?? (g.detected ? `Detected: ${g.detected}` : STATUS_TEXT[g.status])}
        </Text>

        <View style={styles.row}>
          <Text style={styles.turn}>
            {g.turn === 'w' ? 'White' : 'Black'} to move{g.turn === settings.myColor ? ' (nee)' : ''}
          </Text>
          <Text style={styles.eval}>{evalText(g.evalPawns, g.mate)}</Text>
        </View>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${winPct}%` }]} />
        </View>

        {g.thinking && <Text style={styles.dim}>Stockfish yosikkudhu…</Text>}
        {g.moves.length > 0 && g.turn === settings.myColor && !g.gameOverText && (
          <Text style={styles.dim}>Ethirali aadinadhu: {g.moves[g.moves.length - 1]}. Unga best replies:</Text>
        )}
        {g.hint && (
          <View style={{ gap: 2 }}>
            {[g.hint, ...g.alts].map((m, i) => (
              <Text key={m.uci + i} style={[styles.line, { color: LINE_COLORS[i % LINE_COLORS.length] }]}>
                {i + 1}. {m.san ?? m.uci}
                <Text style={styles.dim}>
                  {'   '}
                  {evalText(m.evalPawns, m.mate)}
                  {i === 0 ? `   (depth ${g.hint!.depth})` : ''}
                </Text>
              </Text>
            ))}
          </View>
        )}
        {g.engineError && (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.bad }}>{g.engineError}</Text>
            <Btn label="Retry engine" kind="ghost" onPress={g.retryEngine} />
          </View>
        )}
        {g.selected && <Text style={styles.dim}>Selected {g.selected}. Destination square-a tap pannunga.</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={styles.moves}>{pairs.length ? pairs.join('     ') : 'Moves inga varum'}</Text>
        </ScrollView>

        <View style={styles.row}>
          <Btn flex label="Undo" kind="ghost" onPress={g.undo} disabled={!g.moves.length} />
          <Btn flex label={`Hints: ${settings.hints}`} kind="ghost" onPress={cycleHints} />
          <Btn flex label="PGN" kind="ghost" onPress={() => Share.share({ message: g.pgn() })} disabled={!g.moves.length} />
        </View>
        <View style={styles.row}>
          <Btn
            flex
            label="New game"
            kind="ghost"
            onPress={() =>
              Alert.alert('New game?', 'Current game clear aagum.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Start', onPress: () => newGame(settings.myColor) },
              ])
            }
          />
          <Btn
            flex
            label={`Nee: ${settings.myColor === 'w' ? 'White' : 'Black'}`}
            kind="ghost"
            onPress={() => patchSettings({ myColor: settings.myColor === 'w' ? 'b' : 'w' })}
          />
        </View>
        <View style={styles.row}>
          <Btn flex label="Recalibrate" kind="ghost" onPress={() => go('calibrate')} />
          <Btn flex label="Menu" kind="ghost" onPress={() => go('home')} />
        </View>
        <Text style={styles.dim}>Camera thappa detect pannina: piece-a tap pannunga, appuram destination-a tap pannunga.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  panel: { flex: 1 },
  status: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'space-between' },
  turn: { color: '#fff', fontWeight: '700', fontSize: 16 },
  eval: { color: '#fff', fontWeight: '700', fontSize: 16 },
  bar: { height: 8, backgroundColor: '#111', borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: '#374151' },
  barFill: { height: '100%', backgroundColor: '#f3f4f6' },
  line: { fontWeight: '800', fontSize: 18 },
  dim: { color: colors.dim, fontSize: 12 },
  moves: { color: colors.text, fontSize: 14, fontFamily: 'monospace' },
});
