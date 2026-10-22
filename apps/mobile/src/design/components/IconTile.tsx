import { View } from 'react-native';
import { useTheme } from '../theme';
import type { IconName } from '../tokens';
import { Icon } from './Icon';

/** A rounded square with an icon: the lead of banners, empty states and settings rows. */
export function IconTile({
  icon,
  color,
  size = 44,
}: {
  icon: IconName;
  color?: string;
  size?: number;
}) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: colors.chrome.raised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.55)} color={color ?? colors.chrome.text} />
    </View>
  );
}
