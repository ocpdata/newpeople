const NON_IDENTIFYING_TOKENS = new Set([
  "para",
  "esta",
  "este",
  "estas",
  "estos",
  "esa",
  "ese",
  "esas",
  "esos",
  "oportunidad",
  "oportunidades",
  "etapa",
  "etapas",
  "estado",
  "estados",
  "stage",
  "stages",
  "cuenta",
  "cuentas",
  "cotizacion",
  "cotizaciones",
  "propuesta",
  "propuestas",
  "producto",
  "productos",
  "servicio",
  "servicios",
  "lubricantes",
  "abierta",
  "abiertas",
  "abierto",
  "abiertos",
  "activa",
  "activas",
  "activo",
  "activos",
  "ganada",
  "ganadas",
  "ganado",
  "ganados",
  "perdida",
  "perdidas",
  "perdido",
  "perdidos",
  "anulada",
  "anuladas",
  "anulado",
  "anulados",
  "cuanto",
  "cuantos",
  "cuanta",
  "cuantas",
  "cual",
  "cuales",
  "que",
  "fue",
  "fueron",
  "incluyo",
  "incluyeron",
  "tiene",
  "tienen",
  "hemos",
  "vendido",
  "vendimos",
  "comprado",
  "compramos",
]);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function candidates(
  records,
  text,
  fields,
  { allowSingleTokenMatch = true } = {},
) {
  const normalizedText = normalize(text);
  const normalizedTextTokens = new Set(normalizedText.split(" "));
  const matches = records
    .map((record) => {
      const labels = fields
        .map((field) => normalize(record?.[field]))
        .filter((label) => label.length >= 3);
      const match = labels
        .map((label) => {
          const tokens = label
            .split(" ")
            .filter(
              (token) =>
                token.length >= 3 && !NON_IDENTIFYING_TOKENS.has(token),
            );
          const matchedTokens = tokens.filter((token) =>
            normalizedTextTokens.has(token),
          );
          return {
            label,
            matchedTokens,
            exact: normalizedText.includes(label),
            score: matchedTokens.length / Math.max(tokens.length, 1),
          };
        })
        .sort(
          (left, right) =>
            Number(right.exact) - Number(left.exact) ||
            right.score - left.score ||
            right.label.length - left.label.length,
        )[0] || { label: "", matchedTokens: [], exact: false, score: 0 };
      return {
        record,
        ...match,
      };
    })
    .filter(
      ({ exact, label, matchedTokens }) =>
        label &&
        (exact ||
          (matchedTokens.length >=
            (allowSingleTokenMatch ||
            label
              .split(" ")
              .filter(
                (token) =>
                  token.length >= 3 && !NON_IDENTIFYING_TOKENS.has(token),
              ).length === 1
              ? 1
              : 2) &&
            matchedTokens.some((token) => token.length >= 4) &&
            (matchedTokens.length === 1 ||
              matchedTokens.length /
                Math.max(
                  label
                    .split(" ")
                    .filter(
                      (token) =>
                        token.length >= 3 && !NON_IDENTIFYING_TOKENS.has(token),
                    ).length,
                  1,
                ) >=
                0.3))),
    )
    .sort(
      (left, right) =>
        right.score - left.score || right.label.length - left.label.length,
    );
  const exactMatches = matches.filter(({ record }) =>
    fields.some((field) => {
      const label = normalize(record?.[field]);
      return label && normalizedText.includes(label);
    }),
  );
  return (exactMatches.length ? exactMatches : matches).map(
    ({ record }) => record,
  );
}

