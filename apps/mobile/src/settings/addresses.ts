import type { SubscriptionDto } from '@struja/shared';
import type { Endpoints } from '../api/endpoints';
import { useAddresses, type AddressMatch } from '../store/addresses';

/** How the device's list describes a server address, to find it there. */
export const matchOf = (sub: SubscriptionDto): AddressMatch => ({
  streetId: sub.streetId,
  settlementId: sub.settlementId,
  houseNumber: sub.houseNumber,
  label: sub.label,
});

/** Makes an address the primary one: on the server first, then on the device. */
export async function makePrimary(
  client: Pick<Endpoints, 'patchSubscription'>,
  sub: SubscriptionDto,
): Promise<void> {
  await client.patchSubscription(sub.id, { isPrimary: true });
  useAddresses.getState().setPrimaryMatching(matchOf(sub));
}

/**
 * Deletes an address and, with it, its outages and its history: on the server (which deletes what
 * hangs on it), then on the device. A failed delete changes neither.
 */
export async function deleteAddress(
  client: Pick<Endpoints, 'deleteSubscription'>,
  sub: SubscriptionDto,
): Promise<void> {
  await client.deleteSubscription(sub.id);
  useAddresses.getState().removeMatching(matchOf(sub));
}
