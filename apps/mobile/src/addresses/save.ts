import {
  MAX_ADDRESSES,
  type CreateSubscriptionRequest,
  type subscriptionWithOutagesSchema,
} from '@struja/shared';
import type { z } from 'zod';
import type { Endpoints } from '../api/endpoints';
import { useAddresses } from '../store/addresses';
import { newId } from '../util/uuid';

export type SubscriptionWithOutages = z.infer<typeof subscriptionWithOutagesSchema>;

export class LimitReachedError extends Error {
  constructor() {
    super(`At most ${MAX_ADDRESSES} addresses`);
    this.name = 'LimitReachedError';
  }
}

/**
 * Adds an address on the server and keeps it in the list on the device. The server answer carries the
 * outages already published for the address: they are shown at once and nothing is pushed for them.
 * The local list changes only after the server accepted the address, so a failed save leaves both
 * sides as they were.
 */
export async function saveAddress(
  api: Pick<Endpoints, 'addSubscription'>,
  request: CreateSubscriptionRequest,
  randomId: () => string = newId,
): Promise<SubscriptionWithOutages> {
  if (useAddresses.getState().items.length >= MAX_ADDRESSES) throw new LimitReachedError();
  const result = await api.addSubscription(request);
  useAddresses.getState().add(randomId(), { ...request, isPrimary: result.subscription.isPrimary });
  return result;
}
