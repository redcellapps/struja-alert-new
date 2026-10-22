import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';

export interface TextFieldProps extends Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'placeholder'
  | 'keyboardType'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'returnKeyType'
  | 'maxLength'
  | 'onSubmitEditing'
  | 'autoFocus'
> {
  label: string;
  // Shown under the field in the error colour; the field is also announced as invalid.
  error?: string;
}

/** A filled input (card fill, radius 16, 56 high) with its label above. */
export function TextField({ label, error, ...input }: TextFieldProps) {
  const { colors, radius, fonts } = useTheme();
  const c = colors.chrome;
  return (
    <View style={styles.wrap}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <TextInput
        {...input}
        accessibilityLabel={label}
        allowFontScaling
        maxFontSizeMultiplier={2}
        placeholderTextColor={c.textSecondary}
        selectionColor={c.link}
        cursorColor={c.link}
        style={{
          minHeight: Math.max(56, MIN_TOUCH),
          borderRadius: radius.md,
          paddingHorizontal: 16,
          backgroundColor: c.card,
          color: c.text,
          fontFamily: fonts.text['500'],
          fontSize: 17,
        }}
      />
      {error ? (
        <AppText variant="label" color={c.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 8 } });
