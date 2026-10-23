import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { Icon } from './Icon';

/**
 * The top of a bottom sheet: a grab handle in the middle and a close button (an X) on the right, with
 * a spoken label for TalkBack. Android's own sheet draws no handle, so the screen draws it.
 */
export function SheetHeader({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const c = colors.chrome;
  return (
    <View style={styles.row}>
      <View style={[styles.handle, { backgroundColor: c.outline }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('state.close')}
        onPress={onClose}
        hitSlop={6}
        style={({ pressed }) => [
          styles.close,
          {
            backgroundColor: pressed ? c.outline : c.raised,
            minHeight: MIN_TOUCH,
            minWidth: MIN_TOUCH,
          },
        ]}
      >
        <Icon name={{ ios: 'xmark', android: 'close' }} size={22} color={c.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, justifyContent: 'center', alignItems: 'flex-end' },
  handle: {
    position: 'absolute',
    top: 2,
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  close: { borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
