import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Btn, Seg, colors, BOTTOM } from './ui';
import type { HintMode, Settings } from '../store/useStore';
import type { EngineKind } from '../engine';

type Props = {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  patchSettings: (p: Partial<Settings>) => void;
  onColor: (c: 'w' | 'b') => void;
  onNewGame: () => void;
  onCalibrate: () => void;
  onResetCorners: () => void;
  movesCount: number;
};

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      {props.children}
      {!!props.hint && <Text style={styles.hint}>{props.hint}</Text>}
    </View>
  );
}

export default function SettingsSheet(props: Props) {
  const { settings, patchSettings } = props;

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>SETTINGS</Text>
            <Pressable style={styles.close} onPress={props.onClose} accessibilityLabel="Close settings">
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Field label="PLAYING AS">
              <Seg
                value={settings.myColor}
                onChange={props.onColor}
                options={[
                  { v: 'w', label: 'White' },
                  { v: 'b', label: 'Black' },
                ]}
              />
            </Field>

            <Field label="HINT MODE">
              <Seg<HintMode>
                value={settings.hints}
                onChange={(hints) => patchSettings({ hints })}
                options={[
                  { v: 'mine', label: 'My turn' },
                  { v: 'always', label: 'Always' },
                  { v: 'off', label: 'Off' },
                ]}
              />
            </Field>

            <Field label="TOP MOVES IN AR" hint="2-3 adds faint rings on the engine's alternative destinations.">
              <Seg
                value={String(settings.suggestions ?? 1)}
                onChange={(v) => patchSettings({ suggestions: Number(v) })}
                options={[
                  { v: '1', label: 'Best only' },
                  { v: '2', label: '2' },
                  { v: '3', label: '3' },
                ]}
              />
            </Field>

            <Field label="ENGINE">
              <Seg<EngineKind>
                value={settings.engine ?? 'auto'}
                onChange={(engine) => patchSettings({ engine })}
                options={[
                  { v: 'auto', label: 'Auto' },
                  { v: 'local', label: 'On-device' },
                  { v: 'cloud', label: 'Cloud' },
                ]}
              />
              <Text style={styles.hint}>Auto uses on-device Stockfish and falls back to the cloud.</Text>
            </Field>

            <Field label={`SEARCH DEPTH — ${settings.depth}`} hint="Higher is stronger but slower.">
              <View style={styles.depthRow}>
                <Btn
                  flex
                  kind="ghost"
                  label="−"
                  onPress={() => patchSettings({ depth: Math.max(6, settings.depth - 2) })}
                />
                <View style={styles.depthTrack}>
                  {Array.from({ length: 8 }).map((_, i) => {
                    const on = i < Math.round(((settings.depth - 6) / 14) * 8);
                    return <View key={i} style={[styles.depthTick, on && styles.depthTickOn]} />;
                  })}
                </View>
                <Btn
                  flex
                  kind="ghost"
                  label="+"
                  onPress={() => patchSettings({ depth: Math.min(20, settings.depth + 2) })}
                />
              </View>
            </Field>

            <Field label="PROMOTION ASSUMPTION">
              <Seg
                value={settings.promo}
                onChange={(promo) => patchSettings({ promo })}
                options={[
                  { v: 'q', label: 'Queen' },
                  { v: 'r', label: 'Rook' },
                  { v: 'b', label: 'Bishop' },
                  { v: 'n', label: 'Knight' },
                ]}
              />
            </Field>

            <Field label="CAMERA DEBUG DOTS">
              <Seg
                value={settings.debug ? 'on' : 'off'}
                onChange={(v) => patchSettings({ debug: v === 'on' })}
                options={[
                  { v: 'off', label: 'Off' },
                  { v: 'on', label: 'On' },
                ]}
              />
            </Field>

            <View style={styles.divider} />

            <Field label="BOARD ALIGNMENT" hint="Nudge all four corners until the cyan trace hugs the board.">
              <View style={styles.row}>
                <Btn flex label="Adjust corners" onPress={props.onCalibrate} />
                <Btn flex kind="ghost" label="Reset" onPress={props.onResetCorners} />
              </View>
            </Field>

            <View style={styles.row}>
              <Btn flex kind="ghost" label={`New game${props.movesCount ? ` (${props.movesCount})` : ''}`} onPress={props.onNewGame} />
            </View>

            <Text style={styles.version}>AR CHESS COACH · ON-DEVICE VISION</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '89%',
    backgroundColor: '#080F0B',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(92,255,106,0.18)',
    paddingBottom: BOTTOM,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginTop: 9,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 2.4 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  closeText: { color: colors.dim, fontSize: 14, fontWeight: '800' },
  content: { paddingHorizontal: 20, paddingBottom: 22, gap: 18 },
  field: { gap: 8 },
  label: { color: colors.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  hint: { color: colors.faint, fontSize: 11, lineHeight: 16 },
  row: { flexDirection: 'row', gap: 10 },
  depthRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  depthTrack: { flex: 1.6, flexDirection: 'row', gap: 4, alignItems: 'center' },
  depthTick: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)' },
  depthTickOn: { backgroundColor: colors.green },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  version: {
    color: 'rgba(226,255,233,0.25)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.6,
    textAlign: 'center',
    marginTop: 4,
  },
});
