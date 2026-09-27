const FORM_FIELDS = {
  accounts: new Set([
    "name",
    "registrationCode",
    "phone",
    "website",
    "city",
    "stateRegion",
    "companyDescription",
    "clientLogoUrl",
    "addressLine",
    "postalCode",
    "accountTypeId",
    "economicSectorId",
    "countryId",
    "activationStatusId",
    "ownerUserIds",
  ]),
  contacts: new Set([
    "firstName",
    "lastName",
    "accountId",
    "positionTitle",
    "phone",
    "phoneExtension",
    "mobile",
    "email",
    "department",
    "countryId",
    "stateRegion",
    "city",
    "addressLine",
    "postalCode",
    "purchaseParticipationId",
    "hierarchyLevelId",
    "relationshipTypeId",
    "influenceLevelId",
    "employmentStatusId",
    "activationStatusId",
    "managerContactId",
    "influencesContactId",
  ]),
  opportunities: new Set([
    "name",
    "amountUsd",
    "accountId",
    "closeDate",
    "contactId",
    "salesStageId",
    "businessLineId",
    "sellerUserId",
    "presalesUserId",
    "activationStatusId",
  ]),
};

const STRING_ID_FIELDS = new Set([
  "accountTypeId",
  "economicSectorId",
  "countryId",
  "activationStatusId",
  "accountId",
  "purchaseParticipationId",
  "hierarchyLevelId",
  "relationshipTypeId",
  "influenceLevelId",
  "employmentStatusId",
  "managerContactId",
  "influencesContactId",
  "contactId",
  "salesStageId",
  "businessLineId",
  "sellerUserId",
  "presalesUserId",
]);

export function getCoachHandoffOperation(handoff) {
  return handoff?.payload && typeof handoff.payload === "object"
    ? handoff.payload
    : null;
}

export function getCoachHandoffEntityId(handoff, field) {
  const operation = getCoachHandoffOperation(handoff);
  return Number(operation?.[field] || handoff?.entities?.[field] || 0) || null;
}

export function buildCoachFormPatch(handoff, module) {
  const operation = getCoachHandoffOperation(handoff);
  const allowedFields = FORM_FIELDS[module];
  if (!operation || !allowedFields) return {};

  const payload =
    operation.payload && typeof operation.payload === "object"
      ? operation.payload
      : {};
  const source = { ...payload };
  if (module !== "accounts" && source.accountId === undefined) {
    source.accountId = operation.accountId;
  }
  if (module === "opportunities" && source.contactId === undefined) {
    source.contactId = operation.contactId;
  }
  if (operation.field && allowedFields.has(operation.field)) {
    source[operation.field] = operation.value;
  }

  return Object.fromEntries(
    Object.entries(source)
      .filter(
        ([field, value]) =>
          allowedFields.has(field) && value !== undefined && value !== null,
      )
      .map(([field, value]) => [
        field,
        STRING_ID_FIELDS.has(field) ? String(value || "") : value,
      ]),
  );
}
