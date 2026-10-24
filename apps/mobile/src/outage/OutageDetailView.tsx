import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { cyrillicToLatin } from '@struja/parser/transliterate';
import type { OutageDetailDto } from '@struja/shared';
import {
  AppText,
  Button,
  EmptyState,
  PossibleBadge,
  RemainingText,
  IconTile,
  MessageForm,
  RangeChips,
  Screen,
  SectionHeader,
  SheetHeader,
  SkeletonCard,
  StatusBadge,
  TimelineBar,
} from '../design/components';
import { useTheme } from '../design/theme';
import { CARD_GAP, CARD_PADDING, type StatusKey } from '../design/tokens';
import { belgradeDate, dayHour } from '../format/time';
import { durationShort, hoursUntil, spokenDuration } from '../home/format';
import { statusAt } from '../home/outlook';
import { dateLong, windowText } from './actions';
import { addressRanges, segmentForStreet, streetLine, type Segment } from './ranges';

export interface DetailAddress {
  subscriptionId: number;
  // "Kuća", or null.
  label: string | null;
  // The street (no number), in the chosen script, and the same for the whole address line.
  street: { latin: string; cyrillic: string };
  name: string;
  houseNumber: number | null;
  match: 'affected' | 'possible';
  reason: 'no_number' | 'partial' | 'unresolved' | null;
}

export interface OutageDetailViewProps {
  now: Date;
  script: 'latn' | 'cyrl';
  detail: OutageDetailDto | null;
  addresses: DetailAddress[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onAddNumber: (subscriptionId: number) => void;
  onClose: () => void;
  // "Prati": whether a street of the outage can be followed (it is in the street list and there is
  // room), is followed already, or neither; and the action.
  followState?: (segment: Segment) => 'can' | 'followed' | 'none';
  onFollow?: (segment: Segment) => void;
  onCalendar?: () => void;
  onShare: () => void;
  onOpenSource: () => void;
  // Rejects when the report could not be sent.
  onReport: (message: string) => Promise<unknown>;
}

function Card({ children, gap = 16 }: { children: React.ReactNode; gap?: number }) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.chrome.card,
        borderRadius: radius.xl,
        padding: CARD_PADDING,
        gap,
      }}
    >
      {children}
    </View>
  );
}

