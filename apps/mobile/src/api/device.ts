import { DEV_PUSH_TOKEN_PREFIX, type CreateSubscriptionRequest } from '@struja/shared';
import type { Endpoints } from './endpoints';

// Where the device credentials live. SecureStore (Keystore / Keychain) in the app; a memory map in
// tests.
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const CRED_KEY = 'device-credentials';
const TOKEN_KEY = 'push-token';

export interface LocalAddress {
  // Stable on-device id, independent of the server's subscription ids.
  localId: string;
  request: CreateSubscriptionRequest;
}

export interface DeviceDeps {
  secrets: SecretStore;
  api: Pick<Endpoints, 'registerDevice' | 'addSubscription'>;
  platform: 'android' | 'ios';
  locale: () => { language: 'sr' | 'en'; script: 'latn' | 'cyrl' };
  // The real Expo push token when there is one (Phase 4); otherwise a development token is used.
  realPushToken?: () => Promise<string | null>;
  // The device's own FCM token, sent along when there is one (the server's direct FCM signal path).
  nativePushToken?: () => Promise<string | null>;
  randomId: () => string;
  // The addresses kept on the device: the source of truth that survives a lost secret.
  addresses: () => LocalAddress[];
}

/** Forgets the device on this phone: its credentials and the development push token. */
export async function forgetDevice(secrets: SecretStore): Promise<void> {
  await secrets.remove(CRED_KEY);
  await secrets.remove(TOKEN_KEY);
}

/** "<deviceId>.<secret>" or null. */
export async function getCredentials(secrets: SecretStore): Promise<string | null> {
  return secrets.get(CRED_KEY);
}

// A real token when available. Otherwise the development token (never an ExponentPushToken),
// generated once and kept: a development server accepts it, a production server rejects it.
export async function pushToken(deps: DeviceDeps): Promise<string> {
  const real = await deps.realPushToken?.();
  if (real) return real;
  const existing = await deps.secrets.get(TOKEN_KEY);
  if (existing) return existing;
  const fresh = `${DEV_PUSH_TOKEN_PREFIX}${deps.randomId()}`;
  await deps.secrets.set(TOKEN_KEY, fresh);
  return fresh;
}

/** Registers the device if it has no credentials yet. Idempotent. */
export async function ensureRegistered(deps: DeviceDeps): Promise<string> {
  const existing = await getCredentials(deps.secrets);
  if (existing) return existing;
  return register(deps);
}

async function register(deps: DeviceDeps): Promise<string> {
  const { language, script } = deps.locale();
  const native = (await deps.nativePushToken?.()) ?? null;
  const res = await deps.api.registerDevice({
    pushToken: await pushToken(deps),
    ...(native ? { nativePushToken: native } : {}),
    platform: deps.platform,
    locale: language,
    script,
  });
  const credentials = `${res.deviceId}.${res.deviceSecret}`;
  await deps.secrets.set(CRED_KEY, credentials);
  return credentials;
}

/**
 * The recovery as the client calls it. Several requests fail with 401 at the same moment (Početna
 * loads two queries): the first one starts the recovery, the others wait for it and retry; a request
 * that failed with credentials that were replaced meanwhile just retries. Without this each failure
 * would register again and add every address once more.
 */
export function singleFlightRecovery(deps: DeviceDeps): (used: string | null) => Promise<boolean> {
  let running: Promise<boolean> | null = null;
  return (used) => {
    // The shared promise is set before anything is awaited, so callers arriving together join it.
    running ??= (async () => {
      if ((await getCredentials(deps.secrets)) === used) await recoverDevice(deps);
      return true;
    })().finally(() => {
      running = null;
    });
    return running;
  };
}

/**
 * The secret is gone or no longer valid (reinstall, cleared storage, server restore): register again
 * with the same push token, which makes the server drop the old device and its addresses, then add
 * the addresses kept on the device. Adding an address records the already published outages as told
 * in the app, so nothing is pushed twice. Returns true when the caller may retry its request.
 */
export async function recoverDevice(deps: DeviceDeps): Promise<boolean> {
  await deps.secrets.remove(CRED_KEY);
  await register(deps);
  for (const address of deps.addresses()) {
    await deps.api.addSubscription(address.request);
  }
  return true;
}
