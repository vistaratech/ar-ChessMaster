import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Chess } from 'chess.js';
import CameraBoard from '../components/CameraBoard';
import SettingsSheet from '../components/SettingsSheet';
import { BOTTOM, IconButton, TOP, colors } from '../components/ui';
import { useStore } from '../store/useStore';
import { useGame, Status } from '../hooks/useGame';
import { classify, learnModel, modelQuality } from '../vision/scanner';
import { mismatch, occupancyOf } from '../chess/occupancy';

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

function statusMeta(status: Status, myTurn: boolean) {
  switch (status) {
    case 'needs-colors':
      return { label: 'CALIBRATE BOARD', color: colors.warn };
    case 'detecting':
      return { label: 'MOVE DETECTED', color: colors.green };
    case 'waiting':
      return { label: 'HOLD STEADY', color: colors.warn };
    case 'out-of-sync':
      return { label: 'OUT OF SYNC', color: colors.bad };
    case 'over':
      return { label: 'GAME OVER', color: colors.bad };
    default:
      return myTurn
        ? { label: 'YOUR MOVE', color: colors.green }
        : { label: 'TRACKING', color: colors.cyan };
  }
}

function evalText(ev: number | null, mate: number | null) {
  if (mate !== null) return `MATE ${Math.abs(mate)}`;
  if (ev === null) return '—';
  return (ev > 0 ? '+' : '') + ev.toFixed(1);
}

