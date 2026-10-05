CREATE TABLE "benchmark_item_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"response_count" integer DEFAULT 0 NOT NULL,
	"opt_out_global_pool" boolean DEFAULT false NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_item_aggregates_org_item_uq" UNIQUE("org_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "benchmark_item_aggregates" ADD CONSTRAINT "benchmark_item_aggregates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_item_aggregates" ADD CONSTRAINT "benchmark_item_aggregates_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_item_aggregates" ADD CONSTRAINT "benchmark_item_aggregates_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benchmark_item_aggregates_instrument_idx" ON "benchmark_item_aggregates" USING btree ("instrument_id");