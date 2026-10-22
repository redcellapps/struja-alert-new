CREATE TABLE "settlement_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"raw" text NOT NULL,
	"raw_norm" text NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "settlement_alias" ADD CONSTRAINT "settlement_alias_settlement_id_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_alias_raw_norm_unique" ON "settlement_alias" USING btree ("raw_norm");