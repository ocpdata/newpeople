import { resolveCoachEntities } from "../coach/entity-resolver.js";
import {
  customerRecordListSpecPatch, customerRelationshipSpecPatch, customerRelationshipSpecSchema,
} from "./turn-contract.js";
import { buildCustomerRecordListResponse, normalizeCustomerSearchText, resolveCustomerListSpec } from "./customer-record-list.js";

const isContinuation = (movement) => ["continue", "correct", "answer_clarification", "select_candidate"].includes(movement);
const normalize = normalizeCustomerSearchText;

function recordsFor(snapshot, object) {
  return [...new Map((object === "contact"
    ? [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])]
    : [...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
      ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : [])])
    .filter((record) => Number(record.accountId) === Number(snapshot.account?.id))
    .map((record) => [Number(record.id), record])).values()];
}

function resolveTarget(snapshot, object, reference, fallbackId, businessRules) {
  const records = recordsFor(snapshot, object);
  if (!reference) return records.find((record) => Number(record.id) === Number(fallbackId)) || null;
  const exact = records.filter((record) => normalize(record.name) === normalize(reference));
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  if (object === "contact" && normalize(reference).split(" ").length >= 2) {
    const prefix = records.filter((record) => normalize(record.name).startsWith(`${normalize(reference)} `));
    if (prefix.length) return prefix.length === 1 ? prefix[0] : null;
  }
  const resolution = resolveCoachEntities({
    coachOpportunities: object === "opportunity" ? records : [],
    contactMappings: object === "contact" ? records : [],
  }, reference, businessRules, { exactMatchOnly: true, ignoreStageFilters: true });
  const matches = resolution.candidates[object === "contact" ? "contacts" : "opportunities"];
  return matches.length === 1 ? records.find((record) => Number(record.id) === Number(matches[0].id)) : null;
}

export function validateCustomerRelationshipMemory(value, snapshot) {
  if (!value || Number(value.accountId) !== Number(snapshot.account?.id) ||
      snapshot.permissions?.canReadContacts === false || snapshot.permissions?.canReadOpportunities === false ||
      !["associated_contact", "verify_pair", "contact_opportunities"].includes(value.operation)) return null;
  const opportunity = recordsFor(snapshot, "opportunity").find((record) => record.id === value.opportunityId);
  const contact = recordsFor(snapshot, "contact").find((record) => record.id === value.contactId &&
    record.activationStatusCode === "activado");
  if ((value.operation !== "contact_opportunities" && !opportunity) ||
      (value.operation !== "associated_contact" && !contact) || (value.contactId && !contact)) return null;
  const resolved = resolveCustomerListSpec({ object: "opportunity", listSpec: value.listSpec || {} }, null, "new_request");
  if (resolved.error) return null;
  return {
    accountId: Number(snapshot.account.id), operation: value.operation,
    opportunityId: opportunity ? Number(opportunity.id) : null,
    contactId: contact ? Number(contact.id) : null, listSpec: resolved.spec,
  };
}

