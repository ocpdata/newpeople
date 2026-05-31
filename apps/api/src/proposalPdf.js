import { existsSync, readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { PDFDocument as PDFLibDocument } from "pdf-lib";
import SVGtoPDF from "svg-to-pdfkit";
import { drawQuotationPdfContent } from "./quotationPdf.js";

const PAGE_MARGIN = 42;
const PAGE_WIDTH = 612 - PAGE_MARGIN * 2;
const COLORS = {
  corporate: {
    banner: "#173259",
    bannerAlt: "#204f7f",
    highlight: "#1d7b6b",
    accent: "#1f6fca",
    muted: "#5d6a72",
    border: "#d6e0ec",
    surface: "#f6faff",
    surfaceAlt: "#ecf4ff",
    text: "#1d2730",
  },
  premium: {
    banner: "#7b531d",
    bannerAlt: "#a06c28",
    highlight: "#d2a05b",
    accent: "#b27a2e",
    muted: "#6d624e",
    border: "#e3d6c1",
    surface: "#fff8ef",
    surfaceAlt: "#fff1dc",
    text: "#31251a",
  },
  technical: {
    banner: "#0f4d54",
    bannerAlt: "#18656e",
    highlight: "#2e8f8a",
    accent: "#1f7e89",
    muted: "#4f6c70",
    border: "#cfe2e4",
    surface: "#f2fbfb",
    surfaceAlt: "#e9f7f7",
    text: "#173338",
  },
};

const SECTION_PADDING_X = 22;
const SECTION_CONTENT_WIDTH = PAGE_WIDTH - SECTION_PADDING_X * 2;
const PDF_PAGE_HEIGHT = 792;

function asText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function asNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getProposalTemplateContext(model) {
  const companyName =
    asText(model?.company?.commercialName) ||
    asText(model?.company?.legalName) ||
    "nuestra empresa";

  return {
    client_name: asText(model?.header?.accountName) || "cliente",
    contact_name: asText(model?.header?.contactName) || "contacto",
    company_name: companyName,
  };
}

function resolveProposalTemplateText(text, context) {
  return asText(text).replace(
    /\{\{\s*(client_name|contact_name|company_name)\s*\}\}/g,
    (match, token) => context[token] || match,
  );
}

function resolveProposalTemplateBlock(block, section, context) {
  if (block.type === "list") {
    return {
      ...block,
      items: Array.isArray(block.items)
        ? block.items.map((item) => resolveProposalTemplateText(item, context))
        : [],
    };
  }

  if (block.type === "heading" || block.type === "paragraph") {
    return {
      ...block,
      text: resolveProposalTemplateText(block.text, context),
    };
  }

  return block;
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

function formatCurrency(value, currencyCode = "USD") {
  const safeCurrency = asText(currencyCode) || "USD";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value));
}

function formatFilenamePart(value, fallback = "propuesta") {
  const slug = asText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug || fallback;
}

function formatDisplayDate(value) {
  const safeValue = asText(value);
  if (!safeValue) {
    return "-";
  }

  const nativeDate = new Date(safeValue);
  if (!Number.isNaN(nativeDate.getTime())) {
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(nativeDate);
  }

  const compactDateMatch = safeValue.match(/^(\d{1,2}\s+[\p{L}.]+\s+\d{4})/iu);
  if (compactDateMatch) {
    return compactDateMatch[1];
  }

  const numericDateMatch = safeValue.match(/^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/);
  if (numericDateMatch) {
    return numericDateMatch[1];
  }

  return safeValue.split(",")[0].trim() || safeValue;
}

function decodeDataUrl(value) {
  const safeValue = asText(value);
  const separatorIndex = safeValue.indexOf(",");
  if (!safeValue.startsWith("data:") || separatorIndex <= 5) {
    return null;
  }

  const meta = safeValue.slice(5, separatorIndex);
  const payload = safeValue.slice(separatorIndex + 1);
  const [mimeType = "", ...flags] = meta.split(";");
  const isBase64 = flags.includes("base64");

  try {
    return {
      mimeType,
      content: isBase64
        ? Buffer.from(payload, "base64")
        : Buffer.from(decodeURIComponent(payload), "utf8"),
    };
  } catch {
    return null;
  }
}

