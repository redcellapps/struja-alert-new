import { getCredentials, forgetDevice } from '../api/device';
import { api, secureStore } from '../api/runtime';
import { mmkvPersister } from '../query/client';
import { queryClient } from '../query/instance';
import { useAddresses } from '../store/addresses';
import { useSettings } from '../store/settings';
import { storage } from '../store/storage';
import type { DeleteDeps } from './deleteData';
import { forgetSync } from './sync';

/** "Delete all my data" wired to the real server, secure store, stores and caches. */
export const realDeleteDeps: DeleteDeps = {
  deleteOnServer: async () => {
    // never registered: nothing on the server to delete
    if (!(await getCredentials(secureStore))) return;
    await api.deleteMyData();
  },
  forgetCredentials: () => forgetDevice(secureStore),
  resetStores: () => {
    useAddresses.setState({ items: [] });
    useSettings.getState().reset();
  },
  clearCaches: async () => {
    queryClient.clear();
    await mmkvPersister.removeClient();
    forgetSync(storage());
  },
};
