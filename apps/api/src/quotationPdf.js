import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { config } from "./config.js";

const PAGE_MARGIN = 42;
const PAGE_WIDTH = 612 - PAGE_MARGIN * 2;
const COLORS = {
  brand: "#123044",
  accent: "#d7e2ea",
  text: "#1d2730",
  muted: "#5d6a72",
  border: "#c7d0d6",
};

function asText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function asLines(value) {
  if (Array.isArray(value)) {
    return value.map((line) => asText(line)).filter(Boolean);
  }

  return asText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function asNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatCurrency(value, currencyCode = "USD") {
  const safeCurrency = asText(currencyCode) || "USD";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value));
}

function formatFilenamePart(value, fallback = "cotizacion") {
  const slug = asText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug || fallback;
}

function bufferPdfDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function createDocument() {
  return new PDFDocument({
    size: "LETTER",
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: "Cotizacion",
      Author: "NewPeople CRM",
      Subject: "Cotizacion comercial",
      Creator: "NewPeople API",
    },
  });
}

function ensureSpace(doc, heightNeeded, onBreak) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + heightNeeded <= bottomLimit) {
    return;
  }

  doc.addPage();
  if (typeof onBreak === "function") {
    onBreak();
  }
}

function drawDivider(doc, color = COLORS.border) {
  const y = doc.y;
  doc
    .save()
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(1)
    .strokeColor(color)
    .stroke()
    .restore();
  doc.moveDown(0.5);
}

function drawLabelValue(doc, { label, value, x, y, width, align = "left" }) {
  const safeLabel = asText(label);
  const safeValue = asText(value) || "-";
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(safeLabel, x, y, { width, align });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(COLORS.text)
    .text(safeValue, x, y + 11, { width, align });
}

function drawHeader(doc, model) {
  const company = config.documents.quotation.company;
  const topY = doc.y;
  const leftX = doc.page.margins.left;
  const rightX = leftX + 265;
  const rightWidth = PAGE_WIDTH - 265;

  if (company.logoPath && existsSync(company.logoPath)) {
    try {
      doc.image(company.logoPath, leftX, topY, {
        fit: [150, 55],
        align: "left",
        valign: "top",
      });
    } catch {
      // Ignore logo rendering problems and keep the document available.
    }
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(COLORS.brand)
    .text(company.legalName, leftX, topY + 60, { width: 250 });

  const companyLines = [company.taxId, ...asLines(company.addressLines)];
  if (company.email) companyLines.push(company.email);
  if (company.phone) companyLines.push(company.phone);

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLORS.text)
    .text(companyLines.filter(Boolean).join("\n"), leftX, topY + 84, {
      width: 250,
      lineGap: 2,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(COLORS.brand)
    .text("COTIZACION", rightX, topY, { width: rightWidth, align: "right" });

  drawLabelValue(doc, {
    label: "Propuesta",
    value: model.header.proposalName,
    x: rightX,
    y: topY + 34,
    width: rightWidth,
    align: "right",
  });
  drawLabelValue(doc, {
    label: "Fecha",
    value: model.header.quotationDate,
    x: rightX,
    y: topY + 64,
    width: rightWidth,
    align: "right",
  });
  drawLabelValue(doc, {
    label: "Cuenta",
    value: model.header.accountName,
    x: rightX,
    y: topY + 94,
    width: rightWidth,
    align: "right",
  });

  doc.y = topY + 138;
  drawDivider(doc, COLORS.accent);
}

function drawPeopleSummary(doc, model) {
  const blockTop = doc.y;
  const columnWidth = (PAGE_WIDTH - 18) / 2;
  const rightX = doc.page.margins.left + columnWidth + 18;

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLORS.brand)
    .text("Contacto", doc.page.margins.left, blockTop, { width: columnWidth });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(COLORS.text)
    .text(
      [
        model.header.contactName,
        model.header.contactEmail,
        model.header.contactPhone,
      ]
        .filter(Boolean)
        .join("\n") || "-",
      doc.page.margins.left,
      blockTop + 15,
      { width: columnWidth, lineGap: 2 },
    );

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLORS.brand)
    .text("Ejecutivo comercial", rightX, blockTop, { width: columnWidth });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(COLORS.text)
    .text(
      [
        model.header.sellerName,
        model.header.sellerEmail,
        model.header.sellerPhone,
      ]
        .filter(Boolean)
        .join("\n") || "-",
      rightX,
      blockTop + 15,
      { width: columnWidth, lineGap: 2 },
    );

  const nextY = Math.max(doc.y, blockTop + 70);
  doc.y = nextY;
  drawDivider(doc, COLORS.accent);
}

