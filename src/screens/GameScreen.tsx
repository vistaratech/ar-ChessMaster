import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Chess } from 'chess.js';
import CameraBoard from '../components/CameraBoard';
import { TOP, colors } from '../components/ui';
import { useStore } from '../store/useStore';
import { useGame, Status } from '../hooks/useGame';
import { BUF_H, BUF_W } from '../config';
import { classify, learnModel, modelQuality } from '../vision/scanner';
import { mismatch, occupancyOf } from '../chess/occupancy';

const STATUS_TEXT: Record<Status, string> = {
  'needs-colors': 'Board ready aagudhu…',
  tracking: 'Board-a paathukitte irukken…',
  detecting: 'Move detect aachu, confirm panren…',
  waiting: 'Board maariduchu. Kai-a edunga, clear view venum…',
  'out-of-sync': 'Board match aagala. Undo pannunga illa tap panni move podunga.',
  over: 'Game over',
};

function evalText(ev: number | null, mate: number | null) {
  if (mate !== null) return `Mate in ${Math.abs(mate)}`;
  if (ev === null) return '—';
  return (ev > 0 ? '+' : '') + ev.toFixed(2);
}

export default function GameScreen({ go }: { go?: (s: any) => void }) {
  const { corners, settings, patchSettings, newGame, setCorners, resetCorners, setModel } = useStore();
  const g = useGame();
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [autoScanMsg, setAutoScanMsg] = useState('');
  const prevDetect = useRef<number[] | null>(null);
  const detectHits = useRef(0);

  const onDetect = useCallback((c: number[], feats: number[]) => {
    const start = occupancyOf(new Chess());
    const m = learnModel(feats, start);
    if (!m) return;
    if (modelQuality(m) < 1.8 || mismatch(classify(feats, m), start) > 4) {
      detectHits.current = 0;
      prevDetect.current = null;
      return;
    }
    const p = prevDetect.current;
    const same = !!p && c.every((v, i) => Math.abs(v - p[i]) < 6);
    prevDetect.current = c;
    detectHits.current = same ? detectHits.current + 1 : 1;
    if (detectHits.current >= 2) {
      const detectedCorners = [0, 1, 2, 3].map((k) => ({
        x: c[k * 2] / BUF_W,
        y: c[k * 2 + 1] / BUF_H,
      }));
      setCorners(detectedCorners);
      setModel(m);
      setIsAutoScanning(false);
      setAutoScanMsg('✓ Board Auto-Detected & Locked!');
      setTimeout(() => setAutoScanMsg(''), 3500);
    }
  }, [setCorners, setModel]);

  const isMyTurn = g.turn === settings.myColor;
  const isWhite = settings.myColor === 'w';

  const handleSelectColor = (color: 'w' | 'b') => {
    if (settings.myColor === color) return;
    if (g.moves.length === 0) {
      newGame(color);
    } else {
      Alert.alert(
        'Color மாற்றவா?',
        'Color மாற்றினால் புதிய விளையாட்டு ஆரம்பிக்கும்.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'ஆம், மாற்று',
            style: 'destructive',
            onPress: () => newGame(color),
          },
        ]
      );
    }
  };

  const togglePerspective = () => {
    patchSettings({
      perspective: settings.perspective === 'w' ? 'b' : 'w',
    });
  };

  const handleNewGame = () => {
    if (g.moves.length === 0) return;
    Alert.alert('புதிய விளையாட்டு?', 'தற்போதைய ஆட்டம் அழிக்கப்படும்.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'தொடங்கு', onPress: () => newGame(settings.myColor) },
    ]);
  };

  const pairs: string[] = [];
  for (let i = 0; i < g.moves.length; i += 2) {
    pairs.push(`${i / 2 + 1}. ${g.moves[i]}${g.moves[i + 1] ? '  ' + g.moves[i + 1] : ''}`);
  }

  return (
    <View style={styles.root}>
      {/* Top Safe Area */}
      <View style={{ height: TOP }} />

      {/* Header & Side Selection */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.appTitle}>♞ AR Chess Coach</Text>
          <View style={styles.topActions}>
            <Pressable
              style={[styles.iconBtn, isAutoScanning && styles.iconBtnScanning]}
              onPress={() => {
                const next = !isAutoScanning;
                setIsAutoScanning(next);
                if (next) setIsAdjusting(false);
              }}
            >
              <Text style={styles.iconBtnText}>{isAutoScanning ? '⏹ Stop' : '🔍 Auto'}</Text>
            </Pressable>
            <Pressable
              style={[styles.iconBtn, isAdjusting && styles.iconBtnActive]}
              onPress={() => {
                const next = !isAdjusting;
                setIsAdjusting(next);
                if (next) setIsAutoScanning(false);
              }}
            >
              <Text style={styles.iconBtnText}>{isAdjusting ? '✓ Done' : '🎯 Grid'}</Text>
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={togglePerspective}>
              <Text style={styles.iconBtnText}>🔄 Flip</Text>
            </Pressable>
          </View>
        </View>

        {/* Color Choice Bar */}
        <View style={styles.colorSelectorRow}>
          <Text style={styles.colorPrompt}>I play / நான்:</Text>
          <View style={styles.colorTabs}>
            <Pressable
              onPress={() => handleSelectColor('w')}
              style={[styles.colorTab, isWhite && styles.colorTabActive]}
            >
              <Text style={[styles.colorTabText, isWhite && styles.colorTabTextActive]}>
                ⚪ White (வெள்ளை)
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleSelectColor('b')}
              style={[styles.colorTab, !isWhite && styles.colorTabActive]}
            >
              <Text style={[styles.colorTabText, !isWhite && styles.colorTabTextActive]}>
                ⚫ Black (கருப்பு)
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Auto-Scan Banner */}
      {isAutoScanning && (
        <View style={styles.autoScanBanner}>
          <Text style={styles.autoScanBannerText}>
            🔍 Auto-Detecting Board... போர்டை கேமராவில் நேராகக் காட்டவும் (Starting Position).
          </Text>
          <Pressable style={styles.cancelBtn} onPress={() => setIsAutoScanning(false)}>
            <Text style={styles.cancelBtnText}>Stop</Text>
          </Pressable>
        </View>
      )}

      {/* Auto-Scan Success Toast */}
      {!!autoScanMsg && (
        <View style={styles.successBanner}>
          <Text style={styles.successBannerText}>{autoScanMsg}</Text>
        </View>
      )}

      {/* Adjustment Banner when adjusting corners */}
      {isAdjusting && (
        <View style={styles.adjustBanner}>
          <Text style={styles.adjustBannerText}>
            🎯 போர்டு கார்னர்களை விரலால் இழுத்து (Drag) சரியாக பொருத்தவும்.
          </Text>
          <Pressable style={styles.resetBtn} onPress={resetCorners}>
            <Text style={styles.resetBtnText}>Reset to Center</Text>
          </Pressable>
        </View>
      )}

      {/* Live Camera + AR Chess Overlay */}
      <View style={styles.cameraContainer}>
        <CameraBoard
          corners={corners}
          perspective={settings.perspective}
          isAdjustingCorners={isAdjusting}
          onCornersChange={setCorners}
          detect={isAutoScanning}
          onDetect={onDetect}
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
      </View>

      {/* Bottom Floating Move & Game HUD */}
      <View style={styles.hudContainer}>
        {/* Main Move Recommendation Card */}
        <View style={[styles.card, isMyTurn ? styles.cardMyTurn : styles.cardOpponent]}>
          {g.gameOverText ? (
            <View style={styles.centerAlign}>
              <Text style={styles.gameOverTitle}>🏆 {g.gameOverText}</Text>
              <Text style={styles.subHint}>புதிய விளையாட்டுக்கு New Game அழுத்தவும்</Text>
            </View>
          ) : isMyTurn ? (
            <View>
              <View style={styles.turnRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>✨ UNGA TURN ({isWhite ? 'WHITE' : 'BLACK'})</Text>
                </View>
                <Text style={styles.evalText}>
                  Eval: {evalText(g.evalPawns, g.mate)}
                </Text>
              </View>

              {g.hint ? (
                <View style={styles.moveRow}>
                  <Text style={styles.bestMoveLabel}>Best Move:</Text>
                  <Text style={styles.bestMoveText}>{g.hint.san ?? g.hint.uci}</Text>
                  <Text style={styles.moveCoords}>
                    ({g.hint.from.toUpperCase()} ➔ {g.hint.to.toUpperCase()})
                  </Text>
                </View>
              ) : (
                <Text style={styles.thinkingText}>
                  {g.thinking ? '⏳ Stockfish யோசிக்கிறது…' : 'Move கணக்கிடப்படுகிறது…'}
                </Text>
              )}
            </View>
          ) : (
            <View>
              <View style={styles.turnRow}>
                <View style={[styles.badge, styles.badgeOpponent]}>
                  <Text style={styles.badgeOpponentText}>
                    ⏳ OPPONENT TURN ({isWhite ? 'BLACK' : 'WHITE'})
                  </Text>
                </View>
              </View>
              <Text style={styles.waitingText}>
                {g.detected
                  ? `Move Detected: ${g.detected}`
                  : 'எதிராளி நகர்த்தியதும் உங்களுக்கான Best Move AR-ல் காட்டும்…'}
              </Text>
              <Text style={styles.subHint}>
                (கேமரா பார்க்கவில்லை என்றால் Piece & சதுரத்தை போர்டில் Tap செய்யலாம்)
              </Text>
            </View>
          )}
        </View>

        {/* Moves History & Action Buttons */}
        <View style={styles.actionsBar}>
          <Pressable
            style={[styles.actionBtn, g.moves.length === 0 && styles.btnDisabled]}
            onPress={g.undo}
            disabled={g.moves.length === 0}
          >
            <Text style={styles.actionBtnText}>↩ Undo</Text>
          </Pressable>

          <Pressable
            style={[styles.actionBtn, g.moves.length === 0 && styles.btnDisabled]}
            onPress={handleNewGame}
            disabled={g.moves.length === 0}
          >
            <Text style={styles.actionBtnText}>🔄 New Game</Text>
          </Pressable>

          <Pressable
            style={styles.actionBtn}
            onPress={() =>
              patchSettings({
                hints: settings.hints === 'mine' ? 'always' : 'mine',
              })
            }
          >
            <Text style={styles.actionBtnText}>
              💡 {settings.hints === 'always' ? 'All Hints' : 'My Turn'}
            </Text>
          </Pressable>
        </View>

        {/* Moves List (horizontal chip scroll) */}
        {pairs.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.movesScroll}
          >
            {pairs.map((p, idx) => (
              <View key={idx} style={styles.moveChip}>
                <Text style={styles.moveChipText}>{p}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0d12',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  appTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  iconBtnActive: {
    backgroundColor: '#f59e0b',
    borderColor: '#d97706',
  },
  iconBtnScanning: {
    backgroundColor: '#10b981',
    borderColor: '#059669',
  },
  iconBtnText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  colorSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  colorPrompt: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  colorTabs: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 3,
  },
  colorTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  colorTabActive: {
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  colorTabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  colorTabTextActive: {
    color: '#ffffff',
  },
  autoScanBanner: {
    backgroundColor: '#064e3b',
    paddingHorizontal: 16,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#059669',
  },
  autoScanBannerText: {
    color: '#d1fae5',
    fontSize: 12,
    flex: 1,
    fontWeight: '700',
  },
  cancelBtn: {
    backgroundColor: '#047857',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginLeft: 8,
  },
  cancelBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  successBanner: {
    backgroundColor: '#059669',
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  successBannerText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  adjustBanner: {
    backgroundColor: '#78350f',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adjustBannerText: {
    color: '#fef3c7',
    fontSize: 12,
    flex: 1,
    fontWeight: '600',
  },
  resetBtn: {
    backgroundColor: '#92400e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  resetBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  cameraContainer: {
    width: '100%',
    backgroundColor: '#000',
  },
  hudContainer: {
    flex: 1,
    padding: 12,
    gap: 8,
    justifyContent: 'flex-start',
  },
  card: {
    backgroundColor: '#131b26',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  },
  cardMyTurn: {
    borderColor: '#10b981',
    backgroundColor: '#062016',
  },
  cardOpponent: {
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  turnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  badge: {
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeOpponent: {
    backgroundColor: '#475569',
  },
  badgeOpponentText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  evalText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '700',
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 2,
  },
  bestMoveLabel: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  bestMoveText: {
    color: '#fef08a',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  moveCoords: {
    color: '#10b981',
    fontSize: 15,
    fontWeight: '700',
  },
  thinkingText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
    fontStyle: 'italic',
    marginTop: 4,
  },
  waitingText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  subHint: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 4,
  },
  gameOverTitle: {
    color: '#f59e0b',
    fontSize: 18,
    fontWeight: '800',
  },
  centerAlign: {
    alignItems: 'center',
    gap: 4,
  },
  actionsBar: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionBtnText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.35,
  },
  movesScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  moveChip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  moveChipText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
