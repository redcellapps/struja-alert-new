import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DEFAULT_QUIET_HOURS, NOTIFICATION_KINDS, MAX_ADDRESSES } from '@struja/shared';
import {
  AppText,
  Banner,
  Button,
  MessageForm,
  EmptyState,
  Screen,
  Segmented,
  SectionHeader,
  SkeletonCard,
  SmallButton,
  SwitchRow,
  TimeStepper,
} from '../design/components';
import { useLargeText } from '../design/largeText';
import { useTheme } from '../design/theme';
import { CARD_GAP, CARD_PADDING } from '../design/tokens';
import type { ExactAlarms } from '../notifications/exactAlarms';
import { ExactAlarmsRow, VendorCard } from '../notifications/VendorCard';
import type { Kind, NotificationPermission, SettingsValues } from '../store/settings';

export interface SettingsAddress {
  id: number;
  label: string | null;
  // "Vojvode Mišića 34", in the chosen script.
  name: string;
  primary: boolean;
  // A street can have a house number; a settlement cannot.
  canHaveNumber: boolean;
  hasNumber: boolean;
}

export interface SettingsViewProps {
  values: Pick<
    SettingsValues,
    'themeMode' | 'language' | 'script' | 'highContrast' | 'enabledKinds' | 'quietHours'
  >;
  onChange: (patch: Partial<SettingsViewProps['values']>) => void;
  permission: NotificationPermission;
  onOpenSystemSettings: () => void;
  // Exact alarms (Android 12+): the row shows only while they are not allowed.
  exactAlarms: ExactAlarms;
  onRequestExactAlarms: () => void;
  // The HONOR / Huawei advice card: shown on those phones only.
  vendorCard: boolean;
  onOpenAppLaunch: () => void;
  addresses: SettingsAddress[];
  // Where the list of addresses stands: still loading, failed (with nothing saved to show), or ready.
  addressesState: 'loading' | 'error' | 'ready';
  onRetryAddresses: () => void;
  // The last refresh failed but saved data is shown.
  offline: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onEditNumber: (addressId: number) => void;
  // These reject when the server did not accept the change.
  onMakePrimary: (addressId: number) => Promise<unknown>;
  onDeleteAddress: (addressId: number) => Promise<unknown>;
  onDeleteAll: () => Promise<unknown>;
  onSendFeedback: (message: string) => Promise<unknown>;
  onOpenEds: () => void;
  version: string;
}

const KIND_LABEL: Record<Kind, string> = {
  new: 'settings.kindNew',
  evening_before: 'settings.kindEvening',
  changed: 'settings.kindChanged',
  cancelled: 'settings.kindCancelled',
};

function Card({ children, gap = 16 }: { children: ReactNode; gap?: number }) {
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

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <View style={{ gap: CARD_GAP }}>
    <SectionHeader title={title} />
    {children}
  </View>
);

/** A confirmation for something that cannot be undone: the question, the red action, and Cancel. */
function Confirm(props: {
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  failed?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 12 }} accessibilityLiveRegion="polite">
      <AppText variant="bodyStrong">{props.question}</AppText>
      {props.failed ? (
        <AppText variant="bodyStrong" color={colors.chrome.error}>
          {props.failed}
        </AppText>
      ) : null}
      <Button
        label={props.confirmLabel}
        variant="danger"
        disabled={props.busy}
        onPress={props.onConfirm}
      />
      <Button label={props.cancelLabel} variant="secondary" fullWidth onPress={props.onCancel} />
    </View>
  );
}