export function resolveCoachEntities(snapshot, text) {
  const activeOpportunities = Array.isArray(snapshot?.coachOpportunities)
    ? snapshot.coachOpportunities
    : Array.isArray(snapshot?.pipeline?.opportunities)
      ? snapshot.pipeline.opportunities
      : Array.isArray(snapshot?.workboard)
        ? snapshot.workboard
        : [];
  const opportunities = [
    ...activeOpportunities,
    ...(Array.isArray(snapshot?.wonOpportunities)
      ? snapshot.wonOpportunities
      : []),
    ...(Array.isArray(snapshot?.lostOpportunities)
      ? snapshot.lostOpportunities
      : []),
    ...(Array.isArray(snapshot?.cancelledOpportunities)
      ? snapshot.cancelledOpportunities
      : []),
  ];
  const accounts = Array.isArray(snapshot?.accounts)
    ? snapshot.accounts
    : Array.from(
        new Map(
          opportunities
            .map((item) => item?.account)
            .filter(Boolean)
            .map((account) => [Number(account.id), account]),
        ).values(),
      );
  const contacts = Array.isArray(snapshot?.contactMappings)
    ? snapshot.contactMappings
    : [];
  const leads = Array.isArray(snapshot?.leads) ? snapshot.leads : [];
  const accountMatches = candidates(accounts, text, [
    "name",
    "registrationCode",
    "website",
    "phone",
  ]);
  const opportunityMatches = candidates(opportunities, text, ["name"]);
  const contactMatches = candidates(
    contacts,
    text,
    ["name", "email", "phone", "mobile"],
    { allowSingleTokenMatch: false },
  );
  let leadMatches = candidates(leads, text, ["title"]);
  const normalizedText = normalize(text);
  const asksForOpportunity = /\boportunidad(?:es)?\b/.test(normalizedText);
  const asksForLead = /\b(?:lead|leads|prospecto|prospectos)\b/.test(
    normalizedText,
  );
  if (asksForOpportunity && !asksForLead && opportunityMatches.length === 1) {
    leadMatches = [];
  }
  const account = accountMatches.length === 1 ? accountMatches[0] : null;
  const opportunity =
    opportunityMatches.length === 1 ? opportunityMatches[0] : null;
  const contact = contactMatches.length === 1 ? contactMatches[0] : null;
  const lead = leadMatches.length === 1 ? leadMatches[0] : null;
  return {
    account,
    opportunity,
    contact,
    lead,
    candidates: {
      accounts: accountMatches.map((item) => ({
        id: Number(item.id),
        name: item.name || "",
        website: item.website || "",
        city: item.city || "",
      })),
      opportunities: opportunityMatches.map((item) => ({
        id: Number(item.id),
        name: item.name || "",
        accountId: Number(item.account?.id || item.accountId || 0) || null,
        contactId: Number(item.contact?.id || item.contactId || 0) || null,
        accountName: item.accountName || item.account?.name || "",
        stageName: item.stageName || "",
      })),
      contacts: contactMatches.map((item) => ({
        id: Number(item.id),
        name: item.name || "",
        accountId: Number(item.accountId || 0) || null,
        accountName: item.accountName || "",
        email: item.email || "",
        positionTitle: item.positionTitle || "",
      })),
      leads: leadMatches.map((item) => ({
        id: Number(item.id),
        name: item.title || "",
        accountId: Number(item.accountId || 0) || null,
        opportunityId: Number(item.opportunityId || 0) || null,
        accountName: item.accountName || "",
        summary: item.summary || "",
      })),
    },
  };
}

