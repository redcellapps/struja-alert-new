import { SymbolView, type SymbolViewProps } from 'expo-symbols';

export interface IconProps {
  name: { ios: string; android: string };
  size?: number;
  color: string;
}

/** Material Symbols on Android, SF Symbols on iOS (expo-symbols). Decorative: hidden from TalkBack. */
export function Icon({ name, size = 24, color }: IconProps) {
  return (
    <SymbolView
      name={name as unknown as SymbolViewProps['name']}
      size={size}
      tintColor={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
