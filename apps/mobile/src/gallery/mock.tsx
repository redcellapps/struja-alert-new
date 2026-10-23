import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText, RemainingText, StatusHero } from '../design/components';
import { useTheme } from '../design/theme';
import type { StatusKey } from '../design/tokens';
import { addDays, dayOfMonth, weekdayIndex } from '../format/time';

// Mock data for the development gallery (design review). Nothing here ships in a release build:
// the gallery route redirects away when `__DEV__` is false.
export const TODAY = '2026-11-03';
const HOUR = 3_600_000;
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function mockDays(t: (key: string) => string) {
  return [0, 1, 2, 3].map((n) => {
    const date = addDays(TODAY, n);
    const wd = t(`weekday.${WEEKDAY_KEYS[weekdayIndex(date)]}`);
    const hasOutage = n === 1 || n === 3;
    return {
      date,
      weekday: wd,
      dayOfMonth: dayOfMonth(date),
      hasOutage,
      status: (n === 1 ? 'imminent' : 'upcoming') as StatusKey,
      accessibilityLabel: `${wd}, ${dayOfMonth(date)}. ${hasOutage ? 'ima isključenja' : 'nema isključenja'}`,
    };
  });
}

/** The status hero in one state, from mock data. */
export function MockHero({
  status,
  big = 'display',
}: {
  status: StatusKey;
  big?: 'displayHuge' | 'display' | 'countdown';
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const on = colors.status[status].onFill;
  const address = 'Vojvode Mišića 34, Niš';
  const text = {
    clear: { headline: 'Sve u redu', detail: 'Nema najavljenih isključenja' },
    upcoming: { headline: 'Sutra bez struje', detail: 'Sutra 08:30–12:30' },
    imminent: { headline: 'Uskoro bez struje', detail: 'Počinje za' },
    active: { headline: 'Bez struje', detail: 'Povratak za' },
    past: { headline: 'Završeno', detail: 'Danas 08:30–12:30' },
  }[status];
  const remaining = status === 'active' ? 1 * HOUR + 12 * 60_000 + 5_000 : 5 * HOUR + 40 * 60_000;
  return (
    <StatusHero
      status={status}
      statusLabel={t(`statusShort.${status}`)}
      headline={text.headline}
      address={address}
      accessibilityLabel={`${text.headline}. ${address}`}
    >
      {status === 'imminent' || status === 'active' ? (
        <View style={{ gap: 2 }}>
          <AppText variant="label" color={on}>
            {text.detail}
          </AppText>
          <RemainingText
            variant={big}
            remainingMs={remaining}
            color={on}
            accessibilityLabel={
              status === 'active'
                ? 'Povratak struje za 1 čas i 12 minuta'
                : 'Počinje za 5 časova i 40 minuta'
            }
          />
        </View>
      ) : (
        <AppText
          variant="value"
          color={on}
          style={status === 'past' ? { textDecorationLine: 'line-through' } : undefined}
        >
          {text.detail}
        </AppText>
      )}
    </StatusHero>
  );
}
