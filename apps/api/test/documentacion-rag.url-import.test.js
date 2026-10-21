import { describe, expect, it, vi } from "vitest";
import {
  convertRagHtmlToMarkdown,
  isPublicRagAddress,
  createPinnedRagLookup,
  validateRagSourceUrl,
} from "../src/documentacion-rag/url-import.js";

describe("Documentación RAG URL sources", () => {
  it("accepts public HTTP and HTTPS URLs and rejects unsupported schemes and credentials", () => {
    expect(validateRagSourceUrl("https://example.com/guide.pdf").href).toBe(
      "https://example.com/guide.pdf",
    );
    expect(validateRagSourceUrl("http://example.com").protocol).toBe("http:");
    expect(() => validateRagSourceUrl("file:///etc/passwd")).toThrow(
      "Solo se permiten enlaces HTTP o HTTPS",
    );
    const credentialsUrl = new URL("https://example.com/guide.pdf");
    credentialsUrl.username = "seller";
    expect(() => validateRagSourceUrl(credentialsUrl.href)).toThrow(
      "La URL no debe incluir credenciales",
    );
  });

  it("blocks private, loopback, link-local, and reserved network addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.2.3.4",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ]) {
      expect(isPublicRagAddress(address), address).toBe(false);
    }
    expect(isPublicRagAddress("8.8.8.8")).toBe(true);
    expect(isPublicRagAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("supports both Node DNS lookup callback signatures while pinning the address", () => {
    const address = { address: "159.60.155.233", family: 4 };
    const lookup = createPinnedRagLookup(address);
    const callback = vi.fn();
    lookup("newpip.digitalvs.com", {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, address.address, address.family);

    lookup("newpip.digitalvs.com", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [address]);
  });

  it("converts public HTML to readable Markdown without scripts or navigation", () => {
    const converted = convertRagHtmlToMarkdown(`
      <html><head><title>Guía de venta</title>
      <script>steal()</script><style>.hidden { display:none }</style></head>
      <body><nav>Menú</nav><h1>Proceso</h1><p>Primera&nbsp;etapa.</p>
      <ul><li>Calificar</li><li>Demostrar</li></ul></body></html>
    `);

    expect(converted.fileName).toBe("Guía de venta.md");
    expect(converted.mimeType).toBe("text/markdown");
    expect(converted.sourceType).toBe("web_page");
    expect(converted.buffer.toString()).toContain("# Guía de venta");
    expect(converted.buffer.toString()).toContain("Primera etapa.");
    expect(converted.buffer.toString()).toContain("- Calificar");
    expect(converted.buffer.toString()).not.toContain("steal()");
    expect(converted.buffer.toString()).not.toContain("Menú");
  });

  it("explains when a page has no extractable HTML text", () => {
    expect(() =>
      convertRagHtmlToMarkdown("<html><script>hidden()</script></html>"),
    ).toThrow(
      "puede cargar el contenido con JavaScript o requerir inicio de sesión",
    );
  });
});
