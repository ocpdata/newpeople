import { describe, expect, it, vi } from "vitest";
import {
  findCustomerContractContradictions,
  interpretReviewedCustomerTurn,
} from "../src/commercial-intelligence/turn-contract-review.js";
import { runCustomerContractTurn } from "../src/commercial-intelligence/turn-contract-runtime.js";
import { customerTurnContractSchema } from "../src/commercial-intelligence/turn-contract.js";
import { CUSTOMER_COHERENCE_CASES } from "./fixtures/customer-turn-cases.js";

const question = "Detalla la oportunidad Alfa.";
const component = (extra = {}) => ({
  id: "c1", category: "query.record_detail", text: question, object: "opportunity",
  topic: "", scope: "single", reference: "Alfa", attribution: "none", certainty: "unspecified",
  explicitAction: false, dependsOn: [], continuationOf: "none", ...extra,
});
const contract = (extra = {}, parts = [component()]) => ({
  version: 1, movement: "new_request", resolution: "resolved",
  clarificationQuestion: "", confidence: "high", components: parts, ...extra,
});
const approved = () => ({
  status: "approved", clarificationQuestion: "", issues: [],
});
const mismatch = () => ({
  status: "contradiction", clarificationQuestion: "", issues: [{
    code: "PURPOSE_MISMATCH", componentId: "c1", dimension: "category",
    evidence: "e1", problem: "Se redujo el detalle a notas.",
  }],
});
const input = () => ({ question, classifierPrompt: { instruction: "Personalizada" }, user: { id: 0 } });

