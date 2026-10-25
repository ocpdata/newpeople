import { LEGACY_CATEGORY_TASKS } from "./observed-tasks.js";

// Aligns a legacy B3 contract with the router plan (migration phase B). The plan is the authoritative
// interpretation; B3 only fills the technical specifications its executors need.

const MAX_COMPONENTS = 4;
const normalize = (text) => String(text || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

// Categories used when a task has to be created from the plan; only tasks whose executor needs no extra spec.
const SYNTHESIZABLE = Object.freeze({
  "compose:email": "content.email_draft",
  "compose:message": "content.message_draft",
  "compose:agenda": "content.meeting_preparation",
  "compose:questions": "content.discovery_questions",
  "compose:explanation": "content.explanation",
  "compose:value_argument": "content.value_argument",
  "limit:remove_record": "action.remove_record",
  "limit:send_communication": "action.send_communication",
  "limit:system_help": "query.system_help",
});

function componentTask(component) {
  const [type, kind] = LEGACY_CATEGORY_TASKS[component.category] || ["unknown", "unknown"];
  return { type, kind };
}

/** A component fulfils a task when type and kind agree; consultation and document kinds may differ in detail. */
export function componentMatchesTask(component, task) {
  const { type, kind } = componentTask(component);
  if (type !== task.type) return false;
  if (["consult", "document"].includes(type)) return true;
  return kind === task.kind;
}

const MATERIAL_KINDS = new Set(["summary", "rewrite", "translation"]);
// Summaries, rewrites and translations work on material pasted in the message; a component text much shorter
// than a long message has replaced that material with a description of it.
function lostMaterial(task, component, question) {
  const message = normalize(question);
  return task.type === "compose" && MATERIAL_KINDS.has(task.kind) && message.length >= 300 &&
    normalize(component.text).length < message.length * 0.6;
}

/** Pairs plan tasks with contract components in order and reports what does not match. */
export function comparePlanAndContract(plan, contract, { question = "" } = {}) {
  const tasks = plan.tasks || [];
  const components = contract.components || [];
  const used = new Set();
  const pairs = [];
  const missing = [];
  for (const task of tasks) {
    const component = components.find((item) => !used.has(item.id) && componentMatchesTask(item, task));
    if (component) {
      used.add(component.id);
      pairs.push({ task, component });
    } else {
      missing.push(task);
    }
  }
  const extra = components.filter((item) => !used.has(item.id));
  const lostConstraints = pairs.flatMap(({ task, component }) => task.constraints.quotes
    .filter((quote) => !normalize(component.text).includes(normalize(quote)))
    .map((quote) => ({ taskId: task.id, componentId: component.id, quote })));
  const lostMaterialPairs = pairs.filter(({ task, component }) => lostMaterial(task, component, question));
  const issues = [
    ...lostMaterialPairs.map(({ component }) => ({ code: "LOST_MATERIAL", componentId: component.id,
      problem: `El texto del componente ${component.id} debe incluir completo el material que aporta el vendedor, no una descripción.` })),
    ...missing.map((task) => ({ code: "MISSING_TASK", taskId: task.id,
      problem: `Falta un componente para la tarea ${task.id} (${task.type}/${task.kind}): ${task.ask}` })),
    ...extra.map((component) => ({ code: "UNPLANNED_TASK", componentId: component.id,
      problem: `El componente ${component.id} (${component.category}) no corresponde a ninguna tarea del plan.` })),
    ...lostConstraints.map((item) => ({ code: "LOST_CONSTRAINT", componentId: item.componentId,
      problem: `El texto del componente ${item.componentId} debe conservar literalmente «${item.quote}».` })),
  ];
  return { pairs, missing, extra, lostConstraints, lostMaterialIds: lostMaterialPairs.map(({ component }) => component.id), issues };
}

/**
 * Applies the plan deterministically after B3's single repair: removes unplanned components no other
 * component depends on, restores the literal restrictions in each component text and creates the
 * missing tasks whose executor needs no extra specification.
 */
export function alignContractWithPlan(plan, contract, { question = "" } = {}) {
  const comparison = comparePlanAndContract(plan, contract, { question });
  // Unplanned components survive only when a planned component needs them, directly or transitively.
  const byId = new Map((contract.components || []).map((component) => [component.id, component]));
  const kept = new Set(comparison.pairs.map(({ component }) => component.id));
  const pending = [...kept];
  while (pending.length) {
    for (const dependency of byId.get(pending.pop())?.dependsOn || []) {
      if (!kept.has(dependency)) { kept.add(dependency); pending.push(dependency); }
    }
  }
  const removed = comparison.extra.filter((component) => !kept.has(component.id)).map((component) => component.id);
  const quotesByComponent = new Map();
  for (const item of comparison.lostConstraints) {
    quotesByComponent.set(item.componentId, [...(quotesByComponent.get(item.componentId) || []), item.quote]);
  }
  let components = (contract.components || [])
    .filter((component) => !removed.includes(component.id))
    .map((component) => (comparison.lostMaterialIds.includes(component.id)
      ? { ...component, text: String(question).trim().slice(0, 4000) } : component))
    .map((component) => {
      const quotes = quotesByComponent.get(component.id);
      return quotes ? { ...component, text: `${component.text} (${quotes.map((quote) => `«${quote}»`).join("; ")})`.slice(0, 4000) }
        : component;
    })
    .map((component) => ({
      ...component,
      dependsOn: (component.dependsOn || []).filter((id) => !removed.includes(id)),
      ...(removed.includes(component.continuationOf) ? { continuationOf: "none" } : {}),
    }));
  const synthesized = [];
  let nextId = Math.max(0, ...(contract.components || []).map((component) => Number(String(component.id).slice(1)) || 0));
  for (const task of comparison.missing) {
    const category = SYNTHESIZABLE[`${task.type}:${task.kind}`];
    // The legacy contract holds at most four components (c1-c4).
    if (!category || nextId >= MAX_COMPONENTS || components.length + synthesized.length >= MAX_COMPONENTS) continue;
    nextId += 1;
    const id = `c${nextId}`;
    synthesized.push({
      taskId: task.id, id, text: [task.ask, ...task.constraints.quotes.map((quote) => `«${quote}»`)].join(" ").slice(0, 4000),
      scope: "none", topic: task.ask.slice(0, 120), object: "general", category, certainty: "unspecified",
      dependsOn: [], reference: "", attribution: "none", continuationOf: "none",
      explicitAction: category.startsWith("action."),
    });
  }
  components = [...components, ...synthesized.map(({ taskId: _taskId, ...component }) => component)];
  return {
    contract: { ...contract, components },
    adjustments: {
      removedComponentIds: removed,
      restoredConstraints: comparison.lostConstraints,
      restoredMaterialIds: comparison.lostMaterialIds,
      synthesizedTaskIds: synthesized.map((component) => component.taskId),
      unresolvedTaskIds: comparison.missing.map((task) => task.id)
        .filter((id) => !synthesized.some((component) => component.taskId === id)),
    },
  };
}

/** Plan tasks as context for B3: what to fill, not what to interpret. */
export function plannedTasksForInterpretation(plan) {
  return (plan.tasks || []).map((task) => ({
    id: task.id, type: task.type, kind: task.kind, ask: task.ask, evidence: task.evidence,
    opportunityIds: task.opportunityIds, dependsOn: task.dependsOn,
    allowedCategories: Object.entries(LEGACY_CATEGORY_TASKS)
      .filter(([, [type, kind]]) => type === task.type && (["consult", "document"].includes(type) || kind === task.kind))
      .map(([category]) => category),
    constraints: task.constraints,
  }));
}
