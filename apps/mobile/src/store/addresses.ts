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
  // Adds a house number to the address that matches a server address (same street or settlement,
  // label and old number): the device list and the server list mirror each other.
  setHouseNumber: (
    match: AddressMatch,
    next: { houseNumber: number; houseSuffix?: string },
  ) => void;
  // The same, for deleting an address and for making it the primary one.
  removeMatching: (match: AddressMatch) => void;
  setPrimaryMatching: (match: AddressMatch) => void;
}

export interface AddressMatch {
  streetId: number | null;
  settlementId: number | null;
  houseNumber: number | null;
  label: string | null;
}

const sameAddress = (a: LocalAddress, match: AddressMatch): boolean =>
  (a.request.streetId ?? null) === match.streetId &&
  (a.request.settlementId ?? null) === match.settlementId &&
  (a.request.houseNumber ?? null) === match.houseNumber &&
  (a.request.label ?? null) === match.label;

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
      setHouseNumber: (match, next) =>
        set((s) => {
          const i = s.items.findIndex((a) => sameAddress(a, match));
          if (i < 0) return s;
          const items = [...s.items];
          const request = { ...items[i]!.request, houseNumber: next.houseNumber };
          if (next.houseSuffix === undefined) delete request.houseSuffix;
          else request.houseSuffix = next.houseSuffix;
          items[i] = { localId: items[i]!.localId, request };
          return { items };
        }),
      removeMatching: (match) => {
        const found = get().items.find((a) => sameAddress(a, match));
        if (found) get().remove(found.localId);
      },
      setPrimaryMatching: (match) => {
        const found = get().items.find((a) => sameAddress(a, match));
        if (found) get().setPrimary(found.localId);
      },
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