export function resolveCustomerRelationshipRequest({ component, movement, previous, snapshot, context, businessRules }) {
  const fail = (error, responseType = "clarification") => ({ error, responseType });
  if (!snapshot.account?.id || Number(context.accountId) !== Number(snapshot.account.id)) {
    return fail("Selecciona una cuenta autorizada para consultar sus relaciones.");
  }
  const parsed = customerRelationshipSpecSchema.safeParse(component.relationshipSpec || {});
  if (!parsed.success) return fail("Los criterios de relación no son válidos. Indica qué asociación deseas comprobar.");
  const patch = customerRelationshipSpecPatch(parsed.data);
  if (patch.clarification) return fail(patch.clarification);
  if (patch.unsupported?.length) return fail(`No puedo acreditar estas relaciones o roles: ${patch.unsupported.join(", ")}. Asociación, cargo y pertenencia a la cuenta no acreditan decisión ni autoridad de firma. No sustituí la consulta. Solicita validación comercial de esa facultad con el cliente o el responsable autorizado.`, "informational");
  if (patch.accountReference && normalize(patch.accountReference) !== normalize(snapshot.account.name)) {
    return fail("La consulta de relaciones está limitada a la cuenta seleccionada. Selecciona la otra cuenta en la interfaz.");
  }
  const continuation = isContinuation(movement);
  const operation = patch.operation || (continuation ? previous?.operation : null);
  if (!operation) return fail("Indica si deseas consultar el contacto asociado, comprobar una pareja contacto-oportunidad o listar las oportunidades de un contacto.");
  const opportunityRef = patch.opportunityReference || (component.object === "opportunity" ? component.reference : "") || "";
  const contactRef = patch.contactReference || (component.object === "contact" ? component.reference : "") || "";
  const opportunity = operation !== "contact_opportunities" ? resolveTarget(snapshot, "opportunity", opportunityRef,
    continuation && previous?.opportunityId ? previous.opportunityId : context.opportunityId, businessRules) : null;
  const contact = operation !== "associated_contact" ? resolveTarget(snapshot, "contact", contactRef,
    continuation && previous?.contactId ? previous.contactId : context.contactId, businessRules) : null;
  if (operation !== "contact_opportunities" && !opportunity) return fail("Indica una única oportunidad autorizada por su nombre; no sustituiré una referencia no encontrada por otra seleccionada.");
  if (operation !== "associated_contact" && (!contact || contact.activationStatusCode !== "activado")) {
    return fail(contactRef
      ? `No pude resolver un único contacto activado y autorizado para "${contactRef}". Precisa su nombre; conservo la oportunidad indicada.`
      : "Falta la referencia del contacto que quieres contrastar; conservo la oportunidad indicada. Indica el contacto, sin asumir una asociación por pertenecer a la cuenta.");
  }
  if ((operation === "associated_contact" && contactRef) || (operation === "contact_opportunities" && opportunityRef)) {
    return fail("La operación y las dos referencias no coinciden. Precisa si deseas verificar la pareja o consultar una sola dirección.");
  }
  const sameContact = continuation && previous?.operation === "contact_opportunities" &&
    previous.contactId === Number(contact?.id);
  const list = resolveCustomerListSpec({
    object: "opportunity", listSpec: patch.listSpec ? customerRecordListSpecPatch(patch.listSpec) : {},
  }, sameContact ? { object: "opportunity", spec: previous.listSpec } : null, sameContact ? "continue" : "new_request", snapshot.account);
  if (list.error) return fail(list.error, list.responseType || "informational");
  if (operation !== "contact_opportunities" && patch.listSpec &&
      Object.keys(customerRecordListSpecPatch(patch.listSpec)).some((key) =>
        !["clarification", "accountReference", "unsupported"].includes(key))) {
    return fail("Los filtros de listado solo se admiten al consultar las oportunidades de un contacto. No los ignoré.", "informational");
  }
  return {
    operation, opportunity, contact, listSpec: list.spec,
    memory: { accountId: Number(snapshot.account.id), operation,
      opportunityId: opportunity ? Number(opportunity.id) : null,
      contactId: contact ? Number(contact.id) : null, listSpec: list.spec },
  };
}

