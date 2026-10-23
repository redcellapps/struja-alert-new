import type { SubscriptionDto } from '@struja/shared';
import type { Endpoints } from '../api/endpoints';
import { useAddresses } from '../store/addresses';

/**
 * Adds a house number to a saved address ("Dodaj broj"): on the server first, then on the device, so a
 * failed save changes neither. The server answers with the outages for the address again, now with
 * "affected" or "not affected" instead of "possible".
 */
export async function saveHouseNumber(
  api: Pick<Endpoints, 'patchSubscription'>,
  subscription: SubscriptionDto,
  number: { houseNumber: number; houseSuffix?: string },
) {
  const result = await api.patchSubscription(subscription.id, {
    houseNumber: number.houseNumber,
    houseSuffix: number.houseSuffix ?? null,
  });
  useAddresses.getState().setHouseNumber(
    {
      streetId: subscription.streetId,
      settlementId: subscription.settlementId,
      houseNumber: subscription.houseNumber,
      label: subscription.label,
    },
    number,
  );
  return result;
}
