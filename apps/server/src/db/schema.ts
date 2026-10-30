import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// PostGIS geometry columns. Values go in as WKT/GeoJSON through SQL functions and come out via
// ST_AsGeoJSON in queries, so the driver-side type is an opaque string.
const geometry = (name: string, type: 'Point' | 'MultiLineString') =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `geometry(${type},4326)`,
  })(name);

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const platformEnum = pgEnum('platform', ['android', 'ios']);
export const scriptEnum = pgEnum('script', ['latn', 'cyrl']);
export const aliasSourceEnum = pgEnum('alias_source', [
  'exact',
  'fuzzy',
  'heuristic',
  'scored',
  'manual',
]);
export const outageStatusEnum = pgEnum('outage_status', ['active', 'changed', 'cancelled']);
export const resolvedByEnum = pgEnum('resolved_by', [
  'exact',
  'alias',
  'form',
  'fuzzy',
  'heuristic',
  'scored',
  'manual',
  // Several streets share the name: placed by municipality or distance, or left ambiguous (every
  // one of them is then a candidate).
  'placed',
  'ambiguous',
  'unresolved',
]);
export const parityEnum = pgEnum('parity', ['odd', 'even']);
export const notificationKindEnum = pgEnum('notification_kind', [
  'new',
  'evening_before',
  'changed',
  'cancelled',
  // An undone cancellation: sent only to people who were told "Otkazano".
  'reinstated',
]);
export const liveActivityKindEnum = pgEnum('live_activity_kind', [
  'push_to_start',
  'activity_update',
]);

// ---------------------------------------------------------------- gazetteer

export const street = pgTable(
  'street',
  {
    id: serial('id').primaryKey(),
    city: text('city').notNull(),
    municipality: text('municipality'),
    // All city municipalities the street touches (OSM streets often cross a border).
    municipalities: text('municipalities')
      .array()
      .notNull()
      .default(sql`'{}'`),
    nameLatin: text('name_latin'),
    nameCyrillic: text('name_cyrillic').notNull(),
    nameNorm: text('name_norm').notNull(),
    // Streets with one name in different places are different streets: the key is the smallest OSM
    // way id of the street. Null only on rows from before the split (the import replaces them).
    clusterKey: text('cluster_key'),
    // The nearest settlement, in Cyrillic: what tells same-named streets apart in the app.
    settlementName: text('settlement_name'),
    // alt_name / old_name / name:sr-Latn, normalized: extra exact names for the same street.
    altNorms: text('alt_norms')
      .array()
      .notNull()
      .default(sql`'{}'`),
    osmWayIds: bigint('osm_way_ids', { mode: 'number' })
      .array()
      .notNull()
      .default(sql`'{}'`),
    // One polyline per OSM way, so a street is a MultiLineString.
    geom: geometry('geom', 'MultiLineString'),
  },
  (t) => [
    unique('street_city_name_norm_cluster_unique').on(t.city, t.nameNorm, t.clusterKey),
    index('street_geom_gix').using('gist', t.geom),
    index('street_name_norm_trgm').using('gin', sql`${t.nameNorm} gin_trgm_ops`),
  ],
);

// Villages, hamlets, suburbs: a subscriber can live in one when EDS names a settlement.
export const settlement = pgTable(
  'settlement',
  {
    id: serial('id').primaryKey(),
    city: text('city').notNull(),
    osmId: bigint('osm_id', { mode: 'number' }).notNull(),
    municipality: text('municipality'),
    kind: text('kind').notNull(),
    nameLatin: text('name_latin'),
    nameCyrillic: text('name_cyrillic').notNull(),
    nameNorm: text('name_norm').notNull(),
    altNorms: text('alt_norms')
      .array()
      .notNull()
      .default(sql`'{}'`),
    geom: geometry('geom', 'Point'),
  },
  (t) => [
    unique('settlement_city_osm_id_unique').on(t.city, t.osmId),
    index('settlement_name_norm_idx').on(t.city, t.nameNorm),
  ],
);