function Action(props: {
  glyph: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.action, props.active && styles.actionOn, props.disabled && { opacity: 0.32 }]}
    >
      <Text style={[styles.actionGlyph, props.active && styles.actionTextOn]}>{props.glyph}</Text>
      <Text style={[styles.actionLabel, props.active && styles.actionTextOn]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export default function GameScreen() {
  const { corners, settings, patchSettings, newGame, setCorners, resetCorners, setModel } = useStore();
  const g = useGame();
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [autoScanMsg, setAutoScanMsg] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const prevDetect = useRef<number[] | null>(null);
  const detectHits = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreFeatures = useCallback(() => {}, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setAutoScanMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setAutoScanMsg(''), 3200);
  }, []);

  const onDetect = useCallback(
    (c: number[], feats: number[]) => {
      const start = occupancyOf(new Chess());
      const m = learnModel(feats, start);
      if (!m) return;
      if (modelQuality(m) < 1.8 || mismatch(classify(feats, m), start) > 4) {
        detectHits.current = 0;
        prevDetect.current = null;
        return;
      }
      const p = prevDetect.current;
      const same = !!p && c.every((v, i) => Math.abs(v - p[i]) < 0.02);
      prevDetect.current = c;
      detectHits.current = same ? detectHits.current + 1 : 1;
      if (detectHits.current >= 2) {
        const detectedCorners = [0, 1, 2, 3].map((k) => ({
          x: c[k * 2],
          y: c[k * 2 + 1],
        }));
        setCorners(detectedCorners);
        setModel(m);
        setIsAutoScanning(false);
        showToast('BOARD LOCKED');
      }
    },
    [setCorners, setModel, showToast]
  );

  const isMyTurn = g.turn === settings.myColor;
  const isWhite = settings.myColor === 'w';
  const hintsOff = settings.hints === 'off';
  const meta = statusMeta(g.status, isMyTurn);

  const handleSelectColor = (color: 'w' | 'b') => {
    if (settings.myColor === color) return;
    if (g.moves.length === 0) {
      newGame(color);
    } else {
      Alert.alert('Change colour?', 'Changing sides starts a new game.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change', style: 'destructive', onPress: () => newGame(color) },
      ]);
    }
  };

  const handleNewGame = () => {
    if (g.moves.length === 0) return;
    Alert.alert('New game?', 'The current game will be cleared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start', style: 'destructive', onPress: () => newGame(settings.myColor) },
    ]);
  };

  const cycleHints = () => {
    patchSettings({
      hints: settings.hints === 'mine' ? 'always' : settings.hints === 'always' ? 'off' : 'mine',
    });
  };

  const pairs: string[] = [];
  for (let i = 0; i < g.moves.length; i += 2) {
    pairs.push(`${i / 2 + 1}. ${g.moves[i]}${g.moves[i + 1] ? '  ' + g.moves[i + 1] : ''}`);
  }

  const glyphs = isWhite ? WHITE_GLYPH : BLACK_GLYPH;
  const hintGlyph = g.hintPiece ? glyphs[g.hintPiece.type] ?? '' : '';
  const evalColor =
    g.evalPawns === null
      ? colors.dim
      : (isWhite ? g.evalPawns >= 0 : g.evalPawns <= 0)
      ? colors.green
      : colors.bad;

  return (
    <View style={styles.root}>
      <CameraBoard
        fullscreen
        corners={corners}
        isAdjustingCorners={isAdjusting}
        onCornersChange={setCorners}
        detect={isAutoScanning}
        onDetect={onDetect}
        onFeatures={isAdjusting || isAutoScanning ? ignoreFeatures : g.onFeatures}
        onTap={(sq) => sq && g.tapSquare(sq)}
        safeTop={TOP + 54}
        safeBottom={BOTTOM + 64}
        overlay={{
          hint: g.hint ? { from: g.hint.from, to: g.hint.to } : null,
          hintPiece: g.hintPiece ? { type: g.hintPiece.type, color: g.hintPiece.color } : null,
          alts: g.alts.map((a) => ({ from: a.from, to: a.to })),
          lastMove: g.lastMove,
          selected: g.selected,
          targets: g.targets,
          check: g.checkSquare,
          occ: settings.debug ? g.occ : null,
          showGrid: false,
        }}
      />

      <View style={[styles.top, { paddingTop: TOP + 6 }]} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.statusPill}>
            <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
            <Text style={styles.statusText} numberOfLines={1}>
              {meta.label}
            </Text>
          </View>
          <View style={styles.topActions}>
            <IconButton
              label="⌖"
              active={isAdjusting}
              accessibilityLabel="Adjust board corners"
              onPress={() => {
                const next = !isAdjusting;
                setIsAdjusting(next);
                if (next) setIsAutoScanning(false);
              }}
            />
            <IconButton
              label="◎"
              active={isAutoScanning}
              accessibilityLabel="Auto-detect board"
              onPress={() => {
                const next = !isAutoScanning;
                setIsAutoScanning(next);
                if (next) setIsAdjusting(false);
              }}
            />
            <IconButton label="⚙" accessibilityLabel="Settings" onPress={() => setSettingsOpen(true)} />
          </View>
        </View>

        {isAutoScanning && !autoScanMsg && (
          <View style={[styles.banner, styles.bannerGreen]}>
            <Text style={styles.bannerText}>AUTO-DETECTING — SHOW THE STARTING POSITION</Text>
            <Pressable onPress={() => setIsAutoScanning(false)} hitSlop={8}>
              <Text style={styles.bannerAction}>STOP</Text>
            </Pressable>
          </View>
        )}

        {isAdjusting && (
          <View style={[styles.banner, styles.bannerCyan]}>
            <Text style={styles.bannerText}>DRAG THE FOUR CYAN CORNERS ONTO THE BOARD</Text>
            <Pressable onPress={resetCorners} hitSlop={8}>
              <Text style={styles.bannerAction}>RESET</Text>
            </Pressable>
          </View>
        )}

        {!!autoScanMsg && (
          <View style={[styles.banner, styles.bannerToast]}>
            <Text style={styles.bannerToastText}>✓ {autoScanMsg}</Text>
          </View>
        )}

        {g.status === 'out-of-sync' && (
          <View style={[styles.banner, styles.bannerRed]}>
            <Text style={styles.bannerText}>BOARD OUT OF SYNC — UNDO OR TAP A MOVE</Text>
          </View>
        )}
      </View>

      <View style={[styles.dockWrap, { paddingBottom: BOTTOM }]} pointerEvents="box-none">
        <View style={styles.dockCard}>
          <View style={styles.dockTop}>
            <View style={styles.turnWrap}>
              <View style={[styles.turnDot, { backgroundColor: isMyTurn ? colors.green : colors.cyan }]} />
              <Text style={styles.turnText}>
                {g.gameOverText ? 'GAME OVER' : isMyTurn ? 'YOUR MOVE' : 'OPPONENT MOVE'}
              </Text>
            </View>
            <Text style={[styles.eval, { color: evalColor }]}>{evalText(g.evalPawns, g.mate)}</Text>
            <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={10} accessibilityLabel="Toggle controls">
              <Text style={styles.chev}>{expanded ? '⌄' : '⌃'}</Text>
            </Pressable>
          </View>

          {expanded && (
            <>
              <View style={styles.bestRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bestKicker}>
                    {g.gameOverText
                      ? 'RESULT'
                      : hintsOff
                      ? 'HINTS OFF'
                      : isMyTurn
                      ? 'NEXT MOVE'
                      : 'BOARD WATCH'}
                  </Text>

                  {g.gameOverText ? (
                    <Text style={styles.bestMove} numberOfLines={2}>
                      {g.gameOverText}
                    </Text>
                  ) : isMyTurn ? (
                    g.hint ? (
                      <View style={styles.bestLine}>
                        <Text style={styles.bestGlyph}>{hintGlyph}</Text>
                        <Text style={styles.bestMove}>{g.hint.san ?? g.hint.uci}</Text>
                        <Text style={styles.bestCoords}>
                          {g.hint.from} → {g.hint.to}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.bestMove}>
                        {g.thinking ? 'THINKING…' : 'CALCULATING…'}
                      </Text>
                    )
                  ) : (
                    <Text style={styles.bestMove} numberOfLines={1}>
                      {g.detected ? `DETECTED ${g.detected}` : 'WAITING FOR OPPONENT'}
                    </Text>
                  )}
                </View>
                {g.thinking && <ActivityIndicator size="small" color={colors.green} />}
              </View>

              {!!g.engineError && (
                <Text style={styles.err} numberOfLines={2}>
                  Engine: {g.engineError}
                </Text>
              )}

              <View style={styles.actions}>
                <Action glyph="↶" label="UNDO" disabled={g.moves.length === 0} onPress={g.undo} />
                <Action glyph="＋" label="NEW" onPress={handleNewGame} />
                <Action
                  glyph="✦"
                  label={settings.hints === 'mine' ? 'MY TURN' : settings.hints === 'always' ? 'ALWAYS' : 'OFF'}
                  active={!hintsOff}
                  onPress={cycleHints}
                />
                <Action glyph="⚙" label="SETUP" onPress={() => setSettingsOpen(true)} />
              </View>

              {pairs.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.moves}
                >
                  {pairs.map((p, idx) => (
                    <View key={idx} style={styles.moveChip}>
                      <Text style={styles.moveText}>{p}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </View>

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        patchSettings={patchSettings}
        onColor={handleSelectColor}
        onNewGame={() => {
          setSettingsOpen(false);
          handleNewGame();
        }}
        onCalibrate={() => {
          setSettingsOpen(false);
          setIsAdjusting(true);
          setIsAutoScanning(false);
        }}
        onResetCorners={resetCorners}
        movesCount={g.moves.length}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(5,10,7,0.74)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
    flexShrink: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: colors.text, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  topActions: { flexDirection: 'row', gap: 6 },

  banner: {
    marginTop: 8,
    marginHorizontal: 12,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  bannerGreen: {
    backgroundColor: 'rgba(5,18,9,0.88)',
    borderColor: 'rgba(92,255,106,0.45)',
  },
  bannerCyan: {
    backgroundColor: 'rgba(4,17,17,0.88)',
    borderColor: 'rgba(43,247,229,0.45)',
  },
  bannerRed: {
    backgroundColor: 'rgba(22,6,6,0.88)',
    borderColor: 'rgba(255,93,93,0.45)',
  },
  bannerToast: {
    backgroundColor: 'rgba(92,255,106,0.94)',
    borderColor: 'rgba(92,255,106,1)',
    alignSelf: 'center',
    paddingHorizontal: 16,
  },
  bannerText: {
    flex: 1,
    color: colors.text,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.9,
    lineHeight: 14,
  },
  bannerAction: { color: colors.green, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  bannerToastText: { color: '#041007', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },

  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, zIndex: 20 },
  dockCard: {
    backgroundColor: 'rgba(5,10,7,0.90)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  dockTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  turnWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  turnDot: { width: 6, height: 6, borderRadius: 3 },
  turnText: { color: colors.text, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.6 },
  eval: { marginLeft: 'auto', fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  chev: { color: colors.dim, fontSize: 15, fontWeight: '800', paddingHorizontal: 2 },

  bestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  bestKicker: {
    color: colors.faint,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 1,
  },
  bestLine: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  bestGlyph: { color: colors.text, fontSize: 20 },
  bestMove: { color: colors.text, fontSize: 21, fontWeight: '900', letterSpacing: 0.2 },
  bestCoords: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginLeft: 2,
  },
  err: { color: colors.bad, fontSize: 10, marginTop: 6 },

  actions: { flexDirection: 'row', gap: 7, marginTop: 9 },
  action: {
    flex: 1,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  actionOn: { backgroundColor: colors.green, borderColor: colors.green },
  actionGlyph: { color: colors.text, fontSize: 15, fontWeight: '800', lineHeight: 18 },
  actionLabel: { color: colors.dim, fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 1 },
  actionTextOn: { color: '#041007' },

  moves: { gap: 6, paddingTop: 9, paddingRight: 4 },
  moveChip: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  moveText: {
    color: colors.dim,
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
