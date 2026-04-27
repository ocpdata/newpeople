import { formatQuotationAmount } from "./quotationsUtils";

function formatPrintMoney(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const normalizedValue = Number(value);
  const formattedAmount = formatQuotationAmount(normalizedValue);
  return currency ? `${currency} ${formattedAmount}` : formattedAmount;
}

function renderContactLine(primary, secondary) {
  if (!primary && !secondary) {
    return "";
  }

  return [primary, secondary].filter(Boolean).join("    ");
}

function QuotationPrintDocument({ model }) {
  if (!model) {
    return null;
  }

  return (
    <div className="quotation-print-sheet" data-testid="quotation-print-sheet">
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
            <strong>Fecha: {model.header.quotationDate || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>Cliente: {model.header.accountName || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>Propuesta: {model.header.proposalName || ""}</strong>
          </div>
          <div className="quotation-print-info-card">
            <strong>Contacto: {model.header.contactName || ""}</strong>
            <span data-testid="quotation-print-contact-email">
              {model.header.contactEmail || ""}
            </span>
            <span data-testid="quotation-print-contact-phone">
              {model.header.contactPhone || ""}
            </span>
          </div>
          <div className="quotation-print-info-card">
            <strong>Vendedor: {model.header.sellerName || ""}</strong>
            <span data-testid="quotation-print-seller-email">
              {model.header.sellerEmail || ""}
            </span>
            <span data-testid="quotation-print-seller-phone">
              {model.header.sellerPhone || ""}
            </span>
          </div>
        </div>
      </header>

      {model.introduction ? (
        <p className="quotation-print-introduction">{model.introduction}</p>
      ) : null}

      <div className="quotation-print-sections">
        {model.sections.map((section) => (
          <section
            key={section.id}
            className="quotation-print-section"
            data-testid={`quotation-print-section-${section.id}`}
          >
            <div className="quotation-print-section-title">{section.title}</div>
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
                  <th>Codigo</th>
                  <th>Descripcion</th>
                  <th>Cantidad</th>
                  <th>Precio unitario</th>
                  <th>Precio total</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, index) => (
                  <tr key={row.id || `${section.id}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{row.productCode || ""}</td>
                    <td>{row.productDescription || ""}</td>
                    <td>{row.quantityDisplay || row.quantity || ""}</td>
                    <td>
                      {formatPrintMoney(
                        row.salePriceUnit,
                        model.summary.currencyCode,
                      )}
                    </td>
                    <td>
                      {formatPrintMoney(
                        row.salePriceTotal,
                        model.summary.currencyCode,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="quotation-print-section-subtotal">
              <span>Sub-Total:</span>
              <strong
                data-testid={`quotation-print-section-subtotal-${section.id}`}
              >
                {formatPrintMoney(section.subtotal, model.summary.currencyCode)}
              </strong>
            </div>
          </section>
        ))}
      </div>

      <div className="quotation-print-summary-grid">
        <section className="quotation-print-summary-card">
          <div className="quotation-print-summary-title">
            Condiciones Comerciales
          </div>
          <div className="quotation-print-summary-row">
            <span>Tiempo de entrega</span>
            <strong>{model.commercialTerms.deliveryTime || ""}</strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Validez</span>
            <strong>{model.commercialTerms.quotationValidity || ""}</strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Garantia</span>
            <strong>{model.commercialTerms.warranty || ""}</strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Forma de pago</span>
            <strong>{model.commercialTerms.paymentTerms || ""}</strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Moneda</span>
            <strong>{model.commercialTerms.currency || ""}</strong>
          </div>
        </section>

        <section className="quotation-print-summary-card">
          <div className="quotation-print-summary-title">Resumen</div>
          <div className="quotation-print-summary-row">
            <span>Total</span>
            <strong>
              {formatPrintMoney(
                model.summary.subtotal,
                model.summary.currencyCode,
              )}
            </strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Descuento Final</span>
            <strong>
              {formatPrintMoney(
                model.summary.discount,
                model.summary.currencyCode,
              )}
            </strong>
          </div>
          <div className="quotation-print-summary-row">
            <span>Total Descontado</span>
            <strong>
              {formatPrintMoney(
                model.summary.discountedSubtotal,
                model.summary.currencyCode,
              )}
            </strong>
          </div>
          {model.summary.showVat ? (
            <div className="quotation-print-summary-row">
              <span>IVA</span>
              <strong>
                {formatPrintMoney(
                  model.summary.vatAmount,
                  model.summary.currencyCode,
                )}
              </strong>
            </div>
          ) : null}
          <div className="quotation-print-summary-row is-total">
            <span>Total Final</span>
            <strong>
              {formatPrintMoney(
                model.summary.total,
                model.summary.currencyCode,
              )}
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

export default QuotationPrintDocument;
