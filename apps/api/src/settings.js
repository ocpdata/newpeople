import { config } from "./config.js";
import { query } from "./db.js";

let ensureCompanyProfileTablePromise;
let ensureTemporaryFeatureSettingsTablePromise;

function asText(value) {
  return String(value || "").trim();
}

function buildFallbackCompanyProfile() {
  const defaultCompany = config.documents.quotation.company;
  const addressLines = Array.isArray(defaultCompany.addressLines)
    ? defaultCompany.addressLines.filter(Boolean)
    : [];

  return {
    id: null,
    singletonKey: "default",
    legalName: asText(defaultCompany.legalName),
    commercialName: "",
    taxId: asText(defaultCompany.taxId),
    logoUrl: asText(defaultCompany.logoPath),
    addressLine1: asText(addressLines[0]),
    addressLine2: asText(addressLines[1]),
    city: "",
    stateRegion: "",
    countryId: null,
    countryCode: "",
    countryName: "",
    postalCode: "",
    email: asText(defaultCompany.email),
    phone: asText(defaultCompany.phone),
    website: "",
    description: "",
    createdAt: null,
    updatedAt: null,
    createdByUserId: null,
    createdByUserName: "",
    updatedByUserId: null,
    updatedByUserName: "",
  };
}

function normalizeCompanyProfileRow(row) {
  if (!row) {
    return buildFallbackCompanyProfile();
  }

  return {
    id: Number(row.id),
    singletonKey: row.singleton_key,
    legalName: asText(row.legal_name),
    commercialName: asText(row.commercial_name),
    taxId: asText(row.tax_id),
    logoUrl: asText(row.logo_url),
    addressLine1: asText(row.address_line1),
    addressLine2: asText(row.address_line2),
    city: asText(row.city),
    stateRegion: asText(row.state_region),
    countryId: row.country_id ? Number(row.country_id) : null,
    countryCode: asText(row.country_code),
    countryName: asText(row.country_name),
    postalCode: asText(row.postal_code),
    email: asText(row.email),
    phone: asText(row.phone),
    website: asText(row.website),
    description: asText(row.description),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id ? Number(row.created_by_user_id) : null,
    createdByUserName: asText(row.created_by_user_name),
    updatedByUserId: row.updated_by_user_id ? Number(row.updated_by_user_id) : null,
    updatedByUserName: asText(row.updated_by_user_name),
  };
}

function buildFallbackTemporaryFeatureSettings() {
  return {
    id: null,
    singletonKey: "default",
    accountsPendingEnabled: false,
    contactsPendingEnabled: false,
    opportunitiesPendingEnabled: false,
    createdAt: null,
    updatedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdByUserName: "",
    updatedByUserName: "",
  };
}

function normalizeTemporaryFeatureSettingsRow(row) {
  if (!row) {
    return buildFallbackTemporaryFeatureSettings();
  }

  return {
    id: Number(row.id),
    singletonKey: asText(row.singleton_key),
    accountsPendingEnabled: Boolean(row.accounts_pending_enabled),
    contactsPendingEnabled: Boolean(row.contacts_pending_enabled),
    opportunitiesPendingEnabled: Boolean(row.opportunities_pending_enabled),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id ? Number(row.created_by_user_id) : null,
    updatedByUserId: row.updated_by_user_id ? Number(row.updated_by_user_id) : null,
    createdByUserName: asText(row.created_by_user_name),
    updatedByUserName: asText(row.updated_by_user_name),
  };
}

async function ensureCompanyProfileTable() {
  if (!ensureCompanyProfileTablePromise) {
    ensureCompanyProfileTablePromise = query(
      `CREATE TABLE IF NOT EXISTS company_profile (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        legal_name VARCHAR(190) NOT NULL,
        commercial_name VARCHAR(190) NULL,
        tax_id VARCHAR(120) NOT NULL,
        logo_url LONGTEXT NULL,
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255) NULL,
        city VARCHAR(120) NOT NULL,
        state_region VARCHAR(120) NOT NULL,
        country_id BIGINT UNSIGNED NOT NULL,
        postal_code VARCHAR(20) NOT NULL,
        email VARCHAR(190) NULL,
        phone VARCHAR(40) NULL,
        website VARCHAR(300) NULL,
        description TEXT NULL,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_company_profile_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_company_profile_country FOREIGN KEY (country_id) REFERENCES countries(id),
        CONSTRAINT fk_company_profile_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_company_profile_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureCompanyProfileTablePromise = undefined;
      throw error;
    });
  }

  await ensureCompanyProfileTablePromise;
}

async function ensureTemporaryFeatureSettingsTable() {
  if (!ensureTemporaryFeatureSettingsTablePromise) {
    ensureTemporaryFeatureSettingsTablePromise = query(
      `CREATE TABLE IF NOT EXISTS temporary_feature_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        accounts_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        contacts_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        opportunities_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_temporary_feature_settings_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_temporary_feature_settings_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_temporary_feature_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureTemporaryFeatureSettingsTablePromise = undefined;
      throw error;
    });
  }

  await ensureTemporaryFeatureSettingsTablePromise;
}

