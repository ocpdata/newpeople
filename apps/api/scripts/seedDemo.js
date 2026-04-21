import bcrypt from "bcryptjs";
import { pool, query, withTransaction } from "../src/db.js";
import { config } from "../src/config.js";

const DEMO_MARKER = "DEMO_SEED_V1";
const DEMO_REGISTRATION_PREFIX = "DEMO-ACC-";
const DEFAULT_COUNTS = {
  users: 20,
  accounts: 50,
  contactsMin: 2,
  contactsMax: 4,
  opportunitiesPerAccount: 4,
};
const DEFAULT_PASSWORD = "Demo12345!";
const ADMIN_ROLE_NAME = "Administrador";
const SELLER_ROLE_NAME = "Vendedor";
const PRESALES_ROLE_NAME = "Preventa";

const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Daniel",
  "Elena",
  "Fabian",
  "Gabriela",
  "Hector",
  "Ines",
  "Julio",
  "Karen",
  "Luis",
  "Marta",
  "Nora",
  "Pablo",
  "Rocio",
  "Sergio",
  "Teresa",
  "Uriel",
  "Valeria",
  "Wendy",
  "Ximena",
  "Yolanda",
  "Zaira",
];
const LAST_NAMES = [
  "Alvarez",
  "Bautista",
  "Castillo",
  "Dominguez",
  "Escobar",
  "Fernandez",
  "Garcia",
  "Hernandez",
  "Ibarra",
  "Jimenez",
  "Lopez",
  "Martinez",
  "Navarro",
  "Ortega",
  "Paredes",
  "Quintero",
  "Ramirez",
  "Salazar",
  "Torres",
  "Uribe",
  "Vargas",
  "Zamora",
];
const ACCOUNT_PREFIXES = [
  "Grupo",
  "Corporativo",
  "Soluciones",
  "Tecnologia",
  "Servicios",
  "Redes",
  "Infraestructura",
  "Sistemas",
  "Operacion",
  "Digital",
];
const ACCOUNT_SUFFIXES = [
  "Andina",
  "Global",
  "Latam",
  "Norte",
  "Pacifico",
  "Integral",
  "Prime",
  "Enterprise",
  "One",
  "Alliance",
];
const DEPARTMENTS = [
  "Compras",
  "Infraestructura",
  "TI",
  "Seguridad",
  "Operaciones",
  "Arquitectura",
];
const POSITION_TITLES = [
  "Gerente de TI",
  "Arquitecto de Soluciones",
  "Especialista de Redes",
  "Lider de Seguridad",
  "Coordinador de Infraestructura",
  "Analista Senior",
];
const BUSINESS_NAMES = [
  "Renovacion",
  "Expansion",
  "Modernizacion",
  "Consolidacion",
  "Actualizacion",
  "Migracion",
  "Observabilidad",
  "Proteccion",
];

