import { defineConfig } from 'vitest/config';

// Integration tests start a real PostGIS container (Testcontainers); give them room. Each test file
// starts its own container, so at most two files run at once: the suite stays safe next to the
// emulator and Docker on a 32 GB machine.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 240_000, maxWorkers: 2 },
});
