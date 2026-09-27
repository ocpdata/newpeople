function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function candidates(records, text, fields) {
  const normalizedText = normalize(text);
  const matches = records
    .map((record) => {
      const labels = fields
        .map((field) => normalize(record?.[field]))
        .filter((label) => label.length >= 3);
      const match = labels
        .map((label) => {
          const tokens = label.split(" ").filter((token) => token.length >= 3);
          const matchedTokens = tokens.filter((token) =>
            normalizedText.includes(token),
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
          (matchedTokens.length >= 1 &&
            matchedTokens.some((token) => token.length >= 4) &&
            (matchedTokens.length === 1 ||
              matchedTokens.length / label.split(" ").length >= 0.3))),
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
  const opportunities = Array.isArray(snapshot?.coachOpportunities)
    ? snapshot.coachOpportunities
    : Array.isArray(snapshot?.pipeline?.opportunities)
      ? snapshot.pipeline.opportunities
      : Array.isArray(snapshot?.workboard)
        ? snapshot.workboard
        : [];
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
  const contactMatches = candidates(contacts, text, [
    "name",
    "email",
    "phone",
    "mobile",
  ]);
  const leadMatches = candidates(leads, text, [
    "title",
    "summary",
    "sourceNotes",
  ]);
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
    ([candidateKey, , , , selectedKey]) =>
      !Number(selectedContext?.[selectedKey] || 0) &&
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
