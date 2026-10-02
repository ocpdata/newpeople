const STAGE_ALIASES = new Map([
  ["contacto inicial", "contacto_inicial"],
  ["contacto_inicial", "contacto_inicial"],
  ["identificacion de oportunidad", "identificacion_oportunidad"],
  ["identificacion_oportunidad", "identificacion_oportunidad"],
  ["desarrollo", "desarrollo"],
  ["cotizacion", "cotizacion"],
  ["demostracion", "demostracion"],
  ["negociacion", "negociacion"],
  ["waiting", "waiting"],
  ["espera", "waiting"],
]);

const OPPORTUNITY_STATUS_ALIASES = new Map([
  ["abierta", "en_proceso"],
  ["abierto", "en_proceso"],
  ["en proceso", "en_proceso"],
  ["ganada", "ganada"],
  ["ganado", "ganada"],
  ["perdida", "perdida"],
  ["perdido", "perdida"],
  ["anulada", "anulada"],
  ["anulado", "anulada"],
]);

const INACTIVE_TERMS = [
  "desactivada",
  "desactivado",
  "pendiente de activacion",
];

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function dedupeCoachRecords(records) {
  const seen = new Set();
  return (Array.isArray(records) ? records : []).filter((record) => {
    const id = Number(record?.id || 0);
    const key = id > 0 ? String(id) : JSON.stringify(record || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getCoachOpportunityRecords(snapshot) {
  return dedupeCoachRecords([
    ...(Array.isArray(snapshot?.coachOpportunities)
      ? snapshot.coachOpportunities
      : []),
    ...(Array.isArray(snapshot?.wonOpportunities)
      ? snapshot.wonOpportunities
      : []),
    ...(Array.isArray(snapshot?.lostOpportunities)
      ? snapshot.lostOpportunities
      : []),
    ...(Array.isArray(snapshot?.cancelledOpportunities)
      ? snapshot.cancelledOpportunities
      : []),
    ...(Array.isArray(snapshot?.inactivePipelineOpportunities)
      ? snapshot.inactivePipelineOpportunities
      : []),
  ]);
}

export function inferCoachOpportunityFilters(text, businessRules = {}) {
  const normalizedText = normalize(text);
  const stageAliases = new Map(
    Object.entries(businessRules.aliases?.stage || Object.fromEntries(STAGE_ALIASES)).map(
      ([label, code]) => [normalize(label), code],
    ),
  );
  const statusAliases = new Map(
    Object.entries(
      businessRules.aliases?.opportunityStatus ||
        Object.fromEntries(OPPORTUNITY_STATUS_ALIASES),
    ).map(([label, code]) => [normalize(label), code]),
  );
  const inactivityTerms = Array.isArray(businessRules.aliases?.inactivity)
    ? businessRules.aliases.inactivity.map(normalize)
    : INACTIVE_TERMS;
  const filters = businessRules.filters || {};
  const stageCodes = [...stageAliases.entries()]
    .filter(([label]) => normalizedText.includes(label))
    .map(([, code]) => code);
  const commercialStatusCodes = [...statusAliases.entries()]
    .filter(([label]) => normalizedText.includes(label))
    .map(([, code]) => code);
  const asksForOpen = /\b(abierta|abierto|abiertas|abiertos|en proceso|pipeline)\b/.test(
    normalizedText,
  );
  const asksForActive = /\b(activa|activo|activas|activos)\b/.test(
    normalizedText,
  );
  const asksForInactive = inactivityTerms.some((term) =>
    normalizedText.includes(term),
  );
  const inactiveOnly = asksForInactive || Boolean(filters.defaultInactiveOnly);
  const closeYearMatch = normalizedText.match(/\b(20\d{2})\b/);
  const asksForCloseDate = /\b(fecha de cierre|cierre|cierran|cerrar)\b/.test(
    normalizedText,
  );
  return {
    stageCodes: [...new Set(stageCodes)],
    commercialStatusCodes: [...new Set(commercialStatusCodes)],
    activeOnly:
      (asksForActive || (!inactiveOnly && filters.defaultActiveOnly)) &&
      !inactiveOnly,
    inactiveOnly,
    openOnly: asksForOpen || Boolean(filters.defaultOpenOnly),
    closeYear: asksForCloseDate && closeYearMatch ? Number(closeYearMatch[1]) : null,
  };
}

export function searchCoachOpportunities(snapshot, filters = {}) {
  const records = getCoachOpportunityRecords(snapshot);
  const normalizedAccountId = Number(filters.accountId || 0);
  const normalizedName = normalize(filters.name);
  const stageCodes = new Set(filters.stageCodes || []);
  const commercialStatusCodes = new Set(filters.commercialStatusCodes || []);
  const result = records.filter((opportunity) => {
    const accountId = Number(
      opportunity?.account?.id || opportunity?.accountId || 0,
    );
    const stageCode = String(opportunity?.stageCode || "").trim();
    const commercialStatusCode = String(
      opportunity?.commercialStatusCode || "",
    ).trim();
    const activationStatusCode = String(
      opportunity?.activationStatusCode || "activada",
    ).trim();
    const lifecycle = String(opportunity?.lifecycle || "").trim();
    const closeYear = opportunity?.closeDate
      ? new Date(opportunity.closeDate).getFullYear()
      : null;
    const accountName = normalize(
      opportunity?.accountName || opportunity?.account?.name,
    );
    const opportunityName = normalize(opportunity?.name);

    if (normalizedAccountId && accountId !== normalizedAccountId) return false;
    if (
      normalizedName &&
      !opportunityName.includes(normalizedName) &&
      !accountName.includes(normalizedName)
    )
      return false;
    if (stageCodes.size && !stageCodes.has(stageCode)) return false;
    if (
      commercialStatusCodes.size &&
      commercialStatusCode &&
      !commercialStatusCodes.has(commercialStatusCode)
    )
      return false;
    if (filters.activeOnly && activationStatusCode !== "activada") return false;
    if (filters.inactiveOnly && activationStatusCode === "activada") return false;
    if (filters.openOnly && lifecycle && lifecycle !== "open") return false;
    if (filters.closeYear && closeYear !== Number(filters.closeYear)) return false;
    return true;
  });
  return dedupeCoachRecords(result);
}

export function getCoachReadToolCatalog() {
  return [
    {
      name: "searchAccounts",
      description: "Busca cuentas autorizadas por nombre o identificador.",
      requiredPermission: "cuentas.read",
      readOnly: true,
    },
    {
      name: "searchOpportunities",
      description:
        "Busca oportunidades autorizadas por nombre, cuenta, etapa, estado y activacion.",
      requiredPermission: "oportunidades.read",
      readOnly: true,
    },
    {
      name: "getOpportunity",
      description: "Obtiene el detalle de una oportunidad autorizada.",
      requiredPermission: "oportunidades.read",
      readOnly: true,
    },
    {
      name: "getOpportunityActivities",
      description: "Obtiene actividades y siguientes pasos de una oportunidad.",
      requiredPermissions: ["oportunidades.read", "desarrollo_comercial.read"],
      readOnly: true,
    },
    {
      name: "getOpportunityQuotation",
      description:
        "Consulta la última cotizacion autorizada de una oportunidad y sus partidas comerciales.",
      requiredPermission: "oportunidades.read",
      requiredAnyPermissions: [
        "cotizaciones.operacion",
        "cotizaciones.revision",
        "cotizaciones.ingreso",
        "cotizaciones.aprobacion_humana",
        "cotizaciones.aprobacion_ia",
        "cotizaciones.administracion",
        "cotizaciones.externo",
      ],
      readOnly: true,
    },
    {
      name: "searchContacts",
      description: "Busca contactos autorizados relacionados con una cuenta.",
      requiredPermission: "contactos.read",
      readOnly: true,
    },
    {
      name: "searchLeads",
      description: "Busca leads autorizados solo cuando la intencion es lead.",
      requiredPermission: "interacciones.read",
      readOnly: true,
    },
    {
      name: "getSellerPipeline",
      description: "Consulta pipeline, riesgos y cobertura del vendedor.",
      requiredPermissions: ["oportunidades.read", "desarrollo_comercial.read"],
      readOnly: true,
    },
    {
      name: "getOpportunityReadiness",
      description: "Evalua la preparacion de una oportunidad para su etapa actual.",
      requiredPermissions: ["oportunidades.read", "desarrollo_comercial.read"],
      readOnly: true,
    },
  ];
}
