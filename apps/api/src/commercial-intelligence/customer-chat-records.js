

export function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isOpen(opportunity) {
  return opportunity?.lifecycle === "open";
}

export function accountRecord(snapshot) {
  return snapshot.account
    ? [{ ...snapshot.account, accountId: snapshot.account.id }]
    : [];
}

export function opportunityRecords(snapshot) {
  const accountId = Number(snapshot.account?.id || 0);
  const opportunities = new Map();
  for (const opportunity of [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ]) {
    if (Number(opportunity.accountId || 0) === accountId) {
      opportunities.set(Number(opportunity.id), opportunity);
    }
  }
  return [...opportunities.values()];
}

export function scopeCustomerSnapshot(snapshot) {
  const accountId = Number(snapshot.account?.id || 0);
  if (!accountId) {
    return {
      ...snapshot,
      selectedOpportunity: null,
      opportunities: [],
      inactiveOpportunities: [],
      contacts: [],
      interactions: [],
      activities: [],
      opportunityActivities: [],
      calendarActivities: [],
    };
  }
  const isInScope = (record) => Number(record.accountId || 0) === accountId;
  const opportunities = (snapshot.opportunities || []).filter(isInScope);
  const inactiveOpportunities = (snapshot.inactiveOpportunities || []).filter(
    isInScope,
  );
  const selectedOpportunity = isInScope(snapshot.selectedOpportunity || {})
    ? snapshot.selectedOpportunity
    : null;
  const opportunityIds = new Set(
    [
      ...opportunities,
      ...inactiveOpportunities,
      ...(selectedOpportunity ? [selectedOpportunity] : []),
    ].map((opportunity) => Number(opportunity.id)),
  );
  const contacts = (snapshot.contacts || []).filter(isInScope);
  const interactions = (snapshot.interactions || []).filter(isInScope);
  const activities = (snapshot.activities || []).filter(
    (activity) =>
      isInScope(activity) &&
      (!activity.opportunityId ||
        opportunityIds.has(Number(activity.opportunityId))),
  );
  const opportunityActivities = (snapshot.opportunityActivities || []).filter(
    (activity) => Number(activity.accountId || 0) === accountId,
  );
  const calendarActivities = (snapshot.calendarActivities || []).filter(
    (activity) => Number(activity.accountId || 0) === accountId,
  );
  return {
    ...snapshot,
    selectedOpportunity,
    opportunities,
    inactiveOpportunities,
    contacts,
    interactions,
    activities,
    opportunityActivities,
    calendarActivities,
  };
}

export function buildCustomerCoachSnapshot(snapshot, quotation) {
  const account = snapshot.account;
  const accountId = Number(account?.id || 0) || null;
  const accountName = account?.name || "";
  const contactsById = new Map(
    [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])]
      .map((contact) => [Number(contact.id), contact]),
  );
  const activities = snapshot.activities || snapshot.interactions || [];
  const opportunities = opportunityRecords(snapshot).map((opportunity) => ({
    ...opportunity,
    account: { id: accountId, name: accountName },
    associatedContact:
      snapshot.permissions?.canReadContacts === true &&
      Number(opportunity.contactId || 0) > 0 &&
      Number(opportunity.accountId || accountId) === accountId
        ? (() => {
            const contact = contactsById.get(Number(opportunity.contactId));
            return contact &&
              Number(contact.accountId || 0) === accountId &&
              contact.activationStatusCode === "activado"
              ? {
                  name: contact.name || "",
                  positionTitle: contact.positionTitle || "",
                }
              : null;
          })()
        : null,
    associatedContactStatus:
      snapshot.permissions?.canReadContacts !== true
        ? "restricted"
        : !Object.hasOwn(opportunity, "contactId")
          ? "unavailable"
        : !opportunity.contactId
          ? "not_recorded"
          : contactsById.get(Number(opportunity.contactId))?.activationStatusCode === "activado" &&
            Number(contactsById.get(Number(opportunity.contactId))?.accountId) === accountId
            ? "available"
            : "unavailable",
    activities: activities.filter(
      (activity) =>
        Number(activity.opportunityId || 0) === Number(opportunity.id),
    ),
  }));
  const leads = (snapshot.interactions || [])
    .filter(
      (interaction) =>
        interaction.leadSubstatusCode ||
        interaction.leadReasonCode ||
        interaction.leadRequiredActionCode,
    )
    .map((interaction) => ({
      ...interaction,
      title: interaction.title,
      accountId,
      accountName,
      opportunityId: Number(interaction.opportunityId || 0) || null,
      status: interaction.leadSubstatusCode || "",
    }));
  return {
    accounts: accountRecord(snapshot),
    coachOpportunities: opportunities,
    wonOpportunities: [],
    lostOpportunities: [],
    cancelledOpportunities: [],
    inactivePipelineOpportunities: [],
    contactMappings: (snapshot.contacts || []).map((contact) => ({
      ...contact,
      accountName,
    })),
    leads,
    selectedOpportunityQuotation: quotation,
  };
}

export function getDeadlineSignal(deadlineAt) {
  if (!Number.isFinite(Number(deadlineAt))) return null;
  const remainingMs = Math.max(0, Math.floor(Number(deadlineAt) - Date.now()));
  return remainingMs > 0
    ? AbortSignal.timeout(remainingMs)
    : AbortSignal.abort();
}

export function permissionGranted(permissions, permissionCode) {
  if (typeof permissions?.has === "function") {
    return permissions.has(permissionCode);
  }
  if (Array.isArray(permissions)) return permissions.includes(permissionCode);
  if (Array.isArray(permissions?.codes)) {
    return permissions.codes.includes(permissionCode);
  }
  return permissions?.[permissionCode] === true;
}

export function formatUsd(value) {
  return `USD ${Number(value || 0).toLocaleString("es-MX")}`;
}
