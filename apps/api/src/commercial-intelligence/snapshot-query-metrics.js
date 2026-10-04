export function captureSnapshotQueryRows(source, rows, limit = null) {
  const queryRows = Array.isArray(rows) ? rows : [];
  const resultLimit = Number.isInteger(limit) && limit >= 0 ? limit : null;
  const truncated =
    resultLimit === null ? false : queryRows.length > resultLimit;
  const returnedRows =
    resultLimit === null ? queryRows : queryRows.slice(0, resultLimit);

  return {
    rows: returnedRows,
    metric: {
      source: String(source || "unknown").slice(0, 60),
      resultCount: returnedRows.length,
      resultLimit,
      truncated,
      errorCode: null,
    },
  };
}

export function captureSnapshotQueryFailure(source, limit = null) {
  return {
    source: String(source || "unknown").slice(0, 60),
    resultCount: 0,
    resultLimit: Number.isInteger(limit) && limit >= 0 ? limit : null,
    truncated: null,
    errorCode: "query_error",
  };
}
