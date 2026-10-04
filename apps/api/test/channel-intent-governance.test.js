import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  configurationRows: [],
  transactionStatements: [],
}));

vi.mock("../src/db.js", () => ({
  query: databaseMock.query,
  withTransaction: databaseMock.withTransaction,
}));

import {
  loadChannelIntentConfigurations,
  previewChannelIntent,
  updateChannelIntentConfiguration,
} from "../src/coach/channel-intent-governance.js";

describe("channel intent governance", () => {
  beforeEach(() => {
    databaseMock.configurationRows = [];
    databaseMock.transactionStatements = [];
    databaseMock.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM mi_channel_intent_configurations")) {
        return databaseMock.configurationRows;
      }
      return [];
    });
    databaseMock.withTransaction.mockImplementation(async (work) =>
      work({
        query: async (sql, params) => {
          databaseMock.transactionStatements.push({ sql, params });
          return [];
        },
      }),
    );
  });

  it("loads only configured channels and rejects persisted tool expansion", async () => {
    databaseMock.configurationRows = [
      {
        intent_code: "quotation_query",
        configuration_json: {
          allowedTools: ["searchAccounts", "deleteAccount"],
        },
      },
    ];

    await expect(
      loadChannelIntentConfigurations({ channel: "customer_account" }),
    ).rejects.toThrow("herramientas no permitidas");
    await expect(
      loadChannelIntentConfigurations({ channel: "coach" }),
    ).rejects.toThrow("Canal de enrutamiento no configurable");
  });

  it("writes the prior snapshot and updated intent atomically", async () => {
    const result = await updateChannelIntentConfiguration({
      user: { id: 41 },
      channel: "customer_account",
      intentCode: "quotation_query",
      configuration: { allowedTools: ["searchAccounts"] },
    });

    expect(
      result.catalog.find((item) => item.code === "quotation_query"),
    ).toMatchObject({
      allowedTools: ["searchAccounts"],
    });
    expect(databaseMock.transactionStatements).toHaveLength(2);
    expect(databaseMock.transactionStatements[0].sql).toContain(
      "INSERT INTO mi_channel_intent_revisions",
    );
    expect(databaseMock.transactionStatements[1].sql).toContain(
      "INSERT INTO mi_channel_intent_configurations",
    );
  });

  it("previews an unsaved draft without inventing context or executing tools", async () => {
    const preview = await previewChannelIntent({
      channel: "customer_account",
      question: "¿Qué contiene la cotización para esta oportunidad?",
      intentCode: "quotation_query",
      configuration: {
        enabled: true,
        examples: ["Consulta la cotización"],
        priority: 130,
        allowedTools: ["searchAccounts"],
        requiredContext: ["account"],
      },
    });

    expect(preview.classification).toMatchObject({
      intent: "quotation_query",
      missingContext: ["account"],
      allowedTools: ["searchAccounts"],
    });
    expect(preview.toolsExecuted).toEqual([]);
  });
});
