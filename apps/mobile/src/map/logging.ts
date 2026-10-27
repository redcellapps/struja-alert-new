import { LogManager } from '@maplibre/maplibre-react-native';

// The native map reports every failed tile request as an error. Those are expected (no network, a tile
// host that is down) and the outage detail already handles them by dropping the map, so they must not
// raise an error in the app. Anything else it reports (a broken style, say) still goes through.
const NETWORK_FAILURE =
  /Failed to load|Failed to connect|Request failed|Unable to resolve|Connection refused|timed out|Network is unreachable|HttpRequest|HTTP status/i;

export interface NativeLog {
  level: string;
  tag: string;
  message: string;
}

export const isTileNetworkFailure = ({ tag, message }: NativeLog): boolean =>
  NETWORK_FAILURE.test(message) || /HttpRequest|Resource/i.test(tag);

let installed = false;

/** Keeps expected network failures of the base map out of the app's error log. Safe to call again. */
export function installMapLogging(): void {
  if (installed) return;
  installed = true;
  // true = handled here, false = the default logging
  LogManager.onLog((event) => isTileNetworkFailure(event));
}
