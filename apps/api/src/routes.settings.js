import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { query } from "./db.js";
import {
  buildCompanyDocumentBranding,
  getCompanyDocumentBranding,
  getCompanyProfile,
} from "./settings.js";

const router = express.Router();

const optionalTrimmedString = (maxLength) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z.string().max(maxLength).optional(),
  );

const optionalEmail = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().email().max(190).optional(),
);

const optionalUrl = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().url().max(300).optional(),
);

const logoUrlValueSchema = z
  .string()
  .max(3_000_000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return true;
      }
      return parsed.protocol === "data:" && value.startsWith("data:image/");
    } catch {
      return false;
    }
  }, "Logo invalido");

const companyProfileSchema = z.object({
  legalName: z.string().trim().min(3).max(190),
  commercialName: optionalTrimmedString(190),
  taxId: z.string().trim().min(3).max(120),
  logoUrl: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    logoUrlValueSchema.optional(),
  ),
  addressLine1: z.string().trim().min(3).max(255),
  addressLine2: optionalTrimmedString(255),
  city: z.string().trim().min(2).max(120),
  stateRegion: z.string().trim().min(2).max(120),
  countryId: z.number().int().positive(),
  postalCode: z.string().trim().min(2).max(20),
  email: optionalEmail,
  phone: optionalTrimmedString(40),
  website: optionalUrl,
  description: optionalTrimmedString(2000),
});

function parseChangedFields(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

router.get("/company-profile", requirePermission("configuracion.read"), async (_req, res) => {
  const profile = await getCompanyProfile();
  res.json({ profile });
});

router.get("/document-branding", async (_req, res) => {
  const company = await getCompanyDocumentBranding();
  res.json({ company });
});

router.put("/company-profile", requirePermission("configuracion.update"), async (req, res) => {
  const parsed = companyProfileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos invalidos",
      errors: parsed.error.flatten(),
    });
  }

  const profileBefore = await getCompanyProfile();
  const existingId = profileBefore.id ? Number(profileBefore.id) : null;
  const actorUserId = Number(req.user?.id) || null;
  const now = new Date();
  const payload = {
    legalName: parsed.data.legalName.trim(),
    commercialName: parsed.data.commercialName || null,
    taxId: parsed.data.taxId.trim(),
    logoUrl: parsed.data.logoUrl || null,
    addressLine1: parsed.data.addressLine1.trim(),
    addressLine2: parsed.data.addressLine2 || null,
    city: parsed.data.city.trim(),
    stateRegion: parsed.data.stateRegion.trim(),
    countryId: Number(parsed.data.countryId),
    postalCode: parsed.data.postalCode.trim(),
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    website: parsed.data.website || null,
    description: parsed.data.description || null,
  };

  if (existingId) {
    await query(
      `UPDATE company_profile
       SET legal_name = ?, commercial_name = ?, tax_id = ?, logo_url = ?,
           address_line1 = ?, address_line2 = ?, city = ?, state_region = ?,
           country_id = ?, postal_code = ?, email = ?, phone = ?, website = ?,
           description = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        payload.legalName,
        payload.commercialName,
        payload.taxId,
        payload.logoUrl,
        payload.addressLine1,
        payload.addressLine2,
        payload.city,
        payload.stateRegion,
        payload.countryId,
        payload.postalCode,
        payload.email,
        payload.phone,
        payload.website,
        payload.description,
        actorUserId,
        now,
        existingId,
      ],
    );
  } else {
    await query(
      `INSERT INTO company_profile
        (singleton_key, legal_name, commercial_name, tax_id, logo_url,
         address_line1, address_line2, city, state_region, country_id,
         postal_code, email, phone, website, description,
         created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.legalName,
        payload.commercialName,
        payload.taxId,
        payload.logoUrl,
        payload.addressLine1,
        payload.addressLine2,
        payload.city,
        payload.stateRegion,
        payload.countryId,
        payload.postalCode,
        payload.email,
        payload.phone,
        payload.website,
        payload.description,
        actorUserId,
        actorUserId,
        now,
        now,
      ],
    );
  }

  const profile = await getCompanyProfile();

  await logAuditEvent({
    req,
    module: "configuracion",
    action: existingId ? "updated_company_profile" : "created_company_profile",
    entityType: "company_profile",
    entityId: profile.id,
    detail: "Perfil institucional actualizado",
    before: buildCompanyDocumentBranding(profileBefore),
    after: buildCompanyDocumentBranding(profile),
  });

  res.json({
    message: "Configuracion de empresa actualizada correctamente",
    profile,
  });
});

router.get("/audit", requirePermission("configuracion.read"), async (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 100)
    : 25;

  const rows = await query(
    `SELECT id, module, action, entity_type, entity_id, status, detail,
            changed_fields, performed_by_user_id, performed_by_name,
            performed_by_email, created_at
     FROM audit_log
     WHERE module = 'configuracion'
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [limit],
  );

  res.json(
    rows.map((row) => ({
      ...row,
      changed_fields: parseChangedFields(row.changed_fields),
    })),
  );
});

export default router;