import * as Notifications from 'expo-notifications';
import { NOTIFICATION_CHANNELS, OUTAGE_CATEGORY } from '@struja/shared';
import { i18next, initI18n, setLocale } from '../src/i18n';
import {
  categoryActions,
  channelDefinitions,
  ensureCategories,
  ensureChannels,
} from '../src/notifications/channels';
import { hrefForTarget, targetOfResponse } from '../src/notifications/respond';
import { easProjectId, realPushToken } from '../src/notifications/token';

const t = i18next.t.bind(i18next);
const mocked = jest.mocked(Notifications);

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
afterEach(() => jest.clearAllMocks());

describe('Android channels', () => {
  it('has one channel per kind and "hitno", with the ids the server puts in the push', () => {
    const ids = channelDefinitions(t).map((c) => c.id);
    expect(ids).toEqual([...NOTIFICATION_CHANNELS]);
    expect(ids).toEqual(['new', 'evening_before', 'changed', 'cancelled', 'hitno']);
  });

  it('names them in Serbian, "hitno" high and the rest default, none bypassing Do Not Disturb', () => {
    const byId = Object.fromEntries(channelDefinitions(t).map((c) => [c.id, c.input]));
    expect(byId['new']?.name).toBe('Nova isključenja');
    expect(byId['evening_before']?.name).toBe('Podsetnik uveče');
    expect(byId['changed']?.name).toBe('Izmene');
    expect(byId['cancelled']?.name).toBe('Otkazano');
    expect(byId['hitno']).toMatchObject({
      name: 'Hitno',
      importance: Notifications.AndroidImportance.HIGH,
      bypassDnd: false,
    });
    expect(byId['hitno']?.description).toContain('2 sata');
    for (const id of ['new', 'evening_before', 'changed', 'cancelled']) {
      expect(byId[id]?.importance).toBe(Notifications.AndroidImportance.DEFAULT);
    }
  });

  it('follows the script and the language (Cyrillic, English)', async () => {
    await setLocale('sr', 'cyrl');
    expect(channelDefinitions(t).find((c) => c.id === 'hitno')?.input.name).toBe('Хитно');
    await setLocale('en', 'latn');
    expect(channelDefinitions(t).find((c) => c.id === 'hitno')?.input.name).toBe('Urgent');
    await setLocale('sr', 'latn');
  });

  it('creates every channel on the device', async () => {
    await ensureChannels(t);
    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledTimes(NOTIFICATION_CHANNELS.length);
    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith(
      'hitno',
      expect.objectContaining({ name: 'Hitno' }),
    );
  });
});

describe('the "outage" category', () => {
  it('has the two buttons, both opening the app (the calendar needs an activity)', async () => {
    const actions = categoryActions(t);
    expect(actions.map((a) => [a.identifier, a.buttonTitle])).toEqual([
      ['detalji', 'Detalji'],
      ['kalendar', 'Dodaj u kalendar'],
    ]);
    expect(actions.every((a) => a.options?.opensAppToForeground)).toBe(true);
    await ensureCategories(t);
    expect(mocked.setNotificationCategoryAsync).toHaveBeenCalledWith(OUTAGE_CATEGORY, actions);
  });
});

describe('where a tap leads', () => {
  const response = (
    data: Record<string, unknown>,
    actionIdentifier = 'expo.modules.notifications.actions.DEFAULT',
  ) => ({
    actionIdentifier,
    notification: { request: { content: { data } } },
  });

  it('opens the outage of the push, with the address, from the data', () => {
    const target = targetOfResponse(response({ outageId: 7, subscriptionId: 3, kind: 'new' }));
    expect(target).toEqual({ outageId: 7, subscriptionId: 3, calendar: false });
    expect(hrefForTarget(target!)).toEqual({
      pathname: '/outage/[id]',
      params: { id: '7', addressId: '3' },
    });
  });

  it('falls back to the deep link, and takes ids that arrive as strings', () => {
    expect(targetOfResponse(response({ link: 'strujaalert://outage/42' }))?.outageId).toBe(42);
    expect(targetOfResponse(response({ outageId: '9', subscriptionId: '4' }))).toEqual({
      outageId: 9,
      subscriptionId: 4,
      calendar: false,
    });
  });

  it('"Dodaj u kalendar" opens the detail with the calendar over it', () => {
    const target = targetOfResponse(response({ outageId: 7 }, 'kalendar'));
    expect(target?.calendar).toBe(true);
    expect(hrefForTarget(target!).params).toEqual({ id: '7', calendar: '1' });
  });

  it('"Detalji" is a plain open', () => {
    expect(targetOfResponse(response({ outageId: 7 }, 'detalji'))?.calendar).toBe(false);
  });

  it('ignores a notification that is not about an outage', () => {
    expect(targetOfResponse(response({}))).toBeNull();
    expect(targetOfResponse(response({ outageId: -1 }))).toBeNull();
    expect(targetOfResponse(response({ link: 'https://example.test' }))).toBeNull();
  });
});

describe('the push token', () => {
  it('is null without an EAS project id (the build keeps its development token)', async () => {
    expect(easProjectId()).toBeNull();
    expect(await realPushToken()).toBeNull();
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });
});
