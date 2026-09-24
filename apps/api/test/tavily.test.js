import { describe, expect, it } from "vitest";
import { normalizeTavilyResults } from "../src/tavily.js";

describe("Tavily research adapter", () => {
  it("normalizes and deduplicates public sources by canonical URL", () => {
    const results = normalizeTavilyResults([
      { title: "Fuente 1", url: "https://example.com/news?a=1", content: "Señal pública", score: 0.9 },
      { title: "Fuente duplicada", url: "https://example.com/news?a=2", content: "Otra copia", score: 0.8 },
      { title: "Fuente 2", url: "https://other.example.com", content: "Otra señal", score: 0.7 },
      { title: "Sin contenido", url: "https://empty.example.com", content: "" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ url: "https://example.com/news?a=1", score: 0.9 });
  });
});