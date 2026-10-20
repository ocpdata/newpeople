import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FILE_ACCEPT,
  DOCUMENT_FORMATS,
  LEGACY_DOCUMENT_FORMATS,
} from "../../../shared/document-formats.js";
import { validateSingleFile, extractContentFromBuffer } from "../src/opportunity-documents/service.js";
import { buildCustomerExtractedMaterial } from "../src/commercial-intelligence/customer-documents.js";
import XLSX from "xlsx";
import JSZip from "jszip";

describe("Shared document formats", () => {
  it("offers exactly the same fourteen formats to both selectors", () => {
    expect(DOCUMENT_FILE_ACCEPT.split(",")).toEqual([
      ".pdf", ".docx", ".xlsx", ".xls", ".csv", ".txt", ".md",
      ".eml", ".png", ".jpg", ".jpeg", ".mp3", ".wav", ".m4a",
    ]);
    expect(Object.fromEntries(Object.entries(DOCUMENT_FORMATS)
      .map(([extension, format]) => [extension, format.maxBytes / (1024 * 1024)])))
      .toEqual({
        ".pdf": 20, ".docx": 15, ".xlsx": 10, ".xls": 10, ".csv": 5,
        ".txt": 2, ".md": 2, ".eml": 10, ".png": 10, ".jpg": 10, ".jpeg": 10,
        ".mp3": 50, ".wav": 50, ".m4a": 50,
      });
  });
  for (const [extension, format] of Object.entries(DOCUMENT_FORMATS)) {
    it(`${extension} accepts its exact size limit and MIME aliases in both channels`, () => {
      for (const mimetype of [...format.mimeTypes, "application/octet-stream", ""]) {
        const file = { originalFilename: `FILE${extension.toUpperCase()}`, mimetype, size: format.maxBytes };
        expect(validateSingleFile(file).kind).toBe(format.kind);
        expect(validateSingleFile(file, { includeLegacyFormats: false }).extension).toBe(extension);
        if (!mimetype || mimetype === "application/octet-stream") {
          expect(validateSingleFile(file).mimeType).toBe(format.mimeTypes[0]);
        }
      }
    });
    it(`${extension} rejects oversized, empty and mismatched files`, () => {
      const file = { originalFilename: `file${extension}`, mimetype: format.mimeTypes[0] };
      for (const size of [0, -1, NaN, format.maxBytes + 1]) {
        expect(() => validateSingleFile({ ...file, size })).toThrow();
      }
      expect(() => validateSingleFile({ ...file, size: 1, mimetype: "application/zip" })).toThrow(/no coincide/);
    });
  }
  it.each(Object.entries(LEGACY_DOCUMENT_FORMATS))("preserves %s internally without enabling it in chat", (extension, format) => {
    const file = { originalFilename: `legacy${extension}`, size: 1, mimetype: format.mimeTypes[0] };
    expect(validateSingleFile(file).kind).toBe(format.kind);
    expect(() => validateSingleFile(file, { includeLegacyFormats: false })).toThrow(/no esta soportado/);
  });
  it.each([".zip", ".exe", ".doc", ".gif"])("rejects %s", (extension) => {
    expect(() => validateSingleFile({ originalFilename: `file${extension}`, size: 1 })).toThrow();
  });
  it.each([".txt", ".md", ".csv", ".eml", ".xlsx", ".xls", ".docx"])("extracts useful material from %s for the chat", async (extension) => {
    let buffer = Buffer.from(extension === ".eml"
      ? "From: seller@example.com\r\nTo: client@example.com\r\nSubject: Alcance\r\n\r\nAlcance confirmado"
      : "Alcance confirmado");
    if ([".xlsx", ".xls"].includes(extension)) {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Alcance confirmado"]]), "Alcance");
      buffer = XLSX.write(workbook, { type: "buffer", bookType: extension === ".xls" ? "biff8" : "xlsx" });
    }
    if (extension === ".docx") {
      const zip = new JSZip();
      zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
      zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Alcance confirmado</w:t></w:r></w:p></w:body></w:document>');
      buffer = await zip.generateAsync({ type: "nodebuffer" });
    }
    const extracted = await extractContentFromBuffer({
      buffer, extension, fileName: `alcance${extension}`,
      mimeType: DOCUMENT_FORMATS[extension].mimeTypes[0],
    });
    expect(buildCustomerExtractedMaterial(extracted, `alcance${extension}`).text).toContain("Alcance confirmado");
  });
  it("does not claim empty or failed extraction was analyzed", () => {
    expect(() => buildCustomerExtractedMaterial({ normalizedText: "", extractionStatus: "completed" }, "empty.pdf")).toThrow();
    expect(() => buildCustomerExtractedMaterial({ normalizedText: "Error", extractionStatus: "failed" }, "broken.pdf")).toThrow();
  });
  it("surfaces corrupt PDF and DOCX extraction errors", async () => {
    for (const extension of [".pdf", ".docx"]) {
      await expect(extractContentFromBuffer({ buffer: Buffer.from("corrupt"), extension })).rejects.toThrow();
    }
  });
});
