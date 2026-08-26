import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { requirePermission } from "./auth.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const DOCUMENTATION_SOURCES = [
  path.join(REPO_ROOT, "README.md"),
  path.join(REPO_ROOT, "readme"),
  path.join(REPO_ROOT, "apps/api/README.md"),
  path.join(REPO_ROOT, "apps/web/README.md"),
];

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "documento";
}

function toTitle(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const fileName = path.basename(normalized, ".md");
  const segments = normalized.split("/").filter(Boolean);

  if (normalized === "README.md") return "README principal";
  if (segments[0] === "readme" && segments.length <= 2) {
    return fileName.replace(/[-_]+/g, " ").replace(/\\b\\w/g, (letter) => letter.toUpperCase());
  }
  if (fileName.toUpperCase() === "README") {
    return `README de ${segments.slice(0, -1).join(" /") || "proyecto"}`;
  }

  return fileName.replace(/[-_]+/g, " ").replace(/\\b\\w/g, (letter) => letter.toUpperCase());
}

function toCategory(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const lowerPath = normalized.toLowerCase();

  if (normalized === "README.md") return "General";
  if (
    lowerPath.includes("prueba") ||
    lowerPath.includes("test-") ||
    lowerPath.includes("tests/") ||
    lowerPath.includes("bot-defense") ||
    segments.includes("pruebas")
  ) {
    return "Pruebas";
  }
  if (segments[0] === "readme") return "Documentación";
  if (segments[0] === "apps") return segments[1] ? segments[1].toUpperCase() : "Aplicación";
  return "General";
}

function toDescription(relativePath, content) {
  const plain = String(content || "")
    .replace(/[#>*_`~\-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();

  const firstSentence = plain.split(/\\n+/).find((line) => line.trim().length > 0);
  const fallback = `Documento de referencia del proyecto: ${relativePath}`;
  const value = (firstSentence || fallback).replace(/\\s+/g, " ").trim();

  return value.length > 170 ? `${value.slice(0, 167).trim()}...` : value;
}

async function walkMarkdownFiles(directoryPath, seen = new Map()) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkMarkdownFiles(absolutePath, seen);
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }

    const relativePath = path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
    if (seen.has(relativePath)) continue;

    const content = await fs.readFile(absolutePath, "utf8");
    seen.set(relativePath, {
      id: slugify(relativePath),
      slug: slugify(relativePath),
      title: toTitle(relativePath),
      category: toCategory(relativePath),
      description: toDescription(relativePath, content),
      path: relativePath,
      absolutePath,
    });
  }

  return seen;
}

async function listDocumentationCatalog() {
  const catalog = new Map();

  for (const sourcePath of DOCUMENTATION_SOURCES) {
    try {
      const stat = await fs.stat(sourcePath);
      if (stat.isFile()) {
        const content = await fs.readFile(sourcePath, "utf8");
        const relativePath = path.relative(REPO_ROOT, sourcePath).split(path.sep).join("/");
        catalog.set(relativePath, {
          id: slugify(relativePath),
          slug: slugify(relativePath),
          title: toTitle(relativePath),
          category: toCategory(relativePath),
          description: toDescription(relativePath, content),
          path: relativePath,
          absolutePath: sourcePath,
        });
        continue;
      }

      if (stat.isDirectory()) {
        const files = await walkMarkdownFiles(sourcePath, catalog);
        for (const [relativePath, item] of files.entries()) {
          catalog.set(relativePath, item);
        }
      }
    } catch {
      // Ignored: source missing or unreadable.
    }
  }

  return Array.from(catalog.values()).sort((left, right) =>
    left.title.localeCompare(right.title, "es", { sensitivity: "base" }),
  );
}

router.get("/", requirePermission("configuracion.read"), async (_req, res) => {
  const items = await listDocumentationCatalog();
  res.json({ items });
});

router.get("/:docId", requirePermission("configuracion.read"), async (req, res) => {
  const items = await listDocumentationCatalog();
  const item = items.find((entry) => entry.slug === req.params.docId);

  if (!item) {
    return res.status(404).json({ message: "Documento no encontrado" });
  }

  try {
    const content = await fs.readFile(item.absolutePath, "utf8");
    return res.json({ item: { ...item, content } });
  } catch (error) {
    return res.status(500).json({
      message: "No fue posible leer el documento solicitado",
      error: String(error?.message || error || "Error desconocido"),
    });
  }
});

export default router;