export function applyCoachEntityResolution(
  snapshot,
  currentContext = {},
  resolution = {},
) {
  const opportunities = [
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
  ];
  const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  const contacts = Array.isArray(snapshot?.contactMappings)
    ? snapshot.contactMappings
    : [];
  const leads = Array.isArray(snapshot?.leads) ? snapshot.leads : [];
  const current = Object.fromEntries(
    [
      "accountId",
      "opportunityId",
      "contactId",
      "leadId",
      "quotationId",
      "proposalId",
    ].map((key) => [key, Number(currentContext?.[key] || 0) || null]),
  );
  const next = { ...current };
  const explicit = ["account", "opportunity", "contact", "lead"].filter(
    (key) => resolution?.[key],
  );
  if (!explicit.length)
    return { context: next, changed: false, conflict: null };

  const opportunity = resolution.opportunity || null;
  const account = resolution.account || null;
  const contact = resolution.contact || null;
  const lead = resolution.lead || null;
  const opportunityAccountId = Number(
    opportunity?.account?.id || opportunity?.accountId || 0,
  );
  const contactAccountId = Number(contact?.accountId || 0);
  const leadAccountId = Number(lead?.accountId || 0);
  const requestedAccountId = Number(account?.id || 0);
  const requestedOpportunityId = Number(opportunity?.id || 0);
  const requestedContactId = Number(contact?.id || 0);
  const requestedLeadId = Number(lead?.id || 0);
  const leadOpportunityId = Number(lead?.opportunityId || 0);

  if (
    (requestedAccountId &&
      opportunityAccountId &&
      requestedAccountId !== opportunityAccountId) ||
    (requestedAccountId &&
      contactAccountId &&
      requestedAccountId !== contactAccountId) ||
    (opportunityAccountId &&
      contactAccountId &&
      opportunityAccountId !== contactAccountId) ||
    (requestedOpportunityId &&
      leadOpportunityId &&
      requestedOpportunityId !== leadOpportunityId) ||
    (requestedAccountId &&
      leadAccountId &&
      requestedAccountId !== leadAccountId)
  ) {
    return {
      context: current,
      changed: false,
      conflict: {
        type: "entity_relationship",
        message:
          "Las entidades mencionadas pertenecen a contextos comerciales distintos. Selecciona la combinación correcta.",
        candidates: [
          ...explicit.flatMap((type) => {
            const item = resolution[type];
            return item
              ? [
                  {
                    id: Number(item.id),
                    name: item.name || item.title || "Registro sin nombre",
                    entityType: type,
                    accountId:
                      Number(item.account?.id || item.accountId || 0) || null,
                  },
                ]
              : [];
          }),
        ],
      },
    };
  }

  if (opportunity) {
    next.opportunityId = requestedOpportunityId || null;
    next.accountId = opportunityAccountId || next.accountId;
    const opportunityContactId =
      Number(opportunity.contact?.id || opportunity.contactId || 0) || null;
    const currentContact = contacts.find(
      (item) => Number(item.id) === next.contactId,
    );
    next.contactId =
      opportunityContactId ||
      (Number(currentContact?.accountId || 0) === opportunityAccountId
        ? next.contactId
        : null);
    next.leadId = null;
    next.quotationId = null;
    next.proposalId = null;
  }
  if (account) {
    next.accountId = requestedAccountId || null;
    if (
      next.opportunityId &&
      Number(
        opportunities.find((item) => Number(item.id) === next.opportunityId)
          ?.account?.id ||
          opportunities.find((item) => Number(item.id) === next.opportunityId)
            ?.accountId ||
          0,
      ) !== next.accountId
    ) {
      next.opportunityId = null;
      next.quotationId = null;
      next.proposalId = null;
    }
    if (
      next.contactId &&
      Number(
        contacts.find((item) => Number(item.id) === next.contactId)
          ?.accountId || 0,
      ) !== next.accountId
    ) {
      next.contactId = null;
    }
    next.leadId = null;
  }
  if (contact) {
    next.contactId = requestedContactId || null;
    if (contactAccountId) next.accountId = contactAccountId;
    const currentOpportunity = opportunities.find(
      (item) => Number(item.id) === next.opportunityId,
    );
    const currentOpportunityAccountId = Number(
      currentOpportunity?.account?.id || currentOpportunity?.accountId || 0,
    );
    if (
      currentOpportunityAccountId &&
      contactAccountId &&
      currentOpportunityAccountId !== contactAccountId
    ) {
      next.opportunityId = null;
      next.quotationId = null;
      next.proposalId = null;
    }
    next.leadId = null;
  }
  if (lead) {
    next.leadId = requestedLeadId || null;
    if (leadAccountId) next.accountId = leadAccountId;
    next.opportunityId = opportunities.some(
      (item) => Number(item.id) === leadOpportunityId,
    )
      ? leadOpportunityId
      : null;
    next.contactId = null;
    next.quotationId = null;
    next.proposalId = null;
  }

  return {
    context: next,
    changed: Object.keys(next).some((key) => next[key] !== current[key]),
    conflict: null,
  };
}

export function buildCoachEntityClarification(
  resolution,
  originalRequest,
  selectedContext = {},
) {
  const ambiguousTypes = [
    [
      "opportunities",
      "select_opportunity",
      "oportunidad",
      "opportunity",
      "opportunityId",
    ],
    ["accounts", "select_account", "cuenta", "account", "accountId"],
    ["contacts", "select_contact", "contacto", "contact", "contactId"],
    ["leads", "select_lead", "lead", "lead", "leadId"],
  ];
  const ambiguous = ambiguousTypes.find(
    ([candidateKey]) =>
      (resolution?.candidates?.[candidateKey] || []).length > 1,
  );
  if (!ambiguous) return null;
  const [candidateKey, type, label, entityType] = ambiguous;
  return {
    type,
    message: `Encontré varias coincidencias de ${label}. Selecciona una para continuar.`,
    missing: [label[0].toUpperCase() + label.slice(1)],
    candidates: resolution.candidates[candidateKey]
      .slice(0, 20)
      .map((item) => ({
        id: Number(item.id),
        name: item.name || "Sin nombre",
        accountId: Number(item.accountId || 0) || null,
        contactId: Number(item.contactId || 0) || null,
        opportunityId: Number(item.opportunityId || 0) || null,
        accountName: item.accountName || null,
        entityType,
        stageName: item.stageName || null,
        email: item.email || null,
        positionTitle: item.positionTitle || null,
        website: item.website || null,
        city: item.city || null,
      })),
    originalRequest: String(originalRequest || "")
      .trim()
      .slice(0, 2000),
    intendedAction: "continue_request",
  };
}
