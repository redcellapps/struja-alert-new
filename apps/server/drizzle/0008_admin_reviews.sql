CREATE TABLE "segment_review" (
	"id" serial PRIMARY KEY NOT NULL,
	"outage_street_id" integer,
	"seg_norm" text NOT NULL,
	"kind" text NOT NULL,
	"decision" text NOT NULL,
	"street_id" integer,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "segment_review_norm_idx" ON "segment_review" USING btree ("seg_norm");--> statement-breakpoint
CREATE INDEX "segment_review_kind_idx" ON "segment_review" USING btree ("kind","decided_at");