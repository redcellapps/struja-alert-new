import { useTranslation } from 'react-i18next';
import { remainingLabel } from '../../format/duration';
import type { TypographyKey } from '../tokens';
import { AppText } from './AppText';

export interface RemainingTextProps {
  // Milliseconds until the event (or until it ends).
  remainingMs: number;
  color: string;
  // A spoken version for TalkBack ("1 čas 12 minuta").
  accessibilityLabel: string;
  // The size of the text (a display size by default).
  variant?: TypographyKey;
}

/**
 * How long is left, in hours and minutes ("1 h 12 min", "45 min", "manje od minuta"). It follows the
 * minute clock of the screen: no seconds, no rolling digits, nothing that jitters.
 */
export function RemainingText({
  remainingMs,
  color,
  accessibilityLabel,
  variant = 'display',
}: RemainingTextProps) {
  const { t } = useTranslation();
  return (
    <AppText
      variant={variant}
      color={color}
      accessibilityRole="timer"
      accessibilityLabel={accessibilityLabel}
      numberOfLines={1}
      adjustsFontSizeToFit
    >
      {remainingLabel(remainingMs, t('home.lessThanMinute'))}
    </AppText>
  );
}
