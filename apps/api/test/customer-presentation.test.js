import { describe, expect, it } from "vitest";
import { CUSTOMER_TURN_CATEGORIES } from "../src/commercial-intelligence/turn-contract.js";
import {
  CUSTOMER_FRIENDLY_STYLE_INSTRUCTIONS,
  customerFacingComponentLabel,
  presentCustomerResponse,
  presentCustomerText,
} from "../src/commercial-intelligence/customer-presentation.js";

describe("Customer answer presentation", () => {
  it("provides a seller-facing label for every supported turn category", () => {
    expect(CUSTOMER_TURN_CATEGORIES).toHaveLength(46);
    for (const { code } of CUSTOMER_TURN_CATEGORIES) {
      expect(customerFacingComponentLabel(code)).toEqual(expect.any(String));
      expect(customerFacingComponentLabel(code).length).toBeGreaterThan(0);
    }
  });

  it("uses readable labels for record-specific queries", () => {
    expect(customerFacingComponentLabel("query.record_detail", "contact")).toBe("Datos del contacto");
    expect(customerFacingComponentLabel("query.field_value", "opportunity")).toBe("Dato solicitado de la oportunidad");
    expect(customerFacingComponentLabel("query.record_list", "contact")).toBe("Lista de contactos");
    expect(customerFacingComponentLabel("query.record_search", "opportunity")).toBe("Resultados de oportunidades");
    expect(customerFacingComponentLabel("action.create_record", "contact")).toBe("Propuesta para crear un contacto");
    expect(customerFacingComponentLabel("query.record_detail", "general")).toBe("Datos del registro");
  });

  it("softens technical stage language without dropping its constraints", () => {
    expect(presentCustomerText(
      "Preparación y requisitos de etapa:\nEsta consulta no guarda respuestas ni cambia la etapa.",
    )).toBe("Revisé qué hace falta para avanzar:\nNo guardé respuestas ni cambié la etapa.");
  });

  it("describes a missing contact role in plain language", () => {
    expect(presentCustomerText("Cargo: No informado")).toBe("Cargo: No indicado en el registro");
  });

  it("presents response text and component labels without changing operational metadata", () => {
    const operations = [{ type: "update", status: "proposed" }];
    const original = {
      answer: "Estado registrado: pendiente.",
      operations,
      evidence: ["Oportunidad 42"],
      components: [{ category: "action.change_status", object: "opportunity", answer: "No se ha guardado ningún cambio." }],
    };
    const presented = presentCustomerResponse(original);
    expect(presented.answer).toBe("Estado: pendiente.");
    expect(presented.operations).toBe(operations);
    expect(presented.evidence).toBe(original.evidence);
    expect(presented.components[0]).toMatchObject({
      category: "action.change_status",
      object: "opportunity",
      label: "Avance por revisar",
      answer: "No guardé cambios.",
    });
    expect(original.components[0]).not.toHaveProperty("label");
  });

  it("keeps style guidance separate from factual and operational safeguards", () => {
    expect(CUSTOMER_FRIENDLY_STYLE_INSTRUCTIONS).toContain("No conviertas una propuesta en acuerdo o acción ejecutada");
    expect(CUSTOMER_FRIENDLY_STYLE_INSTRUCTIONS).toContain("Conserva todos los datos");
  });
});
