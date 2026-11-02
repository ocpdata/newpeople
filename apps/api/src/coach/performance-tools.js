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
  Object.freeze({
    name: "getSellerAgenda",
    description:
      "Agenda del vendedor que pregunta: acciones pendientes de sus oportunidades abiertas y actividades del calendario, con las vencidas, las de hoy y las de esta semana.",
    requiredPermission: "oportunidades.read",
    readOnly: true,
  }),
  Object.freeze({
    name: "getSellerClosedDeals",
    description:
      "Historial de cierres del vendedor que pregunta: ganadas, perdidas y anuladas, tasa de cierre, ciclo de venta promedio y motivos de pérdida recientes.",
    requiredPermission: "oportunidades.read",
    readOnly: true,
  }),
  Object.freeze({
    name: "getSellerCommission",
    description:
      "Comisión del vendedor que pregunta en el trimestre: cuota, venta aceptada, cumplimiento frente al 70% requerido, porcentajes por categoría, comisión calculada, cotizaciones elegibles o bloqueadas y ganadas pendientes de aceptar.",
    requiredPermission: "planeacion_comercial.read",
    readOnly: true,
  }),
  Object.freeze({
    name: "getSellerTrend",
    description:
      "Tendencia del vendedor que pregunta: oportunidades creadas y ganadas por semana y por mes (semana y mes actuales frente a los anteriores).",
    requiredPermission: "oportunidades.read",
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
  return needsSellerPerformance(text) || /\b(mi|mis|mio|mios|llevo|gano|ganaria)\b/.test(text);
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

// ---------------------------------------------------------------------------------------------------------------
// Agenda, closed deals and trend. They read the seller's own records (seller of the opportunity) and shape them here.

const localIso = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const addDaysIso = (iso, days) => {
  const [year, month, day] = iso.split("-").map(Number);
  return localIso(new Date(year, month - 1, day + days));
};
const mondayOf = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  const offset = (new Date(year, month - 1, day).getDay() + 6) % 7;
  return addDaysIso(iso, -offset);
};
const toIso = (value) => (value instanceof Date ? localIso(value) : value ? String(value).slice(0, 10) : null);
const clip = (value, max) => String(value ?? "").trim().slice(0, max);

export function shapeAgenda({ actions = [], calendar = [], today }) {
  const weekEnd = addDaysIso(mondayOf(today), 6);
  const describe = (item) => {
    const dueDate = toIso(item.dueDate);
    return { ...item, dueDate, overdue: Boolean(dueDate && dueDate < today), dueToday: dueDate === today, dueThisWeek: Boolean(dueDate && dueDate >= today && dueDate <= weekEnd) };
  };
  const workspace = actions.map(describe);
  const events = calendar.map((item) => describe({ ...item, scheduledAt: item.scheduledAt ? String(item.scheduledAt) : null }));
  const summarize = (list) => ({
    open: list.length,
    overdue: list.filter((item) => item.overdue).length,
    dueToday: list.filter((item) => item.dueToday).length,
    dueThisWeek: list.filter((item) => item.dueThisWeek).length,
    withoutDate: list.filter((item) => !item.dueDate).length,
  });
  const order = (left, right) => (left.dueDate || "9999").localeCompare(right.dueDate || "9999");
  return {
    entityType: "seller_agenda",
    asOf: today,
    weekEnd,
    definitions: {
      workspaceActions: "Acciones pendientes, en curso o bloqueadas de tus oportunidades abiertas (donde eres el vendedor).",
      calendarActivities: "Actividades de tu calendario comercial pendientes o confirmadas.",
      overdue: "Con fecha anterior a hoy.",
      note: "Los vencidos de Ritmo comercial cuentan solo el siguiente paso de las oportunidades del trimestre; aquí se listan todas las acciones.",
    },
    focus: [...workspace, ...events]
      .filter((item) => item.overdue || item.dueToday || item.dueThisWeek)
      .sort(order)
      .slice(0, 6)
      .map((item) => `${item.overdue ? "Vencida" : item.dueToday ? "Para hoy" : "Esta semana"} (${item.dueDate}): ${item.title}${item.opportunity ? ` — ${item.opportunity}` : ""}`),
    workspaceActions: { ...summarize(workspace), items: [...workspace].sort(order).slice(0, MAX_LISTED) },
    calendarActivities: { ...summarize(events), items: [...events].sort(order).slice(0, MAX_LISTED) },
  };
}

export function shapeClosedDeals({ totals = [], recentLost = [] }) {
  const byStatus = Object.fromEntries(totals.map((row) => [row.status, row]));
  const count = (status) => Number(byStatus[status]?.count || 0);
  const amountOf = (status) => amount(byStatus[status]?.amount);
  const decided = count("ganada") + count("perdida");
  return {
    entityType: "seller_closed_deals",
    definitions: {
      scope: "Oportunidades donde eres el vendedor, de todos los periodos y sin importar si están activadas.",
      winRate: "Ganadas entre ganadas más perdidas; las anuladas no cuentan.",
      cycle: "Días promedio entre la creación y el cierre de las ganadas.",
    },
    won: { count: count("ganada"), amountUsd: amountOf("ganada"), averageCycleDays: byStatus.ganada?.cycleDays == null ? null : Math.round(Number(byStatus.ganada.cycleDays)) },
    lost: { count: count("perdida"), amountUsd: amountOf("perdida") },
    cancelled: { count: count("anulada"), amountUsd: amountOf("anulada") },
    winRatePct: decided ? round((count("ganada") / decided) * 100, 1) : null,
    decided,
    recentLostOrCancelled: recentLost.slice(0, 8).map((row) => ({
      name: row.name, account: row.account, status: row.status, amountUsd: amount(row.amountUsd), closedAt: toIso(row.closedAt), reason: clip(row.reason, 220) || null,
    })),
  };
}

export function shapeTrend({ opportunities = [], today, weeks = 8 }) {
  const thisMonday = mondayOf(today);
  const weekKeys = Array.from({ length: weeks }, (_, index) => addDaysIso(thisMonday, (index - (weeks - 1)) * 7));
  const monthOf = (iso) => (iso ? iso.slice(0, 7) : null);
  const thisMonth = monthOf(today);
  const [year, month] = thisMonth.split("-").map(Number);
  const previousMonth = localIso(new Date(year, month - 2, 1)).slice(0, 7);
  const empty = () => ({ created: 0, won: 0, wonAmountUsd: 0 });
  const weekly = Object.fromEntries(weekKeys.map((key) => [key, empty()]));
  const monthly = { [thisMonth]: empty(), [previousMonth]: empty() };
  const add = (bucket, field, value = 0) => {
    if (!bucket) return;
    bucket[field] += 1;
    if (field === "won") bucket.wonAmountUsd += Number(value || 0);
  };
  for (const row of opportunities) {
    const created = toIso(row.createdAt);
    const closed = row.status === "ganada" ? toIso(row.closedAt) : null;
    if (created) {
      add(weekly[mondayOf(created)], "created");
      add(monthly[monthOf(created)], "created");
    }
    if (closed) {
      add(weekly[mondayOf(closed)], "won", row.amountUsd);
      add(monthly[monthOf(closed)], "won", row.amountUsd);
    }
  }
  const series = weekKeys.map((key) => ({ weekStart: key, partial: key === thisMonday, ...weekly[key], wonAmountUsd: amount(weekly[key].wonAmountUsd) }));
  const lastComplete = series[series.length - 2];
  const beforeThat = series[series.length - 3];
  const monthRow = (key) => ({ month: key, ...monthly[key], wonAmountUsd: amount(monthly[key].wonAmountUsd) });
  return {
    entityType: "seller_trend",
    asOf: today,
    definitions: {
      weeks: "Semanas de lunes a domingo. La semana en curso está incompleta (partial) y no debe compararse con las completas.",
      created: "Oportunidades creadas donde eres el vendedor.",
      won: "Oportunidades ganadas según su fecha de cierre.",
    },
    weeklySeries: series,
    lastCompleteWeekVsPrevious: lastComplete && beforeThat ? { lastCompleteWeek: lastComplete, weekBefore: beforeThat, createdChange: lastComplete.created - beforeThat.created, wonChange: lastComplete.won - beforeThat.won } : null,
    monthVsPrevious: { currentMonth: monthRow(thisMonth), previousMonth: monthRow(previousMonth), createdChange: monthly[thisMonth].created - monthly[previousMonth].created },
  };
}

export async function loadSellerAgenda({ run, sellerId, today = localIso(new Date()) }) {
  const [actions, calendar] = await Promise.all([
    run(
      `SELECT a.title, a.action_type AS actionType, a.status, a.due_date AS dueDate, o.name AS opportunity, acc.name AS account
       FROM opportunity_workspace_actions a
       JOIN opportunities o ON o.id = a.opportunity_id
       JOIN accounts acc ON acc.id = o.account_id
       JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
       WHERE o.seller_user_id = ? AND cs.code = 'en_proceso' AND a.status IN ('pending', 'in_progress', 'blocked')
       ORDER BY a.due_date IS NULL, a.due_date, a.id LIMIT 300`,
      [Number(sellerId)],
    ),
    run(
      `SELECT activity_type AS actionType, status, due_date AS dueDate, scheduled_at AS scheduledAt, objective AS title
       FROM commercial_calendar_activities WHERE seller_user_id = ? AND status IN ('pending', 'confirmed')
       ORDER BY due_date IS NULL, due_date, id LIMIT 300`,
      [Number(sellerId)],
    ),
  ]);
  return shapeAgenda({
    actions: actions.map((row) => ({ title: clip(row.title, 160), actionType: row.actionType, status: row.status, dueDate: row.dueDate, opportunity: row.opportunity, account: row.account })),
    calendar: calendar.map((row) => ({ title: clip(row.title, 160), actionType: row.actionType, status: row.status, dueDate: row.dueDate, scheduledAt: row.scheduledAt })),
    today,
  });
}

export async function loadSellerClosedDeals({ run, sellerId }) {
  const [totals, recentLost] = await Promise.all([
    run(
      `SELECT cs.code AS status, COUNT(*) AS count, COALESCE(SUM(o.amount_usd), 0) AS amount,
              AVG(DATEDIFF(o.commercial_closed_at, o.created_at)) AS cycleDays
       FROM opportunities o JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
       WHERE o.seller_user_id = ? GROUP BY cs.code`,
      [Number(sellerId)],
    ),
    run(
      `SELECT o.name, acc.name AS account, cs.code AS status, o.amount_usd AS amountUsd, o.commercial_closed_at AS closedAt,
              o.commercial_close_reason AS reason
       FROM opportunities o JOIN accounts acc ON acc.id = o.account_id
       JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
       WHERE o.seller_user_id = ? AND cs.code IN ('perdida', 'anulada')
       ORDER BY o.commercial_closed_at DESC, o.id DESC LIMIT 8`,
      [Number(sellerId)],
    ),
  ]);
  return shapeClosedDeals({
    totals: totals.map((row) => ({ status: row.status, count: row.count, amount: row.amount, cycleDays: row.cycleDays })),
    recentLost,
  });
}

export async function loadSellerTrend({ run, sellerId, today = localIso(new Date()) }) {
  const since = addDaysIso(mondayOf(today), -7 * 9 - 40);
  const rows = await run(
    `SELECT o.created_at AS createdAt, o.commercial_closed_at AS closedAt, o.amount_usd AS amountUsd, cs.code AS status
     FROM opportunities o JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
     WHERE o.seller_user_id = ? AND (o.created_at >= ? OR o.commercial_closed_at >= ?)`,
    [Number(sellerId), since, since],
  );
  return shapeTrend({ opportunities: rows, today });
}

export async function readSellerTool({ toolName, user, buildLeague, listQuarterItems = null, buildCommissionTracking = null, run }) {
  const sellerId = Number(user?.id || 0);
  if (toolName === "getSellerPerformance") return readSellerPerformance({ user, buildLeague, listQuarterItems, run });
  if (toolName === "getSellerAgenda") return loadSellerAgenda({ run, sellerId });
  if (toolName === "getSellerClosedDeals") return loadSellerClosedDeals({ run, sellerId });
  if (toolName === "getSellerTrend") return loadSellerTrend({ run, sellerId });
  if (toolName === "getSellerCommission") return loadSellerCommission({ run, sellerId, buildCommissionTracking });
  throw new Error(`Herramienta de vendedor desconocida: ${toolName}`);
}

const TOOL_QUESTION_PATTERNS = {
  getSellerAgenda: /\b(hoy|agenda|pendientes?|actividades|que (?:debo|debería|deberia) hacer|vencid[oa]s?|esta semana|proxim[oa]s? pasos?)\b/,
  getSellerClosedDeals: /\b(perdi|perdidas?|perdidos?|ganadas?|ganados?|tasa de cierre|ciclo de venta|cuanto tardo|motivos? de perdida|por que perdi)\b/,
  getSellerCommission: /\b(comision|comisiones|comisionar|cuanto gano|cuanto ganaria|cuanto voy a ganar)\b/,
  getSellerTrend: /\b(semana pasada|mes anterior|mes pasado|mejor o peor|tendencia|este mes|mensual|semanal|vs|frente al)\b/,
};

// The seller tools a question needs, so they are always read for the seller's own numbers.
export function sellerToolsFor(question) {
  const text = String(question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tools = Object.entries(TOOL_QUESTION_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  if (needsSellerPerformance(text)) tools.unshift("getSellerPerformance");
  return [...new Set(tools)];
}

// ---------------------------------------------------------------------------------------------------------------
// Commission: the seller's own row of the same tracking calculation shown in Planeación comercial.

const COMMISSION_RULES = Object.freeze({
  quotaThresholdPct: 70,
  minimumQuotationMarginPct: 10,
  rules: [
    "Solo cuentan las cotizaciones aceptadas, ubicadas en el trimestre de la fecha de cierre de su oportunidad ganada.",
    "Se necesita al menos 70% de la cuota trimestral aceptada para habilitar comisión; si se alcanza al cierre del trimestre, todas las cotizaciones elegibles quedan habilitadas.",
    "Una cotización con margen menor a 10% no genera comisión, pero sí cuenta para el cumplimiento de cuota.",
    "La comisión es contribución por item multiplicada por el porcentaje de su categoría (productos, servicios o renovaciones).",
    "Una cotización solo ganada, sin aceptar, todavía no suma ni genera comisión.",
  ],
});

export function shapeCommission({ tracking, sellerId, period = null }) {
  const summary = (tracking?.summaries || []).find((item) => Number(item.sellerUserId) === Number(sellerId));
  const pending = (tracking?.pendingQuotations || []).filter((item) => Number(item.sellerUserId) === Number(sellerId));
  const base = { entityType: "seller_commission", period: tracking?.period || period, ...COMMISSION_RULES };
  if (!summary) {
    return { ...base, hasCommissionData: false, note: "No hay configuración de comisión ni cotizaciones aceptadas para este vendedor en el trimestre." };
  }
  const quota = amount(summary.salesQuotaAmount);
  const accepted = amount(summary.acceptedSalesAmount);
  const required = amount(quota * (COMMISSION_RULES.quotaThresholdPct / 100));
  return {
    ...base,
    hasCommissionData: true,
    currencyCode: summary.currencyCode || tracking?.baseCurrencyCode || "USD",
    quota: { amount: quota, acceptedSales: accepted, attainmentPct: round(summary.quotaAttainmentPct, 2), requiredToEnable: required, missingToEnable: amount(Math.max(required - accepted, 0)) },
    enabled: Boolean(summary.commissionEnabled),
    percentages: { products: round(summary.productCommissionPct, 2), services: round(summary.serviceCommissionPct, 2), renewals: round(summary.renewalCommissionPct, 2) },
    quotations: {
      accepted: Number(summary.acceptedQuotationCount || 0),
      eligible: Number(summary.eligibleQuotationCount || 0),
      blockedByLowMargin: Number(summary.blockedLowMarginQuotationCount || 0),
      blockedByQuota: Number(summary.blockedByQuotaQuotationCount || 0),
    },
    commission: {
      total: amount(summary.calculatedTotalCommissionAmount),
      products: amount(summary.calculatedProductCommissionAmount),
      services: amount(summary.calculatedServiceCommissionAmount),
      renewals: amount(summary.calculatedRenewalCommissionAmount),
    },
    acceptedQuotations: (summary.quotations || []).slice(0, MAX_LISTED).map((quotation) => ({
      proposal: clip(quotation.proposalName, 120), account: clip(quotation.accountName, 120), opportunity: clip(quotation.opportunityName, 120),
      saleAmount: amount(quotation.totalSaleAmount), marginPct: round(quotation.quotationMarginPct, 2), passesMargin: Boolean(quotation.passesMarginRule),
    })),
    pendingAcceptance: { count: pending.length, items: pending.slice(0, MAX_LISTED).map((quotation) => ({ proposal: clip(quotation.proposalName, 120), account: clip(quotation.accountName, 120), saleAmount: amount(quotation.totalSaleAmount) })) },
  };
}

export async function loadSellerCommission({ run, sellerId, buildCommissionTracking, now = new Date() }) {
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const rows = await run(
    "SELECT id FROM commercial_planning_periods WHERE plan_year = ? AND plan_quarter = ? ORDER BY id DESC LIMIT 1",
    [now.getFullYear(), quarter],
  );
  if (!rows[0]) return { entityType: "seller_commission", hasCommissionData: false, ...COMMISSION_RULES, note: "No hay un periodo de planeación para el trimestre actual." };
  const tracking = await buildCommissionTracking(Number(rows[0].id));
  return shapeCommission({ tracking, sellerId });
}
