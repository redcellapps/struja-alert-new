import { randomUUID } from 'expo-crypto';

// Hermes has no global `crypto.randomUUID`; expo-crypto provides it from the platform.
export const newId = (): string => randomUUID();
