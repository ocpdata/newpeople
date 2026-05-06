import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./commercial-planning.css";

const TAB_OPTIONS = [
  { id: "summary", label: "Resumen" },
  { id: "targets", label: "Metas trimestrales" },
  { id: "periods", label: "Periodos" },
  { id: "audit", label: "Auditoria" },
];

function formatCurrency(value, currencyCode = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "Sin dato";
  return `${Number(value).toFixed(2)}%`;
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPeriodStatusLabel(status) {
  if (status === "draft") return "Borrador";
  if (status === "active") return "Vigente";
  if (status === "closed") return "Cerrado";
  return status || "Sin estado";
}

function getVersionStatusLabel(status) {
  if (status === "draft") return "Borrador";
  if (status === "active") return "Vigente";
  if (status === "archived") return "Archivada";
  return status || "Sin estado";
}

function mergeTargetDrafts(versionDetail) {
  if (!versionDetail) return [];
  const targetsBySellerId = new Map(
    (versionDetail.targets || []).map((target) => [
      target.sellerUserId,
      target,
    ]),
  );

  return (versionDetail.eligibleSellers || []).map((seller) => {
    const target = targetsBySellerId.get(seller.id);
    return {
      sellerUserId: seller.id,
      sellerUserName: seller.fullName,
      sellerEmail: seller.email,
      targetId: target?.id || null,
      salesQuotaAmount:
        target?.salesQuotaAmount === null ||
        target?.salesQuotaAmount === undefined
          ? ""
          : String(target.salesQuotaAmount),
      currencyCode:
        target?.currencyCode || versionDetail.version.baseCurrencyCode || "USD",
      expectedMarginPercent:
        target?.expectedMarginPercent === null ||
        target?.expectedMarginPercent === undefined
          ? ""
          : String(target.expectedMarginPercent),
      expectedContributionAmount: target?.expectedContributionAmount || 0,
      notes: target?.notes || "",
      status: target?.status || "complete",
      updatedByUserName: target?.updatedByUserName || "",
      updatedAt: target?.updatedAt || null,
    };
  });
}

function buildTargetPayload(targetDrafts) {
  const errors = [];
  const targets = [];

  for (const draft of targetDrafts) {
    const hasQuota = String(draft.salesQuotaAmount).trim() !== "";
    const hasMargin = String(draft.expectedMarginPercent).trim() !== "";
    const hasNotes = String(draft.notes || "").trim() !== "";

    if (!hasQuota && !hasMargin && !hasNotes) {
      continue;
    }

    if (!hasQuota || !hasMargin) {
      errors.push(
        `Completa cuota y margen esperado para ${draft.sellerUserName} antes de guardar.`,
      );
      continue;
    }

    const salesQuotaAmount = Number(draft.salesQuotaAmount);
    const expectedMarginPercent = Number(draft.expectedMarginPercent);
    if (!(salesQuotaAmount > 0)) {
      errors.push(
        `La cuota de venta de ${draft.sellerUserName} debe ser mayor que cero.`,
      );
      continue;
    }
    if (Number.isNaN(expectedMarginPercent) || expectedMarginPercent < 0) {
      errors.push(
        `El margen esperado de ${draft.sellerUserName} debe ser mayor o igual a cero.`,
      );
      continue;
    }

    targets.push({
      sellerUserId: draft.sellerUserId,
      salesQuotaAmount,
      currencyCode: String(draft.currencyCode || "USD")
        .trim()
        .toUpperCase(),
      expectedMarginPercent,
      notes: String(draft.notes || "").trim() || null,
      status: draft.status || "complete",
    });
  }

  return { targets, errors };
}

function SummaryCard({ label, value, helper, tone = "" }) {
  return (
    <article className={`commercial-planning-summary-card ${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

export default function CommercialPlanningPage({ can }) {
  const [activeTab, setActiveTab] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [periods, setPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [periodDetail, setPeriodDetail] = useState(null);
  const [versionDetail, setVersionDetail] = useState(null);
  const [targetDrafts, setTargetDrafts] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [savingTargets, setSavingTargets] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [closingPeriod, setClosingPeriod] = useState(false);
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [publishJustification, setPublishJustification] = useState("");
  const [periodForm, setPeriodForm] = useState(() => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    return {
      year: now.getFullYear(),
      quarter,
      baseCurrencyCode: "USD",
      notes: "",
    };
  });

  const canCreate = can("planeacion_comercial.create");
  const canUpdate = can("planeacion_comercial.update");
  const canPublish = can("planeacion_comercial.publish");
  const canClose = can("planeacion_comercial.close");
  const canReadAudit = can("planeacion_comercial.audit.read");
  const canOverrideValidation = can("planeacion_comercial.override_validation");

  async function selectPeriod(periodId, preferredVersionId = null) {
    if (!periodId) {
      setSelectedPeriodId(null);
      setSelectedVersionId(null);
      setPeriodDetail(null);
      setVersionDetail(null);
      setTargetDrafts([]);
      return;
    }

    const periodResponse = await api.get(
      `/api/commercial-planning/periods/${periodId}`,
    );
    const nextPeriodDetail = periodResponse.data;
    const versions = nextPeriodDetail.versions || [];
    const nextVersionId =
      preferredVersionId ||
      nextPeriodDetail.period.activeVersionId ||
      versions[0]?.id ||
      null;

    setSelectedPeriodId(periodId);
    setPeriodDetail(nextPeriodDetail);
    setSelectedVersionId(nextVersionId);

    if (nextVersionId) {
      const versionResponse = await api.get(
        `/api/commercial-planning/versions/${nextVersionId}`,
      );
      setVersionDetail(versionResponse.data);
      setTargetDrafts(mergeTargetDrafts(versionResponse.data));
      return;
    }

    setVersionDetail(null);
    setTargetDrafts([]);
  }

  async function loadPeriods(
    preferredPeriodId = null,
    preferredVersionId = null,
  ) {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/api/commercial-planning/periods");
      const nextPeriods = response.data.periods || [];
      setPeriods(nextPeriods);

      const nextPeriodId =
        preferredPeriodId || selectedPeriodId || nextPeriods[0]?.id || null;

      if (!nextPeriodId) {
        await selectPeriod(null);
        return;
      }

      await selectPeriod(nextPeriodId, preferredVersionId || selectedVersionId);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la planeacion comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadVersion(versionId) {
    if (!versionId) {
      setVersionDetail(null);
      setTargetDrafts([]);
      return;
    }

    setError("");
    try {
      const versionResponse = await api.get(
        `/api/commercial-planning/versions/${versionId}`,
      );
      setVersionDetail(versionResponse.data);
      setTargetDrafts(mergeTargetDrafts(versionResponse.data));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la version seleccionada",
        ),
      );
    }
  }

  async function loadAudit() {
    if (!canReadAudit || !periodDetail?.period) return;
    try {
      const response = await api.get("/api/commercial-planning/audit", {
        params: {
          year: periodDetail.period.year,
          quarter: periodDetail.period.quarter,
        },
      });
      setAuditEntries(response.data.entries || []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la auditoria de planeacion comercial",
        ),
      );
    }
  }

  useEffect(() => {
    loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedVersionId) return;
    if (versionDetail?.version?.id === selectedVersionId) return;
    loadVersion(selectedVersionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersionId]);

  useEffect(() => {
    if (activeTab === "audit") {
      loadAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, periodDetail?.period?.id]);

  function updateTargetDraft(sellerUserId, field, value) {
    setTargetDrafts((current) =>
      current.map((item) =>
        item.sellerUserId === sellerUserId ? { ...item, [field]: value } : item,
      ),
    );
  }

  async function handleCreatePeriod(event) {
    event.preventDefault();
    setCreatingPeriod(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post("/api/commercial-planning/periods", {
        year: Number(periodForm.year),
        quarter: Number(periodForm.quarter),
        baseCurrencyCode: String(periodForm.baseCurrencyCode || "USD")
          .trim()
          .toUpperCase(),
        notes: String(periodForm.notes || "").trim() || null,
      });
      setSuccess(response.data.message);
      await loadPeriods(
        response.data.period.id,
        response.data.createdVersionId,
      );
      setActiveTab("targets");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear el periodo de planeacion",
        ),
      );
    } finally {
      setCreatingPeriod(false);
    }
  }

  async function handleSaveTargets() {
    if (!versionDetail?.version?.id) return;
    const payload = buildTargetPayload(targetDrafts);
    if (payload.errors.length) {
      setError(payload.errors[0]);
      return;
    }

    setSavingTargets(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/commercial-planning/versions/${versionDetail.version.id}/targets`,
        { targets: payload.targets },
      );
      setSuccess(response.data.message);
      await loadPeriods(selectedPeriodId, versionDetail.version.id);
      setSelectedVersionId(versionDetail.version.id);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar las metas trimestrales",
        ),
      );
    } finally {
      setSavingTargets(false);
    }
  }

  async function handleCreateVersion() {
    if (!periodDetail?.period?.id) return;
    setCreatingVersion(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-planning/periods/${periodDetail.period.id}/versions`,
        {},
      );
      setSuccess(response.data.message);
      await loadPeriods(periodDetail.period.id, response.data.version.id);
      setActiveTab("targets");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear una nueva version",
        ),
      );
    } finally {
      setCreatingVersion(false);
    }
  }

  async function handlePublishVersion() {
    if (!versionDetail?.version?.id) return;
    setPublishing(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-planning/versions/${versionDetail.version.id}/publish`,
        {
          justification: String(publishJustification || "").trim() || null,
        },
      );
      setSuccess(response.data.message);
      setPublishJustification("");
      await loadPeriods(selectedPeriodId, versionDetail.version.id);
      setActiveTab("summary");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible publicar la version seleccionada",
        ),
      );
    } finally {
      setPublishing(false);
    }
  }

  async function handleClosePeriod() {
    if (!periodDetail?.period?.id) return;
    setClosingPeriod(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-planning/periods/${periodDetail.period.id}/close`,
        {},
      );
      setSuccess(response.data.message);
      await loadPeriods(periodDetail.period.id, selectedVersionId);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cerrar el periodo seleccionado",
        ),
      );
    } finally {
      setClosingPeriod(false);
    }
  }

  if (loading) {
    return (
      <section className="panel centered">
        Cargando planeacion comercial...
      </section>
    );
  }

  const hasPeriods = periods.length > 0;
  const hasVersions = (periodDetail?.versions || []).length > 0;
  const summary = versionDetail?.version || null;
  const validation = versionDetail?.validation || { errors: [], warnings: [] };
  const filledTargetsCount = targetDrafts.filter(
    (item) =>
      String(item.salesQuotaAmount).trim() &&
      String(item.expectedMarginPercent).trim(),
  ).length;

  return (
    <section className="panel commercial-planning-page">
      <header className="commercial-planning-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Planeacion Comercial</h2>
            <span
              className="module-title-icon commercial-planning-title-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 19h16" />
                <path d="M7 16V9" />
                <path d="M12 16V5" />
                <path d="M17 16v-4" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Define metas trimestrales de cuota de venta, margen esperado y
            contribucion esperada por vendedor.
          </p>
          {periodDetail?.period ? (
            <p className="field-hint">
              Periodo activo en pantalla: {periodDetail.period.label} ·{" "}
              {getPeriodStatusLabel(periodDetail.period.status)}
            </p>
          ) : null}
        </div>

        <div className="commercial-planning-header-actions">
          {canCreate ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCreateVersion}
              disabled={
                !periodDetail?.period ||
                creatingVersion ||
                periodDetail?.period?.status === "closed"
              }
            >
              {creatingVersion ? "Creando version..." : "Nueva version"}
            </button>
          ) : null}
          {canPublish ? (
            <button
              type="button"
              className="btn-primary"
              onClick={handlePublishVersion}
              disabled={
                !versionDetail?.version ||
                publishing ||
                versionDetail?.version?.status !== "draft"
              }
            >
              {publishing ? "Publicando..." : "Publicar version"}
            </button>
          ) : null}
          {canClose ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClosePeriod}
              disabled={
                !periodDetail?.period ||
                closingPeriod ||
                periodDetail?.period?.status === "closed"
              }
            >
              {closingPeriod ? "Cerrando..." : "Cerrar trimestre"}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}

      <div className="commercial-planning-context-bar">
        <label>
          Periodo
          <select
            value={selectedPeriodId || ""}
            onChange={async (event) => {
              const nextPeriodId = Number(event.target.value) || null;
              setError("");
              try {
                await selectPeriod(nextPeriodId);
              } catch (requestError) {
                setError(
                  getApiErrorMessage(
                    requestError,
                    "No fue posible cargar el periodo seleccionado",
                  ),
                );
              }
            }}
            disabled={!hasPeriods}
          >
            {!hasPeriods ? (
              <option value="">No hay periodos creados</option>
            ) : null}
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label} · {getPeriodStatusLabel(period.status)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Version
          <select
            value={selectedVersionId || ""}
            onChange={async (event) => {
              const nextVersionId = Number(event.target.value) || null;
              setSelectedVersionId(nextVersionId);
              setError("");
              try {
                await loadVersion(nextVersionId);
              } catch (requestError) {
                setError(
                  getApiErrorMessage(
                    requestError,
                    "No fue posible cargar la version seleccionada",
                  ),
                );
              }
            }}
            disabled={!hasVersions}
          >
            {!hasVersions ? (
              <option value="">
                {hasPeriods
                  ? "Sin versiones disponibles"
                  : "Selecciona o crea un periodo primero"}
              </option>
            ) : null}
            {(periodDetail?.versions || []).map((version) => (
              <option key={version.id} value={version.id}>
                {version.label} · {getVersionStatusLabel(version.status)}
              </option>
            ))}
          </select>
        </label>

        {summary ? (
          <div className="commercial-planning-context-pills">
            <span className="commercial-planning-status-pill">
              {getVersionStatusLabel(summary.status)}
            </span>
            <span className="commercial-planning-status-pill">
              {summary.baseCurrencyCode}
            </span>
            <span className="commercial-planning-status-pill">
              {summary.targetCount} metas
            </span>
          </div>
        ) : null}
      </div>

      {!hasPeriods ? (
        <section className="commercial-planning-empty-state">
          <div>
            <h3>Aun no hay periodos de planeacion</h3>
            <p>
              Los select de Periodo y Version estan vacios porque todavia no
              existe ningun trimestre creado en este modulo.
            </p>
          </div>
          {canCreate ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setActiveTab("periods")}
            >
              Crear primer periodo
            </button>
          ) : (
            <p className="field-hint">
              Necesitas permiso de creacion para dar de alta el primer periodo.
            </p>
          )}
        </section>
      ) : null}

      <div
        className="commercial-planning-tabs"
        role="tablist"
        aria-label="Vistas de planeacion comercial"
      >
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`commercial-planning-tab ${activeTab === tab.id ? "is-active" : ""}`.trim()}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" ? (
        <div className="commercial-planning-section-stack">
          <div className="commercial-planning-summary-grid">
            <SummaryCard
              label="Vendedores con meta"
              value={filledTargetsCount}
              helper="Metas completas capturadas en la version seleccionada"
            />
            <SummaryCard
              label="Vendedores sin meta"
              value={Math.max(
                (versionDetail?.eligibleSellers?.length || 0) -
                  filledTargetsCount,
                0,
              )}
              helper="Vendedores activos que aun no tienen meta publicada"
              tone="is-warn"
            />
            <SummaryCard
              label="Cuota total"
              value={formatCurrency(
                summary?.totalQuotaAmount || 0,
                summary?.baseCurrencyCode || "USD",
              )}
              helper="Monto total planeado para el trimestre"
            />
            <SummaryCard
              label="Contribucion esperada"
              value={formatCurrency(
                summary?.totalContributionAmount || 0,
                summary?.baseCurrencyCode || "USD",
              )}
              helper="Contribucion calculada con base en cuota y margen esperado"
            />
            <SummaryCard
              label="Margen esperado promedio"
              value={formatPercent(summary?.expectedMarginAveragePercent || 0)}
              helper="Promedio de margen esperado de la version seleccionada"
            />
            <SummaryCard
              label="Ultima publicacion"
              value={formatDateTime(summary?.publishedAt)}
              helper="Fecha en que se volvio oficial esta version"
            />
          </div>

          <section className="commercial-planning-card">
            <div className="commercial-planning-card-header">
              <div>
                <h3>Estado de validacion</h3>
                <p>
                  La publicacion exige errores duros en cero. Las advertencias
                  pueden publicarse solo con justificacion y permiso especial.
                </p>
              </div>
            </div>

            <div className="commercial-planning-validation-grid">
              <div>
                <strong>Errores duros</strong>
                {(validation.errors || []).length ? (
                  <ul className="commercial-planning-list">
                    {validation.errors.map((item) => (
                      <li key={item.code + item.message}>{item.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">
                    Sin errores duros en la version seleccionada.
                  </p>
                )}
              </div>
              <div>
                <strong>Advertencias justificables</strong>
                {(validation.warnings || []).length ? (
                  <ul className="commercial-planning-list">
                    {validation.warnings.map((item) => (
                      <li key={item.code + item.message}>{item.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">Sin advertencias justificables.</p>
                )}
              </div>
            </div>

            {canPublish && versionDetail?.version?.status === "draft" ? (
              <div className="commercial-planning-justification-box">
                <label>
                  Justificacion de publicacion
                  <textarea
                    rows="3"
                    value={publishJustification}
                    onChange={(event) =>
                      setPublishJustification(event.target.value)
                    }
                    placeholder={
                      canOverrideValidation
                        ? "Solo es obligatoria si publicas con advertencias justificables."
                        : "No tienes permiso para publicar con advertencias; corrige la version antes de publicarla."
                    }
                  />
                </label>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "targets" ? (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>Metas trimestrales por vendedor</h3>
              <p>
                La tabla trabaja sobre la version seleccionada. Deja vacio a un
                vendedor si quieres que quede como advertencia justificable al
                publicar.
              </p>
            </div>
            {canUpdate ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveTargets}
                disabled={
                  savingTargets ||
                  !versionDetail?.version ||
                  versionDetail?.version?.status !== "draft"
                }
              >
                {savingTargets ? "Guardando..." : "Guardar borrador"}
              </button>
            ) : null}
          </div>

          <div className="commercial-planning-table-wrap">
            <table className="commercial-planning-table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Cuota de venta</th>
                  <th>Moneda</th>
                  <th>Margen esperado %</th>
                  <th>Contribucion esperada</th>
                  <th>Observaciones</th>
                  <th>Ultima actualizacion</th>
                </tr>
              </thead>
              <tbody>
                {targetDrafts.map((item) => {
                  const contribution =
                    Number(item.salesQuotaAmount || 0) *
                    (Number(item.expectedMarginPercent || 0) / 100);
                  return (
                    <tr key={item.sellerUserId}>
                      <td>
                        <strong>{item.sellerUserName}</strong>
                        <div className="field-hint">{item.sellerEmail}</div>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.salesQuotaAmount}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "salesQuotaAmount",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.currencyCode}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "currencyCode",
                              event.target.value.toUpperCase(),
                            )
                          }
                          maxLength={10}
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.expectedMarginPercent}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "expectedMarginPercent",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
                      </td>
                      <td>
                        {formatCurrency(
                          contribution,
                          item.currencyCode ||
                            summary?.baseCurrencyCode ||
                            "USD",
                        )}
                      </td>
                      <td>
                        <textarea
                          rows="2"
                          value={item.notes}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "notes",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
                      </td>
                      <td>
                        {item.updatedAt
                          ? formatDateTime(item.updatedAt)
                          : "Sin cambios"}
                        {item.updatedByUserName ? (
                          <div className="field-hint">
                            {item.updatedByUserName}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "periods" ? (
        <div className="commercial-planning-periods-grid">
          <section className="commercial-planning-card">
            <div className="commercial-planning-card-header">
              <div>
                <h3>Periodos existentes</h3>
                <p>
                  Administra los trimestres y sus versiones sin depender de
                  otros modulos.
                </p>
              </div>
            </div>

            <div className="commercial-planning-table-wrap">
              <table className="commercial-planning-table">
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Estado</th>
                    <th>Versiones</th>
                    <th>Version vigente</th>
                    <th>Cuota total</th>
                    <th>Contribucion</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr
                      key={period.id}
                      className={
                        selectedPeriodId === period.id ? "is-selected" : ""
                      }
                      onClick={async () => {
                        setError("");
                        try {
                          await selectPeriod(period.id);
                        } catch (requestError) {
                          setError(
                            getApiErrorMessage(
                              requestError,
                              "No fue posible cargar el periodo seleccionado",
                            ),
                          );
                        }
                      }}
                    >
                      <td>{period.label}</td>
                      <td>{getPeriodStatusLabel(period.status)}</td>
                      <td>{period.versionCount}</td>
                      <td>
                        {period.activeVersionNumber
                          ? `Version ${period.activeVersionNumber}`
                          : "Sin version vigente"}
                      </td>
                      <td>
                        {formatCurrency(
                          period.totalQuotaAmount,
                          period.baseCurrencyCode,
                        )}
                      </td>
                      <td>
                        {formatCurrency(
                          period.totalContributionAmount,
                          period.baseCurrencyCode,
                        )}
                      </td>
                    </tr>
                  ))}
                  {!periods.length ? (
                    <tr>
                      <td colSpan="6" className="centered">
                        No hay periodos creados todavia.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {canCreate ? (
            <section className="commercial-planning-card">
              <div className="commercial-planning-card-header">
                <div>
                  <h3>Crear periodo trimestral</h3>
                  <p>El alta crea el periodo y su Version 1 en borrador.</p>
                </div>
              </div>

              <form
                className="commercial-planning-form-grid"
                onSubmit={handleCreatePeriod}
              >
                <label>
                  Ano
                  <input
                    type="number"
                    value={periodForm.year}
                    onChange={(event) =>
                      setPeriodForm((current) => ({
                        ...current,
                        year: event.target.value,
                      }))
                    }
                    min="2020"
                    max="2100"
                  />
                </label>
                <label>
                  Trimestre
                  <select
                    value={periodForm.quarter}
                    onChange={(event) =>
                      setPeriodForm((current) => ({
                        ...current,
                        quarter: event.target.value,
                      }))
                    }
                  >
                    <option value="1">T1</option>
                    <option value="2">T2</option>
                    <option value="3">T3</option>
                    <option value="4">T4</option>
                  </select>
                </label>
                <label>
                  Moneda base
                  <input
                    type="text"
                    value={periodForm.baseCurrencyCode}
                    onChange={(event) =>
                      setPeriodForm((current) => ({
                        ...current,
                        baseCurrencyCode: event.target.value.toUpperCase(),
                      }))
                    }
                    maxLength={10}
                  />
                </label>
                <label className="is-wide">
                  Nota inicial
                  <textarea
                    rows="4"
                    value={periodForm.notes}
                    onChange={(event) =>
                      setPeriodForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Observacion general del trimestre"
                  />
                </label>
                <div className="commercial-planning-form-actions">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={creatingPeriod}
                  >
                    {creatingPeriod ? "Creando periodo..." : "Crear periodo"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
        </div>
      ) : null}

      {activeTab === "audit" ? (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>Auditoria del modulo</h3>
              <p>
                Historial del dominio aislado de Planeacion Comercial para el
                periodo seleccionado.
              </p>
            </div>
          </div>

          {!canReadAudit ? (
            <div className="field-hint">
              No tienes permiso para consultar la auditoria del modulo.
            </div>
          ) : (
            <div className="commercial-planning-table-wrap">
              <table className="commercial-planning-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Actor</th>
                    <th>Accion</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.createdAt)}</td>
                      <td>
                        {entry.performedByName || "Sistema"}
                        {entry.performedByEmail ? (
                          <div className="field-hint">
                            {entry.performedByEmail}
                          </div>
                        ) : null}
                      </td>
                      <td>{entry.action}</td>
                      <td>{entry.detail || "Sin detalle"}</td>
                    </tr>
                  ))}
                  {!auditEntries.length ? (
                    <tr>
                      <td colSpan="4" className="centered">
                        No hay eventos de auditoria para el periodo
                        seleccionado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