describe("B3 interpretation coherence gate", () => {
  it("repairs a named file selection after a completed quotation list even if the AI reviewer approves", async () => {
    const question = "resume el archivo Cotizacion VVF 1-3 Años Access Quality Junio-26.pdf";
    const spec = { source: "quotation_document", documentReference: "Cotizacion VVF 1-3 Años Access Quality Junio-26.pdf" };
    const wrong = contract({}, [component({ category: "query.document_content", object: "document",
      text: question, reference: "", documentSpec: spec })]);
    const fixed = contract({ movement: "continue" }, [component({
      category: "query.document_content", object: "document", text: question, reference: "",
      documentSpec: { ...spec, opportunityReference: "Hardware Refresh", quotationReference: "18", versionNumber: 1 },
    })]);
    const interpret = vi.fn().mockResolvedValue(fixed);
    const reviewWithAI = vi.fn().mockResolvedValue(approved());
    const result = await interpretReviewedCustomerTurn({
      ...input(), question,
      snapshot: { account: { id: 22 }, opportunities: [{ id: 36, accountId: 22, name: "Hardware Refresh" }] },
      conversationContext: { accountId: 22, documentMemory: {
        source: "quotation_document", accountId: 22, opportunityId: 36, quotationId: 18,
        versionId: 22, versionNumber: 1, documentCandidates: [92, 91], documentIds: [],
      } },
    }, { initialContract: wrong, interpret, reviewWithAI });
    expect(result.contract).toEqual(fixed);
    expect(result.review.repaired).toBe(true);
    expect(interpret.mock.calls[0][0].interpretationFeedback.issues)
      .toEqual([expect.objectContaining({ code: "CONTINUITY_MISMATCH" })]);
    expect(reviewWithAI.mock.calls[0][0].context.interpretationContext.documentList)
      .toMatchObject({ opportunityName: "Hardware Refresh", documentCandidates: [92, 91] });
    expect(findCustomerContractContradictions(contract({}, [{ ...wrong.components[0],
      documentSpec: { ...spec, opportunityReference: "Otra oportunidad" },
    }]), { documentMemory: { ...spec, documentCandidates: [92, 91], documentIds: [] } })).toEqual([]);
  });
  it.each([
    "¿Qué archivos están asociados a la cotización 18 de Hardware Refresh?",
    "cuales son los nombres de esos archivos?",
  ])("repairs a structured quotation source used for the filename request: %s", async (question) => {
    const spec = { source: "quotation", opportunityReference: "Hardware Refresh", quotationReference: "18" };
    const wrong = contract({ movement: "continue" }, [component({
      category: "query.document_content", object: "quotation", text: question, reference: "", documentSpec: spec,
    })]);
    const fixed = contract({ movement: "continue" }, [component({
      category: "query.document_content", object: "document", text: question, reference: "",
      documentSpec: { ...spec, source: "quotation_document", documentSelection: "list", versionNumber: 1 },
    })]);
    const discrepancy = { status: "contradiction", clarificationQuestion: "", issues: [{
      code: "SOURCE_MISMATCH", componentId: "c1", dimension: "source", evidence: "e1",
      problem: "Se solicitaron nombres de archivos asociados, no datos comerciales estructurados.",
    }] };
    const interpret = vi.fn().mockResolvedValue(fixed);
    const reviewWithAI = vi.fn().mockResolvedValueOnce(discrepancy).mockResolvedValueOnce(approved());
    const result = await interpretReviewedCustomerTurn({
      ...input(), question,
      snapshot: { account: { id: 22 }, opportunities: [{ id: 36, accountId: 22, name: "Hardware Refresh" }] },
      conversationContext: { accountId: 22, documentMemory: {
        source: "quotation", accountId: 22, opportunityId: 36, quotationId: 18,
        versionId: 22, versionNumber: 1, candidates: [],
      } },
    }, { initialContract: wrong, interpret, reviewWithAI });
    expect(result.contract).toEqual(fixed);
    expect(result.review.repaired).toBe(true);
    expect(interpret.mock.calls[0][0].interpretationFeedback.issues).toEqual([
      { ...discrepancy.issues[0], evidence: question },
    ]);
    const request = reviewWithAI.mock.calls[0][0];
    expect(request.context.interpretationContext.quotationSelection)
      .toMatchObject({ quotationId: 18, versionNumber: 1, opportunityName: "Hardware Refresh" });
    expect(request.systemPrompt).toContain("exige quotation_document/document y documentSelection=list");
    expect(request.systemPrompt).toContain("quotation/quotation sigue siendo");
    expect(reviewWithAI).toHaveBeenCalledTimes(2);
  });
  it("repairs the reported document follow-up even when the AI reviewer approves its incomplete new-request identity", async () => {
    const followup = "¿Qué dice ese documento sobre los requerimientos del cliente?";
    const documentSpec = { source: "opportunity_document", documentReference: "requisitos.docx" };
    const wrong = contract({}, [component({ object: "document", category: "query.document_content",
      text: followup, reference: "", documentSpec })]);
    const fixed = contract({ movement: "continue" }, [component({ object: "document", category: "query.document_content",
      text: followup, reference: "", documentSpec: { source: "opportunity_document", documentSelection: "previous" } })]);
    const interpret = vi.fn().mockResolvedValue(fixed);
    const reviewWithAI = vi.fn().mockResolvedValue(approved());
    const result = await interpretReviewedCustomerTurn({
      ...input(), question: followup,
      snapshot: { account: { id: 1 }, opportunities: [{ id: 10, accountId: 1, name: "Alfa" }] },
      conversationContext: { accountId: 1, documentMemory: { source: "opportunity_document",
        accountId: 1, opportunityId: 10, documentIds: [9], documentCandidates: [9], documentReference: "requisitos.docx" } },
    }, { initialContract: wrong, interpret, reviewWithAI });
    expect(result.contract).toEqual(fixed);
    expect(result.review.repaired).toBe(true);
    expect(interpret.mock.calls[0][0].interpretationFeedback.issues).toEqual([
      expect.objectContaining({ code: "CONTINUITY_MISMATCH", dimension: "continuity" }),
    ]);
    expect(reviewWithAI.mock.calls[0][0].context.interpretationContext.documentSelection)
      .toMatchObject({ documentIds: [9], opportunityName: "Alfa" });
    expect(reviewWithAI).toHaveBeenCalledTimes(2);
    const independent = { ...wrong, components: [{ ...wrong.components[0],
      documentSpec: { ...documentSpec, opportunityReference: "Otra oportunidad" } }] };
    expect(findCustomerContractContradictions(independent, {
      documentMemory: { ...documentSpec, documentIds: [9] },
    })).toEqual([]);
  });
  it.each(CUSTOMER_COHERENCE_CASES)("keeps seeded $id structurally valid but semantically incorrect", (item) => {
    expect(customerTurnContractSchema.safeParse(item.initialContract).success).toBe(true);
    expect(item.initialContract.components[0].category === item.expected[0].category &&
      item.initialContract.components.length === item.expected.length &&
      (!item.expected[0].attribution || item.initialContract.components[0].attribution === item.expected[0].attribution) &&
      (!item.expected[0].certainty || item.initialContract.components[0].certainty === item.expected[0].certainty) &&
      (!item.expected[0].source || item.initialContract.components[0].documentSpec?.source === item.expected[0].source) &&
      (!item.currentText || item.initialContract.components[0].text.toLowerCase().includes(item.currentText))).toBe(false);
  });

  it("reviews the normalized proposal and approves without a repair", async () => {
    const interpret = vi.fn().mockResolvedValue(contract());
    const reviewWithAI = vi.fn().mockResolvedValue(approved());
    const result = await interpretReviewedCustomerTurn(input(), { interpret, reviewWithAI });
    expect(result.contract).toEqual(contract());
    expect(result.review).toMatchObject({ status: "approved", attempts: 1, repaired: false });
    expect(result.review.checks[0].comparison).toEqual({ coverage: true, support: true, fidelity: true });
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(reviewWithAI).toHaveBeenCalledTimes(1);
    expect(reviewWithAI.mock.calls[0][0]).toMatchObject({
      schemaName: "customer_account_turn_coherence", temperature: 0,
      useWebSearchTool: false,
      context: { latestMessage: question, proposedContract: contract() },
      aiUsageContext: { userId: 0, featureCode: "commercial_intelligence.account_chat.intent" },
    });
    const issueFields = reviewWithAI.mock.calls[0][0].fields.find((field) => field.key === "issues").items.fields;
    expect(issueFields.find((field) => field.key === "evidence")).toEqual({
      key: "evidence", type: "enum", enum: ["e1"],
    });
  });

  it("repairs once and reviews again before approving", async () => {
    const wrong = contract({}, [component({ category: "query.opportunity_notes" })]);
    const interpret = vi.fn().mockResolvedValueOnce(wrong).mockResolvedValueOnce(contract());
    const reviewWithAI = vi.fn().mockResolvedValueOnce(mismatch()).mockResolvedValueOnce(approved());
    const result = await interpretReviewedCustomerTurn(input(), { interpret, reviewWithAI });
    expect(result.review).toMatchObject({ status: "approved", repaired: true, attempts: 2, initialContract: wrong });
    expect(result.contract.components[0].category).toBe("query.record_detail");
    expect(interpret.mock.calls[1][0]).toMatchObject({
      question, classifierPrompt: { instruction: "Personalizada" },
      interpretationFeedback: { proposedContract: wrong, issues: [{ ...mismatch().issues[0], evidence: question }] },
    });
    expect(interpret.mock.calls[0][0].deadlineAt).toBe(interpret.mock.calls[1][0].deadlineAt);
    expect(reviewWithAI.mock.calls[1][0].context.proposedContract).toEqual(contract());
  });

  it("keeps multiline history out of schema enums and resolves evidence IDs without altering the original quote", async () => {
    const historyText = "Primera línea.\nSegunda línea.\r\nTercera línea.\tFin.";
    const reviewWithAI = vi.fn().mockResolvedValueOnce({
      ...mismatch(), issues: [{ ...mismatch().issues[0], evidence: "e2" }],
    }).mockResolvedValueOnce(approved());
    const interpret = vi.fn().mockResolvedValue(contract());
    const result = await interpretReviewedCustomerTurn({
      ...input(), conversationHistory: [{ role: "assistant", text: historyText }],
    }, { initialContract: contract(), interpret, reviewWithAI });
    const request = reviewWithAI.mock.calls[0][0];
    expect(request.context.evidenceCatalog).toEqual([
      { id: "e1", text: question }, { id: "e2", text: historyText },
    ]);
    const evidenceField = request.fields.find((field) => field.key === "issues").items.fields
      .find((field) => field.key === "evidence");
    expect(evidenceField.enum).toEqual(["e1", "e2"]);
    expect(evidenceField.enum.every((value) => /^e\d+$/.test(value))).toBe(true);
    expect(result.review.checks[0].issues[0].evidence).toBe(historyText);
    expect(interpret.mock.calls[0][0].interpretationFeedback.issues[0].evidence).toBe(historyText);
    expect(result.review.repaired).toBe(true);
  });

  it("sends bidirectional and evidence relevance rules in one call without redundant model indicators", async () => {
    const reviewWithAI = vi.fn().mockResolvedValue(approved());
    await interpretReviewedCustomerTurn(input(), { initialContract: contract(), reviewWithAI });
    const request = reviewWithAI.mock.calls[0][0];
    expect(request.systemPrompt).toContain("mensaje -> contrato");
    expect(request.systemPrompt).toContain("contrato -> mensaje");
    expect(request.systemPrompt).toContain("Cada cita debe ser PERTINENTE");
    expect(request.fields.some((field) => field.key === "comparison")).toBe(false);
    expect(reviewWithAI).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["MISSING_TASK", "coverage", "coverage", "none"],
    ["UNSUPPORTED_TASK", "support", "support", "c1"],
    ["LOST_CONSTRAINT", "constraint", "fidelity", "c1"],
  ])("records and repairs the %s contrast without another reviewer stage", async (code, dimension, axis, componentId) => {
    const discrepancy = {
      status: "contradiction", clarificationQuestion: "",
      issues: [{ code, dimension, componentId, evidence: "e1", problem: "El contrato no conserva el encargo." }],
    };
    const reviewWithAI = vi.fn().mockResolvedValueOnce(discrepancy).mockResolvedValueOnce(approved());
    const interpret = vi.fn().mockResolvedValue(contract());
    const result = await interpretReviewedCustomerTurn(input(), { initialContract: contract(), interpret, reviewWithAI });
    expect(result.review.checks[0]).toMatchObject({ comparison: { [axis]: false }, issues: [{ code }] });
    expect(result.review.checks[1].comparison).toEqual({ coverage: true, support: true, fidelity: true });
    expect(result.review.repaired).toBe(true);
    expect(interpret.mock.calls[0][0].interpretationFeedback.issues)
      .toEqual([{ ...discrepancy.issues[0], evidence: question }]);
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(reviewWithAI).toHaveBeenCalledTimes(2);
  });

  it("requests clarification without repairing a genuinely ambiguous reference", async () => {
    const ambiguous = {
      status: "ambiguous", clarificationQuestion: "¿Te refieres a Alfa o a Beta?",
      issues: [{ code: "AMBIGUOUS_REFERENCE", componentId: "c1", dimension: "object", evidence: "e1", problem: "Hay dos antecedentes." }],
    };
    const interpret = vi.fn().mockResolvedValue(contract());
    const result = await interpretReviewedCustomerTurn(input(), { interpret, reviewWithAI: async () => ambiguous });
    expect(result.contract).toMatchObject({
      resolution: "clarification", confidence: "low", clarificationQuestion: ambiguous.clarificationQuestion,
      components: [component()],
    });
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it("never retries indefinitely or approves a persistent contradiction", async () => {
    const interpret = vi.fn().mockResolvedValue(contract());
    const reviewWithAI = vi.fn().mockResolvedValue(mismatch());
    const result = await interpretReviewedCustomerTurn(input(), { interpret, reviewWithAI });
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(reviewWithAI).toHaveBeenCalledTimes(2);
    expect(result.contract.resolution).toBe("clarification");
    expect(result.review.status).toBe("clarification");
  });

  it.each([
    null,
    { ...approved(), issues: mismatch().issues },
    { status: "ambiguous", clarificationQuestion: "", issues: mismatch().issues },
    { ...mismatch(), issues: [{ ...mismatch().issues[0], evidence: "Una cita que no existe" }] },
    { ...mismatch(), issues: [{ ...mismatch().issues[0], evidence: "e9999" }] },
    { ...mismatch(), issues: [{ ...mismatch().issues[0], componentId: "c4" }] },
    { ...approved(), comparison: { coverage: true, support: false, fidelity: true } },
    {
      ...mismatch(),
      issues: [{ ...mismatch().issues[0], code: "UNSUPPORTED_TASK", dimension: "support", componentId: "none" }],
    },
    {
      ...mismatch(),
      issues: [{ ...mismatch().issues[0], code: "MISSING_TASK", dimension: "support" }],
    },
  ])("blocks invalid or ungrounded review output %#", async (review) => {
    const interpret = vi.fn().mockResolvedValue(contract());
    const reviewWithAI = vi.fn().mockResolvedValue(review);
    await expect(interpretReviewedCustomerTurn(input(), { interpret, reviewWithAI }))
      .rejects.toMatchObject({ code: "CUSTOMER_B3_REVIEW_FAILED", reviewFailure: { attempt: 2 } });
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(reviewWithAI).toHaveBeenCalledTimes(2);
  });

  it("revalidates an inconsistent hardware clarification once without executing or replacing the contract", async () => {
    const hardwareQuestion = "Dame el detalle de la oportunidad de hardware";
    const proposed = contract({}, [component({ text: hardwareQuestion, reference: "hardware" })]);
    const clarificationQuestion = "¿Te refieres a Hardware Refresh o Hardware Refresh 3 Años?";
    const invalid = { status: "approved", clarificationQuestion, issues: [{
      code: "AMBIGUOUS_REFERENCE", componentId: "c1", dimension: "object", evidence: "e1",
      problem: "La referencia hardware no distingue los dos registros.",
    }] };
    const reviewWithAI = vi.fn().mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce({ ...invalid, status: "ambiguous" });
    const interpret = vi.fn();
    const result = await interpretReviewedCustomerTurn({ ...input(), question: hardwareQuestion }, {
      initialContract: proposed, interpret, reviewWithAI,
    });
    expect(result.contract.resolution).toBe("clarification");
    expect(result.contract.clarificationQuestion).toBe(clarificationQuestion);
    expect(result.review).toMatchObject({ reviewRequests: 2, attempts: 1, repaired: false,
      validationFailures: [{ kind: "invalid_review", receivedReview: invalid,
        validationIssues: [{ path: ["issues"], message: expect.any(String) },
          { path: ["clarificationQuestion"], message: expect.any(String) }] }] });
    const retry = reviewWithAI.mock.calls[1][0];
    expect(retry.context.proposedContract).toEqual(proposed);
    expect(retry.context.reviewValidationFeedback.receivedReview).toEqual(invalid);
    expect(retry.context.latestMessage).toBe(hardwareQuestion);
    expect(interpret).not.toHaveBeenCalled();
    const executeComponent = vi.fn();
    const turn = await runCustomerContractTurn({ question: hardwareQuestion, contract: result.contract,
      context: { accountId: 22 }, executeComponent });
    expect(turn.response.answer).toContain("Hardware Refresh 3 Años");
    expect(turn.response.operations).toEqual([]);
    expect(executeComponent).not.toHaveBeenCalled();
  });

  it("can recover invalid evidence but still requires a valid semantic review", async () => {
    const reviewWithAI = vi.fn()
      .mockResolvedValueOnce({ ...mismatch(), issues: [{ ...mismatch().issues[0], evidence: "e999" }] })
      .mockResolvedValueOnce(mismatch())
      .mockResolvedValueOnce(approved());
    const interpret = vi.fn().mockResolvedValue(contract());
    const result = await interpretReviewedCustomerTurn(input(), { initialContract: contract(), interpret, reviewWithAI });
    expect(result.review).toMatchObject({ reviewRequests: 3, repaired: true,
      validationFailures: [{ kind: "invalid_evidence" }] });
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(reviewWithAI.mock.calls[2][0].context.reviewValidationFeedback).toBeUndefined();
  });

  it("shares a single invalid-review retry across both contract attempts", async () => {
    const invalid = { ...approved(), clarificationQuestion: "¿Qué oportunidad?" };
    const reviewWithAI = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(mismatch()).mockResolvedValueOnce(invalid);
    await expect(interpretReviewedCustomerTurn(input(), {
      initialContract: contract(), interpret: async () => contract(), reviewWithAI,
    })).rejects.toMatchObject({ code: "CUSTOMER_B3_REVIEW_FAILED", reviewFailure: {
      attempt: 3, contractAttempt: 2, kind: "invalid_review",
      validationIssues: [{ path: ["clarificationQuestion"], message: expect.any(String) }],
      previousFailures: [{ attempt: 1, kind: "invalid_review" }],
    } });
    expect(reviewWithAI).toHaveBeenCalledTimes(3);
  });

  it.each(["TimeoutError", "AbortError", "Error"])("blocks provider failure: %s", async (name) => {
    const reviewWithAI = vi.fn().mockRejectedValue(Object.assign(new Error("Provider failed"), { name }));
    await expect(interpretReviewedCustomerTurn(input(), {
      interpret: async () => contract(), reviewWithAI,
    })).rejects.toMatchObject({
      code: name === "Error" ? "CUSTOMER_B3_REVIEW_FAILED" : "CUSTOMER_B3_REVIEW_TIMEOUT",
      reviewFailure: { kind: name === "Error" ? "provider_failure" : "timeout", attempt: 1 },
    });
    expect(reviewWithAI).toHaveBeenCalledTimes(1);
  });

  it("does not start requests after the shared deadline expires", async () => {
    const interpret = vi.fn();
    const reviewWithAI = vi.fn();
    await expect(interpretReviewedCustomerTurn({ ...input(), deadlineAt: Date.now() - 1 }, { interpret, reviewWithAI }))
      .rejects.toMatchObject({ code: "CUSTOMER_B3_REVIEW_TIMEOUT" });
    expect(interpret).not.toHaveBeenCalled();
    expect(reviewWithAI).not.toHaveBeenCalled();
  });

  it("reviews deterministic proposals too", async () => {
    const interpret = vi.fn();
    const reviewWithAI = vi.fn().mockResolvedValue(approved());
    const result = await interpretReviewedCustomerTurn(input(), { initialContract: contract(), interpret, reviewWithAI });
    expect(result.contract).toEqual(contract());
    expect(interpret).not.toHaveBeenCalled();
    expect(reviewWithAI).toHaveBeenCalledTimes(1);
  });

  it("does not accept semantic approval over deterministic source/object contradictions", async () => {
    const invalid = contract({}, [component({
      category: "query.document_content", object: "general",
      documentSpec: { source: "provided_document" },
    })]);
    const result = await interpretReviewedCustomerTurn(input(), {
      interpret: async () => invalid, reviewWithAI: async () => approved(),
    });
    expect(result.contract.resolution).toBe("clarification");
    expect(result.review.checks.every((check) => check.issues[0].code === "OBJECT_MISMATCH")).toBe(true);
  });

  it("accepts empty-component dialogue controls", async () => {
    const stop = contract({ movement: "stop" }, []);
    const result = await interpretReviewedCustomerTurn(input(), {
      initialContract: stop, reviewWithAI: async () => approved(),
    });
    expect(result.contract).toEqual(stop);
  });

  it("accepts already-specific clarification when the reviewer approves", async () => {
    const clarification = contract({ resolution: "clarification", clarificationQuestion: "¿Qué oportunidad?" });
    const result = await interpretReviewedCustomerTurn(input(), {
      initialContract: clarification, reviewWithAI: async () => approved(),
    });
    expect(result.contract).toEqual(clarification);
  });

  it("checks documentary pairs and previous-component continuity", () => {
    const document = component({ category: "query.document_content", object: "document", documentSpec: { source: "provided_document" } });
    expect(findCustomerContractContradictions(contract({}, [document]))).toEqual([]);
    expect(findCustomerContractContradictions(contract({}, [component({ continuationOf: "c1" })])))
      .toMatchObject([{ code: "CONTINUITY_MISMATCH" }]);
    const memory = { turnMemory: { contract: contract() } };
    expect(findCustomerContractContradictions(contract({ movement: "continue" }, [component({ continuationOf: "c1" })]), memory))
      .toEqual([]);
  });

  it("does not promote a blocked clarification into execution through draft confirmation", async () => {
    const executeComponent = vi.fn();
    const result = await runCustomerContractTurn({
      question: "Sí", contract: contract({
        movement: "continue", resolution: "clarification", confidence: "low",
        clarificationQuestion: "¿Qué cambio quieres confirmar?",
      }),
      conversationContext: { accountId: 9001, updateMemory: { marker: "draft" } },
      context: {}, executeComponent,
    });
    expect(result.response.responseType).toBe("clarification");
    expect(result.response.answer).toContain("¿Qué cambio quieres confirmar?");
    expect(executeComponent).not.toHaveBeenCalled();
  });

  it("blocks a review response that arrives after the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      await expect(interpretReviewedCustomerTurn({ ...input(), deadlineAt: Date.now() + 100 }, {
        initialContract: contract(),
        reviewWithAI: async () => { vi.advanceTimersByTime(101); return approved(); },
      })).rejects.toMatchObject({ code: "CUSTOMER_B3_REVIEW_TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not retry an invalid review after the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      const reviewWithAI = vi.fn(async () => {
        vi.advanceTimersByTime(101);
        return { ...approved(), issues: mismatch().issues };
      });
      await expect(interpretReviewedCustomerTurn({ ...input(), deadlineAt: Date.now() + 100 }, {
        initialContract: contract(), reviewWithAI,
      })).rejects.toMatchObject({ code: "CUSTOMER_B3_REVIEW_TIMEOUT" });
      expect(reviewWithAI).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
