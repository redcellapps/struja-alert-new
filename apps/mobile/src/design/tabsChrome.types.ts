import type { ComponentProps } from 'react';
import type { NativeTabs } from 'expo-router/native-tabs';

/** The tab bar props that differ per platform (`tabsChrome.ts` is Android, `tabsChrome.ios.ts` is iOS). */
export type TabsChrome = Pick<
  ComponentProps<typeof NativeTabs>,
  | 'backgroundColor'
  | 'iconColor'
  | 'labelStyle'
  | 'indicatorColor'
  | 'rippleColor'
  | 'labelVisibilityMode'
>;
