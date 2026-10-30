import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { LogBoundarySink, type BoundarySink } from '../jobs/boundary.ts';
import {
  ExpoBoundarySink,
  FcmDirectSink,
  parseServiceAccount,
  type Log,
} from './boundary-sinks.ts';
import { dropDevice } from './deliver.ts';

export type BoundarySinkName = NonNullable<Config['BOUNDARY_SINK']>;

/**
 * The boundary sink the configuration asks for (`BOUNDARY_SINK`; in production Expo's push service,
 * elsewhere the log), shared by the server and the development push tool so both send the same way.
 */
export function chooseBoundarySink(
  config: Pick<
    Config,
    'BOUNDARY_SINK' | 'NODE_ENV' | 'EXPO_ACCESS_TOKEN' | 'FCM_SERVICE_ACCOUNT_JSON'
  >,
  db: Db,
  log: Log,
): { name: BoundarySinkName; sink: BoundarySink } {
  const name = config.BOUNDARY_SINK ?? (config.NODE_ENV === 'production' ? 'expo' : 'log');
  const onDeadDevice = (deviceId: string) => dropDevice(db, deviceId);
  const sink: BoundarySink =
    name === 'expo'
      ? new ExpoBoundarySink({ accessToken: config.EXPO_ACCESS_TOKEN, onDeadDevice, log })
      : name === 'fcm'
        ? new FcmDirectSink(parseServiceAccount(config.FCM_SERVICE_ACCOUNT_JSON as string), {
            onDeadDevice,
            log,
          })
        : new LogBoundarySink(log);
  return { name, sink };
}
