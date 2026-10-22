import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AddressCard, AppText, BentoTile, DayStrip, SectionHeader } from '../design/components';
import { CARD_GAP } from '../design/tokens';
import { MockHero, mockDays, TODAY } from './mock';

/** A composed Početna from mock data: hero, day strip, two bento tiles, three address cards. */
export function HomePreview() {
  const { t } = useTranslation();
  const [day, setDay] = useState(TODAY);
  return (
    <View style={{ gap: 28 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="label" color="textSecondary">
          Dobro jutro
        </AppText>
        <AppText variant="headline">Početna</AppText>
      </View>

      <View style={{ gap: CARD_GAP }}>
        <MockHero status="imminent" />
        <DayStrip days={mockDays(t)} selected={day} onSelect={setDay} />
        <View style={{ flexDirection: 'row', gap: CARD_GAP }}>
          <BentoTile
            icon={{ ios: 'clock.fill', android: 'schedule' }}
            label="Sledeće"
            value="08:30"
            caption="Sutra"
            accessibilityLabel="Sledeće isključenje sutra u 8:30"
          />
          <BentoTile
            icon={{ ios: 'timer', android: 'timer' }}
            label="Trajanje"
            value="4 h"
            caption="08:30–12:30"
            accessibilityLabel="Trajanje isključenja 4 časa, od 8:30 do 12:30"
          />
        </View>
      </View>

      <View style={{ gap: CARD_GAP }}>
        <SectionHeader title="Adrese" trailing={t('outages.count', { count: 2 })} />
        <AddressCard
          label="Kuća"
          primary
          primaryLabel={t('address.primary')}
          address="Vojvode Mišića 34"
          status="imminent"
          statusLabel={t('statusShort.imminent')}
          time="08:30–12:30"
          summary="Sutra · 4 h bez struje"
          accessibilityLabel="Kuća, Vojvode Mišića 34. Struje neće biti sutra od 8:30 do 12:30."
        />
        <AddressCard
          label="Posao"
          address="Bulevar Nemanjića 12"
          status="upcoming"
          statusLabel={t('statusShort.upcoming')}
          time="Petak 09:00–13:00"
          summary="Za 3 dana · 4 h bez struje"
          accessibilityLabel="Posao, Bulevar Nemanjića 12. Najavljeno isključenje u petak od 9 do 13 časova."
        />
        <AddressCard
          label="Roditelji"
          address="Studenička 7"
          status="clear"
          statusLabel={t('statusShort.clear')}
          summary={t('status.clear')}
          accessibilityLabel="Roditelji, Studenička 7. Nema najavljenih isključenja."
        />
      </View>

      <View style={{ gap: 4 }}>
        <AppText variant="caption" color="textSecondary">
          Ažurirano pre 12 min
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {t('home.source')} · {t('home.disclaimer')}
        </AppText>
      </View>
    </View>
  );
}
