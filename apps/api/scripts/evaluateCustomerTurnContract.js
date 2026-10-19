import { writeFile } from "node:fs/promises";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { interpretCustomerTurn } from "../src/commercial-intelligence/turn-contract.js";
import { associateCustomerReport } from "../src/commercial-intelligence/turn-contract-runtime.js";
import { CUSTOMER_TURN_CASES, SYNTHETIC_CUSTOMER_SNAPSHOT as snapshot } from "../test/fixtures/customer-turn-cases.js";

if (!process.argv.includes("--live")) {
  console.error("Requiere --live: realiza llamadas pagadas al proveedor configurado con datos exclusivamente sintéticos.");
  process.exitCode = 1;
} else if (!config.openai.apiKey) {
  console.error("Falta la configuración del proveedor de IA.");
  process.exitCode = 1;
} else {
  const results = [];
  const classifierPrompt = { instruction: "Interpreta solicitudes comerciales de la cuenta autorizada. No ejecutes cambios." };
  const interpret = (question, extra = {}) => interpretCustomerTurn({
    question, snapshot, classifierPrompt, user: { id: 0 }, ...extra,
  });
  try {
    for (const item of CUSTOMER_TURN_CASES) {
      try {
        const actual = await interpret(item.question);
        const passed = actual.resolution === "resolved" && actual.components.length === 1 &&
          actual.components[0].category === item.category && actual.components[0].object === item.object;
        results.push({ group: "catalog", expected: item.category, passed, actual });
        console.log(`${passed ? "PASS" : "FAIL"} ${item.category}: ${actual.components.map((part) => `${part.category}/${part.object}`).join(", ")}`);
      } catch (error) {
        results.push({ group: "catalog", expected: item.category, passed: false, error: error.code || error.message, issues: error.validationIssues });
        console.error(`FAIL ${item.category}: ${error.code || error.message}`);
      }
    }
    const reportContract = results.find((item) => item.expected === "report.client_statement")?.actual;
    const reportMemory = reportContract ? { contract: reportContract, pendingComponentIds: ["c1"] } : null;
    const dialogueCases = [
      ["new_request", "Dame una lista de las oportunidades.", null, []],
      ["answer_clarification", "Renovación Alfa", reportMemory, [{ role: "assistant", text: "¿Para qué oportunidad es el reporte?" }]],
      ["select_candidate", "La primera pregunta", reportMemory, [{ role: "assistant", text: "¿A cuál pregunta quieres agregar el reporte? 1. Motivación 2. Presupuesto" }]],
      ["accept_proposal", "Sí, prepara el borrador de la reunión.", null, [{ role: "assistant", text: "Puedo preparar una propuesta editable de reunión. ¿Quieres que la prepare?" }]],
      ["confirm_execution", "Confirmo que se ejecute el cambio propuesto.", null, [{ role: "assistant", text: "La propuesta de cambio está preparada. Debes revisarla antes de confirmar su ejecución." }]],
      ["modify_draft", "Modifica el borrador del correo para que sea más breve.", null, [{ role: "assistant", text: "Borrador de correo: Estimada Elena, comparto la propuesta para tu revisión." }]],
      ["correct", "Corrijo lo que dije: no es presupuesto, es falta de responsable.", reportMemory, []],
      ["reject", "No, no quiero esa propuesta.", null, [{ role: "assistant", text: "¿Quieres que prepare una propuesta de llamada?" }]],
      ["discard_draft", "Descarta el borrador de la reunión que estamos preparando.", null, [{ role: "assistant", text: "El borrador de reunión sigue pendiente de fecha." }]],
      ["continue", "Continúa con el análisis que estabas haciendo.", null, [{ role: "assistant", text: "Estaba analizando los riesgos de Renovación Alfa." }]],
      ["change_focus", "Dejemos ese reporte. Ahora quiero ver el listado de contactos.", reportMemory, []],
      ["request_rationale", "¿Por qué recomiendas esa acción?", null, [{ role: "assistant", text: "Recomiendo validar al responsable antes de una demo." }]],
      ["stop", "Detente, no sigas con esta solicitud.", reportMemory, []],
    ];
    for (const [movement, question, turnMemory, conversationHistory] of dialogueCases) {
      try {
        const actual = await interpret(question, { conversationHistory, conversationContext: { accountId: 9001, turnMemory } });
        const passed = actual.movement === movement;
        results.push({ group: "dialogue", expected: movement, passed, actual });
        console.log(`${passed ? "PASS" : "FAIL"} dialogue.${movement}: ${actual.movement}`);
      } catch (error) {
        results.push({ group: "dialogue", expected: movement, passed: false, error: error.code || error.message, issues: error.validationIssues, structure: error.invalidStructure });
        console.error(`FAIL dialogue.${movement}: ${error.code || error.message}`);
      }
    }
    const compound = await interpret("¿En qué etapa está Renovación Alfa? Además redacta un correo para pedir una reunión sobre esa oportunidad, pero no lo envíes.");
    const compoundPassed = compound.components.length === 2 &&
      compound.components[0].category === "query.field_value" &&
      compound.components[1].category === "content.email_draft";
    results.push({ group: "critical", expected: "compound", passed: compoundPassed, actual: compound });
    if (reportContract) {
      const report = reportContract.components[0];
      const associated = await associateCustomerReport({
        component: report, snapshot,
        routing: { serverResolvedEntityIds: { opportunityId: 9101 } },
        readToolResults: [{ toolName: "getOpportunity", result: snapshot.opportunities[0] }],
        authorizedToolNames: new Set(["getOpportunityReadiness"]), user: { id: 0 }, signal: AbortSignal.timeout(15000),
      });
      results.push({ group: "critical", expected: "report_destination", passed: associated.stageAnswerPrefill?.questionIds[0] === 9201 && associated.operations.length === 0, actual: associated });
    } else {
      results.push({ group: "critical", expected: "report_destination", passed: false });
    }
    for (const code of ["report.client_statement", "query.field_value", "action.schedule_activity", "guidance.next_steps", "query.record_list", "action.create_record", "content.email_draft"]) {
      const item = results.find((result) => result.expected === code);
      results.push({ group: "critical", expected: code, passed: Boolean(item?.passed) });
    }
  } finally {
    await pool.end();
  }
  const groups = Object.fromEntries(["catalog", "dialogue", "critical"].map((group) => {
    const selected = results.filter((item) => item.group === group);
    return [group, { passed: selected.filter((item) => item.passed).length, total: selected.length }];
  }));
  const passed = groups.catalog.passed / 46 >= 0.95 &&
    groups.dialogue.passed / 13 >= 0.9 &&
    groups.critical.total === 9 && groups.critical.passed === 9;
  const report = { model: config.openai.model, syntheticOnly: true, passed, groups, results, evaluatedAt: new Date().toISOString() };
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    await writeFile(process.argv[outputIndex + 1], JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed, groups }, null, 2));
  if (!passed) process.exitCode = 1;
}
