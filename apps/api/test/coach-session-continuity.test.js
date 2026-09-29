import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../src/db.js", () => ({
  query: queryMock,
}));
vi.mock("../src/coach/schema.js", () => ({
  ensureCoachSchema: vi.fn().mockResolvedValue(undefined),
}));

import {
  getCoachSession,
  setCoachPendingQuestion,
  updateCoachSession,
} from "../src/coach/service.js";

const sessionRow = {
  id: 12,
  user_id: 7,
  status: "active",
  account_id: 21,
  contact_id: null,
  opportunity_id: 34,
  quotation_id: null,
  proposal_id: null,
  lead_id: null,
  context_snapshot: JSON.stringify({ accountId: 21, opportunityId: 34 }),
  messages: JSON.stringify([]),
  draft_operation: null,
  pending_question: "¿Qué falta para avanzar?",
  session_version: 4,
  created_at: "2026-09-29T12:00:00.000Z",
  updated_at: "2026-09-29T12:01:00.000Z",
  closed_at: null,
};

describe("Coach session continuity", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([sessionRow]);
  });

  it("restores pending question and server session version", async () => {
    const session = await getCoachSession(7, 12);

    expect(session).toMatchObject({
      id: 12,
      pendingQuestion: "¿Qué falta para avanzar?",
      version: 4,
      context: { accountId: 21, opportunityId: 34 },
    });
  });

  it("increments the server version when updating pending state", async () => {
    await setCoachPendingQuestion(7, 12, "Nueva pregunta");

    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain("session_version = session_version + 1");
    expect(params).toContain("Nueva pregunta");
  });

  it("clears pending question without losing the session context", async () => {
    const updated = await updateCoachSession(7, 12, {
      pendingQuestion: null,
    });

    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain("pending_question = ?");
    expect(params).toContain(null);
    expect(updated).toMatchObject({
      pendingQuestion: "¿Qué falta para avanzar?",
      version: 4,
      context: { accountId: 21, opportunityId: 34 },
    });
  });
});
