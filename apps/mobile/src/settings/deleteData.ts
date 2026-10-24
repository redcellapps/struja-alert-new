// "Obriši sve moje podatke": the device, its addresses, its history and its settings, on the server and
// on this phone. The server goes first: if it cannot be reached nothing is touched, so the person can
// try again instead of being left with a device the server still knows.
export interface DeleteDeps {
  // Deletes the device on the server (a no-op when this phone never registered).
  deleteOnServer: () => Promise<void>;
  // Forgets the credentials and the push token kept in the secure store.
  forgetCredentials: () => Promise<void>;
  // Empties the lists and the settings kept on the device.
  resetStores: () => void;
  // Empties every cache: the saved server answers, the sync memory.
  clearCaches: () => Promise<void> | void;
}

export async function deleteEverything(deps: DeleteDeps): Promise<void> {
  await deps.deleteOnServer();
  await deps.forgetCredentials();
  deps.resetStores();
  await deps.clearCaches();
}
