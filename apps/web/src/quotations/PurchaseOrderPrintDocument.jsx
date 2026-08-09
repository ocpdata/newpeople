import { formatQuotationAmount } from "./quotationsUtils";

function formatPrintMoney(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const normalizedValue = Number(value);
  const formattedAmount = formatQuotationAmount(normalizedValue);
  return currency ? `${currency} ${formattedAmount}` : formattedAmount;
}

function hasVisibleMoneyValue(value) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return false;
  }

  return Math.round(Math.abs(numericValue) * 100) > 0;
}

function PurchaseOrderPrintDocument({ model }) {
  if (!model) {
    return null;
  }

  const hasDiscount = hasVisibleMoneyValue(model.summary.discount);

  return (
    <div className="quotation-print-sheet" data-testid="purchase-order-print-sheet">
      <header className="quotation-print-header-grid">
        <div className="quotation-print-company-block">
          {model.company.logoUrl ? (
            <img
              src={model.company.logoUrl}
              alt="Logo de la empresa"
              className="quotation-print-company-logo"
            />
          ) : null}
          <div className="quotation-print-info-card">
            <strong>{model.company.legalName}</strong>
            <span>{model.company.taxId}</span>
            {model.company.addressLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </div>

        <div className="quotation-print-metadata-grid">
          <div className="quotation-print-info-card">
            <strong>Orden de compra: {model.header.documentNumber || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>Fecha: {model.header.documentDate || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>{model.header.quotationReference || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>Cliente: {model.header.accountName || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>Propuesta: {model.header.proposalName || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>Proveedores: {model.header.providerNames || ""}</strong>
            <span>{model.header.orderCountLabel || ""}</span>
          </div>
        </div>
      </header>

      <div className="quotation-print-sections">
        {model.sections.map((section) => (
          <section
            key={section.id}
            className="quotation-print-section"
            data-testid={`purchase-order-print-section-${section.id}`}
          >
            <div className="quotation-print-section-title">
              {section.title}
              {section.subtitle ? ` - ${section.subtitle}` : ""}
            </div>
            <table className="quotation-print-table">
              <colgroup>
                <col className="quotation-print-col-item" />
                <col className="quotation-print-col-code" />
                <col className="quotation-print-col-description" />
                <col className="quotation-print-col-quantity" />
                <col className="quotation-print-col-unit-price" />
                <col className="quotation-print-col-total-price" />
              </colgroup>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Cantidad</th>
                  <th>Costo unitario</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, index) => (
                  <tr key={row.id || `${section.id}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{row.productCode || ""}</td>
                    <td>{row.productDescription || ""}</td>
                    <td>{row.quantityDisplay || ""}</td>
                    <td>
                      {formatPrintMoney(
                        row.salePriceUnit,
                        section.currencyCode || model.summary.currencyCode,
                      )}
                    </td>
                    <td>
                      {formatPrintMoney(
                        row.salePriceTotal,
                        section.currencyCode || model.summary.currencyCode,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="quotation-print-section-subtotal">
              <span>Sub-Total:</span>
              <strong data-testid={`purchase-order-print-section-subtotal-${section.id}`}>
                {formatPrintMoney(section.subtotal, section.currencyCode || model.summary.currencyCode)}
              </strong>
            </div>
          </section>
        ))}
      </div>

      <div className="quotation-print-summary-grid">
        <section className="quotation-print-summary-card">
          <div className="quotation-print-summary-title">Datos de la orden</div>
          <div className="quotation-print-summary-row">
            <span>Cotización origen</span>
            <strong>{model.header.quotationReference || ""}</strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Proveedores</span>
            <strong>{model.header.providerNames || ""}</strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Numero de ordenes</span>
            <strong>{model.header.orderCountLabel || ""}</strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Moneda</span>
            <strong>{model.summary.currencyCode || ""}</strong>
          </div>
        </section>

        <section className="quotation-print-summary-card">
          <div className="quotation-print-summary-title">Resumen</div>
          <div className="quotation-print-summary-row">
            <span>Subtotal</span>
            <strong>
              {formatPrintMoney(model.summary.subtotal, model.summary.currencyCode)}
            </strong>
          </div>
          {hasDiscount ? (
            <>
              <div className="quotation-print-summary-row">
                <span>Descuento</span>
                <strong>
                  {formatPrintMoney(model.summary.discount, model.summary.currencyCode)}
                </strong>
              </div>
              <div className="quotation-print-summary-row">
                <span>Subtotal con descuento</span>
                <strong>
                  {formatPrintMoney(
                    model.summary.discountedSubtotal,
                    model.summary.currencyCode,
                  )}
                </strong>
              </div>
            </>
          ) : null}
          {model.summary.showVat ? (
            <div className="quotation-print-summary-row">
              <span>I.V.A.</span>
              <strong>
                {formatPrintMoney(model.summary.vatAmount, model.summary.currencyCode)}
              </strong>
            </div>
          ) : null}
          <div className="quotation-print-summary-row is-total">
            <span>Total</span>
            <strong>
              {formatPrintMoney(model.summary.total, model.summary.currencyCode)}
            </strong>
          </div>
        </section>
      </div>

      <section className="quotation-print-notes-card">
        <div className="quotation-print-summary-title">Notas</div>
        <div className="quotation-print-notes-content">{model.notes || ""}</div>
      </section>
    </div>
  );
}

export default PurchaseOrderPrintDocument;