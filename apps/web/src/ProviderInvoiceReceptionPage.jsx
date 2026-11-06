import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import { formatBusinessDate, getTodayBusinessDate } from "./business-timezone";
import { InvoiceExchangeRateFields } from "./InvoiceExchangeRate";
import { useInvoiceExchangeRate } from "./useInvoiceExchangeRate";

const money = (value, currency) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const date = (value) => formatBusinessDate(value, { fallback: "-" });
const lineKey = (orderId, itemId) => `${orderId}:${itemId}`;
const names = (orders, field) => [...new Set(orders.map((order) => order[field]).filter(Boolean))].join(", ") || "No disponible";

async function fetchSupplierInvoiceData(signal) {
  const [orderResponse, documentResponse] = await Promise.all([
    api.get("/api/provider-invoices/orders", { signal }), api.get("/api/provider-invoices", { signal }),
  ]);
  if (!Array.isArray(orderResponse.data) || !Array.isArray(documentResponse.data)) {
    throw new Error("Respuesta de facturas de proveedores invalida");
  }
  return { orders: orderResponse.data, documents: documentResponse.data };
}

function documentTotals(orders, quantities) {
  let subtotal = 0;
  let ivaAmount = 0;
  orders.forEach((order) => {
    const orderSubtotal = round(order.lines.reduce((sum, line) => {
      const quantity = quantities == null ? Number(line.quantity) : Number(quantities[lineKey(order.orderId, line.itemId)] || 0);
      const unitNet = Number(line.unitCost) * (1 - Number(line.discountPct || 0) / 100);
      return sum + quantity * unitNet;
    }, 0));
    subtotal += orderSubtotal;
    ivaAmount += round(orderSubtotal * Number(order.ivaPct || 0) / 100);
  });
  return { subtotal: round(subtotal), ivaAmount: round(ivaAmount), total: round(subtotal + ivaAmount) };
}

