import { describe, expect, it } from "vitest";
import {
  captureSnapshotQueryFailure,
  captureSnapshotQueryRows,
} from "../src/commercial-intelligence/snapshot-query-metrics.js";

describe("Customer snapshot query metrics", () => {
  it("detects rows beyond a cap and removes the sentinel row", () => {
    const rawRows = Array.from({ length: 51 }, (_, index) => ({
      id: index + 1,
      privateValue: `record-${index + 1}`,
    }));
    const result = captureSnapshotQueryRows("contacts", rawRows, 50);

    expect(result.rows).toHaveLength(50);
    expect(result.rows.at(-1).id).toBe(50);
    expect(result.metric).toEqual({
      source: "contacts",
      resultCount: 50,
      resultLimit: 50,
      truncated: true,
      errorCode: null,
    });
    expect(JSON.stringify(result.metric)).not.toContain("privateValue");
  });

  it("marks a result under its limit complete", () => {
    const result = captureSnapshotQueryRows(
      "opportunities_active",
      [{ id: 1 }, { id: 2 }],
      50,
    );

    expect(result.metric).toMatchObject({
      resultCount: 2,
      resultLimit: 50,
      truncated: false,
      errorCode: null,
    });
  });

  it("records query errors without persisting the error message", () => {
    expect(captureSnapshotQueryFailure("interactions", 30)).toEqual({
      source: "interactions",
      resultCount: 0,
      resultLimit: 30,
      truncated: null,
      errorCode: "query_error",
    });
  });
});
