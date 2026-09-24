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
      const label = labels.sort((left, right) => right.length - left.length)[0] || "";
      const tokens = label.split(" ").filter((token) => token.length >= 3);
      const matchedTokens = tokens.filter((token) => normalizedText.includes(token));
      return { record, label, matchedTokens, score: matchedTokens.length / Math.max(tokens.length, 1) };
    })
    .filter(({ label, matchedTokens }) =>
      label && (normalizedText.includes(label) || (matchedTokens.length >= 1 && matchedTokens.some((token) => token.length >= 4) && (matchedTokens.length === 1 || matchedTokens.length / label.split(" ").length >= 0.3))),
    )
    .sort((left, right) => right.score - left.score || right.label.length - left.label.length)
    .map(({ record }) => record);
  const exactMatches = matches.filter((record) => fields.some((field) => {
    const label = normalize(record?.[field]);
    return label && normalizedText.includes(label);
  }));
  return exactMatches.length ? exactMatches : matches;
}

export function resolveCoachEntities(snapshot, text) {
  const opportunities = Array.isArray(snapshot?.pipeline?.opportunities)
    ? snapshot.pipeline.opportunities
    : Array.isArray(snapshot?.workboard) ? snapshot.workboard : [];
  const contacts = Array.isArray(snapshot?.contactMappings) ? snapshot.contactMappings : [];
  const leads = Array.isArray(snapshot?.leads) ? snapshot.leads : [];
  const opportunityMatches = candidates(opportunities, text, ["name"]);
  const contactMatches = candidates(contacts, text, ["name", "email"]);
  const leadMatches = candidates(leads, text, ["title", "summary"]);
  const opportunity = opportunityMatches.length === 1 ? opportunityMatches[0] : null;
  const contact = contactMatches.length === 1 ? contactMatches[0] : null;
  const lead = leadMatches.length === 1 ? leadMatches[0] : null;
  return {
    opportunity,
    contact,
    lead,
    candidates: {
      opportunities: opportunityMatches.map((item) => ({ id: Number(item.id), name: item.name || "" })),
      contacts: contactMatches.map((item) => ({ id: Number(item.id), name: item.name || "" })),
      leads: leadMatches.map((item) => ({ id: Number(item.id), title: item.title || "" })),
    },
  };
}
