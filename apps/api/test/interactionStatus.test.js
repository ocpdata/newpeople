import { describe, it, expect } from "vitest";
import { inferInteractionActivityStatus } from "../../web/src/opportunities/interactionStatus.js";

describe("inferInteractionActivityStatus", () => {
  it("marks a past-dated activity as done when the analysis says it was realized", () => {
    expect(
      inferInteractionActivityStatus({
        scheduledDate: "2026-09-01",
        note: "Se realizó la llamada y el cliente confirmó el presupuesto.",
        result: "La reunión efectivamente cerró la agenda.",
      }),
    ).toBe("done");
  });

  it("keeps a past-dated item pending when the note frames it as just scheduled and not completed", () => {
    expect(
      inferInteractionActivityStatus({
        scheduledDate: "2026-09-01",
        note: "Quedó agendada la visita para el cliente, pero aún no se realizó.",
      }),
    ).toBe("pending");
  });
});
