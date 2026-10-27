import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pt } from '../lib/homography';
import type { ColorModel } from '../vision/scanner';
import type { EngineKind } from '../engine';

export type HintMode = 'mine' | 'always' | 'off';
export type Settings = {
  myColor: 'w' | 'b';
  hints: HintMode;
  depth: number;
  promo: 'q' | 'r' | 'b' | 'n';
  debug: boolean;
  engine: EngineKind;
  /** How many top moves to show in AR (1-3). */
  suggestions: number;
};

export const DEFAULT_SETTINGS: Settings = {
  myColor: 'w',
  hints: 'mine',
  depth: 14,
  promo: 'q',
  debug: false,
  engine: 'auto',
  suggestions: 3,
};

type State = {
  /** 4 board corners (a1, h1, h8, a8) as fractions (0..1) of the camera box. */
  corners: Pt[] | null;
  model: ColorModel | null;
  settings: Settings;
  moves: string[]; // SAN history of the current game
  setCorners: (c: Pt[] | null) => void;
  setModel: (m: ColorModel | null) => void;
  patchSettings: (p: Partial<Settings>) => void;
  pushMove: (san: string) => void;
  undoMove: () => void;
  newGame: (color: 'w' | 'b') => void;
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      corners: null,
      model: null,
      settings: DEFAULT_SETTINGS,
      moves: [],
      setCorners: (corners) => set({ corners, model: null }), // new corners => colours must be re-learned
      setModel: (model) => set({ model }),
      patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      pushMove: (san) => set((s) => ({ moves: [...s.moves, san] })),
      undoMove: () => set((s) => ({ moves: s.moves.slice(0, -1) })),
      newGame: (color) =>
        set((s) => ({ moves: [], settings: { ...s.settings, myColor: color } })),
    }),
    {
      name: 'ar-chess-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Older saved data may lack newer settings keys: merge them over the defaults.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<State>),
        settings: { ...current.settings, ...((persisted as Partial<State>)?.settings ?? {}) },
      }),
    }
  )
);
