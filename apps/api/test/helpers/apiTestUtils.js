import bcrypt from "bcryptjs";
import { query } from "../../src/db.js";

export const TEST_PASSWORD = "Request123!";
export const TEST_PREFIX = `api_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function placeholders(length) {
  return Array.from({ length }, () => "?").join(", ");
}

export async function getPermissionIds(codes) {
  let rows = await query(
    `SELECT id, code FROM permissions WHERE code IN (${placeholders(codes.length)})`,
    codes,
  );
  const existingCodes = new Set(rows.map((row) => String(row.code)));
  const missingCodes = codes.filter((code) => !existingCodes.has(code));
  for (const code of missingCodes) {
    const separatorIndex = code.lastIndexOf(".");
    const module = separatorIndex > 0 ? code.slice(0, separatorIndex) : code;
    const action = separatorIndex > 0 ? code.slice(separatorIndex + 1) : "read";
    const now = new Date();
    await query(
      `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
      [code, module, action, `Permiso temporal de pruebas: ${code}`, now, now],
    );
  }
  rows = await query(
    `SELECT id, code FROM permissions WHERE code IN (${placeholders(codes.length)})`,
    codes,
  );
  const byCode = new Map(rows.map((row) => [row.code, Number(row.id)]));
  return codes.map((code) => {
    const permissionId = byCode.get(code);
    if (!permissionId) {
      throw new Error(`Permiso no encontrado: ${code}`);
    }
    return permissionId;
  });
}

export async function createRole({
  name,
  permissionCodes = [],
  createdByUserId = null,
}) {
  const now = new Date();
  await query(
    `INSERT INTO roles
      (name, description, is_system, is_active, created_by_user_id, updated_by_user_id, created_at, updated_at)
     VALUES (?, ?, 0, 1, ?, ?, ?, ?)`,
    [
      name,
      `Rol temporal de pruebas: ${name}`,
      createdByUserId,
      createdByUserId,
      now,
      now,
    ],
  );

  const roleRows = await query("SELECT id FROM roles WHERE name = ? LIMIT 1", [
    name,
  ]);
  const roleId = Number(roleRows[0].id);

  if (permissionCodes.length) {
    const permissionIds = await getPermissionIds(permissionCodes);
    for (const permissionId of permissionIds) {
      await query(
        "INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)",
        [roleId, permissionId, now],
      );
    }
  }

  return roleId;
}

export async function ensureNamedRole(name) {
  const existingRows = await query(
    "SELECT id FROM roles WHERE name = ? LIMIT 1",
    [name],
  );
  if (existingRows.length) {
    return { roleId: Number(existingRows[0].id), created: false };
  }

  const now = new Date();
  await query(
    `INSERT INTO roles
      (name, description, is_system, is_active, created_by_user_id, updated_by_user_id, created_at, updated_at)
     VALUES (?, ?, 0, 1, NULL, NULL, ?, ?)`,
    [name, `Rol temporal requerido por pruebas: ${name}`, now, now],
  );

  const roleRows = await query("SELECT id FROM roles WHERE name = ? LIMIT 1", [
    name,
  ]);
  return { roleId: Number(roleRows[0].id), created: true };
}

export async function createUser({
  fullName,
  email,
  roleIds = [],
  status = "active",
}) {
  const now = new Date();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const result = await query(
    `INSERT INTO users
      (full_name, email, description, registered_at, avatar_url, mobile, status, password_hash, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)`,
    [
      fullName,
      email,
      `Usuario temporal de pruebas: ${fullName}`,
      now,
      status,
      passwordHash,
      now,
      now,
    ],
  );
  const userId = Number(result.insertId);

  for (const roleId of roleIds) {
    await query(
      "INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
      [userId, roleId, now],
    );
  }

  return userId;
}

export async function login(supertestRequest, email) {
  const response = await supertestRequest.post("/api/auth/login").send({
    email,
    password: TEST_PASSWORD,
  });
  return response;
}

export async function getCatalogId(tableName, code, columnName = "code") {
  const rows = await query(
    `SELECT id FROM ${tableName} WHERE ${columnName} = ? LIMIT 1`,
    [code],
  );
  if (!rows.length) {
    throw new Error(
      `Catalogo no encontrado en ${tableName}.${columnName}: ${code}`,
    );
  }
  return Number(rows[0].id);
}

export async function getFirstId(tableName) {
  const rows = await query(`SELECT id FROM ${tableName} ORDER BY id LIMIT 1`);
  if (!rows.length) {
    throw new Error(`Tabla sin datos: ${tableName}`);
  }
  return Number(rows[0].id);
}

