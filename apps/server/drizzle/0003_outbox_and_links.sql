ALTER TABLE "notification_log" ALTER COLUMN "sent_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notification_log" ALTER COLUMN "sent_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "deliver_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outage" ADD COLUMN "superseded_by_outage_id" integer;--> statement-breakpoint
ALTER TABLE "outage" ADD COLUMN "change_group_id" integer;--> statement-breakpoint
CREATE INDEX "notification_log_pending_idx" ON "notification_log" USING btree ("status","deliver_at");