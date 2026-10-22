ALTER TYPE "public"."notification_kind" ADD VALUE 'reinstated';--> statement-breakpoint
ALTER TABLE "notification_log" DROP CONSTRAINT "notification_log_dedupe";--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outage" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_dedupe" UNIQUE("subscription_id","outage_id","kind","revision");