ALTER TYPE "public"."resolved_by" ADD VALUE 'placed' BEFORE 'unresolved';--> statement-breakpoint
ALTER TYPE "public"."resolved_by" ADD VALUE 'ambiguous' BEFORE 'unresolved';--> statement-breakpoint
ALTER TABLE "street" DROP CONSTRAINT "street_city_name_norm_unique";--> statement-breakpoint
ALTER TABLE "street" ADD COLUMN "cluster_key" text;--> statement-breakpoint
ALTER TABLE "street" ADD COLUMN "settlement_name" text;--> statement-breakpoint
ALTER TABLE "street" ADD CONSTRAINT "street_city_name_norm_cluster_unique" UNIQUE("city","name_norm","cluster_key");