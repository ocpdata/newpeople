// Describes the tasks a customer-chat turn executed, independently of the engine that ran it.
// The evaluator and diagnostics read these tasks instead of engine-specific categories.

// Legacy B3 categories mapped to the task types of the migration design (§5).
export const LEGACY_CATEGORY_TASKS = Object.freeze({
  "query.account_summary": ["consult", "summary"],
  "query.record_detail": ["consult", "detail"],
  "query.field_value": ["consult", "field"],
  "query.record_list": ["consult", "list"],
  "query.record_search": ["consult", "search"],
  "query.history": ["consult", "history"],
  "query.pending_items": ["consult", "pending"],
  "query.relationships": ["consult", "relationships"],
  "query.opportunity_notes": ["consult", "notes"],
  "query.stage_readiness": ["consult", "readiness"],
  "query.document_content": ["document", "quotation"],
  "query.system_help": ["limit", "system_help"],
  "guidance.situation_assessment": ["consult", "assessment"],
  "guidance.risks_and_gaps": ["consult", "risks"],
  "guidance.next_steps": ["consult", "next_steps"],
  "guidance.prioritization": ["consult", "prioritization"],
  "guidance.comparison": ["consult", "comparison"],
  "guidance.trend_analysis": ["consult", "trend"],
  "guidance.scenario_analysis": ["consult", "scenario"],
  "guidance.strategy": ["consult", "strategy"],
  "content.email_draft": ["compose", "email"],
  "content.message_draft": ["compose", "message"],
  "content.meeting_preparation": ["compose", "agenda"],
  "content.discovery_questions": ["compose", "questions"],
  "content.summary": ["compose", "summary"],
  "content.explanation": ["compose", "explanation"],
  "content.rewrite": ["compose", "rewrite"],
  "content.translation": ["compose", "translation"],
  "content.value_argument": ["compose", "value_argument"],
  "report.client_statement": ["action", "stage_answer"],
  "report.seller_observation": ["action", "stage_answer"],
  "report.interaction_outcome": ["action", "stage_answer"],
  "report.commitment": ["action", "stage_answer"],
  "report.document_evidence": ["action", "stage_answer"],
  "report.hypothesis": ["action", "stage_answer"],
  "action.create_record": ["action", "create_record"],
  "action.update_fields": ["action", "update_fields"],
  "action.update_stage_answer": ["action", "stage_answer"],
  "action.link_records": ["action", "link_contact"],
  "action.schedule_activity": ["action", "schedule_activity"],
  "action.reschedule_activity": ["action", "reschedule_activity"],
  "action.record_outcome": ["action", "record_outcome"],
  "action.record_note": ["action", "record_note"],
  "action.change_status": ["action", "change_stage"],
  "action.remove_record": ["limit", "remove_record"],
  "action.send_communication": ["limit", "send_communication"],
});

const DOCUMENT_SOURCE_KINDS = Object.freeze({
  quotation: "quotation", quotation_document: "quotation", provided_document: "attachment",
  opportunity_document: "crm_document", knowledge_library: "library",
});

// Legacy component statuses keep their meaning; "disabled" and "permission_denied" are capability limits.
const TASK_STATUSES = new Set(["completed", "clarification", "error", "unavailable", "disabled", "permission_denied", "pending"]);

// Public responses may omit the component specification; the response-level provenance tells the source.
function responseDocumentKind(result) {
  // Quotation evidence is specific to the document task; contentSource may also reflect other tasks.
  if (result?.documentCoverage?.source === "quotation" || Number(result?.documentMemory?.quotationId || 0)) return "quotation";
  if (["knowledge_library", "mixed_knowledge"].includes(result?.contentSource)) return "library";
  if (result?.contentSource === "user_provided") return "attachment";
  return null;
}

function legacyTask(component, result) {
  const [type, kind] = LEGACY_CATEGORY_TASKS[component.category] || ["unknown", "unknown"];
  const documentKind = type === "document"
    ? DOCUMENT_SOURCE_KINDS[component.documentSpec?.source] ||
      ({ document: "attachment", general: "library", quotation: "quotation" })[component.object] ||
      responseDocumentKind(result) || kind
    : kind;
  return {
    id: component.id || null,
    type,
    kind: documentKind,
    status: TASK_STATUSES.has(component.status) ? component.status : "pending",
    engine: "legacy",
    category: component.category,
    validation: component.contentValidation || null,
  };
}

/** Returns the executed tasks of a chat response, for either engine. */
export function describeTurnTasks(result) {
  if (Array.isArray(result?.turnTasks)) return result.turnTasks;
  const components = Array.isArray(result?.components) ? result.components : [];
  if (components.length) return components.map((component) => legacyTask(component, result));
  if (!result) return [];
  if ((result.operations || []).length) {
    return result.operations.map((operation) => ({
      id: null, type: "action", kind: operation.kind === "activity" ? "schedule_activity" : String(operation.kind || "unknown"),
      status: "completed", engine: "legacy", category: null, validation: null,
    }));
  }
  return [];
}

export function hasTask(result, { type, kind = null, statuses = null }) {
  return describeTurnTasks(result).some((task) => task.type === type && (!kind || task.kind === kind) &&
    (!statuses || statuses.includes(task.status)));
}
