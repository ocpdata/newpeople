// Seller performance for the Coach chat: quota, gap, pipeline, discipline and rank. The numbers come from the same
// calculation that feeds Ritmo comercial, so Coach and that screen always agree. "Mis oportunidades" means the
// opportunities where the asking user is the seller; account ownership only decides what the user may see.

export const COACH_PERFORMANCE_TOOLS = Object.freeze([
  Object.freeze({
    name: "getSellerPerformance",
    description:
      "Desempeño del vendedor que pregunta en el trimestre: cuota, avance, brecha, días restantes, pipeline abierto y del trimestre, vencidos, sin siguiente paso, lugar en el equipo y puntuación.",
    requiredPermission: "ritmo_comercial.read",
    readOnly: true,
  }),
]);

export const COACH_PERFORMANCE_TOOL_NAMES = Object.freeze(
  COACH_PERFORMANCE_TOOLS.map((tool) => tool.name),
);

const round = (value, digits = 2) => {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
};
const amount = (value) => round(value || 0, 2);

const SCORE_LABELS = {
  closing: "cierre",
  build: "construcción de pipeline",
  discipline: "disciplina de seguimiento",
};

// Shapes the league payload and the seller's own open pipeline into what the model may read. Other sellers are only
// named for users who can read the whole league; everyone else sees their own position and the team size.
export function shapeSellerPerformance({ league, sellerId, openPipeline, canSeeTeamDetail = false, quarterItems = null }) {
  const rows = Array.isArray(league?.leaderboard) ? league.leaderboard : [];
  const me = rows.find((row) => Number(row.sellerUserId) === Number(sellerId));
  const period = league?.quarterContext?.current || {};
  const periodInfo = {
    label: period.label || null,
    startDate: period.startDate || null,
    endDate: period.endDate || null,
    daysElapsed: period.daysElapsed ?? null,
    daysRemaining: period.daysRemaining ?? null,
    weeksRemaining: period.weeksRemaining ?? null,
  };
  const labels = {
    openPipeline: "Pipeline abierto",
    quarterPipeline: "Pipeline del trimestre",
    nextQuarterPipeline: "Pipeline del siguiente Q",
  };
  const definitions = {
    openPipeline: "Oportunidades donde eres el vendedor, en proceso y activadas, sin importar su fecha de cierre.",
    quarterPipeline: "Las abiertas cuya fecha de cierre cae en el trimestre actual. Es la base de la cobertura, los vencidos y los sin siguiente paso.",
    ranking: "Lugar entre los vendedores con meta del trimestre según la puntuación de Ritmo comercial (cierre 50%, construcción 30%, disciplina 20%).",
  };
  if (!me) {
    return {
      entityType: "seller_performance",
      period: periodInfo,
      labels,
      definitions,
      hasQuarterTarget: false,
      openPipeline,
      note: "El vendedor no aparece en Ritmo comercial este trimestre (sin meta asignada), por lo que no hay cuota, avance ni lugar en el equipo.",
    };
  }
  const quota = amount(me.quotaAmountUsd);
  const won = amount(me.wonAmountUsd);
  const gap = amount(me.gapAmountUsd);
  const weeks = Number(periodInfo.weeksRemaining) || 0;
  const weighted = amount(me.pipelineWeightedUsd);
  const scores = { closing: round(me.scoreClosing, 1), build: round(me.scoreBuild, 1), discipline: round(me.scoreDiscipline, 1) };
  const scored = Object.entries(scores).filter(([, value]) => value !== null);
  const minimum = scored.length ? Math.min(...scored.map(([, value]) => value)) : null;
  const lowestDimensions = scored.filter(([, value]) => value === minimum).map(([key]) => SCORE_LABELS[key]);
  const ranked = rows
    .map((row) => ({ position: row.rankPosition, name: row.sellerUserName, score: round(row.scoreTotal, 1) }))
    .sort((left, right) => left.position - right.position);
  return {
    entityType: "seller_performance",
    period: periodInfo,
    labels,
    definitions,
    hasQuarterTarget: quota > 0,
    quota: {
      amountUsd: quota,
      wonUsd: won,
      attainmentPct: round(me.attainmentPct, 1),
      gapUsd: gap,
      weeklyNeededUsd: weeks > 0 ? amount(gap / weeks) : null,
    },
    openPipeline,
    quarterPipeline: {
      count: Number(me.openOpportunities || 0),
      amountUsd: amount(me.funnelOpenAmountUsd),
      weightedUsd: weighted,
      timeWeightedUsd: amount(me.timeWeightedCurrentOpenPipelineUsd),
      coverageOfGapRatio: gap > 0 ? round(weighted / gap, 2) : null,
    },
    coverage: {
      gapUsd: gap,
      quarterWeightedUsd: weighted,
      quarterWeightedCoversPct: gap > 0 ? round((weighted / gap) * 100, 1) : null,
      quarterWeightedCoversGap: gap > 0 ? weighted >= gap : true,
      openPipelineUsd: openPipeline?.amountUsd ?? null,
      openPipelineCoversPct: gap > 0 && openPipeline ? round((openPipeline.amountUsd / gap) * 100, 1) : null,
      note: "La brecha es cuota menos lo ya ganado; el pipeline no se resta de la cuota. Cobertura = pipeline ponderado entre brecha.",
    },
    ...(Array.isArray(quarterItems) ? { quarterOpportunities: describeQuarterItems(quarterItems) } : {}),
    nextQuarterPipelineUsd: amount(me.nextQuarterTimeWeightedOpenPipelineUsd ?? me.nextQuarterOpenPipelineUsd),
    discipline: {
      overdueCount: Number(me.overdueCount || 0),
      noNextStepCount: Number(me.noNextStepCount || 0),
      note: "Cuentan solo las oportunidades del pipeline del trimestre.",
    },
    ranking: {
      position: me.rankPosition ?? null,
      sellers: rows.length,
      score: round(me.scoreTotal, 1),
      scores,
      lowestDimensions,
      lowestDimensionsNote: lowestDimensions.length > 1 ? "Hay empate en la puntuación más baja." : null,
      pointsToNextPosition: me.rankGapToNext === null || me.rankGapToNext === undefined ? null : round(me.rankGapToNext, 1),
      leaderScore: ranked[0]?.score ?? null,
      ...(canSeeTeamDetail ? { table: ranked } : {}),
    },
  };
}