async function ensureDefaultCompanyProfile() {
  await ensureCompanyProfileTable();

  const countryRows = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = 'MX'
     ORDER BY id
     LIMIT 1`,
  );
  const countryId = countryRows[0]?.id;
  if (!countryId) {
    return null;
  }

  await query(
    `INSERT INTO company_profile
      (singleton_key, legal_name, commercial_name, tax_id, logo_url,
       address_line1, address_line2, city, state_region, country_id,
       postal_code, email, phone, website, description,
       created_by_user_id, updated_by_user_id, created_at, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NOW(3), NOW(3))`,
    [
      "Access Quality S.A. de C.V.",
      "Access Quality",
      "RFC: AQU110118AV2",
      null,
      "Montecito #38, Piso 7, Oficina 1, WTC, Col. Napoles",
      "",
      "Ciudad de Mexico",
      "CDMX",
      Number(countryId),
      "03810",
      "",
      "",
      "",
      "Configuracion institucional inicial",
    ],
  );

  return countryId;
}

async function ensureDefaultTemporaryFeatureSettings() {
  await ensureTemporaryFeatureSettingsTable();
  await query(
    `INSERT INTO temporary_feature_settings
      (singleton_key, accounts_pending_enabled, contacts_pending_enabled,
       opportunities_pending_enabled, created_by_user_id, updated_by_user_id,
       created_at, updated_at)
     SELECT 'default', 0, 0, 0, NULL, NULL, NOW(3), NOW(3)
     WHERE NOT EXISTS (
       SELECT 1
       FROM temporary_feature_settings tfs
       WHERE tfs.singleton_key = 'default'
     )`,
  );
}

function buildAddressLines(profile) {
  const lines = [];
  if (profile.addressLine1) lines.push(profile.addressLine1);
  if (profile.addressLine2) lines.push(profile.addressLine2);

  const locality = [profile.city, profile.stateRegion].filter(Boolean).join(", ");
  const localityWithPostal = [
    locality,
    profile.postalCode ? `CP ${profile.postalCode}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (localityWithPostal) lines.push(localityWithPostal);
  if (profile.countryName) lines.push(profile.countryName);
  return lines;
}

export async function getCompanyProfile() {
  await ensureCompanyProfileTable();

  const selectProfile = () =>
    query(
      `SELECT cp.*, c.iso2 AS country_code, c.name AS country_name,
              uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM company_profile cp
       INNER JOIN countries c ON c.id = cp.country_id
       LEFT JOIN users uc ON uc.id = cp.created_by_user_id
       LEFT JOIN users uu ON uu.id = cp.updated_by_user_id
       WHERE cp.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectProfile();
  if (!rows.length) {
    await ensureDefaultCompanyProfile();
    rows = await selectProfile();
  }

  return normalizeCompanyProfileRow(rows[0] || null);
}

export async function getTemporaryFeatureSettings() {
  await ensureTemporaryFeatureSettingsTable();

  const selectSettings = () =>
    query(
      `SELECT tfs.*, uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM temporary_feature_settings tfs
       LEFT JOIN users uc ON uc.id = tfs.created_by_user_id
       LEFT JOIN users uu ON uu.id = tfs.updated_by_user_id
       WHERE tfs.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectSettings();
  if (!rows.length) {
    await ensureDefaultTemporaryFeatureSettings();
    rows = await selectSettings();
  }

  return normalizeTemporaryFeatureSettingsRow(rows[0] || null);
}

export async function saveTemporaryFeatureSettings(settings, actorUserId) {
  const current = await getTemporaryFeatureSettings();
  const existingId = current.id ? Number(current.id) : null;
  const now = new Date();
  const payload = {
    accountsPendingEnabled: settings.accountsPendingEnabled ? 1 : 0,
    contactsPendingEnabled: settings.contactsPendingEnabled ? 1 : 0,
    opportunitiesPendingEnabled: settings.opportunitiesPendingEnabled ? 1 : 0,
  };

  if (existingId) {
    await query(
      `UPDATE temporary_feature_settings
       SET accounts_pending_enabled = ?, contacts_pending_enabled = ?,
           opportunities_pending_enabled = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        payload.accountsPendingEnabled,
        payload.contactsPendingEnabled,
        payload.opportunitiesPendingEnabled,
        actorUserId || null,
        now,
        existingId,
      ],
    );
  } else {
    await query(
      `INSERT INTO temporary_feature_settings
        (singleton_key, accounts_pending_enabled, contacts_pending_enabled,
         opportunities_pending_enabled, created_by_user_id, updated_by_user_id,
         created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.accountsPendingEnabled,
        payload.contactsPendingEnabled,
        payload.opportunitiesPendingEnabled,
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );
  }

  return getTemporaryFeatureSettings();
}

export function buildCompanyDocumentBranding(profile) {
  const safeProfile = profile || buildFallbackCompanyProfile();
  return {
    logoUrl: asText(safeProfile.logoUrl),
    legalName: asText(safeProfile.legalName),
    taxId: asText(safeProfile.taxId),
    addressLines: buildAddressLines(safeProfile),
    email: asText(safeProfile.email),
    phone: asText(safeProfile.phone),
  };
}

export async function getCompanyDocumentBranding() {
  return buildCompanyDocumentBranding(await getCompanyProfile());
}