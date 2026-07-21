CREATE TYPE "public"."instrument_application_period" AS ENUM('diagnostico', 'intermedio', 'cierre');--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "application_period" "instrument_application_period";--> statement-breakpoint
-- Backfill: hasta ahora el momento de aplicación se escribía en `version` (texto
-- libre) y espejado en `config->>'applicationPeriod'`. Se migra al enum tipado
-- tomando sólo los valores que calzan exacto; cualquier otro texto en `version`
-- (p. ej. "Forma A") se deja intacto porque es una versión real, no un momento.
UPDATE "instruments"
SET "application_period" = COALESCE("version", "config" ->> 'applicationPeriod')::"public"."instrument_application_period"
WHERE "application_period" IS NULL
  AND COALESCE("version", "config" ->> 'applicationPeriod') IN ('diagnostico', 'intermedio', 'cierre');--> statement-breakpoint
-- `version` deja de cargar el momento: ya migró a su columna. Si no se limpia, la
-- UI lo muestra dos veces ("Diagnóstico" y "v diagnostico"). Sólo se vacía cuando
-- su texto ES el momento recién migrado, nunca una versión real.
UPDATE "instruments"
SET "version" = NULL
WHERE "version" IS NOT NULL
  AND "application_period" IS NOT NULL
  AND "version" = "application_period"::text;