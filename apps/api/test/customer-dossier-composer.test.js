import { describe, expect, it } from "vitest";
import {
  buildComposerContext, parseComposition, previousAnswer, renderComposition, renderDeliverable, verifyComposition,
} from "../src/commercial-intelligence/dossier/composer.js";

const constraints = (extra = {}) => ({ count: 0, durationMinutes: 0, length: "standard", format: "free",
  excludedSources: [], excludedFields: [], noWrite: false, noSend: false, quotes: [], ...extra });
const task = (kind, extra = {}) => ({ id: "t1", type: "compose", kind, ask: `Preparar ${kind}`, evidence: kind,
  material: "none", opportunityIds: [], constraints: constraints(), ...extra });
const deliverable = (extra = {}) => ({ taskId: "t1", status: "done", reason: "", subject: "", body: "", items: [],
  notes: "", claims: [], ...extra });
const verify = (tasks, deliverables, extra = {}) => verifyComposition({ composition: { deliverables }, tasks, dossiers: [],
  question: extra.question || "Prepara el texto", history: extra.history || [] });
const codes = (result) => result.failures.map((failure) => failure.code);

describe("redactor: armado del texto", () => {
  it("arma correo, agenda y preguntas por código", () => {
    expect(renderDeliverable(task("email"), deliverable({ subject: "Seguimiento", body: "Hola Kimberly,\n\nTexto." })))
      .toBe("Asunto: Seguimiento\n\nHola Kimberly,\n\nTexto.");
    expect(renderDeliverable(task("agenda"), deliverable({ items: [{ text: "Contexto", minutes: 5 }, { text: "Siguiente paso", minutes: 15 }] })))
      .toBe("- Contexto (5 min)\n- Siguiente paso (15 min)\nTotal: 20 min");
    expect(renderDeliverable(task("questions"), deliverable({ items: [{ text: "¿Qué?", minutes: 0 }], notes: "No respondo por el cliente." })))
      .toBe("1. ¿Qué?\n\nNota: No respondo por el cliente.");
    const two = [task("email"), task("questions", { id: "t2" })];
    expect(renderComposition(two, { deliverables: [deliverable({ subject: "A", body: "Hola" }),
      deliverable({ taskId: "t2", items: [{ text: "¿B?", minutes: 0 }] })] })).toBe("**Correo**\n\nAsunto: A\n\nHola\n\n**Preguntas**\n\n1. ¿B?");
  });

  it("exige exactamente un entregable por tarea", () => {
    expect(() => parseComposition({ deliverables: [] }, [task("email")])).toThrow(/un entregable por tarea/);
  });
});

describe("redactor: verificación por código", () => {
  it("valida asunto, saludo y longitud de mensajes", () => {
    expect(codes(verify([task("email")], [deliverable({ body: "Te escribo para..." })]))).toEqual(["EMAIL_SUBJECT", "EMAIL_GREETING"]);
    expect(verify([task("email")], [deliverable({ subject: "Hola", body: "Hola Rene,\n\nGracias." })]).ok).toBe(true);
    expect(codes(verify([task("message")], [deliverable({ body: "x".repeat(800) })]))).toEqual(["MESSAGE_TOO_LONG"]);
  });

  it("valida la duración de la agenda y la cantidad de preguntas", () => {
    const agenda = task("agenda", { constraints: constraints({ durationMinutes: 20, quotes: ["20 minutos"] }) });
    expect(codes(verify([agenda], [deliverable({ items: [{ text: "A", minutes: 10 }, { text: "B", minutes: 15 }] })])))
      .toEqual(["AGENDA_DURATION"]);
    const questions = task("questions", { constraints: constraints({ count: 3, quotes: ["tres"] }) });
    const result = verify([questions], [deliverable({ items: [{ text: "¿Uno?", minutes: 0 }, { text: "Dos: respuesta", minutes: 0 }] })]);
    expect(codes(result)).toEqual(["QUESTION_FORMAT", "ITEM_COUNT"]);
    const ok = verify([questions], [deliverable({ items: ["¿Uno?", "¿Dos?", "¿Tres?"].map((text) => ({ text, minutes: 0 })) })]);
    expect(ok.validations.t1).toEqual({ reasonCode: "approved", actualQuestionCount: 3, requestedQuestionCount: 3 });
  });

  it("no admite cifras ajenas ni registros del CRM al transformar texto aportado", () => {
    const question = "Hardware Refresh tiene un importe de 500.000 USD y cierre el 31 de enero de 2027. Tradúcelo al inglés";
    const translation = task("translation", { material: "message_text" });
    expect(verify([translation], [deliverable({ body: "Hardware Refresh has an amount of 500,000 USD, closing January 31, 2027." })],
      { question }).ok).toBe(true);
    expect(codes(verify([translation], [deliverable({ body: "Amount 550,000 USD, closing January 31, 2027." })], { question })))
      .toEqual(["MATERIAL_NUMBERS"]);
    const history = [{ role: "assistant", text: "Asunto: Retomar\n\nHola Kimberly, ¿revisamos el 1 de julio?" }, { role: "user", text: "Más breve" }];
    expect(previousAnswer(history)).toContain("Hola Kimberly");
    const shorter = task("rewrite", { material: "previous_answer" });
    expect(verify([shorter], [deliverable({ body: "Hola Kimberly, ¿lo revisamos?" })], { history }).ok).toBe(true);
    expect(codes(verify([shorter], [deliverable({ body: "Hola" })], { history: [] }))).toEqual(["MATERIAL_MISSING"]);
  });

  it("conserva incertidumbre, exclusiones de precio y no afirma envíos", () => {
    const question = "Redacta un correo: quizá revisen el presupuesto; todavía no está confirmado";
    const email = (body) => verify([task("email")], [deliverable({ subject: "Presupuesto", body })], { question });
    expect(codes(email("Hola Kimberly,\n\nRevisarán el presupuesto."))).toEqual(["UNCERTAINTY_LOST"]);
    expect(email("Hola Kimberly,\n\nEntiendo que quizá revisen el presupuesto.").ok).toBe(true);
    const noPrice = task("email", { constraints: constraints({ excludedFields: ["prices"], quotes: ["sin mencionar el precio"] }) });
    expect(codes(verify([noPrice], [deliverable({ subject: "A", body: "Hola,\n\nEl total es 500.000 USD." })]))).toEqual(["EXCLUDED_AMOUNTS"]);
    expect(codes(verify([task("message")], [deliverable({ body: "Ya envié la propuesta." })]))).toEqual(["CLAIMED_EXECUTION"]);
    expect(verify([task("message")], [deliverable({ body: "No se envió ni guardó nada." })]).ok).toBe(true);
  });

  it("no entrega registros del CRM cuando solo se transforma texto aportado", () => {
    const context = buildComposerContext({ question: "Traduce: hola", tasks: [task("translation", { material: "message_text" })],
      dossiers: [{ kind: "account" }], history: [], today: "2026-10-25", timezone: "UTC" });
    expect(context.dossiers).toEqual([]);
    expect(buildComposerContext({ question: "Correo", tasks: [task("email")], dossiers: [{ kind: "account" }], history: [],
      today: "2026-10-25", timezone: "UTC" }).dossiers).toHaveLength(1);
  });
});
