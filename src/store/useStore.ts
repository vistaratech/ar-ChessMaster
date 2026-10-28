import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pt } from '../lib/homography';
import { ColorModel, DEFAULT_COLOR_MODEL } from '../vision/scanner';
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

/**
 * Board corners in physical order a1, h1, h8, a8 as fractions of the camera box.
 * The default puts Black at the bottom (the usual phone-on-a-stand view).
 */
export const DEFAULT_CORNERS: Pt[] = [
  { x: 0.88, y: 0.15 },
  { x: 0.12, y: 0.15 },
  { x: 0.12, y: 0.85 },
  { x: 0.88, y: 0.85 },
];

export const DEFAULT_SETTINGS: Settings = {
  myColor: 'b',
  hints: 'mine',
  depth: 14,
  promo: 'q',
  debug: false,
  engine: 'auto',
  /** 1 = draw only the best move; 2-3 also ring the engine's alternative destinations. */
  suggestions: 1,
};

type State = {
  /** 4 board corners in physical board order a1, h1, h8, a8 as fractions (0..1) of the camera box. */
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
          settings: { ...s.settings, myColor: color },
        })),
    }),
    {
      name: 'ar-chess-v2',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: (persisted: unknown, version) => {
        const p = (persisted as Partial<State> & { settings?: { perspective?: 'w' | 'b' } }) ?? {};
        if (version < 2 && p.corners && p.corners.length === 4) {
          const oldSide = p.settings?.perspective ?? p.settings?.myColor;
          if (oldSide === 'b') {
            // Old builds stored corners bottom-left, bottom-right, top-right, top-left.
            // New builds store a1, h1, h8, a8, so a Black-side board rotates by 180 degrees.
            return {
              ...p,
              corners: [p.corners[2], p.corners[3], p.corners[0], p.corners[1]],
            };
          }
        }
        return p;
      },
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
          },
        };
      },
    }
  )
);
