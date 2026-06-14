import { ShieldCheck, Network, Users } from 'lucide-react';
import type { BenchmarkComparisonResponse } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCallout } from '@/components/patterns';
import { BandComparison } from './band-comparison';
import { SkillHeatmap } from './skill-heatmap';
import { NetworkTable } from './network-table';
import {
  formatAchievement,
  formatPercentile,
  percentileQuartileLabel,
} from './band-presentation';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Render de una comparación NO suprimida. Cubre los disclaimers de modo y
// los casos de cohorte vacía. Cuando `suppressed=true` o el caller no tiene red,
// el componente NO muestra datos: solo el aviso correspondiente (H7.4 / H7.6).
// Server Component (sin estado).
// ─────────────────────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0.5">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ComparisonView({
  comparison,
}: {
  comparison: BenchmarkComparisonResponse;
}) {
  const {
    mode,
    suppressed,
    suppressionReason,
    yourSchool,
    cohort,
    networkSchools,
    thresholds,
  } = comparison;

  // ── Supresión por k-anonimato (modo global): NO mostrar datos ──
  if (suppressed) {
    return (
      <AlertCallout
        tone="warning"
        title="Muestra insuficiente para comparar"
      >
        <p>
          {suppressionReason ??
            'La cohorte no alcanza el mínimo de colegios o alumnos para una comparación anónima.'}
        </p>
        <p className="mt-1">
          Para proteger la identidad de los colegios, solo se muestran cohortes con
          al menos {thresholds.kMinSchools} colegios y {thresholds.nMinStudents}{' '}
          alumnos.
        </p>
      </AlertCallout>
    );
  }

  // ── Modo red: tabla identificada (o aviso "sin red") ──
  if (mode === 'network') {
    if (!networkSchools || networkSchools.length === 0) {
      return (
        <AlertCallout tone="info" icon={Network} title="Sin red para comparar">
          {suppressionReason ??
            'Tu colegio no pertenece a una red/sostenedor con otros colegios para comparar.'}
        </AlertCallout>
      );
    }

    return (
      <div className="space-y-6">
        <AlertCallout tone="info" icon={Network} title="Comparación identificada">
          Estás viendo los colegios de tu red/sostenedor con nombre. Esta vista es
          interna y se habilita por acuerdo del sostenedor.
        </AlertCallout>
        <NetworkTable schools={networkSchools} />
        {yourSchool && cohort ? (
          <SkillSection
            perSkillLength={cohort.perSkill.length}
            response={comparison}
          />
        ) : null}
      </div>
    );
  }

  // ── Modo global: comparación anónima ──
  if (!yourSchool || !cohort) {
    return (
      <AlertCallout tone="info" title="Sin datos para esta selección">
        No se encontró una cohorte comparable para el instrumento y filtros
        seleccionados.
      </AlertCallout>
    );
  }

  const quartile = percentileQuartileLabel(yourSchool.percentile);

  return (
    <div className="space-y-6">
      <AlertCallout tone="success" icon={ShieldCheck} title="Comparación anónima">
        Estás comparando tu colegio contra una cohorte agregada y anónima
        ({cohort.schoolCount} colegios). No se exhiben nombres ni datos de colegios
        individuales.
      </AlertCallout>

      {/* Métricas resumen: percentil + posición, sin ranking público */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Tu % de logro"
          value={formatAchievement(yourSchool.avgAchievement)}
          hint={`${yourSchool.studentCount} alumnos evaluados`}
        />
        <MetricCard
          label="Tu percentil"
          value={formatPercentile(yourSchool.percentile)}
          hint={quartile}
        />
        <MetricCard
          label="Mediana cohorte"
          value={formatAchievement(cohort.median)}
          hint={`P25 ${formatAchievement(cohort.p25)} · P75 ${formatAchievement(
            cohort.p75,
          )}`}
        />
        <MetricCard
          label="Cohorte"
          value={`${cohort.schoolCount} colegios`}
          hint={`${cohort.studentCount} alumnos`}
        />
      </div>

      <BandComparison
        yourDistribution={yourSchool.bandDistribution}
        cohortDistribution={cohort.bandDistribution}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            Brechas por habilidad
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SkillHeatmap perSkill={cohort.perSkill} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Sección de habilidades reutilizada en modo red (cuando hay cohorte agregada). */
function SkillSection({
  perSkillLength,
  response,
}: {
  perSkillLength: number;
  response: BenchmarkComparisonResponse;
}) {
  if (perSkillLength === 0 || !response.cohort) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          Brechas por habilidad (tu colegio vs red)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SkillHeatmap perSkill={response.cohort.perSkill} />
      </CardContent>
    </Card>
  );
}
