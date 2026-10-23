import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { Icon } from './Icon';

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  // Placeholder and spoken label ("Pretraži ulicu").
  label: string;
}

/** A filled search box: a magnifier, the text, and a clear button once there is text. */
export function SearchField({ value, onChangeText, label }: SearchFieldProps) {
  const { t } = useTranslation();
  const { colors, radius, fonts } = useTheme();
  const c = colors.chrome;
  return (
    <View
      style={[
        styles.box,
        { backgroundColor: c.card, borderRadius: radius.md, minHeight: Math.max(56, MIN_TOUCH) },
      ]}
    >
      <Icon
        name={{ ios: 'magnifyingglass', android: 'search' }}
        size={22}
        color={c.textSecondary}
      />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={c.textSecondary}
        selectionColor={c.link}
        cursorColor={c.link}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        allowFontScaling
        maxFontSizeMultiplier={2}
        style={[styles.input, { color: c.text, fontFamily: fonts.text['500'] }]}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('state.clear')}
          onPress={() => onChangeText('')}
          hitSlop={8}
          style={styles.clear}
        >
          <Icon
            name={{ ios: 'xmark.circle.fill', android: 'cancel' }}
            size={22}
            color={c.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  input: { flex: 1, fontSize: 17, paddingVertical: 12 },
  clear: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
});