function printHelp() {
  console.log(`Uso:
  npm run seed:demo --prefix apps/api -- --dry-run
  npm run seed:demo --prefix apps/api -- --reset

Opciones:
  --dry-run                     Muestra el plan sin insertar datos.
  --reset                       Elimina primero los datos demo previos y luego siembra de nuevo.
  --users <n>                   Total de usuarios demo. Default: ${DEFAULT_COUNTS.users}
  --accounts <n>                Total de cuentas demo. Default: ${DEFAULT_COUNTS.accounts}
  --contacts-min <n>            Contactos minimos por cuenta. Default: ${DEFAULT_COUNTS.contactsMin}
  --contacts-max <n>            Contactos maximos por cuenta. Default: ${DEFAULT_COUNTS.contactsMax}
  --opportunities-per-account <n>
                                Oportunidades por cuenta. Default: ${DEFAULT_COUNTS.opportunitiesPerAccount}
  --admin-name <texto>          Default: Omar Carrillo
  --admin-email <email>         Default: ocarrillo@accessq.com.mx
  --admin-password <texto>      Default: Cruz4das?
  --oscar-name <texto>          Default: Oscar Rillo
  --oscar-email <email>         Default: ocarrillo@electrodata.com.pe
  --oscar-password <texto>      Default: Cruz4das?
  --default-password <texto>    Password para el resto de usuarios. Default: ${DEFAULT_PASSWORD}
  --help                        Muestra esta ayuda.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    reset: false,
    users: DEFAULT_COUNTS.users,
    accounts: DEFAULT_COUNTS.accounts,
    contactsMin: DEFAULT_COUNTS.contactsMin,
    contactsMax: DEFAULT_COUNTS.contactsMax,
    opportunitiesPerAccount: DEFAULT_COUNTS.opportunitiesPerAccount,
    adminName: "Omar Carrillo",
    adminEmail: "ocarrillo@accessq.com.mx",
    adminPassword: "Cruz4das?",
    oscarName: "Oscar Rillo",
    oscarEmail: "ocarrillo@electrodata.com.pe",
    oscarPassword: "Cruz4das?",
    defaultPassword: DEFAULT_PASSWORD,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--reset") {
      options.reset = true;
      continue;
    }
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Falta valor para ${arg}`);
    }
    index += 1;

    if (key === "users") options.users = Number(value);
    else if (key === "accounts") options.accounts = Number(value);
    else if (key === "contacts-min") options.contactsMin = Number(value);
    else if (key === "contacts-max") options.contactsMax = Number(value);
    else if (key === "opportunities-per-account") {
      options.opportunitiesPerAccount = Number(value);
    } else if (key === "admin-name") options.adminName = String(value);
    else if (key === "admin-email") options.adminEmail = String(value).trim().toLowerCase();
    else if (key === "admin-password") options.adminPassword = String(value);
    else if (key === "oscar-name") options.oscarName = String(value);
    else if (key === "oscar-email") options.oscarEmail = String(value).trim().toLowerCase();
    else if (key === "oscar-password") options.oscarPassword = String(value);
    else if (key === "default-password") options.defaultPassword = String(value);
    else throw new Error(`Opcion no reconocida: ${arg}`);
  }

  validateOptions(options);
  return options;
}

