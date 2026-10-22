import { defineConfig } from 'vitest/config';

// The mock API contract test runs in plain Node (the app's jest preset is for React Native code).
export default defineConfig({
  test: { include: ['mock-server/**/*.test.ts'], environment: 'node' },
});
