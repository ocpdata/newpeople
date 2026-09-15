import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function hexToRgb(hex) {
  const value = String(hex || "#173d72").replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((item) => `${item}${item}`).join("") : value;
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) return rgb(0.09, 0.24, 0.45);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

export async function addProposalPageNumbers(buffer, { format, skipFirstPage = true } = {}) {
  const pdf = await PDFDocument.load(buffer);
  if (pdf.getPageCount() <= (skipFirstPage ? 1 : 0)) return buffer;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const color = hexToRgb(format?.accent || format?.heading);
  const totalPages = pdf.getPageCount();

  for (let index = skipFirstPage ? 1 : 0; index < totalPages; index += 1) {
    const page = pdf.getPage(index);
    const { width } = page.getSize();
    const label = `Página ${index + 1} de ${totalPages}`;
    page.drawLine({
      start: { x: 54, y: 32 },
      end: { x: width - 54, y: 32 },
      thickness: 0.6,
      color,
      opacity: 0.35,
    });
    page.drawText(label, {
      x: width - 54 - font.widthOfTextAtSize(label, 8),
      y: 19,
      size: 8,
      font,
      color,
    });
  }
  return Buffer.from(await pdf.save());
}
