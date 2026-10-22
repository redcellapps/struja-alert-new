import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, Text } from 'react-native';
import type { IconName } from '../tokens';

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
}

// Material Symbols Rounded, filled, weight 400: one file, embedded by the expo-font plugin. The
// glyph is picked by its ligature name ("bolt", "power_off").
const MATERIAL = 'MaterialSymbolsRounded_400Regular_Filled';

/** Decorative icon (hidden from TalkBack): Material Symbols Rounded on Android, SF Symbols on iOS. */
export function Icon({ name, size = 24, color }: IconProps) {
  if (Platform.OS === 'android') {
    return (
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        allowFontScaling={false}
        style={{
          fontFamily: MATERIAL,
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
          color,
          textAlign: 'center',
          includeFontPadding: false,
        }}
      >
        {name.android}
      </Text>
    );
  }
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