function drawParagraphSection(doc, title, content) {
  const safeContent = asText(content);
  if (!safeContent) {
    return;
  }

  ensureSpace(doc, 70);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.brand)
    .text(title, doc.page.margins.left, doc.y, { width: PAGE_WIDTH });
  doc.moveDown(0.35);
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.text).text(safeContent, {
    width: PAGE_WIDTH,
    lineGap: 2,
    align: "left",
  });
  doc.moveDown(0.8);
}

function drawTableHeader(doc, startY) {
  const columns = [32, 72, 214, 48, 79, 83];
  const headers = [
    "#",
    "Codigo",
    "Descripcion",
    "Cant.",
    "P. unit.",
    "Importe",
  ];
  let x = doc.page.margins.left;

  doc.save();
  doc.rect(x, startY, PAGE_WIDTH, 22).fill(COLORS.brand);
  doc.restore();

  headers.forEach((header, index) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#ffffff")
      .text(header, x + 4, startY + 7, {
        width: columns[index] - 8,
        align: index >= 3 ? "right" : "left",
      });
    x += columns[index];
  });

  doc.y = startY + 22;
  return columns;
}

function drawSectionTable(doc, section, currencyCode) {
  const rows = Array.isArray(section?.rows) ? section.rows : [];

  ensureSpace(doc, 48);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.brand)
    .text(asText(section.title) || "Seccion", {
      width: PAGE_WIDTH,
    });
  doc.moveDown(0.3);

  const renderHeader = () => drawTableHeader(doc, doc.y);
  const columns = renderHeader();
  const tableX = doc.page.margins.left;

  for (const row of rows) {
    const values = [
      row.displayOrder == null ? "" : String(row.displayOrder),
      asText(row.productCode),
      asText(row.productDescription),
      asText(row.quantityDisplay) || asNumber(row.quantity).toFixed(2),
      formatCurrency(row.salePriceUnit, currencyCode),
      formatCurrency(row.salePriceTotal, currencyCode),
    ];

    const cellHeights = values.map((value, index) =>
      doc.heightOfString(value || " ", {
        width: columns[index] - 8,
        align: index >= 3 ? "right" : "left",
      }),
    );
    const rowHeight = Math.max(22, ...cellHeights.map((height) => height + 8));

    ensureSpace(doc, rowHeight + 1, () => {
      renderHeader();
    });

    const rowTop = doc.y;
    doc
      .save()
      .rect(tableX, rowTop, PAGE_WIDTH, rowHeight)
      .strokeColor(COLORS.border)
      .lineWidth(0.75)
      .stroke()
      .restore();

    let x = tableX;
    values.forEach((value, index) => {
      if (index > 0) {
        doc
          .save()
          .moveTo(x, rowTop)
          .lineTo(x, rowTop + rowHeight)
          .strokeColor(COLORS.border)
          .lineWidth(0.75)
          .stroke()
          .restore();
      }

      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(COLORS.text)
        .text(value || "-", x + 4, rowTop + 4, {
          width: columns[index] - 8,
          align: index >= 3 ? "right" : "left",
        });
      x += columns[index];
    });

    doc.y = rowTop + rowHeight;
  }

  ensureSpace(doc, 28);
  const subtotalY = doc.y + 6;
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLORS.brand)
    .text("Subtotal de seccion", doc.page.margins.left, subtotalY, {
      width: PAGE_WIDTH - 120,
      align: "right",
    });
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLORS.brand)
    .text(
      formatCurrency(section.subtotal, currencyCode),
      doc.page.margins.left,
      subtotalY,
      {
        width: PAGE_WIDTH,
        align: "right",
      },
    );
  doc.y = subtotalY + 24;
  doc.moveDown(0.6);
}

