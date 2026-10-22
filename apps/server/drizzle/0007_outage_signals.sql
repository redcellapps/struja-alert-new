ALTER TABLE "outage" ADD COLUMN "start_signalled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outage" ADD COLUMN "end_signalled_at" timestamp with time zone;