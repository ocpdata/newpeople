import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/config.js", async (importOriginal) => {
  const { config } = await importOriginal();
  return { config: { ...config, openai: { ...config.openai, apiKey: "test-only" } } };
});
vi.mock("music-metadata", () => ({
  parseBuffer: vi.fn().mockResolvedValue({ format: { duration: 12 } }),
}));
import { extractContentFromBuffer } from "../src/opportunity-documents/service.js";
import { buildCustomerExtractedMaterial } from "../src/commercial-intelligence/customer-documents.js";
import { DOCUMENT_FORMATS } from "../../../shared/document-formats.js";

afterEach(() => vi.unstubAllGlobals());
describe("Document media extraction for customer chat", () => {
  it.each([".png", ".jpg", ".jpeg", ".mp3", ".wav", ".m4a"])("routes %s to the existing OCR or transcription provider", async (extension) => {
    const audio = DOCUMENT_FORMATS[extension].kind === "audio";
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => audio
        ? { text: "Alcance confirmado", language: "es" }
        : { output_text: "Alcance confirmado" },
    });
    vi.stubGlobal("fetch", fetch);
    const extracted = await extractContentFromBuffer({
      buffer: Buffer.from("fixture"), extension, fileName: `alcance${extension}`,
      mimeType: DOCUMENT_FORMATS[extension].mimeTypes[0],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain(audio ? "/audio/transcriptions" : "/responses");
    expect(buildCustomerExtractedMaterial(extracted, `alcance${extension}`).text).toBe("Alcance confirmado");
    if (audio) {
      expect(fetch.mock.calls[0][1].body.get("file").name).toBe(`alcance${extension}`);
      expect(extracted.transcriptionStatus).toBe("completed");
    }
  });
  it.each([".png", ".mp3"])("surfaces provider errors for %s", async (extension) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "Provider unavailable" }));
    await expect(extractContentFromBuffer({
      buffer: Buffer.from("fixture"), extension, fileName: `file${extension}`,
      mimeType: DOCUMENT_FORMATS[extension].mimeTypes[0],
    })).rejects.toThrow("Provider unavailable");
  });
  it("extracts PDF text using the real parser", async () => {
    const stream = "BT /F1 12 Tf 10 100 Td (Alcance confirmado) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n`;
    pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const extracted = await extractContentFromBuffer({
      buffer: Buffer.from(pdf), extension: ".pdf", fileName: "alcance.pdf", mimeType: "application/pdf",
    });
    expect(buildCustomerExtractedMaterial(extracted, "alcance.pdf").text).toContain("Alcance confirmado");
  });
});
