import { defineConfig } from 'vitest/config';

// Integration tests start a real PostGIS container (Testcontainers); give them room.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 240_000 },
});
