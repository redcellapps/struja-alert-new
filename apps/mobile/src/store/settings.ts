import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_QUIET_HOURS, NOTIFICATION_KINDS, type QuietHoursDto } from '@struja/shared';
import { zustandStorage } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Language = 'sr' | 'en';
export type Script = 'latn' | 'cyrl';
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';
export type Kind = (typeof NOTIFICATION_KINDS)[number];

export interface SettingsState {
  themeMode: ThemeMode;
  language: Language;
  script: Script;
  highContrast: boolean;
  enabledKinds: Kind[];
  quietHours: QuietHoursDto | null;
  onboarded: boolean;
  // What the system said the last time we asked (Android 13+ and iOS ask at runtime).
  notificationPermission: NotificationPermission;
  set: (patch: Partial<SettingsValues>) => void;
  // Back to the factory settings ("delete all my data").
  reset: () => void;
}

export type SettingsValues = Omit<SettingsState, 'set' | 'reset'>;

export const DEFAULT_SETTINGS: SettingsValues = {
  themeMode: 'system',
  language: 'sr',
  script: 'latn',
  highContrast: false,
  enabledKinds: [...NOTIFICATION_KINDS],
  quietHours: { ...DEFAULT_QUIET_HOURS },
  onboarded: false,
  notificationPermission: 'undetermined',
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_SETTINGS, enabledKinds: [...NOTIFICATION_KINDS] }),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => zustandStorage),
      version: 1,
    },
  ),
);