// Human-confirmed names for villages and other settlements (the counterpart of street_alias).
export const settlementAlias = pgTable(
  'settlement_alias',
  {
    id: serial('id').primaryKey(),
    settlementId: integer('settlement_id')
      .notNull()
      .references(() => settlement.id, { onDelete: 'cascade' }),
    raw: text('raw').notNull(),
    rawNorm: text('raw_norm').notNull(),
    reviewedAt: tstz('reviewed_at'),
  },
  (t) => [uniqueIndex('settlement_alias_raw_norm_unique').on(t.rawNorm)],
);

// OSM address points; optional data that feeds the house-number feature of the scoring.
export const addressPoint = pgTable(
  'address_point',
  {
    id: serial('id').primaryKey(),
    streetId: integer('street_id')
      .notNull()
      .references(() => street.id, { onDelete: 'cascade' }),
    housenumber: text('housenumber').notNull(),
    geom: geometry('geom', 'Point'),
  },
  (t) => [index('address_point_street_idx').on(t.streetId)],
);

export const streetAlias = pgTable(
  'street_alias',
  {
    id: serial('id').primaryKey(),
    streetId: integer('street_id')
      .notNull()
      .references(() => street.id, { onDelete: 'cascade' }),
    raw: text('raw').notNull(),
    rawNorm: text('raw_norm').notNull(),
    // 1.0 = human-confirmed.
    confidence: doublePrecision('confidence').notNull(),
    source: aliasSourceEnum('source').notNull(),
    reviewedAt: tstz('reviewed_at'),
    rejected: boolean('rejected').notNull().default(false),
  },
  (t) => [uniqueIndex('street_alias_raw_norm_unique').on(t.rawNorm)],
);