/** The outage detail: when, for how long, how it concerns the saved addresses, which streets, the source. */
export function OutageDetailView(props: OutageDetailViewProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { detail, now, script } = props;
  const [rawOpen, setRawOpen] = useState(false);

  if (props.loading)
    return (
      <Screen inset="none">
        <SheetHeader onClose={props.onClose} />
        <SkeletonCard lines={2} accessibilityLabel={t('state.loading')} />
        <SkeletonCard lines={3} accessibilityLabel={t('state.loading')} />
      </Screen>
    );
  if (props.failed || !detail)
    return (
      <Screen inset="none">
        <SheetHeader onClose={props.onClose} />
        <EmptyState
          icon={{ ios: 'wifi.slash', android: 'cloud_off' }}
          title={props.failed ? t('home.loadError') : t('detail.notFound')}
          actionLabel={props.failed ? t('state.retry') : undefined}
          onAction={props.onRetry}
        />
      </Screen>
    );

  const startMs = Date.parse(detail.startsAt);
  const endMs = Date.parse(detail.endsAt);
  const cancelled = detail.status === 'cancelled';
  const over = !cancelled && endMs <= now.getTime();
  const status: StatusKey = cancelled ? 'past' : over ? 'past' : statusAt(startMs, endMs, now);
  const statusLabel = cancelled
    ? t('status.cancelled')
    : over
      ? t('status.past')
      : t(`statusShort.${status}`);
  const s = colors.status[status];
  const today = belgradeDate(now);
  const isToday = detail.outageDate === today;
  // An outage that runs past midnight is drawn to the end of its day.
  const startHour = dayHour(detail.startsAt);
  const crossesMidnight = belgradeDate(new Date(detail.endsAt)) !== detail.outageDate;
  const endHour = crossesMidnight ? 24 : dayHour(detail.endsAt);
  const remaining = (status === 'active' ? endMs : startMs) - now.getTime();
  const spokenWindow = `${windowText(detail)}, ${dateLong(detail.outageDate, t)}`;
  const municipality =
    script === 'cyrl' ? detail.municipality : cyrillicToLatin(detail.municipality);

  return (
    <Screen inset="none">
      <SheetHeader onClose={props.onClose} />
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <StatusBadge status={status} label={statusLabel} />
          {!cancelled && !over && detail.mine.some((m) => m.match === 'possible') ? (
            <PossibleBadge label={t('home.possibleBadge')} />
          ) : null}
        </View>
        <AppText variant="headline" accessibilityRole="header">
          {dateLong(detail.outageDate, t)}
        </AppText>
        <AppText variant="label" color="textSecondary">
          {municipality}
        </AppText>
        {detail.status === 'changed' ? (
          <AppText variant="bodyStrong">{t('detail.changedNote')}</AppText>
        ) : null}
        {cancelled ? <AppText variant="bodyStrong">{t('detail.cancelledNote')}</AppText> : null}
      </View>

      <Card>
        <AppText variant="label" color="textSecondary">
          {t('detail.window')}
        </AppText>
        <View
          style={{ gap: 4 }}
          accessible
          accessibilityLabel={`${spokenWindow}. ${spokenDuration(endMs - startMs, t)}`}
        >
          <AppText
            variant="display"
            style={cancelled ? { textDecorationLine: 'line-through', color: s.mark } : undefined}
          >
            {windowText(detail)}
          </AppText>
          <AppText variant="bodyStrong" color="textSecondary">
            {t('detail.duration')}: {durationShort(endMs - startMs)}
          </AppText>
        </View>
        {!cancelled && !over ? (
          status === 'upcoming' ? (
            <View style={{ gap: 2 }}>
              <AppText variant="label" color="textSecondary">
                {t('detail.countdownStarts')}
              </AppText>
              <AppText variant="value">{hoursUntil(remaining)}</AppText>
            </View>
          ) : (
            <View style={{ gap: 2 }}>
              <AppText variant="label" color="textSecondary">
                {status === 'active' ? t('detail.countdownReturns') : t('detail.countdownStarts')}
              </AppText>
              <RemainingText
                variant="countdown"
                remainingMs={remaining}
                color={colors.chrome.text}
                accessibilityLabel={spokenDuration(remaining, t)}
              />
            </View>
          )
        ) : null}
        <TimelineBar
          startHour={startHour}
          endHour={endHour}
          nowHour={isToday ? dayHour(now.toISOString()) : undefined}
          status={status}
          accessibilityLabel={`${spokenWindow}`}
        />
      </Card>

      {props.addresses.map((a) => {
        const segment = segmentForStreet(detail.segments, a.street);
        const info = addressRanges(segment, a.houseNumber, a.match, a.reason, t);
        return (
          <Card key={a.subscriptionId}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <IconTile icon={{ ios: 'house.fill', android: 'home' }} />
              <View style={{ flex: 1 }}>
                <AppText variant="label" color="textSecondary">
                  {a.label ?? t('detail.forAddress')}
                </AppText>
                <AppText variant="bodyStrong">{a.name}</AppText>
              </View>
            </View>
            {info.chips.length > 0 ? (
              <RangeChips
                ranges={info.chips.map((c) => ({ label: c.label, contains: c.contains }))}
                note={info.note ?? undefined}
              />
            ) : info.note ? (
              <AppText variant="body" color="textSecondary">
                {info.note}
              </AppText>
            ) : null}
            {info.askForNumber ? (
              <Button
                label={t('home.addNumber')}
                variant="secondary"
                fullWidth
                onPress={() => props.onAddNumber(a.subscriptionId)}
              />
            ) : null}
          </Card>
        );
      })}

      <View style={{ gap: CARD_GAP }}>
        <SectionHeader title={t('detail.affectedStreets')} />
        <Card gap={12}>
          {detail.segments.map((seg, i) => {
            const line = streetLine(seg, script, t);
            const follow = props.followState?.(seg) ?? 'none';
            return (
              <View
                key={`${seg.raw}-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodyStrong">{line.title}</AppText>
                  {line.detail ? (
                    <AppText variant="label" color="textSecondary">
                      {line.detail}
                    </AppText>
                  ) : null}
                </View>
                {follow === 'can' ? (
                  <Button
                    label={t('upcoming.follow')}
                    accessibilityLabel={`${t('upcoming.follow')} ${line.title}`}
                    variant="secondary"
                    onPress={() => props.onFollow?.(seg)}
                  />
                ) : follow === 'followed' ? (
                  <AppText variant="label" color="textSecondary">
                    {t('upcoming.following')}
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </Card>
      </View>

      <Card gap={12}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rawOpen ? t('detail.hideRaw') : t('detail.showRaw')}
          accessibilityState={{ expanded: rawOpen }}
          onPress={() => setRawOpen((v) => !v)}
          style={{ minHeight: 40, justifyContent: 'center' }}
        >
          <AppText variant="bodyStrong" color="link">
            {rawOpen ? t('detail.hideRaw') : t('detail.showRaw')}
          </AppText>
        </Pressable>
        {rawOpen ? (
          <View style={{ gap: 6 }}>
            <AppText variant="label" color="textSecondary">
              {t('detail.rawText')}
            </AppText>
            <AppText variant="body" selectable>
              {detail.rawStreets}
            </AppText>
          </View>
        ) : null}
      </Card>

      <View style={{ gap: 12 }}>
        {props.onCalendar ? (
          <Button
            label={t('detail.addToCalendar')}
            variant="secondary"
            fullWidth
            onPress={props.onCalendar}
          />
        ) : null}
        <Button label={t('detail.share')} variant="secondary" fullWidth onPress={props.onShare} />
        <Button
          label={t('detail.openSource')}
          variant="secondary"
          fullWidth
          onPress={props.onOpenSource}
        />
        <MessageForm
          openLabel={t('detail.reportError')}
          hint={t('detail.reportHint')}
          sendLabel={t('detail.reportSend')}
          thanks={t('detail.reportThanks')}
          failedText={t('detail.reportFailed')}
          onSend={props.onReport}
        />
        <AppText variant="caption" color="textSecondary">
          {t('home.source')}
        </AppText>
      </View>
    </Screen>
  );
}
