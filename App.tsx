import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useStore } from './src/store/useStore';
import HomeScreen from './src/screens/HomeScreen';
import CalibrateScreen from './src/screens/CalibrateScreen';
import GameScreen from './src/screens/GameScreen';

export type Screen = 'home' | 'calibrate' | 'game';

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);

  // Open straight into the live camera + AR view once the board is calibrated.
  // First launch (nothing saved yet) goes to the guided calibration instead.
  useEffect(() => {
    const init = () => {
      const s = useStore.getState();
      setScreen(s.corners?.length === 4 && s.model ? 'game' : 'calibrate');
    };
    if (useStore.persist.hasHydrated()) {
      init();
      return;
    }
    return useStore.persist.onFinishHydration(init);
  }, []);

  if (!screen) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0b0f14', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {screen === 'home' && <HomeScreen go={setScreen} />}
      {screen === 'calibrate' && <CalibrateScreen go={setScreen} />}
      {screen === 'game' && <GameScreen go={setScreen} />}
    </>
  );
}
