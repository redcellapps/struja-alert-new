import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { MAX_ADDRESSES, type CreateSubscriptionRequest } from '@struja/shared';
import type { LocalAddress } from '../api/device';
import { zustandStorage } from './storage';

// The saved addresses kept on the device. This list, not the server, is the source of truth: if the
// device secret is lost the app registers again and re-adds these (api/device.ts).
export interface AddressesState {
  items: LocalAddress[];
  add: (localId: string, request: CreateSubscriptionRequest) => boolean;
  remove: (localId: string) => void;
  setPrimary: (localId: string) => void;
}

export const useAddresses = create<AddressesState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (localId, request) => {
        if (get().items.length >= MAX_ADDRESSES) return false;
        const first = get().items.length === 0;
        const primary = first || request.isPrimary === true;
        set((s) => ({
          items: [
            // a new primary address takes the mark from the old one
            ...(primary
              ? s.items.map((a) => ({ ...a, request: { ...a.request, isPrimary: false } }))
              : s.items),
            { localId, request: { ...request, isPrimary: primary } },
          ],
        }));
        return true;
      },
      remove: (localId) =>
        set((s) => {
          const rest = s.items.filter((a) => a.localId !== localId);
          const hadPrimary = s.items.find((a) => a.localId === localId)?.request.isPrimary;
          if (hadPrimary && rest[0])
            rest[0] = { ...rest[0], request: { ...rest[0].request, isPrimary: true } };
          return { items: rest };
        }),
      setPrimary: (localId) =>
        set((s) => ({
          items: s.items.map((a) => ({
            ...a,
            request: { ...a.request, isPrimary: a.localId === localId },
          })),
        })),
    }),
    { name: 'addresses', storage: createJSONStorage(() => zustandStorage), version: 1 },
  ),
);
