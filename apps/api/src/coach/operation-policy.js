const CONTROLLED_OPERATION_POLICIES = Object.freeze({
  account_field: Object.freeze({
    domainPermission: "cuentas.update",
    domainReadPermissions: Object.freeze(["cuentas.read", "cuentas.read_all"]),
    entityType: "account",
    entityIdField: "accountId",
    reversible: true,
    allowedFields: Object.freeze([
      "name",
      "phone",
      "website",
      "city",
      "stateRegion",
      "companyDescription",
    ]),
  }),
  contact_field: Object.freeze({
    domainPermission: "contactos.update",
    domainReadPermissions: Object.freeze([
      "contactos.read",
      "contactos.read_all",
    ]),
    entityType: "contact",
    entityIdField: "contactId",
    reversible: true,
    allowedFields: Object.freeze([
      "firstName",
      "lastName",
      "email",
      "mobile",
      "phone",
      "positionTitle",
      "department",
      "city",
      "stateRegion",
      "hierarchyLevelId",
      "relationshipTypeId",
      "influenceLevelId",
      "managerContactId",
      "influencesContactId",
    ]),
  }),
  opportunity_field: Object.freeze({
    domainPermission: "oportunidades.update",
    domainReadPermissions: Object.freeze([
      "oportunidades.read",
      "oportunidades.read_all",
    ]),
    entityType: "opportunity",
    entityIdField: "opportunityId",
    reversible: true,
    allowedFields: Object.freeze(["name", "amountUsd", "closeDate"]),
  }),
  stage_answer: Object.freeze({
    domainPermission: "oportunidades.update",
    domainReadPermissions: Object.freeze([
      "oportunidades.read",
      "oportunidades.read_all",
    ]),
    entityType: "opportunity",
    entityIdField: "opportunityId",
    reversible: true,
  }),
  lead_call_outcome: Object.freeze({
    domainPermission: "interacciones.update",
    domainReadPermissions: Object.freeze([
      "interacciones.read",
      "interacciones.read_all",
    ]),
    entityType: "interaction",
    entityIdField: "interactionId",
    reversible: true,
  }),
});

const DELEGATED_OPERATION_POLICIES = Object.freeze({
  activity: "calendario_comercial.update",
  lead_resolve: "interacciones.resolve",
  create_lead: "interacciones.update",
  create_contact_mapping: "contactos.update",
  create_account: ["cuentas.create", "cuentas.request"],
  create_contact: ["contactos.create", "contactos.request"],
  create_opportunity: ["oportunidades.create", "oportunidades.request"],
  create_quotation: [
    "cotizaciones.operacion",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
  ],
  create_proposal: "propuestas.create",
});

export function getControlledCoachOperationPolicy(kind) {
  return CONTROLLED_OPERATION_POLICIES[String(kind || "").trim()] || null;
}

export function getDelegatedCoachOperationPermissions(kind) {
  const permissions = DELEGATED_OPERATION_POLICIES[String(kind || "").trim()];
  if (!permissions) return null;
  return Array.isArray(permissions) ? [...permissions] : [permissions];
}

export function isControlledCoachOperation(kind) {
  return Boolean(getControlledCoachOperationPolicy(kind));
}

export function isDelegatedCoachOperation(kind) {
  return Boolean(getDelegatedCoachOperationPermissions(kind));
}

export function hasAnyPermission(user, permissions) {
  return (Array.isArray(permissions) ? permissions : [permissions]).some(
    (permission) => user?.permissionSet?.has(permission),
  );
}

export function validateControlledCoachOperation(operation) {
  const policy = getControlledCoachOperationPolicy(operation?.kind);
  if (!policy) {
    return { ok: false, code: "COACH_OPERATION_UNSUPPORTED" };
  }
  const entityId = Number(operation?.[policy.entityIdField] || 0);
  if (!Number.isInteger(entityId) || entityId <= 0) {
    return { ok: false, code: "COACH_ENTITY_REQUIRED", policy };
  }
  if (
    policy.allowedFields &&
    !policy.allowedFields.includes(String(operation?.field || "").trim())
  ) {
    return { ok: false, code: "COACH_FIELD_NOT_ALLOWED", policy, entityId };
  }
  return { ok: true, policy, entityId };
}
