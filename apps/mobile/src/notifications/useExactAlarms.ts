import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { exactAlarmsState, requestExactAlarms, type ExactAlarms } from './exactAlarms';

/**
 * The exact-alarm state for a screen: read on mount and whenever the app comes back to the front
 * (the person may have changed it in the system settings), with the action that opens the system
 * screen and reads the state again afterwards.
 */
export function useExactAlarms(): { exactAlarms: ExactAlarms; request: () => void } {
  const [state, setState] = useState<ExactAlarms>('unknown');
  useEffect(() => {
    let live = true;
    const read = () =>
      void exactAlarmsState().then((s) => {
        if (live) setState(s);
      });
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  const request = useCallback(() => {
    void requestExactAlarms().then(setState);
  }, []);
  return { exactAlarms: state, request };
}
