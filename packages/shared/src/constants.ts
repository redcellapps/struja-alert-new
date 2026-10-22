// An address, up to this many per device. One of them is primary.
export const MAX_ADDRESSES = 3;

// Europe/Belgrade poll times of the production scheduler (and the fixture collector).
export const POLL_HOURS = [7, 13, 19] as const;

// Quiet hours default: no notifications 22:00-07:00 unless the outage starts within 2 hours.
export const DEFAULT_QUIET_HOURS = { start: '22:00', end: '07:00' } as const;
export const URGENT_WITHIN_HOURS = 2;

export interface CityInfo {
  // Stable id used in URLs.
  id: string;
  // The collector's slug for the city's EDS pages.
  slug: string;
  name: string;
  // false = shown as "Uskoro" in the app.
  active: boolean;
}

// The app covers Niš only for now; the rest are listed so the picker can show "Uskoro".
export const CITIES: readonly CityInfo[] = [
  { id: 'nis', slug: 'Nis', name: 'Niš', active: true },
  { id: 'beograd', slug: 'Beograd', name: 'Beograd', active: false },
  { id: 'novi-sad', slug: 'NoviSad', name: 'Novi Sad', active: false },
  { id: 'kragujevac', slug: 'Kragujevac', name: 'Kragujevac', active: false },
  { id: 'kraljevo', slug: 'Kraljevo', name: 'Kraljevo', active: false },
];
