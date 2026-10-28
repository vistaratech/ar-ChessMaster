import React from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';

export const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 50;
export const BOTTOM = Platform.OS === 'ios' ? 34 : 28;

/** Shared dark-glass / neon-green palette used across every screen. */
export const colors = {
  bg: '#050806',
  card: 'rgba(8,13,10,0.88)',
  cardSolid: '#0B110D',
  border: 'rgba(255,255,255,0.10)',
  text: '#F4FFF6',
  dim: 'rgba(226,255,233,0.62)',
  faint: 'rgba(226,255,233,0.38)',
  green: '#5CFF6A',
  greenDeep: '#18C94B',
  cyan: '#2BF7E5',
  ok: '#5CFF6A',
  warn: '#FFC857',
  bad: '#FF5D5D',
};

export function Btn(p: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  flex?: boolean;
}) {
  const primary = !p.kind || p.kind === 'primary';
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      style={[styles.btn, primary && styles.btnPrimary, p.kind === 'danger' && styles.btnDanger, p.flex && { flex: 1 }, p.disabled && { opacity: 0.35 }]}
    >
      <Text style={[styles.btnText, primary && styles.btnTextPrimary]}>{p.label}</Text>
    </Pressable>
  );
}

export function Seg<T extends string>(p: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg}>
      {p.options.map((o) => {
        const on = p.value === o.v;
        return (
          <Pressable key={o.v} onPress={() => p.onChange(o.v)} style={[styles.segItem, on && styles.segOn]}>
            <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconButton(p: {
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityLabel={p.accessibilityLabel ?? p.label}
      style={[styles.iconBtn, p.active && styles.iconBtnOn, p.disabled && { opacity: 0.35 }]}
    >
      <Text style={[styles.iconText, p.active && styles.iconTextOn]}>{p.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnPrimary: { backgroundColor: colors.green, borderColor: colors.green },
  btnDanger: { backgroundColor: 'rgba(255,93,93,0.14)', borderColor: 'rgba(255,93,93,0.42)' },
  btnText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  btnTextPrimary: { color: '#041007' },
  seg: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 9 },
  segOn: { backgroundColor: colors.green },
  segText: { color: colors.dim, fontWeight: '700', fontSize: 12 },
  segTextOn: { color: '#041007' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,11,8,0.72)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnOn: { backgroundColor: colors.green, borderColor: colors.green },
  iconText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  iconTextOn: { color: '#041007' },
});
