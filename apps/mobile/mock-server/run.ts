import { createMockServer } from './server.ts';

// `pnpm --filter @struja/mobile mock`: the mock API on :3000 (the emulator reaches the host as 10.0.2.2).
const port = Number(process.env.PORT ?? 3000);
createMockServer().listen(port, '0.0.0.0', () => console.log(`Mock API on :${port}`));
