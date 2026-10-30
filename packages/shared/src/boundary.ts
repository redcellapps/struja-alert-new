import { z } from 'zod';

// The "outage active" signal (BRIEF §4 Jobs; docs/phase4-plan.md §3 step 3). At `starts_at` and at
// `ends_at` every affected address gets a data-only push: no title, no body, so the system shows
// nothing by itself. The app's background task turns it into the "Bez struje" notification (the Live
// Update on Android 16+, step 5) and takes it down again at the end.
//
// Both server sinks send this JSON under the `body` data key: that is where Expo's push service puts
// a message's `data` on Android, and the direct FCM sink does the same, so the app parses one shape
// whichever path delivered it.
export const BOUNDARY_PUSH_TYPES = ['outage_started', 'outage_ended'] as const;
export type BoundaryPushType = (typeof BOUNDARY_PUSH_TYPES)[number];

export const boundaryPushSchema = z.object({
  type: z.enum(BOUNDARY_PUSH_TYPES),
  outageId: z.number().int().positive(),
  subscriptionId: z.number().int().positive(),
  startsAt: z.string(),
  endsAt: z.string(),
  // "Moguće pogođeno": the match was not certain.
  possible: z.boolean(),
});
export type BoundaryPush = z.infer<typeof boundaryPushSchema>;

// How long the push may wait for a phone that is unreachable (seconds): a start is news for an hour,
// an end for a quarter of an hour; after that the app's own schedule has done the job.
export const BOUNDARY_TTL_SECONDS: Readonly<Record<BoundaryPushType, number>> = {
  outage_started: 3600,
  outage_ended: 900,
};
