import { randomUUID } from "node:crypto";
import { z } from "zod";
import { customerStageSpecSchema } from "./turn-contract.js";
import { normalizeCustomerSearchText as normalize } from "./customer-record-list.js";
import { nextCustomerStage, stageVersion } from "../coach/customer-stage-access.js";
const schema = z.object({
  accountId: z.number().int().positive(), draftId: z.string().uuid(), revision: z.number().int().positive(),
  opportunityId: z.number().int().nonnegative(), opportunityReference: z.string().max(300), targetReference: z.string().max(300),
  request: z.enum(["advance", "validate_advance", "evaluate_only", "unsupported"]),
  candidates: z.array(z.number().int().positive()).max(100), observedVersion: z.string().max(6000),
}).strict();
export function validateCustomerStageMemory(value, snapshot) {
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data.accountId === Number(snapshot?.account?.id) ? parsed.data : null;
}
const literal = (text, value) => String(text).replace(/\s+/g, " ").includes(String(value).replace(/\s+/g, " "));
export async function buildCustomerStageResponse({ component, movement, question, snapshot, previous, readStages }) {
  const prior = validateCustomerStageMemory(previous, snapshot);
  let memory = prior ? structuredClone(prior) : null;
  const response = (answer, responseType = "clarification", extra = {}) => ({
    answer, responseType, operations: [], evidence: [], recommendedActions: [], pendingItems: [],
    entities: { accountId: Number(snapshot.account.id), opportunityId: memory?.opportunityId || null },
    stageMemory: memory, stageMetadata: memory ? { draftId: memory.draftId, revision: memory.revision, status: "clarification" } : null, ...extra,
  });
  const parsed = customerStageSpecSchema.safeParse(component.stageSpec);
  if (!parsed.success) return response("Identifica la oportunidad y si solicitas validar su avance. No se ejecutó ninguna validación ni cambio.");
  const spec = parsed.data;
  const normalizedQuestion = String(question || "").normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
  const requestsCommercialOutcome = /\b(?:ganad[ao]s?|perdid[ao]s?|anulad[ao]s?)\b[\s\S]{0,60}\b(?:marc\w*|pon\w*|cambi\w*|actualiz\w*|cerr\w*)\b|\b(?:marc\w*|pon\w*|cambi\w*|actualiz\w*|cerr\w*)\b[\s\S]{0,60}\b(?:ganad[ao]s?|perdid[ao]s?|anulad[ao]s?)\b/i
    .test(normalizedQuestion);
  if (requestsCommercialOutcome && spec.request !== "unsupported") {
    return response("No puedo marcar una oportunidad como ganada, perdida o anulada desde esta validación. A08 solo prepara la revisión del avance a la siguiente etapa; no se ejecutó ningún cambio.", "informational");
  }
  const usesPriorOpportunity = prior && spec.mode !== "start" &&
    normalize(spec.opportunityReference) === normalize(prior.opportunityReference);
  const usesPriorTarget = prior && spec.mode !== "start" &&
    normalize(spec.targetReference) === normalize(prior.targetReference);
  if ((spec.opportunityReference && !literal(question, spec.opportunityReference) && !usesPriorOpportunity) ||
      (spec.targetReference && !literal(question, spec.targetReference) && !usesPriorTarget) ||
      (spec.position && (!spec.evidence || !literal(question, spec.evidence)))) {
    return response(`Las referencias deben estar en este mensaje o en una selección validada de la conversación.${prior
      ? " El borrador previo no cambió."
      : " No preparé una validación."}`);
  }
  const fresh = !prior || spec.mode === "start";
  if (prior && fresh && !["new_request", "change_focus"].includes(movement)) return response("Aclara si quieres iniciar una nueva solicitud de validación.");
  if (fresh && ["advance", "validate_advance"].includes(spec.request) && !spec.opportunityReference.trim()) {
    return response("¿Qué oportunidad quieres validar? Indica su nombre para no elegir una por suposición.");
  }
  if (fresh) memory = { accountId: Number(snapshot.account.id), draftId: randomUUID(), revision: 1, opportunityId: 0,
    opportunityReference: "", targetReference: "", request: spec.request, candidates: [], observedVersion: "" };
  const before = JSON.stringify(memory);
  const revise = () => { if (!fresh && memory.revision === prior.revision &&
    (JSON.stringify(memory) !== before || spec.mode === "refresh")) memory.revision += 1; };
  memory.request = spec.request;
  if (spec.opportunityReference && normalize(spec.opportunityReference) !== normalize(memory.opportunityReference)) {
    memory.opportunityReference = spec.opportunityReference; memory.opportunityId = 0; memory.candidates = [];
    memory.targetReference = "";
  }
  if (spec.targetReference) memory.targetReference = spec.targetReference;
  if (component.scope === "collection" || spec.request === "unsupported") {
    memory.request = "unsupported"; memory.observedVersion = ""; revise();
    return response("A08 solo prepara validar el avance a la siguiente etapa de una oportunidad. No incluye bypass, saltos, retrocesos, cierres, activación ni lotes.");
  }
  if (spec.request === "evaluate_only") {
    memory.observedVersion = ""; revise();
    return response("La validación actual de Oportunidades puede avanzar automáticamente si la IA lo determina. No la iniciaré si pides no cambiar nada. Puedes consultar los requisitos con Q10, sin ejecutar la validación.", "informational");
  }
  let data;
  try { data = await readStages(memory.accountId); }
  catch (error) { if (error.code !== "COACH_STAGE_CONFLICT") throw error; revise(); return response(error.message, "error"); }
  if (memory.opportunityId && !data.opportunities.some((item) => Number(item.id) === memory.opportunityId)) {
    memory.opportunityId = 0; memory.observedVersion = ""; revise(); return response("La oportunidad ya no está disponible. Selecciona nuevamente.", "error");
  }
  if (!memory.opportunityId || spec.position) {
    const ref = normalize(memory.opportunityReference).replace(/^oportunidad\s*#?\s*/, "");
    const exact = data.opportunities.filter((item) => normalize(item.name) === ref);
    const matches = /^\d+$/.test(ref) ? data.opportunities.filter((item) => Number(item.id) === Number(ref))
      : !ref ? data.opportunities : exact.length ? exact : data.opportunities.filter((item) => normalize(item.name).includes(ref));
    const ids = matches.map((item) => Number(item.id));
    if (spec.position) {
      if (!prior || JSON.stringify(prior.candidates) !== JSON.stringify(ids.slice(0, 100)) || !ids[spec.position - 1]) {
        memory.candidates = ids.slice(0, 100); revise(); return response("La lista cambió o el ordinal es inválido. Selecciona nuevamente.");
      }
      memory.opportunityId = ids[spec.position - 1];
    } else if (matches.length === 1) memory.opportunityId = ids[0];
    else {
      memory.candidates = ids.slice(0, 100); revise();
      return response(matches.length ? `Selecciona una oportunidad:\n${matches.slice(0, 100).map((item, index) =>
        `${index + 1}. ${item.name} · ID ${item.id} · ${item.stageName} · ${item.status}`).join("\n")}${matches.length > 100 ? "\nMás de 100 candidatas; indica el ID." : ""}`
        : "No encontré esa oportunidad en la cuenta fija. No elegiré otra por suposición.");
    }
    memory.candidates = ids.slice(0, 100);
  }
  let opportunity, next;
  try { ({ opportunity, next } = nextCustomerStage(data, memory.opportunityId)); }
  catch (error) {
    if (error.code !== "COACH_STAGE_CONFLICT") throw error;
    memory.observedVersion = ""; revise();
    const responseType = error.status === 422 ? "informational" : "error";
    return response(`${error.message}. No se inició ninguna validación ni se cambió la oportunidad.`, responseType);
  }
  if (memory.targetReference && ![next.name, next.code].map(normalize).includes(normalize(memory.targetReference))) {
    memory.observedVersion = ""; revise();
    return response(`El siguiente destino disponible es ${next.name}. No saltaré etapas ni cambiaré el destino pedido. Corrige el destino explícitamente para continuar.`);
  }
  memory.observedVersion = stageVersion(data, opportunity, next); revise();
  const summary = { accountName: data.accountName, opportunityName: opportunity.name,
    currentStageId: Number(opportunity.stageId), currentStageName: opportunity.stageName,
    targetStageId: Number(next.id), targetStageName: next.name };
  const operation = { kind: "validate_stage", sourceChannel: "customer_account", targetModule: "opportunities",
    accountId: memory.accountId, opportunityId: memory.opportunityId, stageDraftId: memory.draftId,
    stageRevision: memory.revision, stageObservedVersion: memory.observedVersion, stageSummary: summary,
    payload: { accountId: memory.accountId, opportunityId: memory.opportunityId },
    title: `Validar avance: ${opportunity.name}`.slice(0, 300), evidence: [], missingFields: [], requiresConfirmation: true };
  return response(`${summary.opportunityName} — etapa actual: ${summary.currentStageName}; siguiente etapa posible: ${summary.targetStageName}.\nDejé lista la solicitud para que la revises en Oportunidades. La etapa todavía no cambió. Al revisarla, la oportunidad puede avanzar automáticamente si el resultado lo permite; tener todas las respuestas no garantiza la aprobación.`,
    "change_request", { operations: [operation], stageMetadata: { ...summary, draftId: memory.draftId, revision: memory.revision, status: "prepared" } });
}