async function resolveImageSource(value) {
  const safeValue = asText(value);
  if (!safeValue) return null;

  if (safeValue.startsWith("data:image/")) {
    const decoded = decodeDataUrl(safeValue);
    if (!decoded) return null;

    if (decoded.mimeType === "image/svg+xml") {
      return {
        kind: "svg",
        value: decoded.content.toString("utf8"),
      };
    }

    return {
      kind: "image",
      value: decoded.content,
    };
  }

  if (existsSync(safeValue)) {
    if (safeValue.toLowerCase().endsWith(".svg")) {
      try {
        return {
          kind: "svg",
          value: readFileSync(safeValue, "utf8"),
        };
      } catch {
        return null;
      }
    }

    return {
      kind: "image",
      value: safeValue,
    };
  }

  if (/^https?:\/\//i.test(safeValue) && typeof fetch === "function") {
    try {
      const response = await fetch(safeValue, { method: "GET" });
      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get("content-type") || "";
      const buffer = Buffer.from(await response.arrayBuffer());
      if (contentType.includes("image/svg+xml")) {
        return {
          kind: "svg",
          value: buffer.toString("utf8"),
        };
      }

      return {
        kind: "image",
        value: buffer,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function bufferPdfDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function createDocument(title) {
  return new PDFDocument({
    size: "LETTER",
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: asText(title) || "Propuesta",
      Author: "NewPeople CRM",
      Subject: "Propuesta comercial",
      Creator: "NewPeople API",
    },
  });
}

function measureTextHeight(doc, text, { width, font, fontSize, lineGap = 0 }) {
  return doc
    .font(font)
    .fontSize(fontSize)
    .heightOfString(asText(text) || "", { width, lineGap });
}

function fitTextToBox(
  doc,
  text,
  {
    width,
    height,
    font,
    maxFontSize,
    minFontSize,
    lineGap = 0,
    ellipsis = "...",
  },
) {
  const safeText = asText(text);
  if (!safeText) {
    return {
      text: "",
      fontSize: maxFontSize,
      lineGap,
    };
  }

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const measuredHeight = measureTextHeight(doc, safeText, {
      width,
      font,
      fontSize,
      lineGap,
    });

    if (measuredHeight <= height) {
      return {
        text: safeText,
        fontSize,
        lineGap,
      };
    }
  }

  const fontSize = minFontSize;
  const words = safeText.split(/\s+/).filter(Boolean);
  let candidate = safeText;

  while (words.length > 1) {
    words.pop();
    candidate = `${words.join(" ")}${ellipsis}`;
    const measuredHeight = measureTextHeight(doc, candidate, {
      width,
      font,
      fontSize,
      lineGap,
    });
    if (measuredHeight <= height) {
      return {
        text: candidate,
        fontSize,
        lineGap,
      };
    }
  }

  let compact = safeText;
  while (compact.length > 1) {
    compact = `${compact.slice(0, -1).trim()}${ellipsis}`;
    const measuredHeight = measureTextHeight(doc, compact, {
      width,
      font,
      fontSize,
      lineGap,
    });
    if (measuredHeight <= height) {
      return {
        text: compact,
        fontSize,
        lineGap,
      };
    }
  }

  return {
    text: ellipsis,
    fontSize,
    lineGap,
  };
}

function ensureSpace(doc, heightNeeded) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + heightNeeded <= bottomLimit) {
    return;
  }
  doc.addPage();
}

function drawRoundedCard(doc, x, y, width, height, borderColor, fillColor) {
  doc.save();
  doc.roundedRect(x, y, width, height, 10);
  if (fillColor) {
    if (borderColor) {
      doc.fillAndStroke(fillColor, borderColor);
    } else {
      doc.fillColor(fillColor).fill();
    }
  } else {
    doc.lineWidth(1).strokeColor(borderColor).stroke();
  }
  doc.restore();
}

function drawFilledCircle(doc, x, y, radius, fillColor, opacity = 1) {
  doc.save();
  doc.fillOpacity(opacity).circle(x, y, radius).fill(fillColor).restore();
}

function drawPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const footerY = doc.page.height - doc.page.margins.bottom - 12;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#7c8a96")
      .text(`Pagina ${index + 1} de ${range.count}`, PAGE_MARGIN, footerY, {
        width: PAGE_WIDTH,
        align: "right",
        lineBreak: false,
      });
  }
}

