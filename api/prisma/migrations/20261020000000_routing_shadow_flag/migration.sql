-- REQ-20261020-dd-deadline: registry row of the reviewer-routing shadow flag. OFF by default: the shadow
-- (GET /api/v1/insights/routing and the insights section) appears only after a deliberate platform switch.
-- No schema change; earlier migrations are unchanged.
INSERT INTO "feature_flags" ("key", "enabled", "version") VALUES ('intelligence.routing_shadow', false, 1);