import { createMockServer } from './server.ts';
import { isScenario } from './scenarios.ts';

// `pnpm --filter @struja/mobile mock`: the mock API on :3000 (the emulator reaches the host as 10.0.2.2).
// MOCK_SCENARIO=<name> picks a development scenario (scenarios.ts); MOCK_LOG=1 logs every request.
const port = Number(process.env.PORT ?? 3000);
const scenario = isScenario(process.env.MOCK_SCENARIO) ? process.env.MOCK_SCENARIO : 'upcoming';
createMockServer({ scenario }).listen(port, '0.0.0.0', () =>
  console.log(`Mock API on :${port} (scenario: ${scenario})`),
);
