import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useStore } from './src/store/useStore';
import GameScreen from './src/screens/GameScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';

export type Screen = 'home' | 'calibrate' | 'game' | 'scan';

function AppContent() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let unmounted = false;
    try {
      if (useStore.persist?.hasHydrated?.()) {
        setHydrated(true);
        return;
      }
      const unsub = useStore.persist?.onFinishHydration?.(() => {
        if (!unmounted) setHydrated(true);
      });
      // Safety timeout: if hydration callback never fires, proceed anyway after 800ms
      const timer = setTimeout(() => {
        if (!unmounted) setHydrated(true);
      }, 800);

      return () => {
        unmounted = true;
        unsub?.();
        clearTimeout(timer);
      };
    } catch {
      setHydrated(true);
    }
  }, []);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0d12', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <GameScreen />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
