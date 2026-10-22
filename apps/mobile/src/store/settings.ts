import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_QUIET_HOURS, NOTIFICATION_KINDS, type QuietHoursDto } from '@struja/shared';
import { zustandStorage } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Language = 'sr' | 'en';
export type Script = 'latn' | 'cyrl';
export type Kind = (typeof NOTIFICATION_KINDS)[number];

export interface SettingsState {
  themeMode: ThemeMode;
  language: Language;
  script: Script;
  highContrast: boolean;
  enabledKinds: Kind[];
  quietHours: QuietHoursDto | null;
  onboarded: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      language: 'sr',
      script: 'latn',
      highContrast: false,
      enabledKinds: [...NOTIFICATION_KINDS],
      quietHours: { ...DEFAULT_QUIET_HOURS },
      onboarded: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => zustandStorage),
      version: 1,
    },
  ),
);
