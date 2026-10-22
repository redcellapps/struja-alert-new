CREATE TABLE "alert" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outage" ADD COLUMN "flips" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_run" ADD COLUMN "page_date" date;--> statement-breakpoint
ALTER TABLE "scrape_run" ADD COLUMN "health" text;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_open_unique" ON "alert" USING btree ("kind","dedupe_key") WHERE "alert"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "scrape_run_page_idx" ON "scrape_run" USING btree ("city","page_date","id");