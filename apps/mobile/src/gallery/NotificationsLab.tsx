import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { View } from 'react-native';
import {
  channelForKind,
  OUTAGE_CATEGORY,
  URGENT_CHANNEL,
  type NotificationChannelId,
} from '@struja/shared';
import type { AddressOutageDto } from '@struja/shared';
import { AppText, Button, SectionHeader } from '../design/components';
import { MY_OUTAGES_KEY } from '../home/useHomeData';
import { queryClient } from '../query/instance';

// Development only (the gallery): posts local notifications shaped like the server's pushes, so the
// channels, the "Detalji" / "Dodaj u kalendar" buttons, the grouping by address and the deep link can
// be tried on the emulator without a server or FCM. Delayed a few seconds: enough to leave the app.
// The outage and address ids are taken from the app's own data (the first upcoming outage of a saved
// address), so the tap lands on a real detail against any server; the mock's 1001/1 otherwise.
const DELAY_SECONDS = 4;

interface Sample {
  label: string;
  channel: NotificationChannelId;
  title: string;
  body: string;
  outageId: number;
  address: string;
}

const SAMPLES: Sample[] = [
  {
    label: 'Nova',
    channel: channelForKind('new'),
    title: 'Isključenje struje: Trebinjska, sre 11:00–16:00',
    body: 'Trebinjska 34 · Palilula',
    outageId: 1001,
    address: 'address-1',
  },
  {
    label: 'Hitno (počinje za < 2 h)',
    channel: URGENT_CHANNEL,
    title: 'Isključenje struje: Trebinjska, danas 15:00–17:00',
    body: 'Počinje za 1 h 40 min · Trebinjska 34',
    outageId: 1001,
    address: 'address-1',
  },
  {
    label: 'Izmena',
    channel: channelForKind('changed'),
    title: 'Izmena: Trebinjska, novo vreme 12:00–15:00',
    body: 'Trebinjska 34',
    outageId: 1001,
    address: 'address-1',
  },
  {
    label: 'Otkazano (druga adresa)',
    channel: channelForKind('cancelled'),
    title: 'Otkazano: isključenje čet, Vojvode Putnika',
    body: 'Vojvode Putnika 10',
    outageId: 1002,
    address: 'address-2',
  },
];

function currentIds(): { outageId: number; subscriptionId: number } {
  const mine = queryClient.getQueryData<AddressOutageDto[]>(MY_OUTAGES_KEY);
  const first = mine?.[0];
  return first
    ? { outageId: first.id, subscriptionId: first.subscriptionId }
    : { outageId: 1001, subscriptionId: 1 };
}

async function post(sample: Sample, seconds = DELAY_SECONDS): Promise<void> {
  const ids = currentIds();
  const outageId = sample.address === 'address-1' ? ids.outageId : sample.outageId;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: sample.title,
      body: sample.body,
      categoryIdentifier: OUTAGE_CATEGORY,
      threadIdentifier: sample.address,
      data: {
        outageId,
        subscriptionId: ids.subscriptionId,
        kind: sample.channel,
        link: `strujaalert://outage/${outageId}`,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: sample.channel,
    },
  });
}

export function NotificationsLab() {
  const [status, setStatus] = useState('');
  const run = (label: string, work: () => Promise<void>) => () => {
    setStatus(`${label}: za ${DELAY_SECONDS} s (izađite iz aplikacije)`);
    work().catch((e: unknown) =>
      setStatus(`${label}: ${e instanceof Error ? e.message : String(e)}`),
    );
  };
  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title="Obaveštenja (probna, lokalna)" />
      <AppText variant="body" color="textSecondary">
        Svako stiže na svoj kanal, sa dugmadima „Detalji“ i „Dodaj u kalendar“, grupisano po adresi.
      </AppText>
      {SAMPLES.map((s) => (
        <Button
          key={s.label}
          label={s.label}
          variant="secondary"
          onPress={run(s.label, () => post(s))}
        />
      ))}
      <Button
        label="Tri za jednu adresu (grupa)"
        variant="secondary"
        onPress={run('Grupa', async () => {
          await post(SAMPLES[0]!, DELAY_SECONDS);
          await post(SAMPLES[1]!, DELAY_SECONDS + 1);
          await post(SAMPLES[2]!, DELAY_SECONDS + 2);
        })}
      />
      <Button
        label="Obriši sve"
        variant="text"
        onPress={run('Obrisano', async () => {
          await Notifications.cancelAllScheduledNotificationsAsync();
          await Notifications.dismissAllNotificationsAsync();
        })}
      />
      {status ? (
        <AppText variant="label" color="textSecondary">
          {status}
        </AppText>
      ) : null}
    </View>
  );
}