export async function getStatusCodeById(tableName, entityId, statusColumn) {
  const rows = await query(
    `SELECT s.code
     FROM ${tableName} e
     INNER JOIN ${statusColumn.table} s ON s.id = e.${statusColumn.column}
     WHERE e.id = ?`,
    [entityId],
  );
  return rows.length ? String(rows[0].code) : null;
}

export async function createDirectAccount({
  ownerUserId,
  actorUserId,
  suffix,
}) {
  const now = new Date();
  const result = await query(
    `INSERT INTO accounts
      (name, account_type_id, registration_code, phone, economic_sector_id, website, city, state_region,
       country_id, description, address_line, postal_code, activation_status_id,
       created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `Cuenta fixture ${suffix}`,
      await getFirstId("account_types"),
      `FIX-${suffix}`,
      await getFirstId("economic_sectors"),
      "CDMX",
      "CDMX",
      await getCatalogId("countries", "MX", "iso2"),
      "Cuenta fixture para pruebas",
      "Calle fixture",
      "01000",
      await getCatalogId("account_activation_statuses", "activada"),
      actorUserId,
      now,
      actorUserId,
      now,
    ],
  );
  const accountId = Number(result.insertId);
  await query(
    "INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)",
    [accountId, ownerUserId, now, actorUserId],
  );
  return accountId;
}

export async function createDirectContact({ accountId, actorUserId, suffix }) {
  const now = new Date();
  const result = await query(
    `INSERT INTO contacts
      (first_name, last_name, account_id, position_title, phone, phone_extension,
       mobile, email, department, country_id, state_region, city, address_line,
       postal_code, purchase_participation_id, relationship_type_id,
       hierarchy_level_id, influence_level_id, employment_status_id,
       activation_status_id, manager_contact_id, influences_contact_id,
       created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [
      "Contacto",
      `Fixture ${suffix}`,
      accountId,
      "Compras",
      `555${suffix.slice(-6)}`,
      `fixture.${suffix}@example.com`,
      "Compras",
      await getCatalogId("countries", "MX", "iso2"),
      "CDMX",
      "Ciudad de Mexico",
      "Direccion fixture",
      "01000",
      await getCatalogId("contact_purchase_participations", "ninguno"),
      await getCatalogId("contact_relationship_types", "ninguno"),
      await getCatalogId("contact_hierarchy_levels", "usuario"),
      await getCatalogId("contact_influence_levels", "media"),
      await getFirstId("contact_employment_statuses"),
      await getCatalogId("contact_activation_statuses", "activado"),
      actorUserId,
      now,
      actorUserId,
      now,
    ],
  );
  return Number(result.insertId);
}

export async function createDirectProvider({ actorUserId, suffix }) {
  const now = new Date();
  const result = await query(
    `INSERT INTO providers
      (name, registration_code, address_line, country_id, city, postal_code,
       state_region, activation_status_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `Proveedor fixture ${suffix}`,
      `PROV-${suffix}`,
      "Direccion fixture proveedor",
      await getCatalogId("countries", "MX", "iso2"),
      "Ciudad de Mexico",
      "01000",
      "CDMX",
      await getCatalogId("provider_activation_statuses", "activado"),
      actorUserId,
      now,
      actorUserId,
      now,
    ],
  );
  return Number(result.insertId);
}

export async function createDirectProviderPriceList({
  providerId,
  actorUserId,
  suffix,
  name,
  currencyId,
  itemType = "producto",
  isActive = false,
}) {
  const now = new Date();
  const resolvedCurrencyId = currencyId || (await getFirstId("currencies"));
  const productTypeId = await getCatalogId("product_types", itemType);
  const result = await query(
    `INSERT INTO provider_price_lists
      (provider_id, name, currency_id, product_type_id, item_type, is_active, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      providerId,
      name || `Lista fixture ${suffix}`,
      resolvedCurrencyId,
      productTypeId,
      itemType,
      isActive ? 1 : 0,
      actorUserId,
      now,
      actorUserId,
      now,
    ],
  );
  return Number(result.insertId);
}

export async function createDirectProviderPriceItem({
  providerId,
  actorUserId,
  suffix,
  itemType = "producto",
  listId = null,
}) {
  const now = new Date();
  const productTypeId = await getCatalogId("product_types", itemType);
  const resolvedListId =
    listId ||
    (await createDirectProviderPriceList({
      providerId,
      actorUserId,
      suffix: `${suffix}_list`,
      isActive: true,
    }));
  const result = await query(
    `INSERT INTO provider_price_list_items
      (provider_id, price_list_id, code, description, product_type_id, item_type, price, currency_id, activation_status_id,
       created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      providerId,
      resolvedListId,
      `PRICE-${suffix}`,
      `Precio fixture ${suffix}`,
      productTypeId,
      itemType,
      1234.56,
      await getFirstId("currencies"),
      await getCatalogId("provider_price_list_item_statuses", "activo"),
      actorUserId,
      now,
      actorUserId,
      now,
    ],
  );
  return Number(result.insertId);
}

export async function cleanupArtifacts({
  stageQuestionIds = [],
  quotationIds = [],
  opportunityIds = [],
  contactIds = [],
  accountIds = [],
  providerPriceItemIds = [],
  providerPriceListIds = [],
  providerIds = [],
  userIds = [],
  roleIds = [],
}) {
  const normalizeIds = (values) =>
    Array.from(
      new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );

  stageQuestionIds = normalizeIds(stageQuestionIds);
  quotationIds = normalizeIds(quotationIds);
  opportunityIds = normalizeIds(opportunityIds);
  contactIds = normalizeIds(contactIds);
  accountIds = normalizeIds(accountIds);
  providerPriceItemIds = normalizeIds(providerPriceItemIds);
  providerPriceListIds = normalizeIds(providerPriceListIds);
  providerIds = normalizeIds(providerIds);
  userIds = normalizeIds(userIds);
  roleIds = normalizeIds(roleIds);

  if (userIds.length) {
    await query(
      `DELETE FROM documents WHERE uploaded_by_user_id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    try {
      await query(
        `DELETE FROM account_draft_analysis_jobs WHERE requested_by_user_id IN (${placeholders(userIds.length)})`,
        userIds,
      );
    } catch (error) {
      if (!String(error?.message || "").includes("doesn't exist")) {
        throw error;
      }
    }
    try {
      await query(
        `DELETE FROM commercial_opportunity_narrative_jobs WHERE requested_by_user_id IN (${placeholders(userIds.length)})`,
        userIds,
      );
    } catch (error) {
      if (!String(error?.message || "").includes("doesn't exist")) {
        throw error;
      }
    }
    try {
      await query(
        `DELETE FROM interaction_analysis_jobs WHERE requested_by_user_id IN (${placeholders(userIds.length)})`,
        userIds,
      );
    } catch (error) {
      if (!String(error?.message || "").includes("doesn't exist")) {
        throw error;
      }
    }
    await query(
      `DELETE FROM opportunity_document_upload_sessions WHERE created_by_user_id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    await query(
      `DELETE FROM interactions WHERE created_by IN (${placeholders(userIds.length)}) OR updated_by IN (${placeholders(userIds.length)})`,
      [...userIds, ...userIds],
    );
  }

  if (quotationIds.length) {
    await query(
      `DELETE FROM quotations WHERE id IN (${placeholders(quotationIds.length)})`,
      quotationIds,
    );
  }

  if (stageQuestionIds.length) {
    await query(
      `DELETE FROM opportunity_stage_question_answers WHERE question_id IN (${placeholders(stageQuestionIds.length)})`,
      stageQuestionIds,
    );
    await query(
      `DELETE FROM opportunity_stage_questions WHERE id IN (${placeholders(stageQuestionIds.length)})`,
      stageQuestionIds,
    );
  }

  if (opportunityIds.length) {
    await query(
      `DELETE FROM opportunities WHERE id IN (${placeholders(opportunityIds.length)})`,
      opportunityIds,
    );
  }

  if (contactIds.length) {
    await query(
      `DELETE FROM contacts WHERE id IN (${placeholders(contactIds.length)})`,
      contactIds,
    );
  }

  if (accountIds.length) {
    await query(
      `DELETE FROM accounts WHERE id IN (${placeholders(accountIds.length)})`,
      accountIds,
    );
  }

  if (providerPriceItemIds.length) {
    await query(
      `DELETE FROM provider_price_list_items WHERE id IN (${placeholders(providerPriceItemIds.length)})`,
      providerPriceItemIds,
    );
  }

  if (providerPriceListIds.length) {
    await query(
      `DELETE FROM provider_price_lists WHERE id IN (${placeholders(providerPriceListIds.length)})`,
      providerPriceListIds,
    );
  }

  if (providerIds.length) {
    await query(
      `DELETE FROM providers WHERE id IN (${placeholders(providerIds.length)})`,
      providerIds,
    );
  }

  if (userIds.length) {
    await query(
      `DELETE FROM commercial_planning_period_targets
       WHERE seller_user_id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    await query(
      `DELETE FROM commercial_planning_commission_configs
       WHERE seller_user_id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    await query(
      `DELETE FROM commercial_planning_seller_parameters
       WHERE seller_user_id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    await query(
      `DELETE FROM commercial_planning_periods
       WHERE created_by_user_id IN (${placeholders(userIds.length)})
          OR updated_by_user_id IN (${placeholders(userIds.length)})`,
      [...userIds, ...userIds],
    );
    await query(
      `DELETE FROM users WHERE id IN (${placeholders(userIds.length)})`,
      userIds,
    );
  }

  if (roleIds.length) {
    await query(
      `DELETE FROM roles WHERE id IN (${placeholders(roleIds.length)})`,
      roleIds,
    );
  }
}

const QUOTATION_STATUSES = [
  ["borrador", "Borrador", "draft"], ["en_aprobacion", "En aprobacion", "pending"], ["rechazada", "Rechazada", "rejected"],
  ["aprobada", "Aprobada", "approved"], ["enviada", "Enviada", "sent"], ["ganada", "Ganada", "won"], ["perdida", "Perdida", "lost"],
  ["anulada", "Anulada", "cancelled"], ["aceptada", "Aceptada", "accepted"], ["no_vigente", "No vigente", "inactive"],
];
const QUOTATION_ACTIONS = [
  ["crear_cotizacion", "Crear cotizacion"], ["crear_version", "Crear version"], ["ver", "Ver"], ["modificar", "Modificar"],
  ["solicitar_aprobacion", "Solicitar aprobacion"], ["declarar_ganada", "Declarar ganada"], ["declarar_perdida", "Declarar perdida"],
  ["declarar_anulada", "Declarar anulada"], ["enviar", "Enviar"], ["aprobar", "Aprobar"], ["rechazar", "Rechazar"],
  ["ponerla_borrador", "Ponerla borrador"], ["aceptar", "Aceptar"],
];
// [status, action, permissions (suffix of cotizaciones.*)]
const QUOTATION_ACTION_MATRIX = [
  ["aceptada", "ver", "externo,ingreso,operacion,revision"],
  ["anulada", "ver", "ingreso,operacion,revision"],
  ["aprobada", "declarar_ganada", "ingreso,operacion"],
  ["aprobada", "enviar", "operacion"],
  ["aprobada", "ver", "externo,ingreso,operacion,revision"],
  ["borrador", "declarar_anulada", "operacion"],
  ["borrador", "declarar_perdida", "operacion"],
  ["borrador", "modificar", "ingreso,operacion"],
  ["borrador", "solicitar_aprobacion", "ingreso,operacion"],
  ["borrador", "ver", "ingreso,operacion,revision"],
  ["en_aprobacion", "aprobar", "ingreso,revision"],
  ["en_aprobacion", "modificar", "revision"],
  ["en_aprobacion", "rechazar", "revision"],
  ["en_aprobacion", "ver", "ingreso,operacion,revision"],
  ["enviada", "declarar_anulada", "operacion"],
  ["enviada", "declarar_ganada", "operacion"],
  ["enviada", "declarar_perdida", "operacion"],
  ["enviada", "ver", "externo,ingreso,operacion,revision"],
  ["ganada", "aceptar", "ingreso"],
  ["ganada", "ponerla_borrador", "ingreso"],
  ["ganada", "ver", "externo,ingreso,operacion,revision"],
  ["no_vigente", "ver", "ingreso,operacion,revision"],
  ["perdida", "ver", "ingreso,operacion,revision"],
  ["rechazada", "declarar_anulada", "operacion"],
  ["rechazada", "declarar_perdida", "operacion"],
  ["rechazada", "modificar", "operacion"],
  ["rechazada", "ver", "ingreso,operacion,revision"],
];

// The quotation workflow catalog and its permission matrix are configuration data that the dev database carries but
// schema.sql does not; the permissions must already exist, so this runs after the server bootstrap.
export async function seedQuotationWorkflowCatalog() {
  for (const [index, [code, name, uiKey]] of QUOTATION_STATUSES.entries()) {
    await query(
      `INSERT INTO quotation_statuses (code, name, ui_key, display_order, is_active) VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), ui_key = VALUES(ui_key), display_order = VALUES(display_order), is_active = 1`,
      [code, name, uiKey, index + 1],
    );
  }
  for (const [index, [code, name]] of QUOTATION_ACTIONS.entries()) {
    await query(
      `INSERT INTO quotation_actions (code, name, display_order, is_active) VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), display_order = VALUES(display_order), is_active = 1`,
      [code, name, index + 1],
    );
  }
  for (const [status, action, permissions] of QUOTATION_ACTION_MATRIX) {
    for (const permission of permissions.split(",")) {
      await query(
        `INSERT INTO quotation_action_permissions (status_id, action_id, permission_id, is_allowed)
         SELECT qs.id, qa.id, p.id, 1
         FROM quotation_statuses qs, quotation_actions qa, permissions p
         WHERE qs.code = ? AND qa.code = ? AND p.code = ?
           AND NOT EXISTS (
             SELECT 1 FROM quotation_action_permissions existing
             WHERE existing.status_id = qs.id AND existing.action_id = qa.id AND existing.permission_id = p.id
           )`,
        [status, action, `cotizaciones.${permission}`],
      );
    }
  }
}
