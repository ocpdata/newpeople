import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";

const PAGE_MARGIN = 42;
const PAGE_WIDTH = 612 - PAGE_MARGIN * 2;
const COLORS = {
  brand: "#123044",
  accent: "#d7e2ea",
  text: "#1d2730",
  muted: "#5d6a72",
  border: "#c7d0d6",
};
const CARD_ROW_TEXT_PADDING = 6;

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

function resolveLogoSource(value) {
  const safeValue = asText(value);
  if (!safeValue) return null;

  if (safeValue.startsWith("data:image/")) {
    const separatorIndex = safeValue.indexOf(",");
    if (separatorIndex <= 0) return null;
    try {
      return Buffer.from(safeValue.slice(separatorIndex + 1), "base64");
    } catch {
      return null;
    }
  }

  if (existsSync(safeValue)) {
    return safeValue;
  }

  return null;
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

function hasVisibleAmount(value) {
  return Math.round(asNumber(value) * 100) > 0;
}

function hasVatInSummary(summary) {
  return summary?.vatMode === "total" || summary?.vatMode === "per_item";
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

function drawOutlinedCard(doc, x, y, width, height) {
  doc
    .save()
    .roundedRect(x, y, width, height, 8)
    .lineWidth(1)
    .strokeColor("#d6e0ec")
    .stroke()
    .restore();
}

function measureTextHeight(doc, text, { width, font, fontSize, align = "left" }) {
  return doc
    .font(font)
    .fontSize(fontSize)
    .heightOfString(asText(text) || "", { width, align });
}

function drawCardRows(doc, rows, { x, y, width, paddingX = 14 }) {
  let currentY = y;
  const contentWidth = width - paddingX * 2;
  const labelWidth = contentWidth / 2;

  rows.forEach(([label, value], index) => {
    if (index > 0) {
      doc
        .save()
        .moveTo(x + paddingX, currentY - 4)
        .lineTo(x + width - paddingX, currentY - 4)
        .lineWidth(1)
        .strokeColor("#e3ebf4")
        .stroke()
        .restore();
    }

    const rowHeight = Math.max(
      18,
      measureTextHeight(doc, label, {
        width: labelWidth,
        font: "Helvetica",
        fontSize: 10,
      }),
      measureTextHeight(doc, value, {
        width: contentWidth,
        font: "Helvetica-Bold",
        fontSize: 10,
        align: "right",
      }),
    ) + CARD_ROW_TEXT_PADDING;

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(label, x + paddingX, currentY, {
        width: labelWidth,
        align: "left",
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(asText(value) || "", x + paddingX, currentY, {
        width: contentWidth,
        align: "right",
      });

    currentY += rowHeight;
  });

  return currentY;
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
  const company = model.company;
  const topY = doc.y;
  const leftX = doc.page.margins.left;
  const rightX = leftX + 265;
  const rightWidth = PAGE_WIDTH - 265;
  const logoSource = resolveLogoSource(company.logoUrl);

  if (logoSource) {
    try {
      doc.image(logoSource, leftX, topY, {
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

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(COLORS.text)
    .text(
      `Cotizacion: ${asText(model.header.quotationNumber) || "-"}    Version: ${asText(model.header.versionNumber) || "-"}`,
      rightX,
      topY + 36,
      { width: rightWidth, align: "right" },
    );
  drawLabelValue(doc, {
    label: "Propuesta",
    value: model.header.proposalName,
    x: rightX,
    y: topY + 60,
    width: rightWidth,
    align: "right",
  });
  drawLabelValue(doc, {
    label: "Fecha",
    value: model.header.quotationDate,
    x: rightX,
    y: topY + 90,
    width: rightWidth,
    align: "right",
  });
  drawLabelValue(doc, {
    label: "Cuenta",
    value: model.header.accountName,
    x: rightX,
    y: topY + 120,
    width: rightWidth,
    align: "right",
  });

  doc.y = topY + 164;
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

function drawOutlinedParagraphCard(doc, title, content) {
  const safeContent = asText(content);
  if (!safeContent) {
    return;
  }

  const cardPaddingX = 14;
  const cardPaddingTop = 12;
  const cardPaddingBottom = 16;
  const contentWidth = PAGE_WIDTH - cardPaddingX * 2;

  function measureParagraphHeight(text) {
    return doc.heightOfString(text, {
      width: contentWidth,
      lineGap: 2,
      align: "left",
    });
  }

  function getFittingTextChunk(text, maxHeight) {
    if (!text) {
      return { chunk: "", remainder: "" };
    }

    if (measureParagraphHeight(text) <= maxHeight) {
      return { chunk: text, remainder: "" };
    }

    let low = 1;
    let high = text.length;
    let best = 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = text.slice(0, middle);
      if (measureParagraphHeight(candidate) <= maxHeight) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    let splitIndex = best;
    const candidateChunk = text.slice(0, best);
    const lastWhitespaceIndex = Math.max(
      candidateChunk.lastIndexOf("\n"),
      candidateChunk.lastIndexOf(" "),
      candidateChunk.lastIndexOf("\t"),
    );

    if (lastWhitespaceIndex > 0) {
      splitIndex = lastWhitespaceIndex;
    }

    const chunk = text.slice(0, splitIndex).trimEnd();
    const remainder = text.slice(splitIndex).trimStart();

    if (!chunk) {
      return {
        chunk: text.slice(0, best).trimEnd(),
        remainder: text.slice(best).trimStart(),
      };
    }

    return { chunk, remainder };
  }

  const minimumLineHeight = measureTextHeight(doc, "Ag", {
    width: contentWidth,
    font: "Helvetica",
    fontSize: 10,
  });

  let remainingText = safeContent;
  let isContinuation = false;

  while (remainingText) {
    const currentTitle = isContinuation ? `${title} (cont.)` : title;
    const titleHeight = measureTextHeight(doc, currentTitle, {
      width: contentWidth,
      font: "Helvetica-Bold",
      fontSize: 11,
    });
    const minimumCardHeight =
      cardPaddingTop + titleHeight + 10 + minimumLineHeight + cardPaddingBottom;

    ensureSpace(doc, minimumCardHeight + 12);

    const topY = doc.y;
    const availableHeight =
      doc.page.height - doc.page.margins.bottom - topY;
    const availableContentHeight =
      availableHeight - cardPaddingTop - titleHeight - 10 - cardPaddingBottom;

    const { chunk, remainder } = getFittingTextChunk(
      remainingText,
      availableContentHeight,
    );
    const chunkHeight = measureParagraphHeight(chunk);
    const cardHeight =
      cardPaddingTop + titleHeight + 10 + chunkHeight + cardPaddingBottom;
    const titleY = topY + cardPaddingTop;
    const contentY = titleY + titleHeight + 10;

    drawOutlinedCard(doc, doc.page.margins.left, topY, PAGE_WIDTH, cardHeight);

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(COLORS.brand)
      .text(currentTitle, doc.page.margins.left + cardPaddingX, titleY, {
        width: contentWidth,
      });

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(chunk, doc.page.margins.left + cardPaddingX, contentY, {
        width: contentWidth,
        lineGap: 2,
        align: "left",
      });

    doc.y = topY + cardHeight;
    remainingText = remainder;
    isContinuation = true;

    if (remainingText) {
      doc.addPage();
    } else {
      doc.moveDown(0.8);
    }
  }
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

function measureSectionRow(doc, row, columns, currencyCode) {
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

  return {
    values,
    rowHeight: Math.max(22, ...cellHeights.map((height) => height + 8)),
  };
}

function getSectionOpeningHeight(doc, title, firstRowHeight = 0) {
  const titleHeight = doc.heightOfString(title, {
    width: PAGE_WIDTH,
  });

  return titleHeight + 6 + 22 + firstRowHeight + 1;
}

function renderSectionHeader(doc, section, { isContinuation = false } = {}) {
  const sectionTitle = asText(section?.title) || "Seccion";
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.brand)
    .text(isContinuation ? `${sectionTitle} (cont.)` : sectionTitle, {
      width: PAGE_WIDTH,
    });
  doc.moveDown(0.3);

  return drawTableHeader(doc, doc.y);
}

function drawSectionTable(doc, section, currencyCode) {
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  const columns = [32, 72, 214, 48, 79, 83];
  const sectionTitle = asText(section?.title) || "Seccion";
  const firstMeasuredRow = rows[0]
    ? measureSectionRow(doc, rows[0], columns, currencyCode)
    : null;
  const openingHeight = getSectionOpeningHeight(
    doc,
    sectionTitle,
    firstMeasuredRow?.rowHeight || 0,
  );
  const tableX = doc.page.margins.left;

  ensureSpace(doc, openingHeight);
  renderSectionHeader(doc, section);

  for (const row of rows) {
    const { values, rowHeight } = measureSectionRow(
      doc,
      row,
      columns,
      currencyCode,
    );

    ensureSpace(doc, rowHeight + 1, () => {
      renderSectionHeader(doc, section, { isContinuation: true });
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
  ensureSpace(doc, 190);
  const topY = doc.y;
  const leftWidth = 300;
  const rightWidth = PAGE_WIDTH - leftWidth - 20;
  const leftX = doc.page.margins.left;
  const rightX = doc.page.margins.left + leftWidth + 20;
  const currencyCode = model.summary.currencyCode || "USD";
  const cardPaddingX = 14;
  const cardPaddingTop = 12;
  const cardPaddingBottom = 12;

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.brand)
    .text("Condiciones Comerciales", leftX + cardPaddingX, topY + cardPaddingTop, {
      width: leftWidth - cardPaddingX * 2,
    });

  const terms = [
    ["Tiempo de entrega", model.commercialTerms.deliveryTime],
    ["Validez", model.commercialTerms.quotationValidity],
    ["Garantia", model.commercialTerms.warranty],
    ["Forma de pago", model.commercialTerms.paymentTerms],
    ["Moneda", model.commercialTerms.currency],
  ];

  let currentY = drawCardRows(doc, terms, {
    x: leftX,
    y: topY + cardPaddingTop + 22,
    width: leftWidth,
    paddingX: cardPaddingX,
  });

  const termsBottomY = currentY + cardPaddingBottom;
  drawOutlinedCard(doc, leftX, topY, leftWidth, termsBottomY - topY);

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.brand)
    .text("Resumen", rightX + cardPaddingX, topY + cardPaddingTop, {
      width: rightWidth - cardPaddingX * 2,
      align: "right",
    });

  const summaryRows = [["Subtotal", model.summary.subtotal]];
  if (hasVisibleAmount(model.summary.discount)) {
    summaryRows.push(["Descuento", model.summary.discount]);
    summaryRows.push([
      "Subtotal con descuento",
      model.summary.discountedSubtotal,
    ]);
  }
  if (model.summary.showVat) {
    summaryRows.push(["IVA", model.summary.vatAmount]);
  }
  summaryRows.push([
    hasVatInSummary(model.summary) ? "Total con IVA" : "Total",
    model.summary.total,
  ]);

  currentY = topY + cardPaddingTop + 22;
  summaryRows.forEach(([label, amount], index) => {
    const isTotal = label === "Total";
    const contentWidth = rightWidth - cardPaddingX * 2;
    const labelWidth = contentWidth / 2;
    const rowFont = isTotal ? "Helvetica-Bold" : "Helvetica";
    const rowFontSize = isTotal ? 11 : 10;
    const formattedAmount = formatCurrency(amount, currencyCode);
    const amountHeight = measureTextHeight(doc, formattedAmount, {
      width: contentWidth,
      font: rowFont,
      fontSize: rowFontSize,
      align: "right",
    });
    const rowHeight = Math.max(
      isTotal ? 22 : 18,
      measureTextHeight(doc, label, {
        width: labelWidth,
        font: rowFont,
        fontSize: rowFontSize,
      }),
      amountHeight,
    ) + CARD_ROW_TEXT_PADDING;
    const amountY = currentY + Math.max(0, (rowHeight - amountHeight) / 2);

    if (index > 0) {
      doc
        .save()
        .moveTo(rightX + cardPaddingX, currentY - 4)
        .lineTo(rightX + rightWidth - cardPaddingX, currentY - 4)
        .lineWidth(1)
        .strokeColor("#e3ebf4")
        .stroke()
        .restore();
    }
    doc
      .font(rowFont)
      .fontSize(rowFontSize)
      .fillColor(isTotal ? COLORS.brand : COLORS.text)
      .text(label, rightX + cardPaddingX, currentY, {
        width: labelWidth,
        align: "left",
      });
    doc
      .font(rowFont)
      .fontSize(rowFontSize)
      .fillColor(isTotal ? COLORS.brand : COLORS.text)
      .text(formattedAmount, rightX + cardPaddingX, amountY, {
        width: contentWidth,
        align: "right",
      });
    currentY += rowHeight;
  });

  const summaryBottomY = currentY + cardPaddingBottom;
  drawOutlinedCard(doc, rightX, topY, rightWidth, summaryBottomY - topY);

  doc.y = Math.max(termsBottomY, summaryBottomY);
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
    company: {
      logoUrl: asText(input?.company?.logoUrl),
      legalName: asText(input?.company?.legalName),
      taxId: asText(input?.company?.taxId),
      addressLines: asLines(input?.company?.addressLines),
      email: asText(input?.company?.email),
      phone: asText(input?.company?.phone),
    },
    header: {
      quotationNumber: asText(input?.header?.quotationNumber),
      versionNumber: asText(input?.header?.versionNumber),
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
      vatMode:
        input?.summary?.vatMode === "total" || input?.summary?.vatMode === "per_item"
          ? input.summary.vatMode
          : "without_vat",
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
  drawOutlinedParagraphCard(doc, "Notas", model.notes);
  drawPageNumbers(doc);
  doc.end();

  return {
    buffer: await bufferPromise,
    fileName: `${formatFilenamePart(model.header.proposalName)}.pdf`,
  };
}
