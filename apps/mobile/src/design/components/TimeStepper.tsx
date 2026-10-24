import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

const STEP = 30;
const DAY = 24 * 60;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const toText = (minutes: number) => {
  const wrapped = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/** The time half an hour later (or earlier with a negative step), around midnight. */
export const shiftTime = (hhmm: string, steps: number): string =>
  toText(toMinutes(hhmm) + steps * STEP);

export interface TimeStepperProps {
  // "Od", "Do".
  label: string;
  // "22:00"
  value: string;
  onChange: (next: string) => void;
}

/** A time of day moved half an hour at a time with a minus and a plus button: no picker dialog. */
export function TimeStepper({ label, value, onChange }: TimeStepperProps) {
  const { t } = useTranslation();
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  const move = (steps: number) => {
    haptics.selection();
    onChange(shiftTime(value, steps));
  };
  const button = (steps: number, name: string, icon: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${name}`}
      onPress={() => move(steps)}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? c.outline : c.raised, borderRadius: radius.md },
      ]}
    >
      <Icon name={{ ios: steps < 0 ? 'minus' : 'plus', android: icon }} size={22} color={c.text} />
    </Pressable>
  );
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`${label} ${value}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => move(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={styles.row}
    >
      <AppText variant="label" color="textSecondary" style={styles.label}>
        {label}
      </AppText>
      {button(-1, t('settings.earlier'), 'remove')}
      <AppText variant="value" style={styles.value}>
        {value}
      </AppText>
      {button(1, t('settings.later'), 'add')}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { minWidth: 36 },
  value: { minWidth: 92, textAlign: 'center' },
  button: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