export default function ProviderInvoiceReceptionPage({ canUpdate = false }) {
  const [orders, setOrders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [modal, setModal] = useState(null);
  const [draftOrders, setDraftOrders] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const [downloading, setDownloading] = useState(null);
  const mutation = useRef(false);
  const rate = useInvoiceExchangeRate();
  const [filters, setFilters] = useState({ start: "", end: "", type: "", provider: "", account: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchSupplierInvoiceData();
      setOrders(data.orders);
      setDocuments(data.documents);
      return data.orders;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible cargar las facturas y ordenes de proveedores."));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      try {
        const data = await fetchSupplierInvoiceData(controller.signal);
        setOrders(data.orders);
        setDocuments(data.documents);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(getApiErrorMessage(requestError, "No fue posible cargar las facturas y ordenes de proveedores."));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void initialize();
    return () => controller.abort();
  }, []);

  const pendingOrders = orders.filter((order) => order.lines.some((line) => Number(line.availableQuantity) > 0));
  const selectedOrders = pendingOrders.filter((order) => selectedIds.includes(String(order.orderId)));
  const firstSelected = selectedOrders[0];
  const totals = documentTotals(draftOrders, modal?.mode === "create" ? quantities : null);
  const currency = draftOrders[0]?.currencyCode || modal?.document?.currencyCode || "USD";
  const invalidRange = filters.start && filters.end && filters.start > filters.end;
  const filterOptions = useMemo(() => {
    const providers = new Map();
    const accounts = new Map();
    documents.forEach((document) => {
      providers.set(String(document.providerId), document.providerName);
      (document.orders || []).forEach((order) => {
        accounts.set(String(order.accountId), order.accountName);
      });
    });
    const sorted = (map) => [...map].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es"));
    return { providers: sorted(providers), accounts: sorted(accounts) };
  }, [documents]);
  const filteredDocuments = documents.filter((document) =>
    !invalidRange &&
    (!filters.start || document.invoiceDate >= filters.start) &&
    (!filters.end || document.invoiceDate <= filters.end) &&
    (!filters.type || document.documentType === filters.type) &&
    (!filters.provider || String(document.providerId) === filters.provider) &&
    (!filters.account || document.orders.some((order) => String(order.accountId) === filters.account)),
  );

  function closeModal() {
    if (mutation.current) return;
    setModal(null);
    setModalError("");
    setFiles([]);
  }

  async function openCreate() {
    if (!canUpdate || loading || saving || !selectedOrders.length) return;
    const fresh = await load();
    if (!fresh) return;
    const selected = fresh.filter((order) => selectedIds.includes(String(order.orderId)));
    if (selected.length !== selectedIds.length || selected.some((order) =>
      Number(order.providerId) !== Number(selected[0].providerId) || order.currencyCode !== selected[0].currencyCode)) {
      setError("Las ordenes deben pertenecer al mismo proveedor y moneda. Revisa la seleccion.");
      return;
    }
    const available = selected.filter((order) => order.lines.some((line) => Number(line.availableQuantity) > 0));
    if (!available.length) {
      setError("Las ordenes seleccionadas ya no tienen cantidades disponibles.");
      return;
    }
    setDraftOrders(available);
    setQuantities(Object.fromEntries(available.flatMap((order) => order.lines.map((line) =>
      [lineKey(order.orderId, line.itemId), Number(line.availableQuantity)],
    ))));
    setInvoiceDate(getTodayBusinessDate());
    setInvoiceNumber("");
    setModalError("");
    setFiles([]);
    rate.initialize(available[0].currencyCode);
    setModal({ mode: "create" });
  }

  function openDocument(document, mode) {
    setDraftOrders(document.orders);
    setInvoiceDate(mode === "convert" ? getTodayBusinessDate() : document.invoiceDate);
    setInvoiceNumber(document.invoiceNumber || "");
    setModalError("");
    setFiles([]);
    rate.initialize(document.currencyCode, document);
    setModal({ mode, document });
  }

  async function save(documentType) {
    if (!canUpdate || mutation.current) return;
    if (!invoiceDate || !rate.valid || rate.loading) {
      setModalError("Completa la fecha y un tipo de cambio valido.");
      return;
    }
    if (documentType === "invoice" && !invoiceNumber.trim()) {
      setModalError("Ingresa el numero de factura del proveedor.");
      return;
    }
    const orderItems = draftOrders.map((order) => ({
      orderId: order.orderId,
      items: order.lines.map((line) => ({
        itemId: line.itemId, quantity: Number(quantities[lineKey(order.orderId, line.itemId)] || 0),
      })).filter((line) => line.quantity > 0),
    })).filter((order) => order.items.length);
    if (modal.mode === "create" && (!orderItems.length || draftOrders.some((order) =>
      order.lines.some((line) => {
        const quantity = Number(quantities[lineKey(order.orderId, line.itemId)] || 0);
        return !Number.isFinite(quantity) || quantity < 0 || quantity > Number(line.availableQuantity);
      })))) {
      setModalError("Selecciona al menos un item y cantidades dentro del disponible.");
      return;
    }
    mutation.current = true;
    setSaving(true);
    setModalError("");
    try {
      const payload = {
        invoiceNumber: invoiceNumber.trim() || null, invoiceDate, ...rate.payload,
      };
      const { data } = modal.mode === "convert"
        ? await api.post(`/api/provider-invoices/${modal.document.id}/convert`, payload)
        : await api.post("/api/provider-invoices", { ...payload, documentType, orderItems });
      setSelectedIds([]);
      if (files.length) {
        setModal({ mode: "attach", document: { id: data.id } });
        try {
          await uploadFiles(data.id);
        } catch (uploadError) {
          setModalError(`El documento ya fue guardado. ${getApiErrorMessage(uploadError, "No fue posible adjuntar el archivo. Reintenta sin registrar otra factura.")}`);
          await load();
          return;
        }
      }
      setModal(null);
      await load();
    } catch (requestError) {
      setModalError(getApiErrorMessage(requestError, "No fue posible guardar el documento del proveedor."));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }

  async function uploadFiles(id) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    await api.post(`/api/provider-invoices/${id}/attachments`, form);
  }

  async function retryFiles() {
    if (!canUpdate || mutation.current || !files.length) return;
    mutation.current = true;
    setSaving(true);
    setModalError("");
    try {
      await uploadFiles(modal.document.id);
      setModal(null);
      await load();
    } catch (uploadError) {
      setModalError(getApiErrorMessage(uploadError, "No fue posible adjuntar los archivos. El documento sigue guardado."));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }

  async function downloadAttachment(attachment) {
    if (downloading) return;
    setDownloading(attachment.id);
    setModalError("");
    try {
      const { data } = await api.get(attachment.downloadUrl, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setModalError(getApiErrorMessage(downloadError, "No fue posible descargar el comprobante."));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section>
      <header className="page-header">
        <h2>Facturas de proveedores</h2>
        <p>Registra facturas y prefacturas a partir de las ordenes de compra pendientes.</p>
      </header>
      {error && <p className="status-text error" role="alert">{error}</p>}
      <section className="panel supplier-invoice-panel">
        <div className="supplier-invoice-section-header">
          <div>
            <h3>Ordenes de compra pendientes de factura</h3>
            <p className="field-hint">Selecciona ordenes del mismo proveedor y moneda. Las prefacturas reservan cantidades.</p>
          </div>
          <button type="button" className="btn-primary" disabled={!canUpdate || loading || saving || !selectedOrders.length}
            onClick={() => void openCreate()}>Registrar factura o prefactura</button>
        </div>
        <p className="field-hint">{selectedOrders.length} ordenes seleccionadas</p>
        {loading ? <p role="status">Cargando documentos...</p> : pendingOrders.length ? (
          <div className="supplier-invoice-table-wrap">
            <table className="table">
              <thead><tr>
                <th>Incluir</th><th>Cuenta</th><th>Oportunidad</th><th>Proveedor</th><th>Orden de compra</th>
                <th>Fecha de orden</th><th>Moneda</th><th className="is-right">Monto disponible</th>
              </tr></thead>
              <tbody>{pendingOrders.map((order) => {
                const incompatible = firstSelected && (Number(firstSelected.providerId) !== Number(order.providerId) ||
                  firstSelected.currencyCode !== order.currencyCode);
                const availableQuantities = Object.fromEntries(order.lines.map((line) => [
                  lineKey(order.orderId, line.itemId), Number(line.availableQuantity),
                ]));
                return (
                  <tr key={order.orderId}>
                    <td><input type="checkbox" className="supplier-invoice-check"
                      aria-label={`Incluir orden ${order.orderNumber || order.orderId}`}
                      checked={selectedIds.includes(String(order.orderId))}
                      disabled={!canUpdate || loading || saving || Boolean(incompatible)}
                      title={incompatible ? "Selecciona ordenes del mismo proveedor y moneda" : "Incluir orden"}
                      onChange={(event) => setSelectedIds((current) => event.target.checked
                        ? [...current, String(order.orderId)] : current.filter((id) => id !== String(order.orderId)))} /></td>
                    <td>{order.accountName}</td><td>{order.opportunityName}</td><td>{order.providerName}</td>
                    <td>{order.orderNumber}</td><td>{date(order.orderDate)}</td><td>{order.currencyCode}</td>
                    <td className="is-right">{money(documentTotals([order], availableQuantities).total, order.currencyCode)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="status-text">{error ? "No se pudo consultar la disponibilidad. Reintenta la carga."
          : "No hay ordenes con cantidades disponibles para facturar."}</p>}
        <button type="button" className="btn-secondary" disabled={loading || saving}
          onClick={() => void load()}>Actualizar listado</button>
      </section>

      <section className="panel supplier-invoice-panel">
        <h3>Facturas y prefacturas de proveedores registradas</h3>
        <div className="invoice-document-filters" role="group" aria-label="Filtros de documentos de proveedores">
          <label className="field-group"><span>Fecha de inicio</span>
            <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} /></label>
          <label className="field-group"><span>Fecha de fin</span>
            <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} /></label>
          <label className="field-group"><span>Tipo de documento</span>
            <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
              <option value="">Todos</option><option value="invoice">Factura</option><option value="preinvoice">Prefactura</option>
            </select></label>
          <label className="field-group"><span>Proveedor</span>
            <select aria-label="Proveedor" value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value })}>
              <option value="">Todos los proveedores</option>
              {filterOptions.providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
          <label className="field-group"><span>Cuenta</span>
            <select aria-label="Cuenta" value={filters.account} onChange={(event) => setFilters({ ...filters, account: event.target.value })}>
              <option value="">Todas las cuentas</option>
              {filterOptions.accounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
          <button type="button" className="btn-secondary"
            onClick={() => setFilters({ start: "", end: "", type: "", provider: "", account: "" })}>Limpiar filtros</button>
        </div>
        <p className="field-hint">Las fechas corresponden a la fecha del documento. Mostrando {filteredDocuments.length} de {documents.length} documentos.</p>
        {invalidRange && <p className="status-text error" role="alert">La fecha de inicio no puede ser posterior a la fecha de fin.</p>}
        {filteredDocuments.length ? (
          <div className="supplier-invoice-table-wrap"><table className="table">
            <thead><tr><th>Nombre de oportunidad</th><th>Nombre de cuenta</th><th>Proveedor</th>
              <th>Numero de factura</th><th>Tipo</th><th>Fecha del documento</th><th>Ordenes de compra</th>
              <th className="is-right">Monto original</th><th>Tipo de cambio a USD</th><th className="is-right">Monto en USD</th><th>Acciones</th></tr></thead>
            <tbody>{filteredDocuments.map((document) => (
              <tr key={document.id}>
                <td>{names(document.orders, "opportunityName")}</td><td>{names(document.orders, "accountName")}</td>
                <td>{document.providerName}</td><td>{document.documentType === "preinvoice" ? "Sin asignar" : document.invoiceNumber}</td>
                <td>{document.documentType === "preinvoice" ? "Prefactura" : "Factura"}</td><td>{date(document.invoiceDate)}</td>
                <td>{names(document.orders, "orderNumber")}</td><td className="is-right">{money(document.totalAmount, document.currencyCode)}</td>
                <td>1 USD = {document.exchangeRate} {document.currencyCode}</td><td className="is-right">{money(document.totalUsd, "USD")}</td>
                <td><div className="supplier-invoice-actions">
                  <button type="button" className="btn-secondary processing-product-action-icon" disabled={saving || loading}
                    aria-label="Ver documento" title="Ver documento" onClick={() => openDocument(document, "view")}>
                    <svg viewBox="0 0 24 24" style={{ fill: "none" }} stroke="currentColor"
                      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  {canUpdate && document.documentType === "preinvoice" && document.canConvert !== false && <button type="button" className="btn-secondary processing-product-action-icon"
                    aria-label="Convertir en factura" title="Convertir en factura"
                    disabled={saving || loading} onClick={() => openDocument(document, "convert")}>
                    <svg viewBox="0 0 24 24" style={{ fill: "none" }} stroke="currentColor"
                      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M13 3v6h6M13 3l6 6M8 15h8m-3-3 3 3-3 3" />
                    </svg>
                  </button>}
                  {canUpdate && document.canUpdate !== false && <button type="button" className="btn-secondary processing-product-action-icon"
                    aria-label="Adjuntar comprobantes" title="Adjuntar comprobantes" disabled={saving || loading}
                    onClick={() => openDocument(document, "attach")}>
                    <svg viewBox="0 0 24 24" style={{ fill: "none" }} stroke="currentColor"
                      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L12 3a2 2 0 0 1 3 3L5 16" />
                    </svg>
                  </button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="status-text">{documents.length ? "No hay documentos que coincidan con los filtros."
          : "Aun no hay facturas ni prefacturas de proveedores registradas."}</p>}
      </section>

      {modal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="supplier-invoice-title"
          onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <div className="modal-dialog supplier-invoice-modal">
            <header className="invoice-conversion-header">
              <span className="invoice-conversion-eyebrow">Facturas de proveedores</span>
              <h3 id="supplier-invoice-title">{modal.mode === "create" ? "Registrar factura o prefactura"
                : modal.mode === "convert" ? "Convertir prefactura de proveedor en factura"
                  : modal.mode === "attach" ? "Adjuntar comprobantes de proveedor" : "Documento de proveedor"}</h3>
              <p>{draftOrders[0]?.providerName || modal.document?.providerName} · {currency}</p>
            </header>
            <div className="invoice-conversion-body">
              {modalError && <p className="status-text error" role="alert">{modalError}</p>}
              {["create", "convert"].includes(modal.mode) ? (
                <>
                  <div className="invoice-conversion-summary">
                    <label className="field-group"><span>Numero de factura del proveedor</span>
                      <input value={invoiceNumber} maxLength={100} disabled={saving}
                        onChange={(event) => setInvoiceNumber(event.target.value)} />
                      <small className="field-hint">Obligatorio para factura. La prefactura no requiere numero.</small>
                    </label>
                    <label className="field-group"><span>Fecha del documento</span>
                      <input type="date" value={invoiceDate} disabled={saving}
                        onChange={(event) => setInvoiceDate(event.target.value)} /></label>
                  </div>
                  <InvoiceExchangeRateFields rate={rate} total={modal.mode === "convert" ? modal.document.totalAmount : totals.total} disabled={saving} />
                </>
              ) : modal.mode === "view" ? <p>{modal.document.documentType === "preinvoice" ? "Prefactura sin numero" : `Factura ${modal.document.invoiceNumber}`} · {date(modal.document.invoiceDate)} · Tipo de cambio: 1 USD = {modal.document.exchangeRate} {currency}</p>
                : <p>El documento ya esta registrado. Adjunta sus comprobantes sin crear un nuevo registro.</p>}
              {modal.mode !== "view" && (
                <label className="field-group supplier-invoice-files">
                  <span>Comprobantes del proveedor (opcional)</span>
                  <input type="file" multiple disabled={saving} onChange={(event) => {
                    setFiles(Array.from(event.target.files || []));
                    setModalError("");
                  }} />
                  <small className="field-hint">Los archivos se adjuntan despues de guardar el documento.</small>
                  {files.length > 0 && <small className="field-hint">{files.map((file) => file.name).join(", ")}</small>}
                </label>
              )}
              {modal.mode === "view" && modal.document.attachments?.length > 0 && (
                <div className="supplier-invoice-files">
                  <h4>Comprobantes adjuntos</h4>
                  {modal.document.attachments.map((attachment) => (
                    <button key={attachment.id} type="button" className="btn-secondary"
                      disabled={downloading != null} onClick={() => void downloadAttachment(attachment)}>
                      {downloading === attachment.id ? "Descargando..." : attachment.fileName}
                    </button>
                  ))}
                </div>
              )}
              {modal.mode !== "attach" && draftOrders.map((order) => (
                <section key={order.orderId} className="supplier-invoice-order">
                  <h4>Orden {order.orderNumber}</h4>
                  <p>{order.accountName} · {order.opportunityName} · IVA {order.ivaPct}%</p>
                  <div className="supplier-invoice-table-wrap"><table className="table">
                    <thead><tr>
                      {modal.mode === "create" && <th>Incluir</th>}
                      <th>Codigo</th><th>Descripcion</th>
                      {modal.mode === "create" && <><th>Comprado</th><th>Facturado</th><th>Reservado</th><th>Disponible</th></>}
                      <th>Cantidad</th><th>Costo unitario</th><th>Descuento</th><th>Importe</th>
                    </tr></thead>
                    <tbody>{order.lines.map((line) => {
                      const key = lineKey(order.orderId, line.itemId);
                      const quantity = modal.mode === "create" ? Number(quantities[key] || 0) : Number(line.quantity);
                      const amount = quantity * Number(line.unitCost) * (1 - Number(line.discountPct || 0) / 100);
                      return <tr key={line.itemId}>
                        {modal.mode === "create" && <td><input type="checkbox" aria-label={`Incluir item ${order.orderNumber} ${line.code}`}
                          checked={quantity > 0} disabled={saving || Number(line.availableQuantity) <= 0}
                          onChange={(event) => setQuantities({ ...quantities, [key]: event.target.checked ? Number(line.availableQuantity) : 0 })} /></td>}
                        <td>{line.code}</td><td>{line.description}</td>
                        {modal.mode === "create" && <><td>{line.quantity}</td><td>{line.invoicedQuantity}</td><td>{line.reservedQuantity}</td><td>{line.availableQuantity}</td></>}
                        <td>{modal.mode === "create" ? <input className="supplier-invoice-quantity" type="number" min="0"
                          step="any" max={line.availableQuantity} aria-label={`Cantidad ${order.orderNumber} ${line.code}`}
                          value={quantities[key] ?? 0} disabled={saving || Number(line.availableQuantity) <= 0}
                          onChange={(event) => {
                            setModalError("");
                            setQuantities({ ...quantities, [key]: event.target.value });
                          }} /> : quantity}</td>
                        <td>{money(line.unitCost, currency)}</td><td>{line.discountPct || 0}%</td><td>{money(amount, currency)}</td>
                      </tr>;
                    })}</tbody>
                  </table></div>
                </section>
              ))}
              {modal.mode !== "attach" && <div className="supplier-invoice-totals">
                <span>Subtotal: <strong>{money(modal.document?.subtotal ?? totals.subtotal, currency)}</strong></span>
                <span>IVA: <strong>{money(modal.document?.ivaAmount ?? totals.ivaAmount, currency)}</strong></span>
                <span>Total: <strong>{money(modal.document?.totalAmount ?? totals.total, currency)}</strong></span>
                {modal.mode === "view" && <span>Total en USD: <strong>{money(modal.document.totalUsd, "USD")}</strong></span>}
              </div>}
              {modal.mode === "create" && <p className="field-hint">La prefactura reserva los items seleccionados. Este registro no marca al proveedor como pagado ni modifica la recepcion de productos.</p>}
            </div>
            <footer className="invoice-conversion-actions">
              <button type="button" className="btn-secondary" disabled={saving} onClick={closeModal}>
                {modal.mode === "view" ? "Cerrar" : "Cancelar"}
              </button>
              {modal.mode === "create" && <button type="button" className="btn-secondary"
                disabled={saving || rate.loading || !rate.valid} onClick={() => void save("preinvoice")}>
                {saving ? "Guardando..." : "Guardar prefactura"}
              </button>}
              {["create", "convert"].includes(modal.mode) && <button type="button" className="btn-primary"
                disabled={saving || rate.loading || !rate.valid} onClick={() => void save("invoice")}>
                {saving ? "Guardando..." : modal.mode === "convert" ? "Confirmar conversion" : "Registrar factura"}
              </button>}
              {modal.mode === "attach" && <button type="button" className="btn-primary" disabled={saving || !files.length}
                onClick={() => void retryFiles()}>{saving ? "Adjuntando..." : modalError ? "Reintentar adjuntos" : "Adjuntar comprobantes"}</button>}
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
