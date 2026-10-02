const TERMINAL_COLLECTIONS = [
  "wonOpportunities",
  "lostOpportunities",
  "cancelledOpportunities",
];

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupe(records) {
  const seen = new Set();
  return (Array.isArray(records) ? records : []).filter((record) => {
    const id = Number(record?.id || 0);
    const key = id > 0 ? String(id) : JSON.stringify(record || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allOpportunities(snapshot) {
  return dedupe([
    ...(Array.isArray(snapshot?.coachOpportunities)
      ? snapshot.coachOpportunities
      : []),
    ...TERMINAL_COLLECTIONS.flatMap((key) =>
      Array.isArray(snapshot?.[key]) ? snapshot[key] : [],
    ),
    ...(Array.isArray(snapshot?.inactivePipelineOpportunities)
      ? snapshot.inactivePipelineOpportunities
      : []),
  ]);
}

function mapOpportunity(opportunity) {
  return {
    id: Number(opportunity.id),
    entityType: "opportunity",
    name: opportunity.name || "",
    accountId: Number(
      opportunity.account?.id || opportunity.accountId || 0,
    ) || null,
    accountName: opportunity.accountName || opportunity.account?.name || "",
    amountUsd: Number(opportunity.amountUsd || 0),
    closeDate: opportunity.closeDate || null,
    stageCode: opportunity.stageCode || "",
    stageName: opportunity.stageName || "",
    activationStatusCode: opportunity.activationStatusCode || "activada",
    activationStatusName: opportunity.activationStatusName || "Activada",
    commercialStatusCode: opportunity.commercialStatusCode || "en_proceso",
    lifecycle: opportunity.lifecycle || "open",
    riskLevel: opportunity.riskLevel || "low",
    riskReasons: Array.isArray(opportunity.riskReasons)
      ? opportunity.riskReasons.slice(0, 6)
      : [],
    daysSinceActivity: Number(opportunity.daysSinceActivity || 0),
    nextStep: opportunity.nextStep || null,
    nextPendingAction: opportunity.nextPendingAction || null,
  };
}

function matchesText(record, text, fields) {
  const normalizedText = normalize(text);
  if (!normalizedText) return true;
  return fields.some((field) => normalize(record?.[field]).includes(normalizedText));
}

export function searchAccounts(snapshot, { text = "", accountId = null } = {}) {
  const accounts = dedupe(Array.isArray(snapshot?.accounts) ? snapshot.accounts : []);
  return accounts
    .filter((account) => !accountId || Number(account.id) === Number(accountId))
    .filter((account) => matchesText(account, text, ["name", "registrationCode", "website"]))
    .map((account) => ({
      id: Number(account.id),
      entityType: "account",
      name: account.name || "",
      registrationCode: account.registrationCode || "",
      city: account.city || "",
      stateRegion: account.stateRegion || "",
    }));
}

export function searchOpportunities(
  snapshot,
  {
    text = "",
    accountId = null,
    stageCodes = [],
    commercialStatusCodes = [],
    activeOnly = false,
    inactiveOnly = false,
    openOnly = false,
  } = {},
) {
  const stages = new Set(stageCodes);
  const statuses = new Set(commercialStatusCodes);
  return allOpportunities(snapshot)
    .filter((opportunity) => {
      const account = opportunity.account || {};
      const opportunityAccountId = Number(
        account.id || opportunity.accountId || 0,
      );
      const activationStatusCode = String(
        opportunity.activationStatusCode || "activada",
      );
      const lifecycle = String(opportunity.lifecycle || "");
      const commercialStatusCode = String(
        opportunity.commercialStatusCode || "en_proceso",
      );
      if (accountId && opportunityAccountId !== Number(accountId)) return false;
      if (
        text &&
        !matchesText(
          { name: opportunity.name, accountName: account.name || opportunity.accountName },
          text,
          ["name", "accountName"],
        )
      )
        return false;
      if (stages.size && !stages.has(String(opportunity.stageCode || ""))) return false;
      if (statuses.size && !statuses.has(commercialStatusCode)) return false;
      if (activeOnly && activationStatusCode !== "activada") return false;
      if (inactiveOnly && activationStatusCode === "activada") return false;
      if (openOnly && lifecycle && lifecycle !== "open") return false;
      return true;
    })
    .map(mapOpportunity);
}

export function getOpportunity(snapshot, opportunityId) {
  const opportunity = allOpportunities(snapshot).find(
    (item) => Number(item.id) === Number(opportunityId),
  );
  return opportunity ? mapOpportunity(opportunity) : null;
}

export function getOpportunityActivities(snapshot, opportunityId) {
  const opportunity = allOpportunities(snapshot).find(
    (item) => Number(item.id) === Number(opportunityId),
  );
  if (!opportunity) return [];
  const activities = Array.isArray(opportunity.activities)
    ? opportunity.activities
    : Array.isArray(opportunity.workspace?.actions)
      ? opportunity.workspace.actions
      : [];
  return dedupe(activities).map((activity) => ({
    id: Number(activity.id || 0) || null,
    entityType: "activity",
    opportunityId: Number(opportunityId),
    title: activity.title || activity.name || "",
    actionType: activity.actionType || activity.action_type || "other",
    status: activity.status || "pending",
    scheduledAt: activity.scheduledAt || activity.scheduled_at || null,
    dueDate: activity.dueDate || activity.due_date || null,
    notes: activity.notes || activity.description || "",
  }));
}

export function searchContacts(snapshot, { text = "", accountId = null } = {}) {
  const contacts = dedupe(
    Array.isArray(snapshot?.contactMappings) ? snapshot.contactMappings : [],
  );
  return contacts
    .filter(
      (contact) =>
        !accountId || Number(contact.accountId || 0) === Number(accountId),
    )
    .filter((contact) =>
      matchesText(contact, text, ["name", "email", "phone", "mobile"]),
    )
    .map((contact) => ({
      id: Number(contact.id),
      entityType: "contact",
      name: contact.name || "",
      accountId: Number(contact.accountId || 0) || null,
      accountName: contact.accountName || "",
      email: contact.email || "",
      positionTitle: contact.positionTitle || contact.position_title || "",
    }));
}

export function searchLeads(snapshot, { text = "", accountId = null } = {}) {
  const leads = dedupe(Array.isArray(snapshot?.leads) ? snapshot.leads : []);
  return leads
    .filter(
      (lead) =>
        !accountId || Number(lead.accountId || 0) === Number(accountId),
    )
    .filter((lead) => matchesText(lead, text, ["title", "name", "summary"]))
    .map((lead) => ({
      id: Number(lead.id),
      entityType: "lead",
      name: lead.title || lead.name || "",
      accountId: Number(lead.accountId || 0) || null,
      accountName: lead.accountName || "",
      opportunityId: Number(lead.opportunityId || 0) || null,
      status: lead.status || lead.leadSubstatusCode || "",
    }));
}

export function getSellerPipeline(snapshot) {
  const open = searchOpportunities(snapshot, { openOnly: true }).filter(
    (opportunity) => opportunity.activationStatusCode === "activada",
  );
  const amountUsd = open.reduce((sum, opportunity) => sum + opportunity.amountUsd, 0);
  return {
    entityType: "pipeline",
    openCount: open.length,
    openAmountUsd: amountUsd,
    opportunities: open,
    riskCount: open.filter((opportunity) => opportunity.riskLevel !== "low").length,
  };
}

export function getOpportunityReadiness(snapshot, opportunityId, buildReadiness) {
  const opportunity = allOpportunities(snapshot).find(
    (item) => Number(item.id) === Number(opportunityId),
  );
  if (!opportunity || typeof buildReadiness !== "function") return null;
  return buildReadiness(opportunity);
}

export function executeCoachReadTool({
  toolName,
  snapshot,
  args = {},
  buildReadiness,
  businessRules = {},
}) {
  const scope = businessRules.scope || {};
  const opportunityTools = new Set([
    "searchOpportunities",
    "getOpportunity",
    "getOpportunityActivities",
    "getOpportunityQuotation",
    "getOpportunityReadiness",
    "getSellerPipeline",
  ]);
  const deniedTools = new Set(
    [
      scope.accountSearchAllowed === false && "searchAccounts",
      ...([...opportunityTools].map((name) =>
        scope.opportunitySearchAllowed === false && name,
      )),
      scope.contactSearchAllowed === false && "searchContacts",
      scope.leadSearchAllowed === false && "searchLeads",
    ].filter(Boolean),
  );
  if (deniedTools.has(toolName)) {
    return {
      toolName,
      readOnly: true,
      result: null,
      error: "Herramienta no permitida por la politica del canal.",
    };
  }
  const effectiveArgs =
    toolName === "searchOpportunities"
      ? {
          ...args,
          activeOnly: args.inactiveOnly
            ? false
            : args.activeOnly || businessRules.filters?.defaultActiveOnly,
          inactiveOnly: args.activeOnly
            ? false
            : args.inactiveOnly || businessRules.filters?.defaultInactiveOnly,
          openOnly: args.openOnly || businessRules.filters?.defaultOpenOnly,
        }
      : args;
  const tools = {
    searchAccounts: () => searchAccounts(snapshot, effectiveArgs),
    searchOpportunities: () => searchOpportunities(snapshot, effectiveArgs),
    getOpportunity: () => getOpportunity(snapshot, effectiveArgs.opportunityId),
    getOpportunityActivities: () =>
      getOpportunityActivities(snapshot, effectiveArgs.opportunityId),
    getOpportunityQuotation: () => {
      const quotation = snapshot.selectedOpportunityQuotation;
      return quotation &&
        (!effectiveArgs.opportunityId ||
          Number(quotation.opportunityId) === Number(effectiveArgs.opportunityId))
        ? quotation
        : null;
    },
    searchContacts: () => searchContacts(snapshot, effectiveArgs),
    searchLeads: () => searchLeads(snapshot, effectiveArgs),
    getSellerPipeline: () => getSellerPipeline(snapshot),
    getOpportunityReadiness: () =>
      getOpportunityReadiness(snapshot, effectiveArgs.opportunityId, buildReadiness),
  };
  const execute = tools[toolName];
  if (!execute) throw new Error(`Read tool no soportada: ${toolName}`);
  return {
    toolName,
    readOnly: true,
    result: execute(),
  };
}
