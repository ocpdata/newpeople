const STATUS_UI_BY_KEY = {
  draft: { tone: "draft" },
  pending: { tone: "pending" },
  approved: { tone: "won" },
  accepted: { tone: "won" },
  sent: { tone: "active" },
  won: { tone: "won" },
  rejected: { tone: "lost" },
  lost: { tone: "lost" },
  cancelled: { tone: "canceled" },
  canceled: { tone: "canceled" },
  inactive: { tone: "inactive" },
  default: { tone: "draft" },
};

const STATUS_UI_KEY_BY_CODE = {
  borrador: "draft",
  en_aprobacion: "pending",
  aprobada: "approved",
  aceptada: "accepted",
  enviada: "sent",
  ganada: "won",
  rechazada: "rejected",
  perdida: "lost",
  anulada: "cancelled",
  no_vigente: "inactive",
};

function normalizeStatusToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function getQuotationStatusUiKey(statusLike) {
  const directToken = normalizeStatusToken(
    typeof statusLike === "string"
      ? statusLike
      : statusLike?.uiKey || statusLike?.statusUiKey,
  );

  if (directToken && STATUS_UI_BY_KEY[directToken]) {
    return directToken;
  }

  const codeToken = normalizeStatusToken(
    typeof statusLike === "string"
      ? ""
      : statusLike?.code || statusLike?.statusCode,
  );

  if (codeToken && STATUS_UI_KEY_BY_CODE[codeToken]) {
    return STATUS_UI_KEY_BY_CODE[codeToken];
  }

  return "default";
}

export function getQuotationStatusTone(statusLike) {
  const uiKey = getQuotationStatusUiKey(statusLike);
  return STATUS_UI_BY_KEY[uiKey]?.tone || STATUS_UI_BY_KEY.default.tone;
}
