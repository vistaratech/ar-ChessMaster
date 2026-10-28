import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pt } from '../lib/homography';
import { ColorModel, DEFAULT_COLOR_MODEL } from '../vision/scanner';
import type { EngineKind } from '../engine';

export type HintMode = 'mine' | 'always' | 'off';
export type Settings = {
  myColor: 'w' | 'b';
  perspective: 'w' | 'b';
  hints: HintMode;
  depth: number;
  promo: 'q' | 'r' | 'b' | 'n';
  debug: boolean;
  engine: EngineKind;
  /** How many top moves to show in AR (1-3). */
  suggestions: number;
};

/** Sensible default 4 corners placing the 8x8 grid centered in the camera view. */
export const DEFAULT_CORNERS: Pt[] = [
  { x: 0.12, y: 0.85 }, // bottom-left
  { x: 0.88, y: 0.85 }, // bottom-right
  { x: 0.88, y: 0.15 }, // top-right
  { x: 0.12, y: 0.15 }, // top-left
];

export const DEFAULT_SETTINGS: Settings = {
  myColor: 'b',
  perspective: 'b',
  hints: 'mine',
  depth: 14,
  promo: 'q',
  debug: false,
  engine: 'auto',
  suggestions: 2,
};

type State = {
  /** 4 board corners (bottom-left, bottom-right, top-right, top-left) as fractions (0..1) of the camera box. */
  corners: Pt[];
  model: ColorModel;
  settings: Settings;
  moves: string[]; // SAN history of the current game
  setCorners: (c: Pt[] | null) => void;
  resetCorners: () => void;
  setModel: (m: ColorModel) => void;
  patchSettings: (p: Partial<Settings>) => void;
  pushMove: (san: string) => void;
  undoMove: () => void;
  newGame: (color: 'w' | 'b') => void;
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      corners: DEFAULT_CORNERS,
      model: DEFAULT_COLOR_MODEL,
      settings: DEFAULT_SETTINGS,
      moves: [],
      setCorners: (corners) => set((s) => ({ corners: corners ?? DEFAULT_CORNERS, model: s.model ?? DEFAULT_COLOR_MODEL })),
      resetCorners: () => set({ corners: DEFAULT_CORNERS }),
      setModel: (model) => set({ model }),
      patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      pushMove: (san) => set((s) => ({ moves: [...s.moves, san] })),
      undoMove: () => set((s) => ({ moves: s.moves.slice(0, -1) })),
      newGame: (color) =>
        set((s) => ({
          moves: [],
          settings: { ...s.settings, myColor: color, perspective: color },
        })),
    }),
    {
      name: 'ar-chess-v2',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) => {
        const p = (persisted as Partial<State>) ?? {};
        const corners = p.corners && p.corners.length === 4 ? p.corners : current.corners;
        const model = p.model ?? current.model ?? DEFAULT_COLOR_MODEL;
        return {
          ...current,
          ...p,
          corners,
          model,
          settings: {
            ...current.settings,
            ...(p.settings ?? {}),
            perspective: p.settings?.perspective ?? p.settings?.myColor ?? current.settings.myColor,
          },
        };
      },
    }
  )
);