// Bumped whenever the street list changes, so apps can cache the gazetteer by ETag.
export const gazetteerVersion = pgTable('gazetteer_version', {
  city: text('city').primaryKey(),
  version: integer('version').notNull().default(1),
  etag: text('etag').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- scraping

export const scrapeRun = pgTable(
  'scrape_run',
  {
    id: serial('id').primaryKey(),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
    city: text('city'),
    url: text('url').notNull(),
    httpStatus: smallint('http_status'),
    etag: text('etag'),
    rowsFound: integer('rows_found'),
    error: text('error'),
    // The date in the page header, and how the page looked (see the broken page guard):
    // 'ok' | 'truncated' | 'no_table' | 'reduced' (fewer than half the rows of the previous healthy
    // fetch, which had at least 5 rows: not counted towards "missing") | 'confirmed_reduced' (below half
    // again right after a reduced fetch, or confirmed by the admin: taken as real).
    pageDate: date('page_date'),
    health: text('health'),
  },
  (t) => [
    index('scrape_run_started_idx').on(t.startedAt),
    index('scrape_run_page_idx').on(t.city, t.pageDate, t.id),
  ],
);

// Things the operator must hear about (BRIEF §4 Monitoring). Step 9 delivers them (email + admin
// push); until then they are recorded here. One open alert per (kind, dedupe_key): a condition that
// stays true does not raise a new alert on every fetch.
export const alert = pgTable(
  'alert',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    message: text('message').notNull(),
    details: jsonb('details'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    resolvedAt: tstz('resolved_at'),
    notifiedAt: tstz('notified_at'),
  },
  (t) => [
    uniqueIndex('alert_open_unique')
      .on(t.kind, t.dedupeKey)
      .where(sql`${t.resolvedAt} IS NULL`),
  ],
);

// What the admin decided about a segment: confirmed a match, rejected an auto-accept, or dismissed
// a segment that is no street. The reject rate of spot-checked auto-accepts feeds monitoring.
export const segmentReview = pgTable(
  'segment_review',
  {
    id: serial('id').primaryKey(),
    outageStreetId: integer('outage_street_id'),
    // The normalized segment name (the alias key).
    segNorm: text('seg_norm').notNull(),
    // 'unresolved': from the unresolved queue. 'spot_check': an auto-accepted (scored) match.
    kind: text('kind').$type<'unresolved' | 'spot_check'>().notNull(),
    decision: text('decision').$type<'confirmed' | 'rejected' | 'dismissed'>().notNull(),
    streetId: integer('street_id'),
    decidedAt: tstz('decided_at').notNull().defaultNow(),
  },
  (t) => [
    index('segment_review_norm_idx').on(t.segNorm),
    index('segment_review_kind_idx').on(t.kind, t.decidedAt),
  ],
);

export const outage = pgTable(
  'outage',
  {
    id: serial('id').primaryKey(),
    sourceUrl: text('source_url').notNull(),
    contentHash: text('content_hash').notNull(),
    // City + municipality + date + sorted normalized street set; excludes the time window, so a
    // changed time is "changed", not "new" + "cancelled".
    identityKey: text('identity_key').notNull(),
    city: text('city').notNull(),
    branch: text('branch'),
    municipality: text('municipality').notNull(),
    // false for rows outside the city's scope (other branches): stored, never matched.
    inScope: boolean('in_scope').notNull().default(true),
    outageDate: date('outage_date').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    // The untouched Ulice cell, always kept.
    rawStreets: text('raw_streets').notNull(),
    firstSeenRun: integer('first_seen_run')
      .notNull()
      .references(() => scrapeRun.id),
    lastSeenRun: integer('last_seen_run')
      .notNull()
      .references(() => scrapeRun.id),
    missingRuns: integer('missing_runs').notNull().default(0),
    status: outageStatusEnum('status').notNull().default('active'),
    // On the OLD row: the row that replaced it (a changed time or an edited street list). A
    // replaced row is `cancelled` but must never produce a "cancelled" notification.
    supersededByOutageId: integer('superseded_by_outage_id'),
    // Ambiguous changes: several old and new rows that could not be paired one to one share a
    // group, and the notifier sends one "Izmena" listing the new windows.
    changeGroupId: integer('change_group_id'),
    // What a person was last told must match what EDS shows now, so every real state change after
    // the first is told again. The revision goes up when an outage really changes state again: a
    // cancellation (missing for two fetches), an undone cancellation, a reverted change. A repeat
    // run with nothing new leaves it alone, so it sends nothing.
    revision: integer('revision').notNull().default(0),
    // How many times the displayed version of this outage has switched (a changed time, an edited
    // street list, a revert): a replacing row has its predecessor's count + 1. More than two raises
    // the flip-flop alert.
    flips: integer('flips').notNull().default(0),
    // The start/end signals (the "outage active" surface on affected devices, BRIEF §4 Jobs) are
    // sent once each: these mark them done, so a repeated or retried tick does nothing.
    startSignalledAt: tstz('start_signalled_at'),
    endSignalledAt: tstz('end_signalled_at'),
  },
  (t) => [
    unique('outage_content_hash_unique').on(t.contentHash),
    index('outage_identity_idx').on(t.identityKey),
    index('outage_date_idx').on(t.city, t.outageDate),
  ],
);

// One row per parsed segment and house range; a whole street is one row with null ranges.
export const outageStreet = pgTable(
  'outage_street',
  {
    id: serial('id').primaryKey(),
    outageId: integer('outage_id')
      .notNull()
      .references(() => outage.id, { onDelete: 'cascade' }),
    segmentIndex: integer('segment_index').notNull(),
    streetId: integer('street_id').references(() => street.id),
    settlementId: integer('settlement_id').references(() => settlement.id),
    rawSegment: text('raw_segment').notNull(),
    // "делови X": only part of the street is affected.
    partial: boolean('partial').notNull().default(false),
    houseFrom: integer('house_from'),
    houseTo: integer('house_to'),
    houseRaw: text('house_raw'),
    parity: parityEnum('parity'),
    resolvedBy: resolvedByEnum('resolved_by').notNull(),
    score: doublePrecision('score'),
    // Top 5 candidates with their scores, kept for unresolved segments and admin review.
    candidates: jsonb('candidates'),
  },
  (t) => [
    index('outage_street_outage_idx').on(t.outageId),
    index('outage_street_street_idx').on(t.streetId),
    index('outage_street_settlement_idx').on(t.settlementId),
    check(
      'outage_street_one_target',
      sql`NOT (${t.streetId} IS NOT NULL AND ${t.settlementId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------- devices

export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pushToken: text('push_token').notNull(),
    // The device's own FCM token (Android), for the direct FCM boundary sink; null when unknown.
    nativePushToken: text('native_push_token'),
    deviceSecretHash: text('device_secret_hash').notNull(),
    platform: platformEnum('platform').notNull(),
    osVersion: text('os_version'),
    locale: text('locale').notNull().default('sr'),
    script: scriptEnum('script').notNull().default('latn'),
    // { start: "22:00", end: "07:00" } in Europe/Belgrade; null = defaults.
    quietHours: jsonb('quiet_hours'),
    enabledKinds: text('enabled_kinds')
      .array()
      .notNull()
      .default(sql`'{new,evening_before,changed,cancelled}'`),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
  },
  (t) => [unique('device_push_token_unique').on(t.pushToken)],
);

export const subscription = pgTable(
  'subscription',
  {
    id: serial('id').primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    streetId: integer('street_id').references(() => street.id),
    // A subscriber in a village follows the settlement instead of a street.
    settlementId: integer('settlement_id').references(() => settlement.id),
    houseNumber: integer('house_number'),
    houseSuffix: text('house_suffix'),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('subscription_device_idx').on(t.deviceId),
    index('subscription_street_idx').on(t.streetId),
    index('subscription_settlement_idx').on(t.settlementId),
    // Exactly one of street / settlement.
    check(
      'subscription_one_target',
      sql`(${t.streetId} IS NOT NULL) <> (${t.settlementId} IS NOT NULL)`,
    ),
  ],
);

// The dedupe guarantee: one notification per (subscription, outage, kind). Never drop this
// constraint (BRIEF §8).
export const notificationLog = pgTable(
  'notification_log',
  {
    id: serial('id').primaryKey(),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscription.id, { onDelete: 'cascade' }),
    outageId: integer('outage_id')
      .notNull()
      .references(() => outage.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    // The outage's revision when this was planned. "new" and "evening_before" are once per outage
    // (revision 0); "changed", "cancelled" and "reinstated" carry the revision of the state they
    // announce, so every real flip is told while a repeat run with nothing new sends nothing.
    revision: integer('revision').notNull().default(0),
    // The log doubles as the outbox: the planner inserts a row (claiming the notification through
    // the unique constraint) and the delivery job sends it. 'pending' | 'sending' | 'sent' |
    // 'failed' | 'suppressed' (the user turned this kind off, or the device is gone: recorded,
    // never sent) | 'in_app' (the person saw it on screen when adding the address: recorded as
    // told, never pushed, so later changes still reach them).
    status: text('status').notNull().default('pending'),
    // Not before this time (quiet hours); an urgent notification is deliverable immediately.
    deliverAt: tstz('deliver_at'),
    // Title, body and the data the app needs, rendered at planning time.
    payload: jsonb('payload'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
    // For "changed", "cancelled" and "reinstated": when the data-only companion push went out (the
    // app's background task corrects its local alarm from it; docs/phase4-plan.md step 3).
    companionSentAt: tstz('companion_sent_at'),
    // Expo push ticket / receipt, so dead tokens can be dropped.
    ticketId: text('ticket_id'),
    receiptStatus: text('receipt_status'),
    receiptCheckedAt: tstz('receipt_checked_at'),
  },
  (t) => [
    unique('notification_log_dedupe').on(t.subscriptionId, t.outageId, t.kind, t.revision),
    index('notification_log_ticket_idx').on(t.ticketId),
    index('notification_log_pending_idx').on(t.status, t.deliverAt),
  ],
);

// iOS only. A new token for the same activity invalidates the old one.
export const liveActivityToken = pgTable(
  'live_activity_token',
  {
    id: serial('id').primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    kind: liveActivityKindEnum('kind').notNull(),
    activityId: text('activity_id'),
    token: text('token').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    invalidatedAt: tstz('invalidated_at'),
  },
  (t) => [index('live_activity_device_idx').on(t.deviceId, t.kind)],
);

// "Prijavi grešku"
export const report = pgTable('report', {
  id: serial('id').primaryKey(),
  outageId: integer('outage_id').references(() => outage.id, { onDelete: 'set null' }),
  subscriptionId: integer('subscription_id').references(() => subscription.id, {
    onDelete: 'set null',
  }),
  message: text('message').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
