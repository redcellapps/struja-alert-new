import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useSettings } from '../store/settings';
import {
  DEFAULT_FONT,
  fontSets,
  motion,
  palettes,
  radius,
  spacing,
  typography,
  type ContrastLevel,
  type FontSet,
  type FontSetKey,
  type Palette,
  type ThemeName,
} from './tokens';

export interface Theme {
  name: ThemeName;
  contrast: ContrastLevel;
  colors: Palette;
  fontKey: FontSetKey;
  fonts: FontSet;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  motion: typeof motion;
}

export function buildTheme(
  name: ThemeName,
  contrast: ContrastLevel = 'standard',
  fontKey: FontSetKey = DEFAULT_FONT,
): Theme {
  return {
    name,
    contrast,
    colors: palettes[contrast][name],
    fontKey,
    fonts: fontSets[fontKey],
    spacing,
    radius,
    typography,
    motion,
  };
}

const ThemeContext = createContext<Theme>(buildTheme('light'));

export function ThemeProvider({ children, override }: { children: ReactNode; override?: Theme }) {
  const system = useColorScheme();
  const mode = useSettings((s) => s.themeMode);
  const highContrast = useSettings((s) => s.highContrast);
  const theme = useMemo(() => {
    if (override) return override;
    const name: ThemeName = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
    return buildTheme(name, highContrast ? 'high' : 'standard');
  }, [override, mode, system, highContrast]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);
