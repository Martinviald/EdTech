CREATE INDEX "taxonomy_nodes_parent_idx" ON "taxonomy_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "item_taxonomy_tags_node_idx" ON "item_taxonomy_tags" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "items_org_status_idx" ON "items" USING btree ("org_id","status");