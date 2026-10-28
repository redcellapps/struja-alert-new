import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { NOTIFICATION_ACTIONS } from '@struja/shared';

export interface NotificationTarget {
  outageId: number;
  subscriptionId: number | null;
  // "Dodaj u kalendar" was pressed: open the detail and then the calendar.
  calendar: boolean;
}

// The data the server puts in every push (apps/server/src/notify/plan.ts).
interface PushData {
  outageId?: unknown;
  subscriptionId?: unknown;
  link?: unknown;
}

const asId = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0
    ? v
    : typeof v === 'string' && /^\d+$/.test(v)
      ? Number(v)
      : null;

/**
 * Where a tap on a notification (or on one of its buttons) leads. The outage id comes from the data,
 * or from the deep link `strujaalert://outage/<id>` when the data has none. Null when the notification
 * is not about an outage (nothing to open but the app).
 */
export function targetOfResponse(response: {
  actionIdentifier: string;
  notification: { request: { content: { data?: unknown } } };
}): NotificationTarget | null {
  const data = (response.notification.request.content.data ?? {}) as PushData;
  const fromLink =
    typeof data.link === 'string'
      ? /^strujaalert:\/\/outage\/(\d+)/.exec(data.link)?.[1]
      : undefined;
  const outageId = asId(data.outageId) ?? asId(fromLink);
  if (outageId === null) return null;
  return {
    outageId,
    subscriptionId: asId(data.subscriptionId),
    calendar: response.actionIdentifier === NOTIFICATION_ACTIONS.calendar,
  };
}

export function hrefForTarget(target: NotificationTarget): {
  pathname: '/outage/[id]';
  params: Record<string, string>;
} {
  return {
    pathname: '/outage/[id]',
    params: {
      id: String(target.outageId),
      ...(target.subscriptionId !== null ? { addressId: String(target.subscriptionId) } : {}),
      ...(target.calendar ? { calendar: '1' } : {}),
    },
  };
}

/**
 * Opens the outage detail when the person taps a notification or one of its buttons: while the app
 * runs, and for the tap that started the app (cold start from the shade), once.
 */
export function useNotificationResponses(router: {
  push: (href: ReturnType<typeof hrefForTarget>) => void;
}): void {
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (handled.current === key) return;
      handled.current = key;
      const target = targetOfResponse(response);
      if (target) router.push(hrefForTarget(target));
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) open(last);
    });
    return () => sub.remove();
  }, [router]);
}