function normalizeModel(input) {
  const palette = COLORS[input?.theme?.coverStyle] || COLORS.corporate;
  const templateContext = getProposalTemplateContext({
    company: {
      commercialName: input?.company?.commercialName,
      legalName: input?.company?.legalName,
    },
    header: {
      accountName: input?.header?.accountName,
      contactName: input?.header?.contactName,
    },
  });

  return {
    company: {
      logoUrl: asText(input?.company?.logoUrl),
      legalName: asText(input?.company?.legalName),
      commercialName: asText(input?.company?.commercialName),
      addressLines: asLines(input?.company?.addressLines),
      email: asText(input?.company?.email),
      phone: asText(input?.company?.phone),
    },
    header: {
      proposalTitle: asText(input?.header?.proposalTitle),
      accountName: asText(input?.header?.accountName),
      contactName: asText(input?.header?.contactName),
      quotationNumber: asText(input?.header?.quotationNumber),
      quotationVersionNumber: asText(input?.header?.quotationVersionNumber),
      updatedAtLabel: asText(input?.header?.updatedAtLabel),
      statusLabel: asText(input?.header?.statusLabel),
      templateName: asText(input?.header?.templateName),
    },
    theme: {
      coverStyle: asText(input?.theme?.coverStyle) || "corporate",
      palette,
    },
    sections: Array.isArray(input?.sections)
      ? input.sections.map((section) => ({
          title: asText(section?.title),
          subtitle: asText(section?.subtitle),
          layout: asText(section?.layout) || "",
          layoutConfig: {
            mode: asText(section?.layoutConfig?.mode),
            rows: Array.isArray(section?.layoutConfig?.rows)
              ? section.layoutConfig.rows
                  .map((row) => ({
                    blockIndexes: Array.isArray(row?.blockIndexes)
                      ? row.blockIndexes
                          .map((index) => Number(index))
                          .filter(
                            (index) => Number.isInteger(index) && index >= 0,
                          )
                      : [],
                  }))
                  .filter((row) => row.blockIndexes.length > 0)
              : [],
          },
          blocks: Array.isArray(section?.blocks)
            ? section.blocks.map((block) =>
                resolveProposalTemplateBlock(
                  {
                    type: asText(block?.type),
                    text: asText(block?.text),
                    items: Array.isArray(block?.items)
                      ? block.items.map((item) => asText(item)).filter(Boolean)
                      : [],
                    assetPublicId: asText(block?.assetPublicId),
                    brochure: block?.brochure
                      ? {
                          publicId: asText(block.brochure.publicId),
                          title: asText(block.brochure.title),
                          summary: asText(block.brochure.summary),
                          assetTypeCode: asText(block.brochure.assetTypeCode),
                          assetTypeLabel: asText(block.brochure.assetTypeLabel),
                          visibilityLabel: asText(
                            block.brochure.visibilityLabel,
                          ),
                          files: Array.isArray(block?.brochure?.files)
                            ? block.brochure.files.map((file) => ({
                                fileName: asText(file?.fileName),
                                fileUrl:
                                  asText(file?.fileUrl) ||
                                  asText(file?.publicUrl) ||
                                  asText(file?.downloadUrl),
                              }))
                            : [],
                          links: Array.isArray(block?.brochure?.links)
                            ? block.brochure.links.map((link) => ({
                                label: asText(link?.label),
                                url: asText(link?.url),
                              }))
                            : [],
                        }
                      : null,
                    image: block?.image
                      ? {
                          fileUrl: asText(block.image.fileUrl),
                          altText: asText(block.image.altText),
                          caption: asText(block.image.caption),
                          fileName: asText(block.image.fileName),
                        }
                      : null,
                  },
                  section,
                  templateContext,
                ),
              )
            : [],
        }))
      : [],
    pricing: {
      summary: {
        subtotal: asNumber(input?.pricing?.summary?.subtotal),
        total: asNumber(input?.pricing?.summary?.total),
        currencyCode: asText(input?.pricing?.summary?.currencyCode) || "USD",
      },
      sections: Array.isArray(input?.pricing?.sections)
        ? input.pricing.sections.map((section) => ({
            title: asText(section?.title),
            items: Array.isArray(section?.items)
              ? section.items.map((item) => ({
                  productCode: asText(item?.productCode),
                  productDescription: asText(item?.productDescription),
                  quantity: asNumber(item?.quantity),
                  salePriceTotal: asNumber(item?.salePriceTotal),
                }))
              : [],
          }))
        : [],
    },
    quotationAttachment: input?.quotationAttachment
      ? {
          company: {
            logoUrl: asText(input.quotationAttachment?.company?.logoUrl),
            legalName: asText(input.quotationAttachment?.company?.legalName),
            addressLines: asLines(
              input.quotationAttachment?.company?.addressLines,
            ),
            email: asText(input.quotationAttachment?.company?.email),
            phone: asText(input.quotationAttachment?.company?.phone),
          },
          header: {
            quotationNumber: asText(
              input.quotationAttachment?.header?.quotationNumber,
            ),
            versionNumber: asText(
              input.quotationAttachment?.header?.versionNumber,
            ),
            quotationDate: asText(
              input.quotationAttachment?.header?.quotationDate,
            ),
            proposalName: asText(
              input.quotationAttachment?.header?.proposalName,
            ),
            accountName: asText(input.quotationAttachment?.header?.accountName),
            contactName: asText(input.quotationAttachment?.header?.contactName),
            contactEmail: asText(
              input.quotationAttachment?.header?.contactEmail,
            ),
            contactPhone: asText(
              input.quotationAttachment?.header?.contactPhone,
            ),
            sellerName: asText(input.quotationAttachment?.header?.sellerName),
            sellerEmail: asText(input.quotationAttachment?.header?.sellerEmail),
            sellerPhone: asText(input.quotationAttachment?.header?.sellerPhone),
          },
          introduction: asText(input.quotationAttachment?.introduction),
          sections: Array.isArray(input.quotationAttachment?.sections)
            ? input.quotationAttachment.sections.map((section) => ({
                title: asText(section?.title),
                subtotal: asNumber(section?.subtotal),
                rows: Array.isArray(section?.rows)
                  ? section.rows.map((row) => ({
                      displayOrder:
                        row?.displayOrder == null
                          ? null
                          : asNumber(row.displayOrder),
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
            subtotal: asNumber(input.quotationAttachment?.summary?.subtotal),
            discount: asNumber(input.quotationAttachment?.summary?.discount),
            discountedSubtotal: asNumber(
              input.quotationAttachment?.summary?.discountedSubtotal,
            ),
            vatAmount: asNumber(input.quotationAttachment?.summary?.vatAmount),
            total: asNumber(input.quotationAttachment?.summary?.total),
            showVat: Boolean(input.quotationAttachment?.summary?.showVat),
            vatMode: asText(input.quotationAttachment?.summary?.vatMode),
            currencyCode:
              asText(input.quotationAttachment?.summary?.currencyCode) || "USD",
          },
          commercialTerms: {
            deliveryTime: asText(
              input.quotationAttachment?.commercialTerms?.deliveryTime,
            ),
            quotationValidity: asText(
              input.quotationAttachment?.commercialTerms?.quotationValidity,
            ),
            warranty: asText(
              input.quotationAttachment?.commercialTerms?.warranty,
            ),
            paymentTerms: asText(
              input.quotationAttachment?.commercialTerms?.paymentTerms,
            ),
            currency: asText(
              input.quotationAttachment?.commercialTerms?.currency,
            ),
          },
          notes: asText(input.quotationAttachment?.notes),
        }
      : null,
  };
}

function drawProposalQuotationAttachmentSeparator(doc, model) {
  doc.addPage();

  doc
    .font("Helvetica-Bold")
    .fontSize(24)
    .fillColor(model.theme.palette.banner)
    .text("Anexo: cotizacion heredada", PAGE_MARGIN, 96, {
      width: PAGE_WIDTH,
    });

  doc
    .font("Helvetica")
    .fontSize(12)
    .fillColor(model.theme.palette.muted)
    .text(
      `Cotizacion #${model.header.quotationNumber || "-"} · v${model.header.quotationVersionNumber || "-"}`,
      PAGE_MARGIN,
      136,
      { width: PAGE_WIDTH },
    )
    .moveDown(0.4)
    .text(
      "Este anexo conserva la cotizacion base heredada utilizada como respaldo economico de la propuesta.",
      PAGE_MARGIN,
      doc.y,
      { width: PAGE_WIDTH, lineGap: 4 },
    );

  doc.y += 22;
}

async function drawProposalQuotationAttachment(doc, model) {
  if (!model.quotationAttachment) {
    return;
  }

  drawProposalQuotationAttachmentSeparator(doc, model);
  await drawQuotationPdfContent(doc, model.quotationAttachment);
}

async function appendBrochureAttachmentsToBuffer(
  baseBuffer,
  brochureAttachments,
) {
  if (!Array.isArray(brochureAttachments) || brochureAttachments.length === 0) {
    return baseBuffer;
  }

  const output = await PDFLibDocument.load(baseBuffer);

  for (const attachment of brochureAttachments) {
    if (!attachment?.buffer?.length) {
      continue;
    }

    const mimeType = asText(attachment.mimeType).toLowerCase();
    const fileName = asText(attachment.fileName) || "folleto";

    if (
      mimeType === "application/pdf" ||
      fileName.toLowerCase().endsWith(".pdf")
    ) {
      const attachmentPdf = await PDFLibDocument.load(attachment.buffer, {
        ignoreEncryption: true,
      });
      const copiedPages = await output.copyPages(
        attachmentPdf,
        attachmentPdf.getPageIndices(),
      );
      copiedPages.forEach((page) => output.addPage(page));
      continue;
    }

    if (
      mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/jpg"
    ) {
      const page = output.addPage([612, PDF_PAGE_HEIGHT]);
      const image =
        mimeType === "image/png"
          ? await output.embedPng(attachment.buffer)
          : await output.embedJpg(attachment.buffer);
      const maxWidth = 612 - PAGE_MARGIN * 2;
      const maxHeight = PDF_PAGE_HEIGHT - 180;
      const scale = Math.min(
        maxWidth / image.width,
        maxHeight / image.height,
        1,
      );
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, {
        x: PAGE_MARGIN + (maxWidth - width) / 2,
        y: PAGE_MARGIN + (maxHeight - height) / 2,
        width,
        height,
      });
    }
  }

  return Buffer.from(await output.save());
}

async function drawCompanyHeader(doc, model) {
  const logoSource = await resolveImageSource(model.company.logoUrl);
  const startY = doc.y;
  const logoSize = 48;
  const textX = logoSource ? PAGE_MARGIN + logoSize + 12 : PAGE_MARGIN;

  if (logoSource) {
    try {
      if (logoSource.kind === "svg") {
        SVGtoPDF(doc, logoSource.value, PAGE_MARGIN, startY, {
          width: logoSize,
          height: logoSize,
          preserveAspectRatio: "xMinYMin meet",
        });
      } else {
        doc.image(logoSource.value, PAGE_MARGIN, startY, {
          fit: [logoSize, logoSize],
          align: "left",
          valign: "top",
        });
      }
    } catch {
      // Ignore logo rendering failures.
    }
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(model.theme.palette.text)
    .text(model.company.legalName || "NewPeople", textX, startY, {
      width: PAGE_WIDTH - (textX - PAGE_MARGIN),
    });

  const metaLines = [
    ...model.company.addressLines,
    model.company.email,
    model.company.phone,
  ].filter(Boolean);

  if (metaLines.length) {
    doc
      .moveDown(0.2)
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(model.theme.palette.muted)
      .text(metaLines.join(" • "), textX, doc.y, {
        width: PAGE_WIDTH - (textX - PAGE_MARGIN),
      });
  }

  doc.y = Math.max(doc.y, startY + logoSize);
  doc.moveDown(0.8);
}

function drawCover(doc, model) {
  const bannerHeight = 176;
  const y = doc.y;
  const { palette } = model.theme;
  const titleWidth = PAGE_WIDTH - 220;
  const titleTop = y + 64;
  const titleHeight = 96;
  const coverTitle = fitTextToBox(
    doc,
    model.header.proposalTitle || "Propuesta sin titulo",
    {
      width: titleWidth,
      height: titleHeight,
      font: "Times-Bold",
      maxFontSize: 28,
      minFontSize: 18,
      lineGap: 2,
    },
  );

  drawRoundedCard(
    doc,
    PAGE_MARGIN,
    y,
    PAGE_WIDTH,
    bannerHeight,
    palette.banner,
    palette.banner,
  );
  doc
    .save()
    .fillOpacity(0.9)
    .roundedRect(
      PAGE_MARGIN + PAGE_WIDTH * 0.42,
      y,
      PAGE_WIDTH * 0.58,
      bannerHeight,
      22,
    )
    .fill(palette.bannerAlt)
    .restore();
  drawFilledCircle(
    doc,
    PAGE_MARGIN + PAGE_WIDTH - 40,
    y + 24,
    72,
    "#ffffff",
    0.08,
  );
  drawFilledCircle(
    doc,
    PAGE_MARGIN + PAGE_WIDTH - 10,
    y + 18,
    34,
    palette.highlight,
    0.2,
  );
  drawFilledCircle(
    doc,
    PAGE_MARGIN + PAGE_WIDTH - 90,
    y + bannerHeight - 18,
    56,
    "#ffffff",
    0.06,
  );

  doc
    .save()
    .fillOpacity(0.12)
    .roundedRect(PAGE_MARGIN + PAGE_WIDTH - 190, y + 18, 160, 136, 18)
    .fill("#ffffff")
    .restore();

  doc
    .fillColor("#f8fbff")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Propuesta comercial", PAGE_MARGIN + 22, y + 46, {
      width: PAGE_WIDTH - 44,
    });

  doc
    .font("Times-Bold")
    .fontSize(coverTitle.fontSize)
    .text(coverTitle.text, PAGE_MARGIN + 22, titleTop, {
      width: titleWidth,
      height: titleHeight,
      lineGap: coverTitle.lineGap,
    });

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("rgba(255,255,255,0.82)")
    .text("Fecha", PAGE_MARGIN + PAGE_WIDTH - 170, y + 78, {
      width: 130,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#ffffff")
    .text(
      formatDisplayDate(model.header.updatedAtLabel),
      PAGE_MARGIN + PAGE_WIDTH - 170,
      y + 90,
      {
        width: 130,
      },
    );

  doc.y = y + bannerHeight + 18;
}

function drawMetadataCards(doc, model) {
  const { palette } = model.theme;
  const y = doc.y;
  const gap = 12;
  const cardHeight = 64;
  const cards = [
    ["Cuenta", model.header.accountName || "Sin cuenta asociada"],
    ["Contacto", model.header.contactName || "Sin contacto asignado"],
  ];
  const cardWidth = (PAGE_WIDTH - gap * (cards.length - 1)) / cards.length;

  cards.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + index * (cardWidth + gap);
    drawRoundedCard(
      doc,
      x,
      y,
      cardWidth,
      cardHeight,
      palette.border,
      palette.surface,
    );
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(palette.muted)
      .text(label, x + 12, y + 11, { width: cardWidth - 24 })
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(palette.text)
      .text(value, x + 12, y + 28, { width: cardWidth - 24 });
  });

  doc.y = y + cardHeight + 20;
}

function isCertificationsSection(section) {
  const explicitLayout = asText(
    section?.layoutConfig?.mode || section?.layout,
  ).toLowerCase();
  if (explicitLayout === "horizontal-gallery") {
    return true;
  }
  const title = asText(section?.title).toLowerCase();
  const subtitle = asText(section?.subtitle).toLowerCase();
  return title === "certificaciones" || subtitle === "certifications";
}

function normalizeSectionLayoutConfig(section) {
  const explicitMode = asText(
    section?.layoutConfig?.mode || section?.layout,
  ).toLowerCase();
  if (
    explicitMode === "stack" ||
    explicitMode === "horizontal-gallery" ||
    explicitMode === "manual-rows"
  ) {
    if (explicitMode !== "manual-rows") {
      return { mode: explicitMode };
    }

    const rows = Array.isArray(section?.layoutConfig?.rows)
      ? section.layoutConfig.rows.filter(
          (row) => Array.isArray(row?.blockIndexes) && row.blockIndexes.length,
        )
      : [];
    return rows.length ? { mode: explicitMode, rows } : { mode: explicitMode };
  }

  return {
    mode: isCertificationsSection(section) ? "horizontal-gallery" : "stack",
  };
}

function getSectionLayout(section) {
  return normalizeSectionLayoutConfig(section).mode;
}

function isGalleryCompatibleBlock(block) {
  return block?.type === "image" && Boolean(block?.image?.fileUrl);
}

function splitSectionBlocksForPdfLayout(section) {
  const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
  const layoutConfig = normalizeSectionLayoutConfig(section);

  if (layoutConfig.mode === "manual-rows") {
    const rowByStartIndex = new Map();
    const rowBlockIndexes = new Set();

    (layoutConfig.rows || []).forEach((row) => {
      const resolvedEntries = row.blockIndexes
        .map((blockIndex) => ({
          blockIndex,
          block: blocks[blockIndex],
        }))
        .filter(({ block }) => isGalleryCompatibleBlock(block));

      if (!resolvedEntries.length) {
        return;
      }

      rowByStartIndex.set(
        resolvedEntries[0].blockIndex,
        resolvedEntries.map((entry) => entry.block),
      );
      resolvedEntries.forEach((entry) => rowBlockIndexes.add(entry.blockIndex));
    });

    return blocks.reduce((segments, block, blockIndex) => {
      if (rowByStartIndex.has(blockIndex)) {
        segments.push({
          type: "gallery",
          blocks: rowByStartIndex.get(blockIndex),
          forceSingleRow: true,
        });
        return segments;
      }

      if (rowBlockIndexes.has(blockIndex)) {
        return segments;
      }

      segments.push({ type: "block", block });
      return segments;
    }, []);
  }

  if (layoutConfig.mode !== "horizontal-gallery") {
    return blocks.map((block) => ({ type: "block", block }));
  }

  const leadingBlocks = [];
  const galleryBlocks = [];
  const trailingBlocks = [];
  let seenGallery = false;

  for (const block of blocks) {
    if (isGalleryCompatibleBlock(block)) {
      seenGallery = true;
      galleryBlocks.push(block);
      continue;
    }

    if (seenGallery) {
      trailingBlocks.push(block);
    } else {
      leadingBlocks.push(block);
    }
  }

  return [
    ...leadingBlocks.map((block) => ({ type: "block", block })),
    ...(galleryBlocks.length
      ? [{ type: "gallery", blocks: galleryBlocks, forceSingleRow: false }]
      : []),
    ...trailingBlocks.map((block) => ({ type: "block", block })),
  ];
}

function getGalleryPdfMetrics() {
  return {
    itemsPerRow: 4,
    rowGap: 12,
    cellGap: 12,
    cellPadding: 8,
    imageHeight: 56,
    captionGap: 6,
    captionFontSize: 9.5,
    captionLineGap: 2,
  };
}

function chunkGalleryBlocks(blocks, itemsPerRow) {
  const rows = [];
  for (let index = 0; index < blocks.length; index += itemsPerRow) {
    rows.push(blocks.slice(index, index + itemsPerRow));
  }

  if (rows.length > 1 && rows[rows.length - 1].length === 1) {
    const previousRow = rows[rows.length - 2];
    const lastItem = previousRow.pop();
    if (lastItem) {
      rows[rows.length - 1].unshift(lastItem);
    }
  }

  return rows;
}

function measureGalleryCaptionHeight(doc, caption, cellWidth, metrics) {
  if (!caption) {
    return 0;
  }

  return measureTextHeight(doc, caption, {
    width: cellWidth,
    font: "Helvetica",
    fontSize: metrics.captionFontSize,
    lineGap: metrics.captionLineGap,
    align: "center",
  });
}

function getGalleryImageFrameHeight(metrics) {
  return metrics.imageHeight + metrics.cellPadding * 2;
}

function estimateBlocksHeight(doc, blocks, section) {
  return (blocks || []).reduce(
    (total, block) => total + estimateBlockHeight(doc, block, section),
    0,
  );
}

function estimateGalleryRowHeight(doc, rowBlocks, section) {
  const metrics = getGalleryPdfMetrics(section);
  const cellWidth =
    (SECTION_CONTENT_WIDTH - metrics.cellGap * (rowBlocks.length - 1)) /
    rowBlocks.length;
  const maxCaptionHeight = rowBlocks.reduce((maxHeight, block) => {
    const caption = block.image?.caption || "";
    return Math.max(
      maxHeight,
      measureGalleryCaptionHeight(doc, caption, cellWidth, metrics),
    );
  }, 0);

  return (
    getGalleryImageFrameHeight(metrics) +
    (maxCaptionHeight ? metrics.captionGap + maxCaptionHeight : 0)
  );
}

function estimateGalleryBlocksHeight(
  doc,
  blocks,
  section,
  forceSingleRow = false,
) {
  if (!blocks.length) {
    return 0;
  }

  if (forceSingleRow) {
    return estimateGalleryRowHeight(doc, blocks, section);
  }

  const metrics = getGalleryPdfMetrics(section);
  const rows = chunkGalleryBlocks(blocks, metrics.itemsPerRow);
  return rows.reduce((total, rowBlocks, rowIndex) => {
    return (
      total +
      estimateGalleryRowHeight(doc, rowBlocks, section) +
      (rowIndex < rows.length - 1 ? metrics.rowGap : 0)
    );
  }, 0);
}

function getSectionImageFigureHeight(section) {
  if (isCertificationsSection(section)) {
    return Math.round(250 / 4);
  }

  return 250;
}

function estimateBlockHeight(doc, block, section) {
  if (block.type === "heading") {
    return (
      measureTextHeight(doc, block.text, {
        width: SECTION_CONTENT_WIDTH,
        font: "Helvetica-Bold",
        fontSize: 13,
      }) + 12
    );
  }

  if (block.type === "paragraph") {
    return (
      measureTextHeight(doc, block.text, {
        width: SECTION_CONTENT_WIDTH,
        font: "Times-Roman",
        fontSize: 12,
        lineGap: 4,
      }) + 14
    );
  }

  if (block.type === "list") {
    return block.items.reduce(
      (total, item) =>
        total +
        measureTextHeight(doc, `• ${item}`, {
          width: SECTION_CONTENT_WIDTH - 6,
          font: "Times-Roman",
          fontSize: 11.5,
          lineGap: 3,
        }) +
        6,
      10,
    );
  }

  if (block.type === "image" && block.image?.fileUrl) {
    return getSectionImageFigureHeight(section) + 48;
  }

  return 0;
}

function estimateSectionHeight(doc, section) {
  const headerHeight = 48;
  const segments = splitSectionBlocksForPdfLayout(section);
  const contentHeight = segments.reduce((total, segment) => {
    if (segment.type === "gallery") {
      return (
        total +
        estimateGalleryBlocksHeight(
          doc,
          segment.blocks,
          section,
          segment.forceSingleRow,
        )
      );
    }

    return total + estimateBlockHeight(doc, segment.block, section);
  }, 0);

  return headerHeight + contentHeight + 26;
}

async function drawBlock(doc, block, model, section) {
  const { palette } = model.theme;
  const contentX = PAGE_MARGIN + SECTION_PADDING_X;

  if (block.type === "heading") {
    ensureSpace(doc, 26);
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(palette.text)
      .text(block.text, contentX, doc.y, { width: SECTION_CONTENT_WIDTH });
    doc.moveDown(0.35);
    return;
  }

  if (block.type === "paragraph") {
    ensureSpace(doc, 42);
    doc
      .font("Times-Roman")
      .fontSize(12)
      .fillColor(palette.text)
      .text(block.text, contentX, doc.y, {
        width: SECTION_CONTENT_WIDTH,
        lineGap: 4,
      });
    doc.moveDown(0.5);
    return;
  }

  if (block.type === "list") {
    for (const item of block.items) {
      ensureSpace(doc, 20);
      doc
        .font("Times-Roman")
        .fontSize(11.5)
        .fillColor(palette.text)
        .text(`• ${item}`, contentX + 4, doc.y, {
          width: SECTION_CONTENT_WIDTH - 4,
          lineGap: 3,
        });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.25);
    return;
  }

  if (block.type === "image" && block.image?.fileUrl) {
    const imageSource = await resolveImageSource(block.image.fileUrl);
    if (!imageSource) {
      return;
    }

    const figureHeight = getSectionImageFigureHeight(section);
    ensureSpace(doc, figureHeight + 28);
    const y = doc.y;
    drawRoundedCard(
      doc,
      contentX,
      y,
      SECTION_CONTENT_WIDTH,
      figureHeight,
      palette.border,
      palette.surfaceAlt,
    );
    try {
      if (imageSource.kind === "svg") {
        SVGtoPDF(doc, imageSource.value, contentX + 10, y + 10, {
          width: SECTION_CONTENT_WIDTH - 20,
          height: figureHeight - 20,
          preserveAspectRatio: "xMidYMid meet",
        });
      } else {
        doc.image(imageSource.value, contentX + 10, y + 10, {
          fit: [SECTION_CONTENT_WIDTH - 20, figureHeight - 20],
          align: "center",
          valign: "center",
        });
      }
      doc.y = y + figureHeight + 6;
      const caption = block.image.caption || "";
      if (caption) {
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor(palette.muted)
          .text(caption, contentX, doc.y, {
            width: SECTION_CONTENT_WIDTH,
            align: "center",
          });
        doc.moveDown(0.4);
      }
    } catch {
      doc.y = y;
    }

    return;
  }
}

async function drawBlocksStack(doc, blocks, model, section) {
  for (const block of blocks) {
    await drawBlock(doc, block, model, section);
  }
}

async function drawGalleryItem(doc, block, x, y, cellWidth, model) {
  const { palette } = model.theme;
  const metrics = getGalleryPdfMetrics();
  const imageSource = await resolveImageSource(block.image.fileUrl);
  if (!imageSource) {
    return;
  }

  const frameHeight = getGalleryImageFrameHeight(metrics);
  drawRoundedCard(
    doc,
    x,
    y,
    cellWidth,
    frameHeight,
    palette.border,
    palette.surfaceAlt,
  );

  try {
    if (imageSource.kind === "svg") {
      SVGtoPDF(
        doc,
        imageSource.value,
        x + metrics.cellPadding,
        y + metrics.cellPadding,
        {
          width: cellWidth - metrics.cellPadding * 2,
          height: metrics.imageHeight,
          preserveAspectRatio: "xMidYMid meet",
        },
      );
    } else {
      doc.image(
        imageSource.value,
        x + metrics.cellPadding,
        y + metrics.cellPadding,
        {
          fit: [cellWidth - metrics.cellPadding * 2, metrics.imageHeight],
          align: "center",
          valign: "center",
        },
      );
    }

    const caption = block.image.caption || "";
    if (caption) {
      doc
        .font("Helvetica")
        .fontSize(metrics.captionFontSize)
        .fillColor(palette.muted)
        .text(caption, x, y + frameHeight + metrics.captionGap, {
          width: cellWidth,
          align: "center",
          lineGap: metrics.captionLineGap,
        });
    }
  } catch {
    return;
  }
}

async function drawGalleryRow(doc, rowBlocks, section, model) {
  const metrics = getGalleryPdfMetrics(section);
  const rowHeight = estimateGalleryRowHeight(doc, rowBlocks, section);
  ensureSpace(doc, rowHeight);

  const startY = doc.y;
  const startX = PAGE_MARGIN + SECTION_PADDING_X;
  const cellWidth =
    (SECTION_CONTENT_WIDTH - metrics.cellGap * (rowBlocks.length - 1)) /
    rowBlocks.length;

  for (let index = 0; index < rowBlocks.length; index += 1) {
    const x = startX + index * (cellWidth + metrics.cellGap);
    await drawGalleryItem(doc, rowBlocks[index], x, startY, cellWidth, model);
  }

  doc.y = startY + rowHeight;
}

async function drawGalleryBlocks(
  doc,
  blocks,
  section,
  model,
  forceSingleRow = false,
) {
  if (!blocks.length) {
    return;
  }

  if (forceSingleRow) {
    await drawGalleryRow(doc, blocks, section, model);
    return;
  }

  const metrics = getGalleryPdfMetrics(section);
  const rows = chunkGalleryBlocks(blocks, metrics.itemsPerRow);
  for (let index = 0; index < rows.length; index += 1) {
    await drawGalleryRow(doc, rows[index], section, model);
    if (index < rows.length - 1) {
      doc.y += metrics.rowGap;
    }
  }
}

async function drawSectionByLayout(doc, section, model) {
  const segments = splitSectionBlocksForPdfLayout(section);

  for (const segment of segments) {
    if (segment.type === "gallery") {
      await drawGalleryBlocks(
        doc,
        segment.blocks,
        section,
        model,
        segment.forceSingleRow,
      );
      continue;
    }

    await drawBlock(doc, segment.block, model, section);
  }
}

async function drawSections(doc, model) {
  const { palette } = model.theme;
  for (const section of model.sections) {
    const sectionHeight = estimateSectionHeight(doc, section);
    ensureSpace(doc, sectionHeight);
    const sectionStartY = doc.y;

    drawRoundedCard(
      doc,
      PAGE_MARGIN,
      sectionStartY,
      PAGE_WIDTH,
      sectionHeight,
      null,
      "#ffffff",
    );

    doc
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor(palette.accent)
      .text(section.title, PAGE_MARGIN + 22, sectionStartY + 12, {
        width: PAGE_WIDTH - 44,
      });

    doc.y = sectionStartY + 48;
    await drawSectionByLayout(doc, section, model);
    doc.y += 12;
  }
}

export async function buildProposalPdfBuffer(input) {
  const model = normalizeModel(input);
  const doc = createDocument(model.header.proposalTitle || "Propuesta");
  const bufferPromise = bufferPdfDocument(doc);

  await drawCompanyHeader(doc, model);
  drawCover(doc, model);
  drawMetadataCards(doc, model);
  await drawSections(doc, model);
  await drawProposalQuotationAttachment(doc, model);
  drawPageNumbers(doc);
  doc.end();

  const baseBuffer = await bufferPromise;
  const mergedBuffer = await appendBrochureAttachmentsToBuffer(
    baseBuffer,
    input?.brochureAttachments,
  );

  return {
    buffer: mergedBuffer,
    fileName: `${formatFilenamePart(model.header.proposalTitle, "propuesta")}.pdf`,
  };
}
