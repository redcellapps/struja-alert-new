import { createQueryClient } from './client';

// The one query client of the app (the root layout provides it; "delete all my data" clears it).
export const queryClient = createQueryClient();