function drawSummaryAndTerms(doc, model) {
  ensureSpace(doc, 170);
  const topY = doc.y;
  const leftWidth = 300;
  const rightWidth = PAGE_WIDTH - leftWidth - 20;
  const rightX = doc.page.margins.left + leftWidth + 20;
  const currencyCode = model.summary.currencyCode || "USD";

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.brand)
    .text("Condiciones comerciales", doc.page.margins.left, topY, {
      width: leftWidth,
    });
  doc.moveDown(0.3);

  const terms = [
    ["Entrega", model.commercialTerms.deliveryTime],
    ["Vigencia", model.commercialTerms.quotationValidity],
    ["Garantia", model.commercialTerms.warranty],
    ["Pago", model.commercialTerms.paymentTerms],
    ["Moneda", model.commercialTerms.currency],
  ];

  let currentY = topY + 18;
  for (const [label, value] of terms) {
    drawLabelValue(doc, {
      label,
      value,
      x: doc.page.margins.left,
      y: currentY,
      width: leftWidth,
    });
    currentY += 28;
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.brand)
    .text("Resumen", rightX, topY, { width: rightWidth, align: "right" });

  const summaryRows = [
    ["Subtotal", model.summary.subtotal],
    ["Descuento", model.summary.discount],
    ["Subtotal con descuento", model.summary.discountedSubtotal],
  ];
  if (model.summary.showVat) {
    summaryRows.push(["IVA", model.summary.vatAmount]);
  }
  summaryRows.push(["Total", model.summary.total]);

  currentY = topY + 22;
  for (const [label, amount] of summaryRows) {
    const isTotal = label === "Total";
    doc
      .font(isTotal ? "Helvetica-Bold" : "Helvetica")
      .fontSize(isTotal ? 11 : 10)
      .fillColor(isTotal ? COLORS.brand : COLORS.text)
      .text(label, rightX, currentY, {
        width: rightWidth / 2,
        align: "left",
      });
    doc
      .font(isTotal ? "Helvetica-Bold" : "Helvetica")
      .fontSize(isTotal ? 11 : 10)
      .fillColor(isTotal ? COLORS.brand : COLORS.text)
      .text(formatCurrency(amount, currencyCode), rightX, currentY, {
        width: rightWidth,
        align: "right",
      });
    currentY += isTotal ? 22 : 18;
  }

  doc.y = Math.max(currentY, topY + 144);
  doc.moveDown(0.8);
}

function drawPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const footerY = doc.page.height - doc.page.margins.bottom - 12;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        `Pagina ${index + 1} de ${range.count}`,
        doc.page.margins.left,
        footerY,
        {
          width: PAGE_WIDTH,
          align: "right",
          lineBreak: false,
        },
      );
  }
}

function normalizeModel(input) {
  return {
    header: {
      quotationDate: asText(input?.header?.quotationDate),
      proposalName: asText(input?.header?.proposalName),
      accountName: asText(input?.header?.accountName),
      contactName: asText(input?.header?.contactName),
      contactEmail: asText(input?.header?.contactEmail),
      contactPhone: asText(input?.header?.contactPhone),
      sellerName: asText(input?.header?.sellerName),
      sellerEmail: asText(input?.header?.sellerEmail),
      sellerPhone: asText(input?.header?.sellerPhone),
    },
    introduction: asText(input?.introduction),
    sections: Array.isArray(input?.sections)
      ? input.sections.map((section) => ({
          title: asText(section?.title),
          subtotal: asNumber(section?.subtotal),
          rows: Array.isArray(section?.rows)
            ? section.rows.map((row) => ({
                displayOrder:
                  row?.displayOrder == null ? null : Number(row.displayOrder),
                productCode: asText(row?.productCode),
                productDescription: asText(row?.productDescription),
                quantity: asNumber(row?.quantity),
                quantityDisplay: asText(row?.quantityDisplay),
                salePriceUnit: asNumber(row?.salePriceUnit),
                salePriceTotal: asNumber(row?.salePriceTotal),
              }))
            : [],
        }))
      : [],
    summary: {
      subtotal: asNumber(input?.summary?.subtotal),
      discount: asNumber(input?.summary?.discount),
      discountedSubtotal: asNumber(input?.summary?.discountedSubtotal),
      vatAmount: asNumber(input?.summary?.vatAmount),
      total: asNumber(input?.summary?.total),
      showVat: Boolean(input?.summary?.showVat),
      currencyCode: asText(input?.summary?.currencyCode) || "USD",
    },
    commercialTerms: {
      deliveryTime: asText(input?.commercialTerms?.deliveryTime),
      quotationValidity: asText(input?.commercialTerms?.quotationValidity),
      warranty: asText(input?.commercialTerms?.warranty),
      paymentTerms: asText(input?.commercialTerms?.paymentTerms),
      currency: asText(input?.commercialTerms?.currency),
    },
    notes: asText(input?.notes),
  };
}

export async function buildQuotationPdfBuffer(input) {
  const model = normalizeModel(input);
  const doc = createDocument();
  const bufferPromise = bufferPdfDocument(doc);

  drawHeader(doc, model);
  drawPeopleSummary(doc, model);
  drawParagraphSection(doc, "Introduccion", model.introduction);
  for (const section of model.sections) {
    drawSectionTable(doc, section, model.summary.currencyCode);
  }
  drawSummaryAndTerms(doc, model);
  drawParagraphSection(doc, "Notas", model.notes);
  drawPageNumbers(doc);
  doc.end();

  return {
    buffer: await bufferPromise,
    fileName: `${formatFilenamePart(model.header.proposalName)}.pdf`,
  };
}