function validateOptions(options) {
  const numericEntries = [
    ["users", options.users],
    ["accounts", options.accounts],
    ["contactsMin", options.contactsMin],
    ["contactsMax", options.contactsMax],
    ["opportunitiesPerAccount", options.opportunitiesPerAccount],
  ];

  for (const [label, value] of numericEntries) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${label} debe ser un entero positivo`);
    }
  }

  if (options.users < 2) {
    throw new Error("users debe ser al menos 2 para incluir administrador y Oscar");
  }
  if (options.contactsMax < options.contactsMin) {
    throw new Error("contacts-max no puede ser menor que contacts-min");
  }
  if (options.adminEmail === options.oscarEmail) {
    throw new Error("admin-email y oscar-email deben ser distintos");
  }
}

function buildUserSpecs(options) {
  const specs = [
    {
      key: "admin",
      fullName: options.adminName,
      email: options.adminEmail,
      password: options.adminPassword,
      roleName: ADMIN_ROLE_NAME,
      description: "Usuario base para demo manual",
      mobile: "+52 555 100 0001",
      reusable: true,
    },
    {
      key: "oscar",
      fullName: options.oscarName,
      email: options.oscarEmail,
      password: options.oscarPassword,
      roleName: SELLER_ROLE_NAME,
      description: "Usuario base para demo manual",
      mobile: "+51 999 100 0001",
      reusable: true,
    },
  ];

  const additionalUsers = options.users - specs.length;
  for (let index = 0; index < additionalUsers; index += 1) {
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(index * 3) % LAST_NAMES.length];
    const roleName = index % 5 === 0 ? PRESALES_ROLE_NAME : SELLER_ROLE_NAME;
    specs.push({
      key: `demo-${index + 1}`,
      fullName: `${firstName} ${lastName}`,
      email: `demo.user${String(index + 1).padStart(2, "0")}@newpeople.local`,
      password: options.defaultPassword,
      roleName,
      description: `${DEMO_MARKER}:user:${String(index + 1).padStart(2, "0")}`,
      mobile: `+52 555 ${String(200000 + index).slice(-6)}`,
      reusable: false,
    });
  }

  return specs;
}

async function ensureRole(conn, { name, description, permissionCodes }) {
  const [existingRows] = await conn.query(
    "SELECT id FROM roles WHERE name = ? LIMIT 1",
    [name],
  );

  let roleId;
  if (existingRows.length) {
    roleId = Number(existingRows[0].id);
  } else {
    const now = new Date();
    const [insert] = await conn.query(
      `INSERT INTO roles
        (name, description, is_system, is_active, created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, 0, 1, NULL, NULL, ?, ?)`,
      [name, description, now, now],
    );
    roleId = Number(insert.insertId);
  }

  if (Array.isArray(permissionCodes) && permissionCodes.length > 0) {
    const placeholders = permissionCodes.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id, code FROM permissions WHERE code IN (${placeholders})`,
      permissionCodes,
    );

    const idsByCode = new Map(permissionRows.map((row) => [row.code, Number(row.id)]));
    for (const permissionCode of permissionCodes) {
      const permissionId = idsByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(`Permiso requerido no encontrado: ${permissionCode}`);
      }
      await conn.query(
        `INSERT INTO role_permissions (role_id, permission_id, created_at)
         VALUES (?, ?, NOW(3))
         ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
        [roleId, permissionId],
      );
    }
  }

  return roleId;
}

async function fetchCatalogs() {
  const [countries, accountTypes, economicSectors, accountStatuses, purchaseParticipations, relationshipTypes, employmentStatuses, contactStatuses, businessLines, salesStages, opportunityStatuses] = await Promise.all([
    query("SELECT id, iso2, name FROM countries WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM account_types WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM economic_sectors WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM account_activation_statuses WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM contact_purchase_participations WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM contact_relationship_types WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM contact_employment_statuses WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM contact_activation_statuses WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM opportunity_business_lines WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM opportunity_sales_stages WHERE is_active = 1 ORDER BY id"),
    query("SELECT id, code, name FROM opportunity_activation_statuses WHERE is_active = 1 ORDER BY id"),
  ]);

  if (!countries.length || !accountTypes.length || !economicSectors.length) {
    throw new Error("Faltan catalogos base. Ejecuta primero apps/api/sql/schema.sql");
  }

  return {
    countries,
    accountTypes,
    economicSectors,
    accountStatuses,
    purchaseParticipations,
    relationshipTypes,
    employmentStatuses,
    contactStatuses,
    businessLines,
    salesStages,
    opportunityStatuses,
  };
}

function byCode(rows, code) {
  const match = rows.find((row) => String(row.code) === String(code));
  if (!match) {
    throw new Error(`No se encontro catalogo con code=${code}`);
  }
  return Number(match.id);
}

async function collectSafetyState(userSpecs) {
  const emails = userSpecs.map((user) => user.email);
  const placeholders = emails.map(() => "?").join(", ");
  const [emailRows, demoUserRows, demoAccountRows] = await Promise.all([
    query(
      `SELECT id, email, description
       FROM users
       WHERE email IN (${placeholders})`,
      emails,
    ),
    query(
      `SELECT id, email, description
       FROM users
       WHERE description LIKE ?`,
      [`${DEMO_MARKER}:%`],
    ),
    query(
      `SELECT id
       FROM accounts
       WHERE description LIKE ? OR registration_code LIKE ?`,
      [`${DEMO_MARKER}:%`, `${DEMO_REGISTRATION_PREFIX}%`],
    ),
  ]);

  const reusableEmails = new Set(
    userSpecs.filter((user) => user.reusable).map((user) => user.email),
  );
  const collisions = emailRows.filter((row) => {
    if (reusableEmails.has(String(row.email).toLowerCase())) {
      return false;
    }
    return !String(row.description || "").startsWith(`${DEMO_MARKER}:`);
  });

  const reusableExistingUsers = emailRows.filter((row) =>
    reusableEmails.has(String(row.email).toLowerCase()),
  );

  return {
    collisions,
    reusableExistingUsers,
    existingDemoUsers: demoUserRows,
    existingDemoAccounts: demoAccountRows,
  };
}

function summarizePlan({ options, userSpecs }) {
  const contactCounts = Array.from({ length: options.accounts }, (_, index) =>
    options.contactsMin + (index % (options.contactsMax - options.contactsMin + 1)),
  );
  const totalContacts = contactCounts.reduce((sum, count) => sum + count, 0);
  return {
    totalUsers: userSpecs.length,
    totalAccounts: options.accounts,
    totalContacts,
    totalOpportunities: options.accounts * options.opportunitiesPerAccount,
  };
}

function printSummary({ options, userSpecs, safetyState, plan }) {
  console.log(`Base objetivo: ${config.db.database}`);
  console.log(`Host DB: ${config.db.host}:${config.db.port}`);
  console.log(`Modo: ${options.dryRun ? "dry-run" : "ejecucion"}`);
  console.log(`Reset previo: ${options.reset ? "si" : "no"}`);
  console.log(`Usuarios a sembrar: ${plan.totalUsers}`);
  console.log(`Cuentas a sembrar: ${plan.totalAccounts}`);
  console.log(`Contactos estimados: ${plan.totalContacts}`);
  console.log(`Oportunidades a sembrar: ${plan.totalOpportunities}`);
  console.log(`Datos demo existentes: ${safetyState.existingDemoUsers.length} usuarios, ${safetyState.existingDemoAccounts.length} cuentas`);
  console.log(`Usuarios reutilizables detectados: ${safetyState.reusableExistingUsers.length}`);
  console.log(`Administrador: ${options.adminName} <${options.adminEmail}>`);
  console.log(`Usuario vendedor garantizado: ${options.oscarName} <${options.oscarEmail}>`);
  console.log(`Password resto de usuarios: ${options.defaultPassword}`);
  console.log(`Primeros usuarios demo: ${userSpecs.slice(0, 5).map((user) => `${user.fullName} (${user.roleName})`).join(", ")}`);
  if (safetyState.collisions.length > 0) {
    console.log("Colisiones detectadas con usuarios existentes no demo:");
    for (const collision of safetyState.collisions) {
      console.log(`- ${collision.email} (id ${collision.id})`);
    }
  }
}

function pickRow(rows, index) {
  return rows[index % rows.length];
}

function makeAccountStatusId(catalogs, index) {
  if (index % 10 === 0) return byCode(catalogs.accountStatuses, "desactivada");
  if (index % 4 === 0) return byCode(catalogs.accountStatuses, "pendiente_activacion");
  return byCode(catalogs.accountStatuses, "activada");
}

function makeContactStatusId(catalogs, index) {
  if (index % 9 === 0) return byCode(catalogs.contactStatuses, "desactivado");
  if (index % 4 === 0) return byCode(catalogs.contactStatuses, "pendiente_activacion");
  return byCode(catalogs.contactStatuses, "activado");
}

function makeOpportunityStatusId(catalogs, index) {
  if (index % 11 === 0) return byCode(catalogs.opportunityStatuses, "desactivada");
  if (index % 3 === 0) return byCode(catalogs.opportunityStatuses, "pendiente_activacion");
  return byCode(catalogs.opportunityStatuses, "activada");
}

function buildAccountName(index, countryIso2) {
  const prefix = ACCOUNT_PREFIXES[index % ACCOUNT_PREFIXES.length];
  const suffix = ACCOUNT_SUFFIXES[(index * 2) % ACCOUNT_SUFFIXES.length];
  return `${prefix} ${suffix} ${countryIso2} ${String(index + 1).padStart(2, "0")}`;
}

async function resetDemoData(conn) {
  await conn.query(
    `DELETE o FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     WHERE a.description LIKE ? OR a.registration_code LIKE ?`,
    [`${DEMO_MARKER}:%`, `${DEMO_REGISTRATION_PREFIX}%`],
  );
  await conn.query(
    `DELETE c FROM contacts c
     INNER JOIN accounts a ON a.id = c.account_id
     WHERE a.description LIKE ? OR a.registration_code LIKE ?`,
    [`${DEMO_MARKER}:%`, `${DEMO_REGISTRATION_PREFIX}%`],
  );
  await conn.query(
    `DELETE ao FROM account_owners ao
     INNER JOIN accounts a ON a.id = ao.account_id
     WHERE a.description LIKE ? OR a.registration_code LIKE ?`,
    [`${DEMO_MARKER}:%`, `${DEMO_REGISTRATION_PREFIX}%`],
  );
  await conn.query(
    `DELETE FROM accounts
     WHERE description LIKE ? OR registration_code LIKE ?`,
    [`${DEMO_MARKER}:%`, `${DEMO_REGISTRATION_PREFIX}%`],
  );
  await conn.query(
    `DELETE FROM password_setup_tokens
     WHERE user_id IN (
       SELECT id FROM (
         SELECT id FROM users WHERE description LIKE ?
       ) seeded_users
     )`,
    [`${DEMO_MARKER}:%`],
  );
  await conn.query(
    `DELETE FROM user_roles
     WHERE user_id IN (
       SELECT id FROM (
         SELECT id FROM users WHERE description LIKE ?
       ) seeded_users
     )`,
    [`${DEMO_MARKER}:%`],
  );
  await conn.query(`DELETE FROM users WHERE description LIKE ?`, [`${DEMO_MARKER}:%`]);
}

async function seedDemoData({ options, userSpecs, catalogs }) {
  return withTransaction(async (conn) => {
    if (options.reset) {
      await resetDemoData(conn);
    }

    const adminRoleId = await ensureRole(conn, {
      name: ADMIN_ROLE_NAME,
      description: "Acceso total",
      permissionCodes: [],
    });
    const sellerRoleId = await ensureRole(conn, {
      name: SELLER_ROLE_NAME,
      description: "Rol demo para vendedores",
      permissionCodes: [
        "cuentas.read",
        "cuentas.request",
        "cuentas.update",
        "contactos.read",
        "contactos.request",
        "contactos.update",
        "oportunidades.read",
        "oportunidades.request",
        "oportunidades.update",
      ],
    });
    const presalesRoleId = await ensureRole(conn, {
      name: PRESALES_ROLE_NAME,
      description: "Rol demo para preventa",
      permissionCodes: [
        "cuentas.read",
        "contactos.read",
        "oportunidades.read",
      ],
    });
    const roleIdByName = new Map([
      [ADMIN_ROLE_NAME, adminRoleId],
      [SELLER_ROLE_NAME, sellerRoleId],
      [PRESALES_ROLE_NAME, presalesRoleId],
    ]);

    const now = new Date();
    const createdUsers = [];
    const reusableEmails = userSpecs.filter((user) => user.reusable).map((user) => user.email);
    const reusablePlaceholders = reusableEmails.map(() => "?").join(", ");
    const [reusableRows] = reusableEmails.length
      ? await conn.query(
          `SELECT id, email FROM users WHERE email IN (${reusablePlaceholders})`,
          reusableEmails,
        )
      : [[]];
    const reusableByEmail = new Map(
      reusableRows.map((row) => [String(row.email).toLowerCase(), Number(row.id)]),
    );
    let adminUserId = reusableByEmail.get(options.adminEmail) || null;

    for (const user of userSpecs.filter((spec) => spec.reusable)) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      const existingId = reusableByEmail.get(user.email);
      if (existingId) {
        await conn.query(
          `UPDATE users
           SET full_name = ?, status = 'active', password_hash = ?, mobile = COALESCE(mobile, ?), updated_at = NOW(3)
           WHERE id = ?`,
          [user.fullName, passwordHash, user.mobile, existingId],
        );
        await conn.query(
          `INSERT INTO user_roles (user_id, role_id, created_at)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
          [existingId, roleIdByName.get(user.roleName), now],
        );
        createdUsers.push({ ...user, id: existingId, reused: true });
        if (user.key === "admin") {
          adminUserId = existingId;
        }
        continue;
      }

      const createdBy = user.key === "admin" ? null : adminUserId;
      const updatedBy = user.key === "admin" ? null : adminUserId;
      const [insert] = await conn.query(
        `INSERT INTO users
          (full_name, email, description, registered_at, avatar_url, mobile, status, password_hash, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?, ?)`,
        [
          user.fullName,
          user.email,
          user.description,
          now,
          user.mobile,
          passwordHash,
          createdBy,
          updatedBy,
          now,
          now,
        ],
      );
      const userId = Number(insert.insertId);
      if (user.key === "admin") {
        adminUserId = userId;
        await conn.query(
          "UPDATE users SET created_by = ?, updated_by = ? WHERE id = ?",
          [userId, userId, userId],
        );
      }
      await conn.query(
        "INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
        [userId, roleIdByName.get(user.roleName), now],
      );
      createdUsers.push({ ...user, id: userId, reused: false });
    }

    for (let index = 0; index < userSpecs.length; index += 1) {
      const user = userSpecs[index];
      if (user.reusable) continue;
      const passwordHash = await bcrypt.hash(user.password, 10);
      const createdBy = adminUserId;
      const updatedBy = adminUserId;
      const [insert] = await conn.query(
        `INSERT INTO users
          (full_name, email, description, registered_at, avatar_url, mobile, status, password_hash, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?, ?)`,
        [
          user.fullName,
          user.email,
          user.description,
          now,
          user.mobile,
          passwordHash,
          createdBy,
          updatedBy,
          now,
          now,
        ],
      );
      const userId = Number(insert.insertId);
      await conn.query(
        "INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
        [userId, roleIdByName.get(user.roleName), now],
      );
      createdUsers.push({ ...user, id: userId });
    }

    const sellerUsers = createdUsers.filter((user) => user.roleName === SELLER_ROLE_NAME);
    const presalesUsers = createdUsers.filter((user) => user.roleName === PRESALES_ROLE_NAME);
    const createdAccounts = [];

    for (let index = 0; index < options.accounts; index += 1) {
      const country = pickRow(catalogs.countries, index);
      const accountType = pickRow(catalogs.accountTypes, index);
      const sector = pickRow(catalogs.economicSectors, index + 2);
      const ownerA = sellerUsers[index % sellerUsers.length];
      const ownerB = sellerUsers[(index + 3) % sellerUsers.length];
      const ownerIds = index % 3 === 0 ? [ownerA.id, ownerB.id] : [ownerA.id];
      const registrationCode = `${DEMO_REGISTRATION_PREFIX}${String(index + 1).padStart(3, "0")}`;
      const [insert] = await conn.query(
        `INSERT INTO accounts
          (name, account_type_id, registration_code, phone, economic_sector_id, website, city, state_region,
           country_id, description, address_line, postal_code, activation_status_id,
           created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          buildAccountName(index, country.iso2),
          Number(accountType.id),
          registrationCode,
          `+52 555 ${String(300000 + index).slice(-6)}`,
          Number(sector.id),
          `https://demo-account-${index + 1}.example.com`,
          `Ciudad ${country.iso2}`,
          `Region ${country.iso2}`,
          Number(country.id),
          `${DEMO_MARKER}:account:${String(index + 1).padStart(3, "0")}`,
          `Avenida Demo ${index + 1}`,
          `${10000 + index}`,
          makeAccountStatusId(catalogs, index),
          adminUserId,
          now,
          adminUserId,
          now,
        ],
      );
      const accountId = Number(insert.insertId);
      for (const ownerUserId of ownerIds) {
        await conn.query(
          `INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by)
           VALUES (?, ?, ?, ?)`,
          [accountId, ownerUserId, now, adminUserId],
        );
      }
      createdAccounts.push({
        id: accountId,
        countryId: Number(country.id),
        accountName: buildAccountName(index, country.iso2),
        ownerIds,
        primarySellerId: ownerA.id,
      });
    }

    const createdContactsByAccount = new Map();
    let contactCounter = 0;
    for (let index = 0; index < createdAccounts.length; index += 1) {
      const account = createdAccounts[index];
      const totalContacts =
        options.contactsMin + (index % (options.contactsMax - options.contactsMin + 1));
      const accountContacts = [];
      for (let contactIndex = 0; contactIndex < totalContacts; contactIndex += 1) {
        const firstName = FIRST_NAMES[(contactCounter + contactIndex) % FIRST_NAMES.length];
        const lastName = LAST_NAMES[(contactCounter + index + contactIndex) % LAST_NAMES.length];
        const [insert] = await conn.query(
          `INSERT INTO contacts
            (first_name, last_name, account_id, position_title, phone, phone_extension,
             mobile, email, department, country_id, state_region, city, address_line,
             postal_code, purchase_participation_id, relationship_type_id,
             employment_status_id, activation_status_id, manager_contact_id,
             influences_contact_id, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
          [
            firstName,
            lastName,
            account.id,
            POSITION_TITLES[(contactCounter + contactIndex) % POSITION_TITLES.length],
            `+52 555 ${String(400000 + contactCounter).slice(-6)}`,
            `${100 + ((contactCounter + contactIndex) % 900)}`,
            `+52 777 ${String(500000 + contactCounter).slice(-6)}`,
            `contact.${account.id}.${contactIndex + 1}@demo.local`,
            DEPARTMENTS[(contactCounter + index) % DEPARTMENTS.length],
            account.countryId,
            `Region ${account.id}`,
            `Ciudad ${account.id}`,
            `Contacto demo ${contactCounter + 1}`,
            `${20000 + contactCounter}`,
            Number(pickRow(catalogs.purchaseParticipations, contactCounter).id),
            Number(pickRow(catalogs.relationshipTypes, contactCounter + 1).id),
            Number(pickRow(catalogs.employmentStatuses, contactCounter + 2).id),
            makeContactStatusId(catalogs, contactCounter),
            adminUserId,
            now,
            adminUserId,
            now,
          ],
        );
        accountContacts.push(Number(insert.insertId));
        contactCounter += 1;
      }
      createdContactsByAccount.set(account.id, accountContacts);
    }

    let opportunityCounter = 0;
    for (let index = 0; index < createdAccounts.length; index += 1) {
      const account = createdAccounts[index];
      const contactIds = createdContactsByAccount.get(account.id) || [];
      for (let opportunityIndex = 0; opportunityIndex < options.opportunitiesPerAccount; opportunityIndex += 1) {
        const contactId = contactIds[opportunityIndex % contactIds.length];
        const salesStage = pickRow(catalogs.salesStages, opportunityCounter);
        const businessLine = pickRow(catalogs.businessLines, opportunityCounter + 2);
        const presalesUser = presalesUsers.length
          ? presalesUsers[opportunityCounter % presalesUsers.length]
          : null;
        const closeDate = new Date();
        closeDate.setDate(closeDate.getDate() + 15 + opportunityCounter * 3);
        const closeDateValue = closeDate.toISOString().slice(0, 10);

        await conn.query(
          `INSERT INTO opportunities
            (name, amount_usd, account_id, close_date, contact_id, sales_stage_id, business_line_id,
             seller_user_id, presales_user_id, activation_status_id, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `${BUSINESS_NAMES[opportunityCounter % BUSINESS_NAMES.length]} ${account.accountName}`,
            15000 + opportunityCounter * 1250,
            account.id,
            closeDateValue,
            contactId,
            Number(salesStage.id),
            Number(businessLine.id),
            account.primarySellerId,
            opportunityIndex % 2 === 0 ? presalesUser?.id || null : null,
            makeOpportunityStatusId(catalogs, opportunityCounter),
            adminUserId,
            now,
            adminUserId,
            now,
          ],
        );
        opportunityCounter += 1;
      }
    }

    return {
      adminUserId,
      createdUsers: createdUsers.length,
      createdAccounts: createdAccounts.length,
      createdContacts: contactCounter,
      createdOpportunities: opportunityCounter,
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const userSpecs = buildUserSpecs(options);
  const catalogs = await fetchCatalogs();
  const safetyState = await collectSafetyState(userSpecs);
  const plan = summarizePlan({ options, userSpecs });
  printSummary({ options, userSpecs, safetyState, plan });

  if (safetyState.collisions.length > 0) {
    throw new Error("Hay colisiones con usuarios existentes no demo. Ajusta emails o limpia manualmente antes de sembrar.");
  }
  if (!options.reset && (safetyState.existingDemoUsers.length > 0 || safetyState.existingDemoAccounts.length > 0)) {
    throw new Error("Ya existe data demo. Usa --reset para regenerarla de forma segura.");
  }
  if (options.dryRun) {
    console.log("Dry-run finalizado. No se insertaron datos.");
    return;
  }

  const result = await seedDemoData({ options, userSpecs, catalogs });
  console.log("Seeder demo completado.");
  console.log(`Usuarios creados: ${result.createdUsers}`);
  console.log(`Cuentas creadas: ${result.createdAccounts}`);
  console.log(`Contactos creados: ${result.createdContacts}`);
  console.log(`Oportunidades creadas: ${result.createdOpportunities}`);
  console.log(`Administrador: ${options.adminEmail} / ${options.adminPassword}`);
  console.log(`Oscar: ${options.oscarEmail} / ${options.oscarPassword}`);
  console.log(`Resto de usuarios demo: ${options.defaultPassword}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });