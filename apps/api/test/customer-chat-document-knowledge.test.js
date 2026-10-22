import { describe, expect, it } from "vitest";
import {
  buildCustomerDocumentKnowledgeQuery,
  shouldRetrieveCustomerDocumentKnowledge,
} from "../src/commercial-intelligence/customer-chat-document-knowledge.js";

describe("customer chat document knowledge policy", () => {
  it("removes selected CRM names and numeric record references from the Pinecone query", () => {
    const query = buildCustomerDocumentKnowledgeQuery({
      question: "¿Qué estrategia recomiendas para Acme y la oportunidad #123?",
      snapshot: { account: { name: "Acme" } },
    });
    expect(query).not.toContain("Acme");
    expect(query).not.toContain("#123");
    expect(query).toContain("estrategia");
  });

  it("retrieves for general sales guidance and product/process questions", () => {
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Qué sigue para esta oportunidad?",
      routing: { intent: "opportunity_guidance", intents: ["opportunity_guidance"] },
    })).toBe(true);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Cómo funciona BlueCat y cómo se implementa?",
      routing: { intent: "account_overview", intents: ["account_overview"] },
    })).toBe(true);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Cómo es el proceso de ventas?",
      turnContract: {
        resolution: "resolved",
        components: [{ category: "guidance.strategy", object: "general" }],
      },
    })).toBe(true);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Qué productos tiene esta cuenta?",
      routing: { intent: "account_overview", intents: ["account_overview"] },
    })).toBe(false);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "Prepara preguntas para descubrir necesidades",
      turnContract: {
        resolution: "resolved",
        components: [{ category: "content.discovery_questions" }],
      },
    })).toBe(true);
  });

  it("does not retrieve for CRM facts, clarifications, or operations", () => {
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Cuál es el monto de la oportunidad?",
      routing: { intent: "quotation_query", intents: ["quotation_query"] },
    })).toBe(false);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Qué producto aparece en la cotización?",
      routing: { intent: "quotation_query", intents: ["quotation_query"] },
    })).toBe(false);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Cómo funciona BlueCat?",
    })).toBe(false);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "Actualiza el monto de la oportunidad",
      routing: {
        mode: "operation",
        intents: ["crm_operation"],
      },
    })).toBe(false);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "¿Qué proceso sigo?",
      routing: { requiresClarification: true, intents: ["opportunity_guidance"] },
    })).toBe(false);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "Prepara un argumento de valor y actualiza el CRM",
      turnContract: {
        resolution: "resolved",
        components: [
          { category: "content.value_argument" },
          { category: "action.update_fields" },
        ],
      },
    })).toBe(false);
    expect(shouldRetrieveCustomerDocumentKnowledge({
      question: "Prepara un argumento de valor",
      turnContract: {
        resolution: "clarification",
        components: [{ category: "content.value_argument" }],
      },
    })).toBe(false);
  });
});
