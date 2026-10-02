import { describe, expect, it } from "vitest";
import {
  listCoachCaseCatalog,
  matchCoachQueryCase,
} from "../src/coach/case-catalog.js";
import { classifyCoachIntent } from "../src/coach/phase-one-engine.js";

describe("Coach case catalog", () => {
  it.each([
    ["Qué riesgos bloquean esta oportunidad?", "COACH-STAGE-RISK-001"],
    ["¿Qué me falta para avanzar de etapa?", "COACH-STAGE-PREPARATION-001"],
    ["¿Qué preguntas debo hacer en Cotización?", "COACH-STAGE-QUESTIONS-001"],
    ["¿Qué actividades están pendientes?", "COACH-ACTIVITY-QUERY-001"],
    ["¿Qué contiene una cotización?", "COACH-QUOTATION-QUERY-001"],
    ["¿Quiénes son los decisores y contactos?", "COACH-CONTACT-QUERY-001"],
    ["Dame un resumen de la cuenta", "COACH-ACCOUNT-QUERY-001"],
  ])("maps the governed case for %s", (question, caseId) => {
    expect(matchCoachQueryCase(question)?.id).toBe(caseId);
  });

  it("uses stable IDs and exposes only deterministic catalog metadata", () => {
    expect(listCoachCaseCatalog().map((item) => item.id)).toEqual([
      "COACH-STAGE-RISK-001",
      "COACH-STAGE-PREPARATION-001",
      "COACH-STAGE-QUESTIONS-001",
      "COACH-ACTIVITY-QUERY-001",
      "COACH-QUOTATION-QUERY-001",
      "COACH-CONTACT-QUERY-001",
      "COACH-ACCOUNT-QUERY-001",
    ]);
  });

  it("returns the governed stage-question case through the intent layer", () => {
    expect(classifyCoachIntent("¿Qué preguntas debo hacer en Cotización?")).toMatchObject({
      type: "stage_readiness",
      subtype: "stage_questions",
      caseId: "COACH-STAGE-QUESTIONS-001",
      operationRequested: false,
    });
  });
});