const MAX_LISTED = 15;
const isoDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);

// The quarter's opportunities with the two flags Ritmo comercial counts: no next step, and next step overdue.
export function describeQuarterItems(items, today = todayIso()) {
  const described = items.map((item) => {
    const dueDate = isoDate(item.nextStep?.dueDate);
    return {
      name: item.name || item.opportunityName || "",
      account: item.accountName || "",
      amountUsd: amount(item.amountUsd),
      closeDate: isoDate(item.closeDate),
      nextStep: item.nextStep ? { title: item.nextStep.title || "", dueDate } : null,
      withoutNextStep: !item.nextStep,
      overdue: Boolean(dueDate && dueDate < today),
    };
  });
  return {
    count: described.length,
    withoutNextStep: described.filter((item) => item.withoutNextStep).map((item) => item.name),
    overdue: described.filter((item) => item.overdue).map((item) => ({ name: item.name, dueDate: item.nextStep.dueDate })),
    items: described.slice(0, MAX_LISTED),
  };
}

// Reads the seller's own open pipeline directly: seller of the opportunity, in process and activated.
export async function loadOpenPipeline({ run, sellerId }) {
  const rows = await run(
    `SELECT COUNT(*) AS count, COALESCE(SUM(o.amount_usd), 0) AS amount
     FROM opportunities o
     JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
     JOIN opportunity_activation_statuses aas ON aas.id = o.activation_status_id
     WHERE o.seller_user_id = ? AND cs.code = 'en_proceso' AND aas.code = 'activada'`,
    [Number(sellerId)],
  );
  return { count: Number(rows[0]?.count || 0), amountUsd: amount(rows[0]?.amount) };
}

export async function readSellerPerformance({ user, buildLeague, listQuarterItems = null, run }) {
  const sellerId = Number(user?.id || 0);
  const [league, openPipeline, quarterItems] = await Promise.all([
    buildLeague({ user, forceGlobalScope: true }),
    loadOpenPipeline({ run, sellerId }),
    listQuarterItems ? listQuarterItems({ user, sellerUserId: sellerId }) : null,
  ]);
  const canSeeTeamDetail = Boolean(user?.permissionSet?.has?.("ritmo_comercial.read_all"));
  return shapeSellerPerformance({ league, sellerId, openPipeline, canSeeTeamDetail, quarterItems });
}

// "Mis oportunidades" are the ones where the asking user is the seller; the opportunity list Coach loads also holds
// those of the user's accounts that another seller carries.
export function keepOwnOpportunities(pipeline, sellerId, snapshotOpportunities = []) {
  if (!pipeline || !Array.isArray(pipeline.opportunities)) return pipeline;
  const ownIds = new Set(
    (Array.isArray(snapshotOpportunities) ? snapshotOpportunities : [])
      .filter((opportunity) => Number(opportunity?.sellerUserId) === Number(sellerId))
      .map((opportunity) => Number(opportunity.id)),
  );
  const own = pipeline.opportunities.filter((opportunity) => ownIds.has(Number(opportunity?.id)));
  return {
    ...pipeline,
    opportunities: own,
    openCount: own.length,
    openAmountUsd: own.reduce((sum, opportunity) => sum + Number(opportunity.amountUsd || 0), 0),
    riskCount: own.filter((opportunity) => opportunity.riskLevel !== "low").length,
    scope: "Oportunidades donde eres el vendedor, en proceso y activadas.",
  };
}

const PERFORMANCE_QUESTION = /\b(cuota|meta|brecha|ritmo|ranking|lugar|posicion|puntuacion|puntos|vencid[oa]s?|(?:sin|no tienen?|falta de) siguiente paso|cobertura|alcanza|cubrir|cuanto me falta|me falta|dias quedan|por semana)\b/;

// Questions about the seller's own numbers must always read the shared calculation, whatever tool the planner chose.
export function needsSellerPerformance(question) {
  const text = String(question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return PERFORMANCE_QUESTION.test(text);
}

// A list of opportunities asked as "mis oportunidades" or about the seller's own numbers holds only the ones they carry.
export function asksForOwnOpportunities(question) {
  const text = String(question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return needsSellerPerformance(text) || /\b(mi|mis|mio|mios)\b/.test(text);
}

export function keepOwnOpportunityList(records, sellerId, snapshotOpportunities = []) {
  if (!Array.isArray(records)) return records;
  const ownIds = new Set(
    (Array.isArray(snapshotOpportunities) ? snapshotOpportunities : [])
      .filter((opportunity) => Number(opportunity?.sellerUserId) === Number(sellerId))
      .map((opportunity) => Number(opportunity.id)),
  );
  return records.filter((record) => ownIds.has(Number(record?.id)));
}

const hasGlobalScope = (user) =>
  Boolean(
    user?.permissionSet?.has?.("oportunidades.read_all") ||
      (Array.isArray(user?.roles) && user.roles.some((role) => role?.is_system || role?.name === "Administrador")),
  );

// The seller pipeline is the user's own unless a user with global scope asks about the whole portfolio.
export function pipelineIsOwn({ question, user }) {
  return asksForOwnOpportunities(question) || !hasGlobalScope(user);
}
