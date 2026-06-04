import express from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { query } from "./db.js";
import { buildQuotationPdfBuffer } from "./quotationPdf.js";
import { getCompanyDocumentBranding } from "./settings.js";

const router = express.Router();

const quotationPdfRowSchema = z.object({
  displayOrder: z.number().int().nonnegative().optional().nullable(),
  productCode: z.string().trim().max(120).optional().nullable(),
  productDescription: z.string().trim().max(5000).optional().nullable(),
  quantity: z.number().nonnegative().optional().nullable(),
  quantityDisplay: z.string().trim().max(120).optional().nullable(),
  salePriceUnit: z.number().nonnegative().optional().nullable(),
  salePriceTotal: z.number().nonnegative().optional().nullable(),
});

const quotationPdfSectionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  subtotal: z.number().nonnegative().optional().default(0),
  rows: z.array(quotationPdfRowSchema).optional().default([]),
});

const quotationPdfRenderSchema = z.object({
  header: z.object({
    quotationNumber: z.string().trim().max(80).optional().default(""),
    versionNumber: z.string().trim().max(80).optional().default(""),
    quotationDate: z.string().trim().max(120).optional().default(""),
    proposalName: z.string().trim().max(180).optional().default(""),
    accountName: z.string().trim().max(180).optional().default(""),
    contactName: z.string().trim().max(180).optional().default(""),
    contactEmail: z.string().trim().max(180).optional().default(""),
    contactPhone: z.string().trim().max(80).optional().default(""),
    sellerName: z.string().trim().max(180).optional().default(""),
    sellerEmail: z.string().trim().max(180).optional().default(""),
    sellerPhone: z.string().trim().max(80).optional().default(""),
  }),
  introduction: z.string().trim().max(50000).optional().default(""),
  sections: z.array(quotationPdfSectionSchema).optional().default([]),
  summary: z.object({
    subtotal: z.number().nonnegative().optional().default(0),
    discount: z.number().nonnegative().optional().default(0),
    discountedSubtotal: z.number().nonnegative().optional().default(0),
    vatAmount: z.number().nonnegative().optional().default(0),
    total: z.number().nonnegative().optional().default(0),
    showVat: z.boolean().optional().default(false),
    vatMode: z
      .enum(["without_vat", "total", "per_item"])
      .optional()
      .default("without_vat"),
    currencyCode: z.string().trim().min(1).max(20).optional().default("USD"),
  }),
  commercialTerms: z
    .object({
      deliveryTime: z.string().trim().max(180).optional().default(""),
      quotationValidity: z.string().trim().max(180).optional().default(""),
      warranty: z.string().trim().max(180).optional().default(""),
      paymentTerms: z.string().trim().max(180).optional().default(""),
      currency: z.string().trim().max(120).optional().default(""),
    })
    .optional()
    .default({}),
  notes: z.string().trim().max(50000).optional().default(""),
});

let quotationPublicShareTableEnsured = false;

async function ensureQuotationPublicShareTable() {
  if (quotationPublicShareTableEnsured) {
    return;
  }

  await query(
    `CREATE TABLE IF NOT EXISTS quotation_public_share_links (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      quotation_version_id BIGINT UNSIGNED NOT NULL,
      created_by_user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      pdf_payload_json LONGTEXT NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      last_accessed_at DATETIME(3) NULL,
      access_count INT UNSIGNED NOT NULL DEFAULT 0,
      revoked_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
      updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
      CONSTRAINT uq_quotation_public_share_links_token_hash UNIQUE (token_hash),
      CONSTRAINT fk_quotation_public_share_links_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
      CONSTRAINT fk_quotation_public_share_links_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
      INDEX idx_quotation_public_share_links_version (quotation_version_id, expires_at),
      INDEX idx_quotation_public_share_links_expiry (expires_at)
    )`,
  );

  quotationPublicShareTableEnsured = true;
}

function buildQuotationPublicShareTokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

router.get("/quotation-shares/:token/pdf", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ message: "Token invalido" });
  }

  await ensureQuotationPublicShareTable();

  const tokenHash = buildQuotationPublicShareTokenHash(token);
  const rows = await query(
    `SELECT id, quotation_version_id, pdf_payload_json, expires_at, revoked_at
     FROM quotation_public_share_links
     WHERE token_hash = ?
     LIMIT 1`,
    [tokenHash],
  );

  if (!rows.length) {
    return res.status(404).json({ message: "Enlace no encontrado" });
  }

  const shareLink = rows[0];
  if (shareLink.revoked_at) {
    return res.status(410).json({ message: "Enlace revocado" });
  }

  const expiresAt = new Date(shareLink.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ message: "Enlace expirado" });
  }

  let parsedPayload;
  try {
    const decodedPayload = JSON.parse(shareLink.pdf_payload_json || "{}");
    const parsed = quotationPdfRenderSchema.safeParse(decodedPayload);
    if (!parsed.success) {
      return res.status(422).json({
        message: "El enlace contiene un documento invalido.",
      });
    }
    parsedPayload = parsed.data;
  } catch {
    return res.status(422).json({
      message: "El enlace contiene un documento invalido.",
    });
  }

  const company = await getCompanyDocumentBranding();
  const { buffer, fileName } = await buildQuotationPdfBuffer({
    ...parsedPayload,
    company,
  });

  await query(
    `UPDATE quotation_public_share_links
     SET access_count = access_count + 1,
         last_accessed_at = NOW(3),
         updated_at = NOW(3)
     WHERE id = ?`,
    [Number(shareLink.id)],
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", String(buffer.length));
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  res.setHeader("Cache-Control", "no-store");

  return res.send(buffer);
});

export default router;
