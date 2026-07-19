import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import QuotationStatusIcon from "./quotations/QuotationStatusIcon";
import { getQuotationStatusTone } from "./quotations/quotationStatusPresentation";

const ACCEPT_ORDER_STATUS_CODES = ["ganada", "aceptada"];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatCurrency(value, currencyCode = "USD") {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function calculateContributionPct(contribution, sale) {
  const saleAmount = Number(sale || 0);
  if (!saleAmount) return null;
  return (Number(contribution || 0) / saleAmount) * 100;
}

function getQuotationFinancials(quotation) {
  const totalSale = Number(quotation?.latestTotalSaleAmount || 0);
  const productSale = Number(quotation?.latestProductSaleAmount || 0);
  const serviceSale = Number(quotation?.latestServiceSaleAmount || 0);
  const productCost = Number(quotation?.latestProductCostAmount || 0);
  const serviceCost = Number(quotation?.latestServiceCostAmount || 0);
  const productContribution = Number(
    quotation?.latestProductContributionAmount || 0,
  );
  const serviceContribution = Number(
    quotation?.latestServiceContributionAmount || 0,
  );
  const totalCost = productCost + serviceCost;
  const totalContribution =
    quotation?.latestContributionAmount === null ||
    quotation?.latestContributionAmount === undefined
      ? productContribution + serviceContribution
      : Number(quotation.latestContributionAmount || 0);

  return {
    totalSale,
    totalCost,
    totalContribution,
    totalContributionPct: calculateContributionPct(
      totalContribution,
      totalSale,
    ),
    productSale,
    productCost,
    productContribution,
    productContributionPct: calculateContributionPct(
      productContribution,
      productSale,
    ),
    serviceSale,
    serviceCost,
    serviceContribution,
    serviceContributionPct: calculateContributionPct(
      serviceContribution,
      serviceSale,
    ),
  };
}

function isAcceptOrderQuotation(quotation) {
  return ACCEPT_ORDER_STATUS_CODES.includes(
    normalizeText(quotation?.latestStatusCode || quotation?.latestStatusName),
  );
}

function isAcceptedQuotation(quotation) {
  return (
    normalizeText(
      quotation?.latestStatusCode || quotation?.latestStatusName,
    ) === "aceptada"
  );
}

function isSellerNotificationPending(quotation) {
  return (
    normalizeText(quotation?.acceptanceNotificationStatusCode) === "pendiente"
  );
}

function getQuotationWorkflowBadgeClass(quotation) {
  return `user-status-badge ${getQuotationStatusTone({
    uiKey: quotation?.latestStatusUiKey,
    code: quotation?.latestStatusCode,
  })}`;
}

function getQuotationActivationBadgeClass(quotation) {
  const normalized = normalizeText(
    quotation?.activationStatusCode || quotation?.activationStatusName,
  );
  if (normalized === "activada") return "user-status-badge active";
  if (normalized === "pendiente_activacion" || normalized === "pendiente") {
    return "user-status-badge pending";
  }
  return "user-status-badge inactive";
}

export default function AcceptOrderPage() {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState("id");
  const [sortDirection, setSortDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [openQuotationMenuId, setOpenQuotationMenuId] = useState(null);
  const [acceptingVersionId, setAcceptingVersionId] = useState(null);
  const [quotationToAccept, setQuotationToAccept] = useState(null);
  const [quotationToNotify, setQuotationToNotify] = useState(null);
  const [sellerNotificationNote, setSellerNotificationNote] = useState("");
  const [sendingNotificationQuotationId, setSendingNotificationQuotationId] =
    useState(null);

  useEffect(() => {
    let ignore = false;

    async function loadQuotations() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(
          `/api/quotations?latestStatusCodes=${ACCEPT_ORDER_STATUS_CODES.join(",")}`,
        );
        if (!ignore) {
          setQuotations(
            Array.isArray(data) ? data.filter(isAcceptOrderQuotation) : [],
          );
        }
      } catch (loadError) {
        if (!ignore) {
          setError(
            getApiErrorMessage(
              loadError,
              "No fue posible cargar las cotizaciones para aceptar pedido",
            ),
          );
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadQuotations();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, perPage]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection(field === "id" ? "desc" : "asc");
  }

  function getSortArrow(field) {
    if (sortField !== field) return "";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function toggleQuotationMenu(quotationId) {
    setOpenQuotationMenuId((current) =>
      current === quotationId ? null : quotationId,
    );
  }

  function openAcceptQuotationModal(quotation) {
    if (
      isAcceptedQuotation(quotation) ||
      !Number(quotation?.latestVersionId || 0)
    ) {
      return;
    }
    setOpenQuotationMenuId(null);
    setQuotationToAccept(quotation);
    setError("");
    setSuccess("");
  }

  function closeAcceptQuotationModal() {
    if (acceptingVersionId) return;
    setQuotationToAccept(null);
  }

  function openSellerNotificationModal(quotation) {
    if (!quotation) return;
    setQuotationToNotify(quotation);
    setSellerNotificationNote("");
    setError("");
    setSuccess("");
  }

  function closeSellerNotificationModal() {
    if (sendingNotificationQuotationId) return;
    setQuotationToNotify(null);
    setSellerNotificationNote("");
  }

  function goToQuotation(quotation) {
    const quotationId = Number(quotation?.id || 0);
    if (!quotationId) return;
    navigate(`/quotations?quotationId=${quotationId}`);
  }

  async function acceptQuotation(quotation) {
    const versionId = Number(quotation?.latestVersionId || 0);
    if (!versionId || isAcceptedQuotation(quotation)) return;

    setAcceptingVersionId(versionId);
    setOpenQuotationMenuId(null);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotation-versions/${versionId}/transition`,
        { actionCode: "aceptar" },
      );
      setQuotations((current) =>
        current.map((item) =>
          Number(item.latestVersionId || 0) === versionId
            ? {
                ...item,
                latestStatusCode: data?.statusCode || "aceptada",
                latestStatusName: data?.statusName || "Aceptada",
                latestStatusUiKey: "accepted",
              }
            : item,
        ),
      );
      setSuccess("Pedido aceptado");
      setQuotationToAccept(null);
    } catch (acceptError) {
      setError(
        getApiErrorMessage(acceptError, "No fue posible aceptar el pedido"),
      );
    } finally {
      setAcceptingVersionId(null);
    }
  }

  async function sendSellerNotification() {
    const quotationId = Number(quotationToNotify?.id || 0);
    const note = sellerNotificationNote.trim();
    if (!quotationId || !note) {
      setError("Escribe una nota para el vendedor");
      return;
    }

    setSendingNotificationQuotationId(quotationId);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotations/${quotationId}/seller-notification`,
        { note },
      );
      const pendingPatch = {
        acceptanceNotificationStatusCode: data?.statusCode || "pendiente",
        acceptanceNotificationSentAt: data?.sentAt || new Date().toISOString(),
      };
      setQuotations((current) =>
        current.map((item) =>
          Number(item.id || 0) === quotationId
            ? { ...item, ...pendingPatch }
            : item,
        ),
      );
      setQuotationToAccept((current) =>
        Number(current?.id || 0) === quotationId
          ? { ...current, ...pendingPatch }
          : current,
      );
      setSuccess("Notificacion enviada al vendedor");
      closeSellerNotificationModal();
    } catch (notificationError) {
      setError(
        getApiErrorMessage(
          notificationError,
          "No fue posible enviar la notificacion al vendedor",
        ),
      );
    } finally {
      setSendingNotificationQuotationId(null);
    }
  }

  const visibleQuotations = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    const searched = normalizedQuery
      ? quotations.filter((quotation) => {
          const haystack = [
            quotation.id,
            quotation.latestVersionNumber,
            quotation.accountName,
            quotation.opportunityName,
            quotation.latestProposalName,
            quotation.sellerUserName,
            quotation.opportunitySalesStageName,
            quotation.latestStatusName,
            quotation.activationStatusName,
          ]
            .filter(Boolean)
            .join(" ");
          return normalizeText(haystack).includes(normalizedQuery);
        })
      : quotations;

    const readValue = (quotation) => {
      if (sortField === "id") return Number(quotation.id || 0);
      if (sortField === "version") {
        return Number(quotation.latestVersionNumber || 0);
      }
      if (sortField === "importe") {
        return Number(quotation.latestTotalSaleAmount || 0);
      }
      if (sortField === "cierre") {
        return String(quotation.opportunityCloseDate || "");
      }
      if (sortField === "cuenta") return String(quotation.accountName || "");
      if (sortField === "oportunidad") {
        return String(quotation.opportunityName || "");
      }
      if (sortField === "vendedor") {
        return String(quotation.sellerUserName || "");
      }
      if (sortField === "estado_cotizacion") {
        return String(quotation.latestStatusName || "");
      }
      return String(
        quotation.latestProposalName || quotation.opportunityName || "",
      );
    };

    return [...searched].sort((left, right) => {
      const leftValue = readValue(left);
      const rightValue = readValue(right);
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "es", {
              numeric: true,
              sensitivity: "base",
            });
      return sortDirection === "asc" ? result : -result;
    });
  }, [quotations, query, sortDirection, sortField]);

  const totalPages = Math.max(1, Math.ceil(visibleQuotations.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pagedQuotations = visibleQuotations.slice(
    (currentPage - 1) * perPage,
    currentPage * perPage,
  );
  const acceptFinancials = quotationToAccept
    ? getQuotationFinancials(quotationToAccept)
    : null;
  const acceptCurrencyCode = quotationToAccept?.latestCurrencyCode || "USD";

  return (
    <section className="panel">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Aceptar Pedido</h2>
            <span
              className="module-title-icon module-title-icon-opportunities"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M7 3.75A2.75 2.75 0 0 0 4.25 6.5v11A2.75 2.75 0 0 0 7 20.25h10a2.75 2.75 0 0 0 2.75-2.75v-11A2.75 2.75 0 0 0 17 3.75zm0 1.5h10c.69 0 1.25.56 1.25 1.25v11c0 .69-.56 1.25-1.25 1.25H7c-.69 0-1.25-.56-1.25-1.25v-11c0-.69.56-1.25 1.25-1.25" />
                <path d="M16.03 9.53a.75.75 0 0 0-1.06-1.06l-4.22 4.22-1.72-1.72a.75.75 0 0 0-1.06 1.06l2.25 2.25c.3.3.77.3 1.06 0z" />
              </svg>
            </span>
          </div>
          <p>
            Lista las cotizaciones ganadas para aceptar el pedido antes de su
            ejecucion operativa.
          </p>
        </div>
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Estados incluidos"
        >
          <span className="status-filter-pill status-filter-pill-won is-selected">
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Ganadas / Aceptadas</span>
            <span className="status-filter-pill-count">
              {quotations.length}
            </span>
          </span>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por ID, cuenta, oportunidad, propuesta, vendedor o estado"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}
      {loading ? <p className="field-hint">Cargando cotizaciones...</p> : null}

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("id")}
              >
                ID <span>{getSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("version")}
              >
                Version <span>{getSortArrow("version")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("cuenta")}
              >
                Cuenta <span>{getSortArrow("cuenta")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("oportunidad")}
              >
                Oportunidad <span>{getSortArrow("oportunidad")}</span>
              </button>
            </th>
            <th>Propuesta</th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("vendedor")}
              >
                Vendedor <span>{getSortArrow("vendedor")}</span>
              </button>
            </th>
            <th>Etapa oportunidad</th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("importe")}
              >
                Importe <span>{getSortArrow("importe")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("cierre")}
              >
                Cierre <span>{getSortArrow("cierre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("estado_cotizacion")}
              >
                Estado cotizacion{" "}
                <span>{getSortArrow("estado_cotizacion")}</span>
              </button>
            </th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {!loading && pagedQuotations.length > 0 ? (
            pagedQuotations.map((quotation) => (
              <tr key={quotation.id}>
                <td>{quotation.id}</td>
                <td>{quotation.latestVersionNumber || "-"}</td>
                <td>{quotation.accountName || "-"}</td>
                <td>{quotation.opportunityName || "-"}</td>
                <td>{quotation.latestProposalName || "-"}</td>
                <td>{quotation.sellerUserName || "-"}</td>
                <td>{quotation.opportunitySalesStageName || "-"}</td>
                <td>
                  {formatCurrency(
                    quotation.latestTotalSaleAmount,
                    quotation.latestCurrencyCode,
                  )}
                </td>
                <td>{formatDate(quotation.opportunityCloseDate)}</td>
                <td>
                  <span
                    className={`${getQuotationWorkflowBadgeClass(quotation)} quotation-status-badge`}
                  >
                    <span
                      className="quotation-status-badge-icon"
                      aria-hidden="true"
                    >
                      <QuotationStatusIcon
                        status={{
                          uiKey: quotation.latestStatusUiKey,
                          code: quotation.latestStatusCode,
                        }}
                      />
                    </span>
                    {quotation.latestStatusName || "-"}
                  </span>
                </td>
                <td>
                  <span className={getQuotationActivationBadgeClass(quotation)}>
                    {quotation.activationStatusName || "-"}
                  </span>
                  {isSellerNotificationPending(quotation) ? (
                    <span className="accept-order-pending-badge">
                      Pendiente
                    </span>
                  ) : null}
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap opportunities-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleQuotationMenu(quotation.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openQuotationMenuId === quotation.id ? (
                      <div className="user-kebab-menu quotation-actions-menu">
                        <button
                          type="button"
                          disabled={
                            isAcceptedQuotation(quotation) ||
                            acceptingVersionId === quotation.latestVersionId ||
                            !Number(quotation.latestVersionId || 0)
                          }
                          onClick={() => openAcceptQuotationModal(quotation)}
                        >
                          {acceptingVersionId === quotation.latestVersionId
                            ? "Aceptando..."
                            : "Aceptar"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={12} className="empty-state">
                {loading
                  ? "Cargando cotizaciones..."
                  : "No hay cotizaciones ganadas o aceptadas para mostrar"}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleQuotations.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(currentPage - 1) * perPage + 1}–
              {Math.min(currentPage * perPage, visibleQuotations.length)} de{" "}
              {visibleQuotations.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={currentPage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={currentPage === totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por pagina:</span>
            {[10, 50, 100].map((pageSize) => (
              <button
                key={pageSize}
                type="button"
                className={`users-perpage-btn${perPage === pageSize ? " is-active" : ""}`}
                onClick={() => setPerPage(pageSize)}
              >
                {pageSize}
              </button>
            ))}
          </div>
        </div>
      )}

      {quotationToAccept ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-order-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeAcceptQuotationModal();
            }
          }}
        >
          <div className="modal-dialog modal-dialog-wide accept-order-modal">
            <div className="accept-order-modal-hero">
              <div>
                <span className="accept-order-modal-kicker">
                  Cotizacion #{quotationToAccept.id} · Version{" "}
                  {quotationToAccept.latestVersionNumber || "-"}
                </span>
                <h3 id="accept-order-modal-title">
                  {quotationToAccept.latestProposalName || "Aceptar pedido"}
                </h3>
                <p>{quotationToAccept.accountName || "Cuenta sin nombre"}</p>
              </div>
              <span
                className={`${getQuotationWorkflowBadgeClass(quotationToAccept)} quotation-status-badge`}
              >
                <span
                  className="quotation-status-badge-icon"
                  aria-hidden="true"
                >
                  <QuotationStatusIcon
                    status={{
                      uiKey: quotationToAccept.latestStatusUiKey,
                      code: quotationToAccept.latestStatusCode,
                    }}
                  />
                </span>
                {quotationToAccept.latestStatusName || "-"}
              </span>
            </div>

            <div className="accept-order-modal-summary">
              <div>
                <span>Oportunidad</span>
                <strong>{quotationToAccept.opportunityName || "-"}</strong>
              </div>
              <div>
                <span>Vendedor</span>
                <strong>{quotationToAccept.sellerUserName || "-"}</strong>
              </div>
              <div>
                <span>Cierre</span>
                <strong>
                  {formatDate(quotationToAccept.opportunityCloseDate)}
                </strong>
              </div>
            </div>

            <div className="accept-order-total-card">
              <div>
                <span>Importe total</span>
                <strong>
                  {formatCurrency(
                    acceptFinancials.totalSale,
                    acceptCurrencyCode,
                  )}
                </strong>
              </div>
              <div>
                <span>Costo total</span>
                <strong>
                  {formatCurrency(
                    acceptFinancials.totalCost,
                    acceptCurrencyCode,
                  )}
                </strong>
              </div>
              <div>
                <span>Contribucion total</span>
                <strong>
                  {formatCurrency(
                    acceptFinancials.totalContribution,
                    acceptCurrencyCode,
                  )}
                </strong>
                <small>
                  {formatPercent(acceptFinancials.totalContributionPct)}
                </small>
              </div>
            </div>

            <div className="accept-order-financial-grid">
              <div className="accept-order-financial-card">
                <div className="accept-order-financial-card-header">
                  <span>Productos</span>
                  <strong>
                    {formatPercent(acceptFinancials.productContributionPct)}
                  </strong>
                </div>
                <dl>
                  <div>
                    <dt>Venta</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.productSale,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Costo</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.productCost,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Contribucion</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.productContribution,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="accept-order-financial-card">
                <div className="accept-order-financial-card-header">
                  <span>Servicios</span>
                  <strong>
                    {formatPercent(acceptFinancials.serviceContributionPct)}
                  </strong>
                </div>
                <dl>
                  <div>
                    <dt>Venta</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.serviceSale,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Costo</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.serviceCost,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Contribucion</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.serviceContribution,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="accept-order-modal-actions">
              <button
                type="button"
                className="btn-secondary accept-order-go-button"
                onClick={() => goToQuotation(quotationToAccept)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V6h5a1 1 0 1 0 0-2zm9 0a1 1 0 1 0 0 2h2.59l-6.3 6.3a1 1 0 1 0 1.42 1.4l6.29-6.29V10a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1z"
                  />
                </svg>
                Ir a la cotizacion
              </button>
              <button
                type="button"
                className="btn-secondary accept-order-icon-button accept-order-email-button"
                onClick={() => openSellerNotificationModal(quotationToAccept)}
                aria-label="Enviar correo al vendedor"
                title="Enviar correo al vendedor"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 17 20H7a2.5 2.5 0 0 1-2.5-2.5zm2.1-.5 5.4 4.05L17.4 6zm10.9 12a.5.5 0 0 0 .5-.5V7.25l-5.4 4.05a1 1 0 0 1-1.2 0L6 7.25V17.5a.5.5 0 0 0 .5.5z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="btn-secondary accept-order-icon-button"
                onClick={closeAcceptQuotationModal}
                disabled={Boolean(acceptingVersionId)}
                aria-label="Cancelar aceptacion"
                title="Cancelar"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M6.22 4.81a1 1 0 0 0-1.41 1.41L10.59 12l-5.78 5.78a1 1 0 1 0 1.41 1.41L12 13.41l5.78 5.78a1 1 0 0 0 1.41-1.41L13.41 12l5.78-5.78a1 1 0 0 0-1.41-1.41L12 10.59z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="btn-primary accept-order-icon-button accept-order-confirm-button"
                onClick={() => acceptQuotation(quotationToAccept)}
                disabled={
                  Boolean(acceptingVersionId) ||
                  isAcceptedQuotation(quotationToAccept)
                }
                aria-label="Confirmar aceptacion"
                title="Confirmar aceptacion"
              >
                {acceptingVersionId === quotationToAccept.latestVersionId ? (
                  "Aceptando..."
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M9.55 17.2 4.8 12.45a1 1 0 0 1 1.4-1.42l3.35 3.34 8.25-8.24a1 1 0 1 1 1.4 1.42z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quotationToNotify ? (
        <div
          className="modal-overlay modal-overlay-elevated"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-order-notification-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeSellerNotificationModal();
            }
          }}
        >
          <div className="modal-dialog accept-order-notification-modal">
            <div className="accept-order-notification-header">
              <span>Correo al vendedor</span>
              <h3 id="accept-order-notification-title">
                {quotationToNotify.sellerUserName || "Vendedor"}
              </h3>
              <p>
                Cotizacion #{quotationToNotify.id} ·{" "}
                {quotationToNotify.latestProposalName || "Sin propuesta"}
              </p>
            </div>

            <label className="field-group accept-order-note-field">
              <span>Nota</span>
              <textarea
                value={sellerNotificationNote}
                onChange={(event) =>
                  setSellerNotificationNote(event.target.value)
                }
                rows={5}
                maxLength={2000}
                placeholder="Escribe la indicacion para el vendedor"
              />
            </label>

            <div className="accept-order-notification-actions">
              <button
                type="button"
                className="btn-secondary accept-order-icon-button"
                onClick={closeSellerNotificationModal}
                disabled={Boolean(sendingNotificationQuotationId)}
                aria-label="Cancelar envio"
                title="Cancelar"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M6.22 4.81a1 1 0 0 0-1.41 1.41L10.59 12l-5.78 5.78a1 1 0 1 0 1.41 1.41L12 13.41l5.78 5.78a1 1 0 0 0 1.41-1.41L13.41 12l5.78-5.78a1 1 0 0 0-1.41-1.41L12 10.59z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="btn-primary accept-order-icon-button accept-order-confirm-button"
                onClick={sendSellerNotification}
                disabled={
                  Boolean(sendingNotificationQuotationId) ||
                  !sellerNotificationNote.trim()
                }
                aria-label="Confirmar envio"
                title="Confirmar envio"
              >
                {sendingNotificationQuotationId === quotationToNotify.id ? (
                  "Enviando..."
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M2.7 11.08a1 1 0 0 1 .55-.84l16.5-8a1 1 0 0 1 1.4 1.15l-4 17.5a1 1 0 0 1-1.72.43l-4.25-4.75-3.3 3.06a1 1 0 0 1-1.67-.68v-5.1L3.3 12a1 1 0 0 1-.6-.92m5.5 2.17v3.4l2.1-1.95a1 1 0 0 1 1.43.07l3.9 4.36L18.58 6.2z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
