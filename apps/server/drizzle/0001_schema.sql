CREATE TYPE "public"."alias_source" AS ENUM('exact', 'fuzzy', 'heuristic', 'scored', 'manual');--> statement-breakpoint
CREATE TYPE "public"."live_activity_kind" AS ENUM('push_to_start', 'activity_update');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('new', 'evening_before', 'changed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."outage_status" AS ENUM('active', 'changed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."parity" AS ENUM('odd', 'even');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TYPE "public"."resolved_by" AS ENUM('exact', 'alias', 'form', 'fuzzy', 'heuristic', 'scored', 'manual', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."script" AS ENUM('latn', 'cyrl');--> statement-breakpoint
CREATE TABLE "address_point" (
	"id" serial PRIMARY KEY NOT NULL,
	"street_id" integer NOT NULL,
	"housenumber" text NOT NULL,
	"geom" geometry(Point,4326)
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"push_token" text NOT NULL,
	"device_secret_hash" text NOT NULL,
	"platform" "platform" NOT NULL,
	"os_version" text,
	"locale" text DEFAULT 'sr' NOT NULL,
	"script" "script" DEFAULT 'latn' NOT NULL,
	"quiet_hours" jsonb,
	"enabled_kinds" text[] DEFAULT '{new,evening_before,changed,cancelled}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_push_token_unique" UNIQUE("push_token")
);
--> statement-breakpoint
CREATE TABLE "gazetteer_version" (
	"city" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"etag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_activity_token" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" "live_activity_kind" NOT NULL,
	"activity_id" text,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"outage_id" integer NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" text,
	"receipt_status" text,
	"receipt_checked_at" timestamp with time zone,
	CONSTRAINT "notification_log_dedupe" UNIQUE("subscription_id","outage_id","kind")
);
--> statement-breakpoint
CREATE TABLE "outage" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"identity_key" text NOT NULL,
	"city" text NOT NULL,
	"branch" text,
	"municipality" text NOT NULL,
	"in_scope" boolean DEFAULT true NOT NULL,
	"outage_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"raw_streets" text NOT NULL,
	"first_seen_run" integer NOT NULL,
	"last_seen_run" integer NOT NULL,
	"missing_runs" integer DEFAULT 0 NOT NULL,
	"status" "outage_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "outage_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "outage_street" (
	"id" serial PRIMARY KEY NOT NULL,
	"outage_id" integer NOT NULL,
	"segment_index" integer NOT NULL,
	"street_id" integer,
	"settlement_id" integer,
	"raw_segment" text NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"house_from" integer,
	"house_to" integer,
	"house_raw" text,
	"parity" "parity",
	"resolved_by" "resolved_by" NOT NULL,
	"score" double precision,
	"candidates" jsonb,
	CONSTRAINT "outage_street_one_target" CHECK (NOT ("outage_street"."street_id" IS NOT NULL AND "outage_street"."settlement_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" serial PRIMARY KEY NOT NULL,
	"outage_id" integer,
	"subscription_id" integer,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"city" text,
	"url" text NOT NULL,
	"http_status" smallint,
	"etag" text,
	"rows_found" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "settlement" (
	"id" serial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"osm_id" bigint NOT NULL,
	"municipality" text,
	"kind" text NOT NULL,
	"name_latin" text,
	"name_cyrillic" text NOT NULL,
	"name_norm" text NOT NULL,
	"alt_norms" text[] DEFAULT '{}' NOT NULL,
	"geom" geometry(Point,4326),
	CONSTRAINT "settlement_city_osm_id_unique" UNIQUE("city","osm_id")
);
--> statement-breakpoint
CREATE TABLE "street" (
	"id" serial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"municipality" text,
	"municipalities" text[] DEFAULT '{}' NOT NULL,
	"name_latin" text,
	"name_cyrillic" text NOT NULL,
	"name_norm" text NOT NULL,
	"alt_norms" text[] DEFAULT '{}' NOT NULL,
	"osm_way_ids" bigint[] DEFAULT '{}' NOT NULL,
	"geom" geometry(MultiLineString,4326),
	CONSTRAINT "street_city_name_norm_unique" UNIQUE("city","name_norm")
);
--> statement-breakpoint
CREATE TABLE "street_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"street_id" integer NOT NULL,
	"raw" text NOT NULL,
	"raw_norm" text NOT NULL,
	"confidence" double precision NOT NULL,
	"source" "alias_source" NOT NULL,
	"reviewed_at" timestamp with time zone,
	"rejected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"street_id" integer,
	"settlement_id" integer,
	"house_number" integer,
	"house_suffix" text,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_one_target" CHECK (("subscription"."street_id" IS NOT NULL) <> ("subscription"."settlement_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "address_point" ADD CONSTRAINT "address_point_street_id_street_id_fk" FOREIGN KEY ("street_id") REFERENCES "public"."street"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activity_token" ADD CONSTRAINT "live_activity_token_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_outage_id_outage_id_fk" FOREIGN KEY ("outage_id") REFERENCES "public"."outage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outage" ADD CONSTRAINT "outage_first_seen_run_scrape_run_id_fk" FOREIGN KEY ("first_seen_run") REFERENCES "public"."scrape_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outage" ADD CONSTRAINT "outage_last_seen_run_scrape_run_id_fk" FOREIGN KEY ("last_seen_run") REFERENCES "public"."scrape_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outage_street" ADD CONSTRAINT "outage_street_outage_id_outage_id_fk" FOREIGN KEY ("outage_id") REFERENCES "public"."outage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outage_street" ADD CONSTRAINT "outage_street_street_id_street_id_fk" FOREIGN KEY ("street_id") REFERENCES "public"."street"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outage_street" ADD CONSTRAINT "outage_street_settlement_id_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_outage_id_outage_id_fk" FOREIGN KEY ("outage_id") REFERENCES "public"."outage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "street_alias" ADD CONSTRAINT "street_alias_street_id_street_id_fk" FOREIGN KEY ("street_id") REFERENCES "public"."street"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_street_id_street_id_fk" FOREIGN KEY ("street_id") REFERENCES "public"."street"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_settlement_id_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_point_street_idx" ON "address_point" USING btree ("street_id");--> statement-breakpoint
CREATE INDEX "live_activity_device_idx" ON "live_activity_token" USING btree ("device_id","kind");--> statement-breakpoint
CREATE INDEX "notification_log_ticket_idx" ON "notification_log" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "outage_identity_idx" ON "outage" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "outage_date_idx" ON "outage" USING btree ("city","outage_date");--> statement-breakpoint
CREATE INDEX "outage_street_outage_idx" ON "outage_street" USING btree ("outage_id");--> statement-breakpoint
CREATE INDEX "outage_street_street_idx" ON "outage_street" USING btree ("street_id");--> statement-breakpoint
CREATE INDEX "outage_street_settlement_idx" ON "outage_street" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "scrape_run_started_idx" ON "scrape_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "settlement_name_norm_idx" ON "settlement" USING btree ("city","name_norm");--> statement-breakpoint
CREATE INDEX "street_geom_gix" ON "street" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "street_name_norm_trgm" ON "street" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "street_alias_raw_norm_unique" ON "street_alias" USING btree ("raw_norm");--> statement-breakpoint
CREATE INDEX "subscription_device_idx" ON "subscription" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "subscription_street_idx" ON "subscription" USING btree ("street_id");--> statement-breakpoint
CREATE INDEX "subscription_settlement_idx" ON "subscription" USING btree ("settlement_id");