import PDFDocument from "pdfkit";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { buildQuotationPdfBuffer, drawQuotationPdfContent } from "../src/quotationPdf.js";
import { buildProposalPdfBuffer } from "../src/proposalPdf.js";

const serials = (count, prefix = "SERIE") => Array.from({ length: count }, (_, index) =>
  `${prefix}${String(index + 1).padStart(4, "0")}`);
const row = (extra = {}) => ({
  displayOrder: 1, productCode: "BDS2500-HW-MN", quantity: 7.25,
  salePriceUnit: 23.45, salePriceTotal: 170.0125,
  productDescription: "Soporte de fabricante", ...extra,
});
const model = (rows) => ({
  header: { proposalName: "Renovacion soporte", quotationNumber: "18", versionNumber: "1" },
  sections: [{ title: "Soporte anual", subtotal: 170.0125, rows }],
  summary: { subtotal: 170.0125, total: 170.0125, currencyCode: "USD" },
});

async function readPdf(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.filter((item) => item.str).map((item) => ({
        text: item.str, x: item.transform[4], baseline: page.view[3] - item.transform[5],
        height: item.height,
      })));
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

async function renderWithRowBounds(input, options = {}) {
  const doc = new PDFDocument({ size: "LETTER", margin: 42, bufferPages: true });
  const chunks = [];
  const buffer = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const rows = [];
  const rect = doc.rect;
  doc.rect = function (x, y, width, height) {
    if (width === 528 && this._fontSize === 9) {
      rows.push({ x, y, width, height, page: this.bufferedPageRange().count - 1 });
    }
    return rect.call(this, x, y, width, height);
  };
  if (options.embedded) doc.text("Documento principal antes del anexo");
  await drawQuotationPdfContent(doc, input, { startOnNewPage: options.embedded });
  doc.end();
  return { rows, pages: await readPdf(await buffer) };
}

function expectRowsInsidePages(rows) {
  expect(rows.length).toBeGreaterThan(0);
  for (const bounds of rows) {
    expect(bounds.y).toBeGreaterThanOrEqual(42);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(750);
  }
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1], current = rows[index];
    if (previous.page === current.page) {
      expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height - 0.01);
    }
  }
}