function AddressRow({ address, props }: { address: SettingsAddress; props: SettingsViewProps }) {
  const { t } = useTranslation();
  const large = useLargeText();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>();

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setFailed(undefined);
    try {
      await action();
      setConfirming(false);
    } catch {
      setFailed(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card gap={12}>
      <View style={{ gap: 4 }}>
        {address.label ? (
          <AppText variant="label" color="textSecondary">
            {address.label}
          </AppText>
        ) : null}
        <AppText variant="bodyStrong">{address.name}</AppText>
      </View>
      {confirming ? (
        <Confirm
          question={t('settings.confirmDeleteAddress', { name: address.name })}
          confirmLabel={t('settings.delete')}
          cancelLabel={t('settings.cancel')}
          failed={failed}
          busy={busy}
          onConfirm={() =>
            void run(() => props.onDeleteAddress(address.id), t('settings.deleteAddressFailed'))
          }
          onCancel={() => {
            setConfirming(false);
            setFailed(undefined);
          }}
        />
      ) : (
        <View style={{ gap: 8 }}>
          {failed ? (
            <AppText variant="label" color="textSecondary">
              {failed}
            </AppText>
          ) : null}
          <View
            style={{
              flexDirection: large ? 'column' : 'row',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <SmallButton
              label={t('address.primary')}
              icon={{ ios: 'star.fill', android: 'star' }}
              selected={address.primary}
              accessibilityLabel={
                address.primary
                  ? `${t('address.primary')}: ${address.name}`
                  : `${t('settings.makePrimary')}: ${address.name}`
              }
              disabled={busy}
              onPress={
                address.primary
                  ? undefined
                  : () =>
                      void run(() => props.onMakePrimary(address.id), t('settings.actionFailed'))
              }
            />
            {address.canHaveNumber ? (
              <SmallButton
                label={address.hasNumber ? t('settings.changeNumber') : t('home.addNumber')}
                icon={{ ios: 'pencil', android: 'edit' }}
                accessibilityLabel={`${address.hasNumber ? t('settings.changeNumber') : t('home.addNumber')}: ${address.name}`}
                onPress={() => props.onEditNumber(address.id)}
              />
            ) : null}
            <SmallButton
              label={t('settings.delete')}
              icon={{ ios: 'trash.fill', android: 'delete' }}
              tone="danger"
              accessibilityLabel={`${t('settings.delete')}: ${address.name}`}
              onPress={() => setConfirming(true)}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

function DeleteAll({ onDeleteAll }: { onDeleteAll: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!confirming)
    return (
      <Button
        label={t('settings.deleteData')}
        variant="danger"
        onPress={() => setConfirming(true)}
      />
    );
  return (
    <Confirm
      question={t('settings.deleteDataBody')}
      confirmLabel={t('settings.deleteAll')}
      cancelLabel={t('settings.cancel')}
      failed={failed ? t('settings.deleteDataFailed') : undefined}
      busy={busy}
      onConfirm={() => {
        setBusy(true);
        setFailed(false);
        onDeleteAll()
          .catch(() => setFailed(true))
          .finally(() => setBusy(false));
      }}
      onCancel={() => {
        setConfirming(false);
        setFailed(false);
      }}
    />
  );
}

/** Podešavanja: appearance, notifications, addresses, privacy and the about section. */
export function SettingsView(props: SettingsViewProps) {
  const { t } = useTranslation();
  const { values, onChange } = props;
  const [licences, setLicences] = useState(false);

  const toggleKind = (kind: Kind, on: boolean) =>
    onChange({
      enabledKinds: on
        ? NOTIFICATION_KINDS.filter((k) => k === kind || values.enabledKinds.includes(k))
        : values.enabledKinds.filter((k) => k !== kind),
    });
  const quiet = values.quietHours;

  return (
    <Screen>
      <AppText variant="headline" accessibilityRole="header">
        {t('settings.title')}
      </AppText>
      {props.offline ? <Banner tone="offline" message={t('banner.offline')} /> : null}

      <Section title={t('settings.appearance')}>
        <Card>
          <View style={{ gap: 8 }}>
            <AppText variant="label" color="textSecondary">
              {t('settings.script')}
            </AppText>
            <Segmented
              accessibilityLabel={t('settings.script')}
              value={values.script}
              onChange={(script) => onChange({ script })}
              options={[
                { value: 'latn', label: 'Latinica' },
                { value: 'cyrl', label: 'Ћирилица' },
              ]}
            />
          </View>
          <View style={{ gap: 8 }}>
            <AppText variant="label" color="textSecondary">
              {t('settings.language')}
            </AppText>
            <Segmented
              accessibilityLabel={t('settings.language')}
              value={values.language}
              onChange={(language) => onChange({ language })}
              options={[
                { value: 'sr', label: values.script === 'cyrl' ? 'Српски' : 'Srpski' },
                { value: 'en', label: 'English' },
              ]}
            />
          </View>
          <View style={{ gap: 8 }}>
            <AppText variant="label" color="textSecondary">
              {t('settings.theme')}
            </AppText>
            <Segmented
              accessibilityLabel={t('settings.theme')}
              value={values.themeMode}
              onChange={(themeMode) => onChange({ themeMode })}
              options={[
                { value: 'system', label: t('settings.themeSystem') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'dark', label: t('settings.themeDark') },
              ]}
            />
          </View>
        </Card>
        <SwitchRow
          label={t('settings.highContrast')}
          description={t('settings.highContrastHint')}
          value={values.highContrast}
          onChange={(highContrast) => onChange({ highContrast })}
        />
      </Section>

      <Section title={t('settings.notifications')}>
        {props.permission === 'denied' ? (
          <Banner
            tone="warning"
            message={t('banner.notificationsOff')}
            actionLabel={t('banner.turnOn')}
            onAction={props.onOpenSystemSettings}
          />
        ) : props.permission === 'granted' ? (
          <AppText variant="label" color="textSecondary">
            {t('settings.notificationsOn')}
          </AppText>
        ) : null}
        <ExactAlarmsRow exactAlarms={props.exactAlarms} onRequest={props.onRequestExactAlarms} />
        {props.vendorCard ? (
          <VendorCard
            onOpenAppLaunch={props.onOpenAppLaunch}
            exactAlarms={props.exactAlarms}
            onRequestExactAlarms={props.onRequestExactAlarms}
          />
        ) : null}
        <Card gap={4}>
          <AppText variant="label" color="textSecondary">
            {t('settings.kindsTitle')}
          </AppText>
          {NOTIFICATION_KINDS.map((kind) => (
            <SwitchRow
              plain
              key={kind}
              label={t(KIND_LABEL[kind])}
              value={values.enabledKinds.includes(kind)}
              onChange={(on) => toggleKind(kind, on)}
            />
          ))}
        </Card>
        <Card>
          <SwitchRow
            plain
            label={t('settings.quietHours')}
            description={t('settings.quietHoursHint')}
            value={quiet !== null}
            onChange={(on) => onChange({ quietHours: on ? { ...DEFAULT_QUIET_HOURS } : null })}
          />
          {quiet ? (
            <View style={{ gap: 8 }}>
              <TimeStepper
                label={t('settings.quietFrom')}
                value={quiet.start}
                onChange={(start) => onChange({ quietHours: { ...quiet, start } })}
              />
              <TimeStepper
                label={t('settings.quietTo')}
                value={quiet.end}
                onChange={(end) => onChange({ quietHours: { ...quiet, end } })}
              />
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title={t('settings.addresses')}>
        {props.addressesState === 'loading' ? (
          <SkeletonCard lines={1} accessibilityLabel={t('state.loading')} />
        ) : null}
        {props.addressesState === 'error' ? (
          <EmptyState
            icon={{ ios: 'wifi.slash', android: 'cloud_off' }}
            title={t('home.loadError')}
            actionLabel={t('state.retry')}
            onAction={props.onRetryAddresses}
          />
        ) : null}
        {props.addressesState === 'ready' && props.addresses.length === 0 ? (
          <AppText variant="body" color="textSecondary">
            {t('settings.noAddresses')}
          </AppText>
        ) : null}
        {props.addresses.map((a) => (
          <AddressRow key={a.id} address={a} props={props} />
        ))}
        {props.canAdd ? (
          <Button
            label={t('home.addAddress')}
            variant="secondary"
            fullWidth
            onPress={props.onAdd}
          />
        ) : (
          <AppText variant="label" color="textSecondary">
            {t('settings.addressesHint', { max: MAX_ADDRESSES })}
          </AppText>
        )}
      </Section>

      <Section title={t('settings.privacy')}>
        <Card>
          <AppText variant="body" color="textSecondary">
            {t('settings.privacyBody')}
          </AppText>
          <DeleteAll onDeleteAll={props.onDeleteAll} />
        </Card>
      </Section>

      <Section title={t('settings.about')}>
        <Card>
          <AppText variant="bodyStrong">
            {t('settings.version', { version: props.version })}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {t('settings.aboutBody')}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {t('home.disclaimer')}
          </AppText>
          <Button
            label={t('settings.openEds')}
            variant="secondary"
            fullWidth
            onPress={props.onOpenEds}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: licences }}
            accessibilityLabel={t('settings.licences')}
            onPress={() => setLicences((v) => !v)}
            style={{ minHeight: 40, justifyContent: 'center' }}
          >
            <AppText variant="bodyStrong" color="link">
              {t('settings.licences')}
            </AppText>
          </Pressable>
          {licences ? (
            <AppText variant="body" color="textSecondary">
              {t('settings.licencesBody')}
            </AppText>
          ) : null}
          <MessageForm
            openLabel={t('settings.feedback')}
            hint={t('settings.feedbackHint')}
            sendLabel={t('settings.feedbackSend')}
            thanks={t('settings.feedbackThanks')}
            failedText={t('settings.feedbackFailed')}
            onSend={props.onSendFeedback}
          />
        </Card>
      </Section>
    </Screen>
  );
}