export function buildCustomerRelationshipResponse({ request, account, reads, metrics, collectionScopes }) {
  const base = {
    answer: "", responseType: "informational", operations: [], recommendedActions: [], pendingItems: [],
    inferences: [], evidence: [], confidence: "medium", source: "account_intelligence",
  };
  const fail = (answer) => ({ ...base, answer, responseType: "error" });
  if (reads.some((read) => read.error || read.queryFailed) ||
      metrics.some((metric) => ["contacts", "opportunities_active", "opportunities_inactive"].includes(metric.source) && metric.errorCode)) {
    return fail("No pude verificar la relación porque falló una lectura autorizada. Un fallo no significa que no exista asociación.");
  }
  const contacts = reads.find((read) => read.toolName === "searchContacts")?.result;
  if (!Array.isArray(contacts)) return fail("No pude verificar los contactos autorizados necesarios para comprobar la relación.");
  const visibleContacts = contacts.filter((contact) => Number(contact.accountId) === Number(account.id) &&
    contact.activationStatusCode === "activado");
  if (request.contact && !visibleContacts.some((contact) => Number(contact.id) === request.memory.contactId)) {
    return fail("El contacto consultado no está disponible en la lectura autorizada. No puedo comprobar su asociación.");
  }
  if (request.operation === "contact_opportunities") {
    const read = reads.find((item) => item.toolName === "searchOpportunities");
    if (!Array.isArray(read?.result)) return fail("No pude verificar las oportunidades asociadas en la lectura autorizada.");
    const unknown = read.result.filter((record) => Number(record.accountId) === Number(account.id) &&
      (!["available", "not_recorded"].includes(record.associatedContactStatus) ||
        (record.associatedContactStatus === "available" &&
          (!Number.isInteger(record.associatedContactId) || record.associatedContactId <= 0)))).length;
    const list = buildCustomerRecordListResponse({
      object: "opportunity", spec: request.listSpec, account,
      readToolResults: [read], snapshotQueryMetrics: metrics, collectionScopes,
      recordFilter: (record) => record.associatedContactStatus === "available" &&
        Number(record.associatedContactId) === request.memory.contactId,
      additionalPartialReasons: unknown ? ["asociaciones no verificables en registros recuperados"] : [],
    });
    if (list.responseType === "error") return list;
    return {
      ...list,
      answer: [
        `Oportunidades con ${request.contact.name} como contacto asociado registrado; no implica que sea decisor ni firmante.`,
        ...(unknown ? [`Cobertura de relaciones parcial: ${unknown} registro(s) con vínculo no verificable; no puedo afirmar ausencia global de asociaciones.`] : []),
        list.answer,
      ].join("\n"),
      recordList: { ...list.recordList, relationshipContactId: request.memory.contactId },
      relationshipMemory: request.memory,
      entities: { ...list.entities, contactId: request.memory.contactId },
      evidence: [...list.evidence, `Relación CRM explícita: contacto asociado ${request.memory.contactId}, cuenta ${account.id}.`],
    };
  }
  const record = reads.find((read) => read.toolName === "getOpportunity")?.result;
  if (!record || Number(record.id) !== request.memory.opportunityId || Number(record.accountId) !== Number(account.id)) {
    return fail("La oportunidad no está disponible en la lectura autorizada. No puedo verificar el vínculo.");
  }
  const status = record.associatedContactStatus;
  if (!["available", "not_recorded"].includes(status)) {
    return {
      ...base, answer: status === "restricted"
        ? "El contacto asociado está restringido. No puedo mostrar sus datos ni verificar la pareja."
        : "No pude verificar el destino del vínculo registrado con los contactos autorizados recuperados. No significa que la oportunidad no tenga asociación.",
      relationshipStatus: status === "restricted" ? "restricted" : "unavailable",
    };
  }
  const associated = status === "available" ? visibleContacts.find((contact) =>
    Number(contact.id) === Number(record.associatedContactId)) : null;
  if (status === "available" && !associated) return fail("El destino del vínculo no pudo validarse con los contactos autorizados. No se sustituyó por otro contacto.");
  const match = associated && Number(associated.id) === request.memory.contactId;
  const answer = !associated ? `${record.name} no tiene contacto asociado registrado.` :
    request.operation === "verify_pair"
      ? match ? `Sí. ${request.contact.name} es el contacto asociado registrado de ${record.name}.`
        : `No en el vínculo consultado: ${request.contact.name} no es el contacto asociado registrado de ${record.name}; figura ${associated.name}. Esto no descarta otras formas de participación.`
      : `${associated.name} es el contacto asociado registrado de ${record.name}${associated.positionTitle ? `; cargo registrado: ${associated.positionTitle}` : ""}.`;
  const memory = { ...request.memory,
    contactId: request.operation === "verify_pair" ? request.memory.contactId : associated ? Number(associated.id) : null };
  return {
    ...base, answer: `${answer}\nLa asociación registrada no acredita autoridad de decisión, aprobación ni firma.`,
    relationshipStatus: !associated ? "not_recorded" : request.operation === "verify_pair" ? match ? "matched" : "different" : "associated",
    relationshipMemory: memory, confidence: "high",
    entities: { accountId: Number(account.id), opportunityId: Number(record.id), contactId: memory.contactId },
    evidence: [`Vínculo CRM consultado: getOpportunity ${record.id}, cuenta ${account.id}; destino contrastado con searchContacts autorizado.`],
  };
}