function expectSerialsInsideRows(pages, rows, expected) {
  const actual = pages.flatMap((items, page) => items
    .filter((item) => expected.includes(item.text)).map((item) => ({ ...item, page })));
  expect(actual.map((item) => item.text).sort()).toEqual([...expected].sort());
  for (const item of actual) {
    const bounds = rows.find((candidate) => candidate.page === item.page &&
      item.baseline >= candidate.y && item.baseline <= candidate.y + candidate.height);
    expect(bounds, item.text).toBeDefined();
    expect(item.baseline - item.height).toBeGreaterThanOrEqual(bounds.y);
    expect(item.baseline + 2).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
}

describe("Quotation PDF table layout", () => {
  it("keeps multiline serial descriptions above the following row, using the rendered font metrics", async () => {
    const first = serials(12), second = serials(9, "LOCAL");
    const { rows, pages } = await renderWithRowBounds(model([
      row({ productDescription: [
        "BlueCat 2500 - BlueCat DNS/ DHCP Server - Incluye",
        "1. Soporte de Fabricante para 8 BlueCat 2500.",
        "2. Suscripcion para 8 BlueCat 2500", "Seriales:", ...first,
      ].join("\n") }),
      row({ displayOrder: 4, productCode: "ELECT-ST24X7-AN",
        productDescription: ["Servicio de Soporte Tecnico Local para 8 BlueCat 2500.",
          "Modalidad 24x7. Seriales:", ...second].join("\n") }),
    ]));
    expect(rows).toHaveLength(2);
    expectRowsInsidePages(rows);
    expect(pages.flat().find((item) => item.text === "Soporte anual").x).toBe(42);
    expectSerialsInsideRows(pages, rows, [...first, ...second]);
    const firstPage = pages[rows[0].page];
    const lastSerial = firstPage.find((item) => item.text === first.at(-1));
    if (rows[0].page === rows[1].page) expect(lastSerial.baseline + 2).toBeLessThan(rows[1].y);
  });

  it("moves a row that fits on a fresh page intact, rather than splitting it at the current page end", async () => {
    const expected = serials(38);
    const { rows, pages } = await renderWithRowBounds(model([
      row({ productDescription: serials(24, "PRIMERO").join("\n") }),
      row({ displayOrder: 2, productDescription: expected.join("\n") }),
    ]));
    expect(rows).toHaveLength(2);
    expect(rows[1].page).toBeGreaterThan(rows[0].page);
    expectRowsInsidePages(rows);
    expectSerialsInsideRows(pages, rows, expected);
    expect(pages[rows[1].page].some((item) => item.text === "Soporte anual (cont.)")).toBe(true);
  });

  it.each([false, true])("preserves every serial across oversized rows without repeating amounts (embedded=%s)", async (embedded) => {
    const expected = serials(180);
    const { rows, pages } = await renderWithRowBounds(model([
      row({ productDescription: expected.join("\n") }),
      row({ displayOrder: 2, productCode: "SIGUIENTE", productDescription: "Siguiente producto",
        quantity: 1, salePriceUnit: 2, salePriceTotal: 2 }),
    ]), { embedded });
    expect(rows.length).toBeGreaterThan(3);
    expectRowsInsidePages(rows);
    expectSerialsInsideRows(pages, rows, expected);
    const allText = pages.flat().map((item) => item.text);
    expect(allText.filter((text) => text === "7.25")).toHaveLength(1);
    const unitPrice = new Intl.NumberFormat("es-MX", {
      style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(23.45).replace(/\s+/g, " ");
    expect(allText.filter((text) => text.replace(/\s+/g, " ") === unitPrice)).toHaveLength(1);
    expect(pages.flat().filter((item) => item.x >= 77 && item.x < 79 && item.text !== "Codigo")
      .map((item) => item.text).join("")).toBe("BDS2500-HW-MNSIGUIENTE");
    expect(allText.filter((text) => text === "Siguiente producto")).toHaveLength(1);
    expect(allText.filter((text) => text === "Subtotal de seccion")).toHaveLength(1);
    for (const page of new Set(rows.map((bounds) => bounds.page))) {
      expect(pages[page].some((item) => item.text === "Descripcion")).toBe(true);
    }
    if (embedded) expect(pages[0].some((item) => item.text === "Documento principal antes del anexo")).toBe(true);
  });

  it("splits independently overflowing columns without losing text or repeating consumed cells", async () => {
    const codes = serials(130, "COD"), descriptions = serials(175);
    const { rows, pages } = await renderWithRowBounds(model([
      row({ productCode: codes.join("\n"), productDescription: descriptions.join("\n") }),
    ]));
    expectRowsInsidePages(rows);
    expectSerialsInsideRows(pages, rows, [...codes, ...descriptions]);
    expect(pages.flat().filter((item) => item.text === "7.25")).toHaveLength(1);
  });

  it("makes progress through unbroken descriptions and keeps every character", async () => {
    const description = `${"Z".repeat(5000)}ULTIMO`;
    const { rows, pages } = await renderWithRowBounds(model([
      row({ productDescription: description }),
    ]));
    expectRowsInsidePages(rows);
    const extracted = pages.flat().filter((item) =>
      item.x >= 149 && item.x < 151 && item.text !== "Descripcion").map((item) => item.text).join("");
    expect(extracted).toBe(description);
  });

  it("renders and parses the official PDF with wrapped descriptions and valid page numbering", async () => {
    const { buffer, fileName } = await buildQuotationPdfBuffer(model([
      row({ productDescription: `${"Detalle tecnico con ajuste automatico de linea. ".repeat(240)}FINDETALLE` }),
    ]));
    expect(fileName).toBe("renovacion-soporte.pdf");
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = await readPdf(buffer);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.flat().filter((item) => item.text.includes("FINDETALLE"))).toHaveLength(1);
    const renderedDescription = pages.flat().filter((item) =>
      item.x >= 149 && item.x < 151 && item.text !== "Descripcion")
      .map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
    expect(renderedDescription).toBe(
      `${"Detalle tecnico con ajuste automatico de linea. ".repeat(240)}FINDETALLE`.trim());
    for (let index = 0; index < pages.length; index++) {
      expect(pages[index].some((item) => item.text === `Pagina ${index + 1} de ${pages.length}`)).toBe(true);
      expect(pages[index].some((item) => !item.text.startsWith("Pagina "))).toBe(true);
    }
  });

  it("preserves the quotation table when generated through the actual proposal attachment flow", async () => {
    const expected = serials(145, "ANEXO");
    const { buffer } = await buildProposalPdfBuffer({
      header: { proposalTitle: "Propuesta con cotizacion anexa" },
      quotationAttachment: model([row({ productDescription: expected.join("\n") })]),
    });
    const pages = await readPdf(buffer);
    const allText = pages.flat().map((item) => item.text);
    expect(allText.filter((text) => expected.includes(text))).toEqual(expected);
    expect(allText.filter((text) => text === "7.25")).toHaveLength(1);
    for (const page of pages.filter((items) => items.some((item) => expected.includes(item.text)))) {
      expect(page.some((item) => item.text === "Descripcion")).toBe(true);
      for (const item of page.filter((item) => expected.includes(item.text))) {
        expect(item.baseline - item.height).toBeGreaterThanOrEqual(42);
        expect(item.baseline + 2).toBeLessThanOrEqual(750);
      }
    }
  });
});
