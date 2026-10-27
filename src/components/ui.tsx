import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform, StatusBar } from 'react-native';

export const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 50;

export function Btn(p: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; flex?: boolean }) {
  const bg = p.kind === 'ghost' ? '#1f2937' : p.kind === 'danger' ? '#b91c1c' : '#2563eb';
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      style={[styles.btn, { backgroundColor: bg, opacity: p.disabled ? 0.4 : 1 }, p.flex && { flex: 1 }]}
    >
      <Text style={styles.btnText}>{p.label}</Text>
    </Pressable>
  );
}

export function Seg<T extends string>(p: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg}>
      {p.options.map((o) => (
        <Pressable key={o.v} onPress={() => p.onChange(o.v)} style={[styles.segItem, p.value === o.v && styles.segOn]}>
          <Text style={styles.segText}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const colors = { bg: '#0b0f14', card: '#131a22', text: '#e5e7eb', dim: '#9ca3af', ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444' };

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  seg: { flexDirection: 'row', backgroundColor: '#1f2937', borderRadius: 10, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segOn: { backgroundColor: '#2563eb' },
  segText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
