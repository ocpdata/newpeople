export const QUOTA_PROBABILITY_STAGE_TIME_FACTORS = Object.freeze({
  contacto_inicial: 1,
  identificacion_oportunidad: 0.8,
  desarrollo: 0.6,
  cotizacion: 0.4,
  demostracion: 0.3,
  negociacion: 0.2,
  waiting: 0.1,
});

export function calculateOpportunityStageTimeFactor({
  stageCode,
  daysUntilClose,
  averageOpportunityToWinDays,
}) {
  const averageDays = Number(averageOpportunityToWinDays || 0);
  if (!(averageDays > 0)) return 1;

  const stageFactor = QUOTA_PROBABILITY_STAGE_TIME_FACTORS[stageCode] ?? 1;
  const stageDays = Math.max(1, averageDays * stageFactor);
  const availableDays = Math.max(0, Number(daysUntilClose || 0));
  return Math.max(0, Math.min(1, availableDays / stageDays));
}