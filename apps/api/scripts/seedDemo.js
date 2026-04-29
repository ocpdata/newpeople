import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { pool, query, withTransaction } from "../src/db.js";
import { config } from "../src/config.js";

const F5_PRODUCTS_PRICE_LIST = JSON.parse(
  readFileSync(new URL("./f5DemoPriceList.json", import.meta.url), "utf8"),
);
const SERVICES_PRICE_LIST = JSON.parse(
  readFileSync(new URL("./servicesDemoPriceList.json", import.meta.url), "utf8"),
);
const ELECTRODATA_PRICE_LIST = JSON.parse(
  readFileSync(new URL("./electrodataDemoPriceList.json", import.meta.url), "utf8"),
);
const BUNDLES_PRICE_LIST = JSON.parse(
  readFileSync(new URL("./bundlesDemoPriceList.json", import.meta.url), "utf8"),
);

const DEMO_MARKER = "DEMO_SEED_V1";
const DEMO_REGISTRATION_PREFIX = "DEMO-ACC-";
const DEMO_PROVIDER_REGISTRATION_PREFIX = "DEMO-PROV-";
const DEFAULT_COUNTS = {
  users: 20,
  accounts: 50,
  contactsMin: 2,
  contactsMax: 4,
  opportunitiesPerAccount: 4,
  providers: 7,
  providerPriceItemsMin: 50,
  providerPriceItemsMax: 50,
};
const SERVICE_ONLY_PROVIDER_INDEX = 3;
const BUNDLES_PROVIDER_INDEX = 6;
const BUNDLES_GROUP_ITEMS_COUNT = 20;
const DEMO_PROVIDER_BLUEPRINTS = [
  {
    providerName: "F5 Networks",
    priceListName: "Productos F5",
    itemType: "producto",
    seededItems: F5_PRODUCTS_PRICE_LIST,
  },
  {
    providerName: "Bluecat Networks",
    priceListName: "Lista base demo 02",
    itemType: "producto",
  },
  {
    providerName: "Cisco",
    priceListName: "Lista base demo 03",
    itemType: "producto",
  },
  {
    providerName: "Servicios Access Quality",
    priceListName: "Servicios",
    itemType: "servicio_propio",
    seededItems: SERVICES_PRICE_LIST,
  },
  {
    providerName: "Electrodata",
    priceListName: "Productos",
    itemType: "producto",
    seededItems: ELECTRODATA_PRICE_LIST,
  },
  {
    providerName: "Otros",
    priceListName: "Lista base demo 05",
    itemType: "producto",
  },
  {
    providerName: "Bundles",
    providerAliases: ["Bundle F5"],
    priceListName: "F5",
    itemType: "grupo_productos",
    seededItems: BUNDLES_PRICE_LIST,
  },
];
const DEMO_CLOSED_OPPORTUNITY_TARGETS = {
  ganada: 10,
  perdida: 4,
  anulada: 5,
};
const DEMO_QUOTATION_TARGET = 24;
const DEFAULT_PASSWORD = "Demo12345!";
const ADMIN_ROLE_NAME = "Administrador";
const SELLER_ROLE_NAME = "Vendedor";
const PRESALES_ROLE_NAME = "Preventa";
const DIR_COMERCIAL_ROLE_NAME = "Director Comercial";
const ING_OPS_ROLE_NAME = "Ingeniero Operaciones";
const CONTABILIDAD_ROLE_NAME = "Contabilidad";

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
const PROVIDER_PREFIXES = [
  "Distribuidora",
  "Mayorista",
  "Tecnologia",
  "Servicios",
  "Integraciones",
  "Redes",
  "Infraestructura",
  "Abastecimiento",
];
const PROVIDER_SUFFIXES = [
  "Continental",
  "Norte",
  "Latam",
  "Prime",
  "Industrial",
  "Corporativo",
  "Global",
  "Especializado",
];
const PROVIDER_PRICE_FAMILIES = [
  "Licenciamiento",
  "Soporte",
  "Implementacion",
  "Monitoreo",
  "Seguridad",
  "Consultoria",
  "Hardware",
  "Servicios administrados",
];
const AVATAR_PALETTES = [
  ["#0f4c81", "#4cc9f0", "#f8fafc"],
  ["#165b33", "#6cbf84", "#f6fff8"],
  ["#7a3b00", "#f4a261", "#fff8f0"],
  ["#6a1b4d", "#f28482", "#fff6f8"],
  ["#1d3557", "#a8dadc", "#f1faee"],
  ["#3d405b", "#81b29a", "#f4f1de"],
  ["#6b2d5c", "#f7a072", "#fff7f3"],
  ["#264653", "#2a9d8f", "#f1fffa"],
];

function hashText(value) {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildInitials(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return "NP";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function buildAvatarDataUrl(user) {
  const seed = `${user.key}|${user.email}|${user.fullName}`;
  const palette = AVATAR_PALETTES[hashText(seed) % AVATAR_PALETTES.length];
  const initials = buildInitials(user.fullName);
  const fullName = escapeXml(user.fullName);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="Avatar de ${fullName}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette[0]}" />
          <stop offset="100%" stop-color="${palette[1]}" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="40" fill="url(#bg)" />
      <circle cx="122" cy="38" r="18" fill="rgba(255,255,255,0.16)" />
      <circle cx="40" cy="132" r="28" fill="rgba(255,255,255,0.11)" />
      <text
        x="50%"
        y="54%"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="60"
        font-weight="700"
        fill="${palette[2]}"
      >${escapeXml(initials)}</text>
    </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

function buildOpportunityCommercialOutcome(catalogs, opportunityCounter, now) {
  const wonLimit = DEMO_CLOSED_OPPORTUNITY_TARGETS.ganada;
  const lostLimit = wonLimit + DEMO_CLOSED_OPPORTUNITY_TARGETS.perdida;
  const cancelledLimit = lostLimit + DEMO_CLOSED_OPPORTUNITY_TARGETS.anulada;

  if (opportunityCounter < wonLimit) {
    return {
      commercialStatusCode: "ganada",
      salesStageId: byCode(catalogs.salesStages, "waiting"),
      commercialStatusId: byCode(
        catalogs.opportunityCommercialStatuses,
        "ganada",
      ),
      commercialClosedAt: now,
      commercialCloseReason: null,
    };
  }

  if (opportunityCounter < lostLimit) {
    return {
      commercialStatusCode: "perdida",
      salesStageId: pickRow(catalogs.salesStages, opportunityCounter).id,
      commercialStatusId: byCode(
        catalogs.opportunityCommercialStatuses,
        "perdida",
      ),
      commercialClosedAt: now,
      commercialCloseReason:
        "Cierre demo: oportunidad perdida por decision del cliente",
    };
  }

  if (opportunityCounter < cancelledLimit) {
    return {
      commercialStatusCode: "anulada",
      salesStageId: pickRow(catalogs.salesStages, opportunityCounter).id,
      commercialStatusId: byCode(
        catalogs.opportunityCommercialStatuses,
        "anulada",
      ),
      commercialClosedAt: now,
      commercialCloseReason:
        "Cierre demo: oportunidad anulada por cambio interno del proyecto",
    };
  }

  return {
    commercialStatusCode: "en_proceso",
    salesStageId: pickRow(catalogs.salesStages, opportunityCounter).id,
    commercialStatusId: byCode(
      catalogs.opportunityCommercialStatuses,
      "en_proceso",
    ),
    commercialClosedAt: null,
    commercialCloseReason: null,
  };
}

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
    else if (key === "admin-email")
      options.adminEmail = String(value).trim().toLowerCase();
    else if (key === "admin-password") options.adminPassword = String(value);
    else if (key === "oscar-name") options.oscarName = String(value);
    else if (key === "oscar-email")
      options.oscarEmail = String(value).trim().toLowerCase();
    else if (key === "oscar-password") options.oscarPassword = String(value);
    else if (key === "default-password")
      options.defaultPassword = String(value);
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
    throw new Error(
      "users debe ser al menos 2 para incluir administrador y Oscar",
    );
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
    {
      key: "patricia-salas",
      fullName: "Patricia Salas",
      email: "patricia.salas@demo.com",
      password: options.defaultPassword,
      roleName: DIR_COMERCIAL_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 300 0001",
      reusable: true,
    },
    {
      key: "laura-mendoza",
      fullName: "Laura Mendoza",
      email: "laura.mendoza@demo.com",
      password: options.defaultPassword,
      roleName: CONTABILIDAD_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 300 0002",
      reusable: true,
    },
    {
      key: "roberto-fuentes",
      fullName: "Roberto Fuentes",
      email: "roberto.fuentes@demo.com",
      password: options.defaultPassword,
      roleName: CONTABILIDAD_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 300 0003",
      reusable: true,
    },
    {
      key: "andres-villanueva",
      fullName: "Andres Villanueva",
      email: "andres.villanueva@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0001",
      reusable: true,
    },
    {
      key: "claudia-herrera",
      fullName: "Claudia Herrera",
      email: "claudia.herrera@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0002",
      reusable: true,
    },
    {
      key: "diego-morales",
      fullName: "Diego Morales",
      email: "diego.morales@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0003",
      reusable: true,
    },
    {
      key: "elena-paredes",
      fullName: "Elena Paredes",
      email: "elena.paredes@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0004",
      reusable: true,
    },
    {
      key: "fernando-castillo",
      fullName: "Fernando Castillo",
      email: "fernando.castillo@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0005",
      reusable: true,
    },
    {
      key: "gabriela-rios",
      fullName: "Gabriela Rios",
      email: "gabriela.rios@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0006",
      reusable: true,
    },
    {
      key: "hector-vargas",
      fullName: "Hector Vargas",
      email: "hector.vargas@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0007",
      reusable: true,
    },
    {
      key: "isabel-navarro",
      fullName: "Isabel Navarro",
      email: "isabel.navarro@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0008",
      reusable: true,
    },
    {
      key: "jorge-medina",
      fullName: "Jorge Medina",
      email: "jorge.medina@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0009",
      reusable: true,
    },
    {
      key: "karla-espinoza",
      fullName: "Karla Espinoza",
      email: "karla.espinoza@demo.com",
      password: options.defaultPassword,
      roleName: ING_OPS_ROLE_NAME,
      description: `${DEMO_MARKER}:user:fixed`,
      mobile: "+52 555 400 0010",
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

  for (const spec of specs) {
    spec.avatarUrl = buildAvatarDataUrl(spec);
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

    const idsByCode = new Map(
      permissionRows.map((row) => [row.code, Number(row.id)]),
    );
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
  const [
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
    opportunityCommercialStatuses,
    opportunityStageQuestions,
    quotationStatuses,
    quotationActivationStatuses,
    quotationSectionInclusionTypes,
    providerStatuses,
    providerPriceItemStatuses,
    productTypes,
    currencies,
  ] = await Promise.all([
    query(
      "SELECT id, iso2, name FROM countries WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM account_types WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM economic_sectors WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM account_activation_statuses WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM contact_purchase_participations WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM contact_relationship_types WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM contact_employment_statuses WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM contact_activation_statuses WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM opportunity_business_lines WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name, stage_order FROM opportunity_sales_stages WHERE is_active = 1 ORDER BY stage_order, id",
    ),
    query(
      "SELECT id, code, name FROM opportunity_activation_statuses WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM opportunity_commercial_statuses WHERE is_active = 1 ORDER BY id",
    ),
    query(
      `SELECT id, sales_stage_id, code, prompt, response_type, display_order
       FROM opportunity_stage_questions
       WHERE is_active = 1
       ORDER BY sales_stage_id, display_order, id`,
    ),
    query(
      "SELECT id, code, name, ui_key AS uiKey FROM quotation_statuses WHERE is_active = 1 ORDER BY display_order, id",
    ),
    query(
      "SELECT id, code, name FROM quotation_activation_statuses WHERE is_active = 1 ORDER BY display_order, id",
    ),
    query(
      "SELECT id, code, name FROM quotation_section_inclusion_types WHERE is_active = 1 ORDER BY display_order, id",
    ),
    query(
      "SELECT id, code, name FROM provider_activation_statuses WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM provider_price_list_item_statuses WHERE is_active = 1 ORDER BY id",
    ),
    query(
      "SELECT id, code, name FROM product_types WHERE is_active = 1 ORDER BY sort_order, id",
    ),
    query(
      "SELECT id, code, name, symbol FROM currencies WHERE is_active = 1 ORDER BY id",
    ),
  ]);

  if (
    !countries.length ||
    !accountTypes.length ||
    !economicSectors.length ||
    !providerStatuses.length ||
    !providerPriceItemStatuses.length ||
    !productTypes.length ||
    !currencies.length
  ) {
    throw new Error(
      "Faltan catalogos base. Ejecuta primero apps/api/sql/schema.sql",
    );
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
    opportunityCommercialStatuses,
    opportunityStageQuestions,
    quotationStatuses,
    quotationActivationStatuses,
    quotationSectionInclusionTypes,
    providerStatuses,
    providerPriceItemStatuses,
    productTypes,
    currencies,
  };
}

function byCode(rows, code) {
  const match = rows.find((row) => String(row.code) === String(code));
  if (!match) {
    throw new Error(`No se encontro catalogo con code=${code}`);
  }
  return Number(match.id);
}

function buildQuotationIntroduction(
  opportunityName,
  accountName,
  versionNumber,
) {
  return `Cotizacion demo v${versionNumber} para ${opportunityName} sobre la cuenta ${accountName}. Incluye alcance preliminar, precios de referencia y supuestos operativos para validacion funcional.`;
}

function buildQuotationSectionTitle(index, accountName) {
  const titles = [
    "Licenciamiento y suscripciones",
    "Servicios profesionales",
    "Alcance opcional",
  ];
  return `${titles[index % titles.length]} - ${accountName}`;
}

function makeQuotationStatusCode(index) {
  if (index % 7 === 0) return "enviada";
  if (index % 5 === 0) return "aprobada";
  if (index % 3 === 0) return "en_aprobacion";
  return "borrador";
}

function buildQuotationSectionItems({
  quotationSeedIndex,
  providers,
  sectionId,
  adminUserId,
  now,
}) {
  const firstProvider = pickRow(providers, quotationSeedIndex);
  const secondProvider = pickRow(providers, quotationSeedIndex + 2);

  return [
    {
      quotationSectionId: sectionId,
      providerId: Number(firstProvider.id),
      productCode: `DEMO-Q-${String(quotationSeedIndex + 1).padStart(3, "0")}-A`,
      productDescription: `Componente principal demo para proveedor ${firstProvider.name}`,
      quantity: 1,
      listPriceUnit: 12500 + quotationSeedIndex * 180,
      manufacturerDiscountPct: 7.5,
      importCostPct: 4.25,
      profitMarginPct: 18,
      displayOrder: 1,
      createdByUserId: adminUserId,
      updatedByUserId: adminUserId,
      createdAt: now,
      updatedAt: now,
    },
    {
      quotationSectionId: sectionId,
      providerId: Number(secondProvider.id),
      productCode: `DEMO-Q-${String(quotationSeedIndex + 1).padStart(3, "0")}-B`,
      productDescription: `Servicio complementario demo para proveedor ${secondProvider.name}`,
      quantity: 1,
      listPriceUnit: 4200 + quotationSeedIndex * 90,
      manufacturerDiscountPct: 0,
      importCostPct: 0,
      profitMarginPct: 22,
      displayOrder: 2,
      createdByUserId: adminUserId,
      updatedByUserId: adminUserId,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

async function seedDemoQuotations({
  conn,
  catalogs,
  adminUserId,
  opportunities,
  providers,
  now,
}) {
  const activeOpportunities = opportunities
    .filter((opportunity) => opportunity.activationStatusCode === "activada")
    .slice(0, DEMO_QUOTATION_TARGET);

  if (!activeOpportunities.length || !providers.length) {
    return { createdQuotations: 0, createdQuotationVersions: 0 };
  }

  const activeQuotationStatusId = byCode(
    catalogs.quotationActivationStatuses,
    "activada",
  );
  const includedTypeId = byCode(
    catalogs.quotationSectionInclusionTypes,
    "incluida",
  );
  const optionalTypeId = byCode(
    catalogs.quotationSectionInclusionTypes,
    "opcional",
  );

  let createdQuotations = 0;
  let createdQuotationVersions = 0;

  for (let index = 0; index < activeOpportunities.length; index += 1) {
    const opportunity = activeOpportunities[index];
    const [quotationInsert] = await conn.query(
      `INSERT INTO quotations
        (opportunity_id, latest_version_id, activation_status_id, created_at, updated_at, created_by_user_id, updated_by_user_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [
        opportunity.id,
        activeQuotationStatusId,
        now,
        now,
        adminUserId,
        adminUserId,
      ],
    );
    const quotationId = Number(quotationInsert.insertId);
    const totalVersions = index % 4 === 0 ? 2 : 1;
    let latestVersionId = null;

    for (
      let versionNumber = 1;
      versionNumber <= totalVersions;
      versionNumber += 1
    ) {
      const statusCode =
        versionNumber < totalVersions
          ? "no_vigente"
          : makeQuotationStatusCode(index);
      const statusId = byCode(catalogs.quotationStatuses, statusCode);
      const quotationDate = new Date(now);
      quotationDate.setDate(
        quotationDate.getDate() - index - (totalVersions - versionNumber),
      );
      const [versionInsert] = await conn.query(
        `INSERT INTO quotation_versions
          (quotation_id, version_number, contact_id, proposal_name, quotation_date, introduction,
           status_id, activation_status_id, created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotationId,
          versionNumber,
          opportunity.contactId,
          `${opportunity.name} - Propuesta v${versionNumber}`,
          quotationDate.toISOString().slice(0, 10),
          buildQuotationIntroduction(
            opportunity.name,
            opportunity.accountName,
            versionNumber,
          ),
          statusId,
          activeQuotationStatusId,
          now,
          now,
          adminUserId,
          adminUserId,
        ],
      );
      latestVersionId = Number(versionInsert.insertId);
      createdQuotationVersions += 1;

      const sections = [
        {
          title: buildQuotationSectionTitle(0, opportunity.accountName),
          inclusionTypeId: includedTypeId,
          displayOrder: 1,
        },
        {
          title: buildQuotationSectionTitle(1, opportunity.accountName),
          inclusionTypeId: index % 2 === 0 ? optionalTypeId : includedTypeId,
          displayOrder: 2,
        },
      ];

      for (const section of sections) {
        const [sectionInsert] = await conn.query(
          `INSERT INTO quotation_sections
            (quotation_version_id, title, inclusion_type_id, activation_status_id, display_order,
             created_at, updated_at, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            latestVersionId,
            section.title,
            section.inclusionTypeId,
            activeQuotationStatusId,
            section.displayOrder,
            now,
            now,
            adminUserId,
            adminUserId,
          ],
        );
        const sectionId = Number(sectionInsert.insertId);
        const sectionItems = buildQuotationSectionItems({
          quotationSeedIndex: index + versionNumber,
          providers,
          sectionId,
          adminUserId,
          now,
        });

        for (const item of sectionItems) {
          await conn.query(
            `INSERT INTO quotation_section_items
              (quotation_section_id, provider_id, product_code, product_description, quantity, list_price_unit,
               manufacturer_discount_pct, import_cost_pct, profit_margin_pct, display_order,
               created_at, updated_at, created_by_user_id, updated_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.quotationSectionId,
              item.providerId,
              item.productCode,
              item.productDescription,
              item.quantity,
              item.listPriceUnit,
              item.manufacturerDiscountPct,
              item.importCostPct,
              item.profitMarginPct,
              item.displayOrder,
              item.createdAt,
              item.updatedAt,
              item.createdByUserId,
              item.updatedByUserId,
            ],
          );
        }
      }
    }

    await conn.query(
      `UPDATE quotations
       SET latest_version_id = ?, updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [latestVersionId, now, adminUserId, quotationId],
    );
    createdQuotations += 1;
  }

  return { createdQuotations, createdQuotationVersions };
}

function groupStageQuestionsByStageId(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const stageId = Number(row.sales_stage_id);
    if (!grouped.has(stageId)) {
      grouped.set(stageId, []);
    }
    grouped.get(stageId).push({
      id: Number(row.id),
      salesStageId: stageId,
      code: String(row.code),
      prompt: String(row.prompt),
      responseType: String(row.response_type),
      displayOrder: Number(row.display_order),
    });
  }
  return grouped;
}

function normalizeSeedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pickVariant(options, seedParts) {
  const seed = seedParts.map((part) => String(part || "")).join("|");
  return options[hashText(seed) % options.length];
}

function buildAccountProfile(account, opportunityId) {
  const sectorName = String(account.economicSectorName || "").trim();
  const accountTypeName = String(account.accountTypeName || "").trim();
  const normalizedSector = normalizeSeedText(sectorName);
  const normalizedAccountType = normalizeSeedText(accountTypeName);

  const sectorContext = normalizedSector.includes("finan")
    ? pickVariant(
        [
          "El cliente opera con foco en control, continuidad y trazabilidad de procesos criticos.",
          "El contexto del cliente exige seguridad, disponibilidad y visibilidad sobre operaciones sensibles.",
          "La conversacion gira alrededor de confiabilidad, cumplimiento y continuidad del servicio.",
        ],
        [opportunityId, sectorName, "sector-finanzas"],
      )
    : normalizedSector.includes("gob") || normalizedSector.includes("public")
      ? pickVariant(
          [
            "El entorno del cliente requiere justificar valor, formalidad de compra y sostenibilidad operativa.",
            "La decision del cliente está muy ligada a procesos formales, respaldo y capacidad de ejecucion documentada.",
            "El caso exige claridad en alcance, soporte y cumplimiento de lineamientos internos.",
          ],
          [opportunityId, sectorName, "sector-publico"],
        )
      : normalizedSector.includes("salud")
        ? pickVariant(
            [
              "La prioridad del cliente está en continuidad, tiempos de respuesta y estabilidad del servicio.",
              "El proyecto se evalúa con foco en disponibilidad, soporte y reduccion de riesgo operativo.",
              "La organizacion necesita una solucion robusta para proteger continuidad y calidad de atencion.",
            ],
            [opportunityId, sectorName, "sector-salud"],
          )
        : normalizedSector.includes("educ")
          ? pickVariant(
              [
                "El cliente busca una solucion simple de operar, escalable y facil de adoptar por equipos amplios.",
                "La conversacion prioriza usabilidad, despliegue ordenado y sostenibilidad de largo plazo.",
                "El valor esperado se concentra en adopcion rapida, soporte y facilidad de administracion.",
              ],
              [opportunityId, sectorName, "sector-educacion"],
            )
          : pickVariant(
              [
                "El caso de negocio se evalúa por impacto operativo, viabilidad y capacidad real de implementacion.",
                "La oportunidad se está trabajando con foco en valor tangible, continuidad y escalabilidad.",
                "El cliente prioriza resultados medibles, bajo riesgo de ejecucion y acompanamiento confiable.",
              ],
              [
                opportunityId,
                sectorName || account.accountName,
                "sector-default",
              ],
            );

  const accountTypeContext = normalizedAccountType.includes("prospect")
    ? pickVariant(
        [
          "Al ser una cuenta prospecto, todavía estamos construyendo confianza y criterio de comparacion.",
          "Como prospecto, la cuenta requiere mayor trabajo de posicionamiento y validacion de valor.",
          "La relacion está en fase de descubrimiento, por lo que cada avance debe reforzar credibilidad y diferenciacion.",
        ],
        [opportunityId, accountTypeName, "type-prospecto"],
      )
    : normalizedAccountType.includes("cliente")
      ? pickVariant(
          [
            "Al tratarse de un cliente existente, la conversacion aprovecha experiencia previa y confianza operativa.",
            "La cuenta ya conoce nuestro trabajo, así que el foco está en ampliar valor y reducir friccion de decision.",
            "Existe historial con la cuenta y eso facilita avanzar sobre resultados concretos y expectativas realistas.",
          ],
          [opportunityId, accountTypeName, "type-cliente"],
        )
      : pickVariant(
          [
            "La tipologia de la cuenta sugiere equilibrar relacion comercial, riesgo y claridad de propuesta.",
            "El tipo de cuenta exige combinar valor consultivo con una propuesta ejecutable y competitiva.",
            "La conversacion comercial se está ajustando al nivel de madurez y relacion actual con la cuenta.",
          ],
          [
            opportunityId,
            accountTypeName || account.accountName,
            "type-default",
          ],
        );

  return {
    sectorName,
    accountTypeName,
    sectorContext,
    accountTypeContext,
  };
}

function buildDemoOpportunityAnswerValue({
  question,
  stage,
  opportunityName,
  account,
  contactId,
  sellerUserId,
  opportunityId,
  commercialStatusCode,
}) {
  const stageCode = normalizeSeedText(stage.code || stage.name);
  const questionCode = normalizeSeedText(question.code);
  const statusCode = normalizeSeedText(commercialStatusCode);

  const sharedContext = {
    opportunityName,
    accountName: account.accountName,
    contactId,
    sellerUserId,
    opportunityId,
    ...buildAccountProfile(account, opportunityId),
  };

  const dealContext =
    statusCode === "ganada"
      ? pickVariant(
          [
            "La oportunidad ya muestra senales claras de cierre favorable y buena alineacion ejecutiva.",
            "El cliente ha confirmado preferencia por nuestra propuesta y el escenario luce favorable.",
            "La conversacion comercial evoluciono con alta probabilidad de adjudicacion para nuestro equipo.",
          ],
          [opportunityId, statusCode, "deal-context"],
        )
      : statusCode === "perdida"
        ? pickVariant(
            [
              "Se detectaron objeciones comerciales relevantes y mayor presion competitiva en la decision.",
              "El cliente comparo alternativas con mayor peso en precio y redujo nuestra probabilidad de exito.",
              "La evaluacion final se complico por restricciones presupuestales y preferencia por otro proveedor.",
            ],
            [opportunityId, statusCode, "deal-context"],
          )
        : statusCode === "anulada"
          ? pickVariant(
              [
                "El proyecto perdió prioridad interna por cambios en agenda y aprobaciones del cliente.",
                "La iniciativa quedó pausada por redefinicion del alcance y reordenamiento interno del cliente.",
                "Hubo cambio de patrocinio interno y la oportunidad dejó de avanzar en el corto plazo.",
              ],
              [opportunityId, statusCode, "deal-context"],
            )
          : pickVariant(
              [
                "La oportunidad sigue avanzando con seguimiento regular y espacio para fortalecer posicionamiento.",
                "El proceso comercial continúa activo y todavía hay margen para construir valor diferencial.",
                "El cliente mantiene interes y la oportunidad requiere acompanamiento constante en esta fase.",
              ],
              [opportunityId, statusCode, "deal-context"],
            );

  if (stageCode === "contacto_inicial") {
    const opener = pickVariant(
      [
        `El cliente de ${sharedContext.accountName} mostró interes inicial por ${sharedContext.opportunityName} para resolver una necesidad inmediata de negocio.`,
        `${sharedContext.accountName} abrió la conversacion inicial alrededor de ${sharedContext.opportunityName} con foco en mejorar continuidad operativa.`,
        `La primera interaccion con ${sharedContext.accountName} evidencio una necesidad concreta que conecta bien con ${sharedContext.opportunityName}.`,
      ],
      [opportunityId, stageCode, question.code, "opener"],
    );
    return `${opener} El contacto ${sharedContext.contactId} confirmó apertura para una reunion de descubrimiento con el vendedor ${sharedContext.sellerUserId}. ${sharedContext.accountTypeContext} ${dealContext}`;
  }

  if (stageCode === "identificacion_oportunidad") {
    if (questionCode.includes("presupuesto")) {
      return `${pickVariant(
        [
          `El cliente maneja una referencia presupuestal preliminar y esta validando la fuente interna de fondos para ${sharedContext.opportunityName}.`,
          `Existe un rango presupuestal tentativo para ${sharedContext.opportunityName}, aunque aún depende de confirmacion interna.`,
          `La conversacion economica ya arrancó y el cliente estima un presupuesto inicial compatible con ${sharedContext.opportunityName}.`,
        ],
        [opportunityId, stageCode, question.code],
      )} El vendedor ${sharedContext.sellerUserId} acordó aterrizar el rango economico durante la siguiente reunion. ${sharedContext.sectorContext} ${dealContext}`;
    }
    if (questionCode.includes("fecha_adquisicion")) {
      return `${pickVariant(
        [
          `La adquisicion ideal debe concretarse dentro del proximo trimestre para no afectar la hoja de ruta operativa de ${sharedContext.accountName}.`,
          `${sharedContext.accountName} necesita tomar decision dentro del siguiente ciclo trimestral para no mover hitos del proyecto.`,
          `La ventana esperada de compra es corta y coincide con iniciativas prioritarias que el cliente no quiere retrasar.`,
        ],
        [opportunityId, stageCode, question.code],
      )} Si la compra se retrasa, el impacto esperado es menor continuidad del servicio y mayor presion sobre el equipo interno.`;
    }
    if (questionCode.includes("decisor") || questionCode.includes("compra")) {
      return `${pickVariant(
        [
          "La decision final involucra al area usuaria, compras y direccion de TI.",
          "El proceso de definicion ya incluye a negocio, compras y al sponsor de tecnologia.",
          "La compra se resolverá con participacion conjunta de usuarios clave, compras y liderazgo tecnico.",
        ],
        [opportunityId, stageCode, question.code],
      )} El proceso requiere validacion tecnica, cuadro comparativo y aprobacion financiera antes de emitir la orden. ${dealContext}`;
    }
    return `${pickVariant(
      [
        `En la etapa de identificacion se confirmo que ${sharedContext.accountName} necesita una solucion alineada a ${sharedContext.opportunityName}, con foco en impacto de negocio, viabilidad tecnica y argumentos diferenciales frente a otros postores.`,
        `La fase de descubrimiento permitió precisar que ${sharedContext.opportunityName} responde a una necesidad real de ${sharedContext.accountName} y requiere argumentos claros de valor.`,
        `Ya quedó claro que ${sharedContext.accountName} busca una solucion como ${sharedContext.opportunityName} y evaluará cuidadosamente viabilidad, costo e impacto esperado.`,
      ],
      [opportunityId, stageCode, question.code],
    )} ${sharedContext.sectorContext} ${sharedContext.accountTypeContext} ${dealContext}`;
  }

  if (stageCode === "desarrollo") {
    if (questionCode.includes("riesgo_tecnico")) {
      return `${pickVariant(
        [
          "Se identificaron riesgos tecnicos moderados relacionados con integracion, ventanas de cambio y capacidad del ambiente actual.",
          "Los principales riesgos tecnicos se concentran en integracion, dependencias del entorno actual y tiempos de despliegue.",
          "El analisis tecnico mostró riesgos manejables en interoperabilidad, pruebas y adopcion operativa.",
        ],
        [opportunityId, stageCode, question.code],
      )} La mitigacion propuesta considera pruebas controladas, plan de rollback y acompanamiento del equipo preventa.`;
    }
    if (questionCode.includes("aceptacion_propuesta")) {
      return `${pickVariant(
        [
          "El cliente recibio favorablemente la propuesta tecnica y solicitó pequenos ajustes de alcance antes de considerarla definitiva.",
          "La propuesta tecnica fue bien valorada y solo quedaron ajustes menores antes de su validacion final.",
          "La arquitectura planteada generó buena recepcion y el cliente pidió refinamientos puntuales, no cambios estructurales.",
        ],
        [opportunityId, stageCode, question.code],
      )} No se detectaron objeciones de fondo sobre la arquitectura planteada. ${dealContext}`;
    }
    return `${pickVariant(
      [
        `Durante el desarrollo de ${sharedContext.opportunityName} se profundizo en arquitectura, alcances y criterios tecnicos.`,
        `La etapa de desarrollo de ${sharedContext.opportunityName} permitió aterrizar arquitectura, dependencias y entregables clave.`,
        `En desarrollo se consolidaron alcances tecnicos y criterios de implementacion para ${sharedContext.opportunityName}.`,
      ],
      [opportunityId, stageCode, question.code],
    )} ${sharedContext.accountName} validó que la solucion cubre los puntos criticos y deja una base clara para la propuesta comercial. ${sharedContext.sectorContext} ${dealContext}`;
  }

  if (stageCode === "cotizacion") {
    if (questionCode.includes("condiciones_comerciales")) {
      return `${pickVariant(
        [
          `Las condiciones comerciales propuestas son consistentes con los tiempos de pago y formalizacion esperados por ${sharedContext.accountName}.`,
          `La estructura comercial presentada encaja razonablemente con el esquema de compra y aprobacion del cliente.`,
          `Las condiciones propuestas resultan compatibles con la forma en que ${sharedContext.accountName} suele formalizar este tipo de proyectos.`,
        ],
        [opportunityId, stageCode, question.code],
      )} Quedó pendiente validar ajustes menores en vigencia y esquema de facturacion.`;
    }
    return `${pickVariant(
      [
        `La propuesta economica presentada para ${sharedContext.opportunityName} se encuentra dentro del rango que el cliente considera defendible.`,
        `El precio de ${sharedContext.opportunityName} quedó cerca del rango validado por el cliente y es comercialmente competitivo.`,
        `La propuesta economica ya se ve razonable para ${sharedContext.accountName}, aunque todavía hay espacio para reforzar percepcion de valor.`,
      ],
      [opportunityId, stageCode, question.code],
    )} El vendedor ${sharedContext.sellerUserId} detectó espacio para afinar valor percibido antes del cierre. ${sharedContext.accountTypeContext} ${dealContext}`;
  }

  if (stageCode === "demostracion") {
    if (questionCode.includes("criterios_exito")) {
      return `${pickVariant(
        [
          "Los criterios de exito acordados incluyen facilidad de uso, cobertura funcional, tiempos de respuesta y claridad en la integracion con el entorno actual.",
          "El cliente definio como criterios de exito una demostracion clara de cobertura funcional, simplicidad operativa y encaje con su ambiente actual.",
          "Se acordó medir el exito de la demo por usabilidad, capacidad de integracion y evidencia de resultados en escenarios reales.",
        ],
        [opportunityId, stageCode, question.code],
      )} El cliente espera evidencias concretas sobre operacion real.`;
    }
    if (questionCode.includes("resultado")) {
      return `${pickVariant(
        [
          "La demostracion fue bien recibida y permitió resolver dudas funcionales clave.",
          "La sesion de demostracion respondió las preguntas más sensibles y fortaleció la confianza del cliente.",
          "El resultado de la demostracion fue positivo y dejó mejor posicionada la propuesta frente a la competencia.",
        ],
        [opportunityId, stageCode, question.code],
      )} El cliente confirmó interes en avanzar, siempre que la propuesta final conserve el enfoque mostrado durante la sesion. ${dealContext}`;
    }
    return `${pickVariant(
      [
        `La demostracion de ${sharedContext.opportunityName} se orientó a mostrar escenarios reales del cliente y reforzar confianza en la solucion.`,
        `La demo de ${sharedContext.opportunityName} priorizó casos de uso reales para que ${sharedContext.accountName} visualizara adopcion y valor.`,
        `Se construyó una demostracion enfocada en situaciones operativas concretas para acelerar la evaluacion del cliente.`,
      ],
      [opportunityId, stageCode, question.code],
    )} El equipo de ${sharedContext.accountName} dejó siguientes pasos claros para continuar la evaluacion. ${sharedContext.sectorContext} ${dealContext}`;
  }

  if (stageCode === "negociacion") {
    if (
      questionCode.includes("precio") ||
      questionCode.includes("condiciones")
    ) {
      return `${pickVariant(
        [
          "El rango minimo negociable ya fue definido con condiciones que preservan margen y competitividad.",
          "Ya se estableció un piso comercial razonable que protege rentabilidad y mantiene atractiva la propuesta.",
          "La estrategia de negociacion contempla flexibilidad acotada para sostener competitividad sin erosionar margen.",
        ],
        [opportunityId, stageCode, question.code],
      )} Se puede flexibilizar calendario de entrega y forma de pago, pero sin comprometer el alcance critico del proyecto. ${dealContext}`;
    }
    return `${pickVariant(
      [
        `En la negociacion, ${sharedContext.accountName} prioriza respaldo tecnico, tiempos de implementacion y acompanamiento postventa.`,
        `La conversacion de negociacion gira en torno a valor percibido, soporte, tiempos de entrega y condiciones de servicio.`,
        `En esta etapa, ${sharedContext.accountName} está comparando principalmente solidez tecnica, acompanamiento y condiciones finales.`,
      ],
      [opportunityId, stageCode, question.code],
    )} Desde nuestro lado, los puntos mas sensibles son alcance, margen y compromiso de decision en fecha acordada. ${sharedContext.accountTypeContext} ${dealContext}`;
  }

  if (stageCode === "waiting") {
    if (statusCode === "ganada") {
      return `${pickVariant(
        [
          `La propuesta de ${sharedContext.opportunityName} llegó a decision final con clara preferencia del cliente por nuestra oferta.`,
          `${sharedContext.accountName} cerró la evaluacion de ${sharedContext.opportunityName} con inclinacion favorable hacia nuestra propuesta.`,
          `En waiting, ${sharedContext.opportunityName} ya mostraba señales firmes de adjudicacion para nuestro equipo.`,
        ],
        [opportunityId, stageCode, statusCode, question.code],
      )} El valor tecnico, la propuesta economica y la confianza de ejecucion terminaron inclinando la decision.`;
    }
    return `${pickVariant(
      [
        `La propuesta de ${sharedContext.opportunityName} quedó en decision final. ${sharedContext.accountName} comparará oferta economica, valor tecnico y capacidad de ejecucion antes de emitir su definicion.`,
        `La oportunidad ${sharedContext.opportunityName} entró a evaluación final y el cliente quedó de contrastar precio, alcance y respaldo de entrega.`,
        `${sharedContext.accountName} dejó ${sharedContext.opportunityName} en espera de definicion final tras revisar propuesta, tiempos y valor agregado.`,
      ],
      [opportunityId, stageCode, statusCode, question.code],
    )} ${sharedContext.sectorContext} ${dealContext}`;
  }

  return `${pickVariant(
    [
      `Seguimiento demo de la oportunidad ${sharedContext.opportunityName} para ${sharedContext.accountName}.`,
      `La oportunidad ${sharedContext.opportunityName} sigue en seguimiento dentro de ${sharedContext.accountName}.`,
      `Se mantiene trazabilidad comercial y tecnica sobre ${sharedContext.opportunityName} en ${sharedContext.accountName}.`,
    ],
    [opportunityId, stageCode, question.code, "fallback"],
  )} El contacto ${sharedContext.contactId} mantiene comunicacion activa con el vendedor ${sharedContext.sellerUserId} y la respuesta registrada cubre ${question.prompt}. ${dealContext}`;
}

async function seedOpportunityStageAnswers({
  conn,
  opportunityId,
  activeSalesStageId,
  commercialStatusCode,
  catalogs,
  now,
  opportunityName,
  account,
  contactId,
  sellerUserId,
}) {
  const activeStage = catalogs.salesStages.find(
    (stage) => Number(stage.id) === Number(activeSalesStageId),
  );
  if (!activeStage) {
    throw new Error(
      `Etapa activa no encontrada para oportunidad ${opportunityId}`,
    );
  }

  const questionsByStageId = groupStageQuestionsByStageId(
    catalogs.opportunityStageQuestions,
  );
  const eligibleStages = catalogs.salesStages.filter(
    (stage) => Number(stage.stage_order) <= Number(activeStage.stage_order),
  );

  for (const stage of eligibleStages) {
    const questions = questionsByStageId.get(Number(stage.id)) || [];
    for (const question of questions) {
      await conn.query(
        `INSERT INTO opportunity_stage_question_answers
          (opportunity_id, sales_stage_id, question_id, question_code_snapshot,
           question_prompt_snapshot, answer_value, answered_by_user_id, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          opportunityId,
          Number(stage.id),
          Number(question.id),
          question.code,
          question.prompt,
          buildDemoOpportunityAnswerValue({
            question,
            stage,
            opportunityName,
            account,
            contactId,
            sellerUserId,
            opportunityId,
            commercialStatusCode,
          }),
          sellerUserId,
          now,
        ],
      );
    }
  }
}

async function collectSafetyState(userSpecs) {
  const emails = userSpecs.map((user) => user.email);
  const placeholders = emails.map(() => "?").join(", ");
  const [emailRows, demoUserRows, demoAccountRows, demoProviderRows] =
    await Promise.all([
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
      query(
        `SELECT id
       FROM providers
       WHERE registration_code LIKE ?`,
        [`${DEMO_PROVIDER_REGISTRATION_PREFIX}%`],
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
    existingDemoProviders: demoProviderRows,
  };
}

function summarizePlan({ options, userSpecs }) {
  const contactCounts = Array.from(
    { length: options.accounts },
    (_, index) =>
      options.contactsMin +
      (index % (options.contactsMax - options.contactsMin + 1)),
  );
  const totalContacts = contactCounts.reduce((sum, count) => sum + count, 0);
  const totalProviderPriceItems = Array.from(
    { length: DEFAULT_COUNTS.providers },
    (_, index) => makeProviderPriceItemsCount(index),
  ).reduce((sum, count) => sum + count, 0);
  return {
    totalUsers: userSpecs.length,
    totalAccounts: options.accounts,
    totalContacts,
    totalOpportunities: options.accounts * options.opportunitiesPerAccount,
    totalProviders: DEFAULT_COUNTS.providers,
    totalProviderPriceItems,
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
  console.log(`Proveedores a sembrar: ${plan.totalProviders}`);
  console.log(
    `Precios de proveedores estimados: ${plan.totalProviderPriceItems}`,
  );
  console.log(
    `Datos demo existentes: ${safetyState.existingDemoUsers.length} usuarios, ${safetyState.existingDemoAccounts.length} cuentas, ${safetyState.existingDemoProviders.length} proveedores`,
  );
  console.log(
    `Usuarios reutilizables detectados: ${safetyState.reusableExistingUsers.length}`,
  );
  console.log(`Administrador: ${options.adminName} <${options.adminEmail}>`);
  console.log(
    `Usuario vendedor garantizado: ${options.oscarName} <${options.oscarEmail}>`,
  );
  console.log(`Password resto de usuarios: ${options.defaultPassword}`);
  console.log(
    `Primeros usuarios demo: ${userSpecs
      .slice(0, 5)
      .map((user) => `${user.fullName} (${user.roleName})`)
      .join(", ")}`,
  );
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
  if (index % 4 === 0)
    return byCode(catalogs.accountStatuses, "pendiente_activacion");
  return byCode(catalogs.accountStatuses, "activada");
}

function makeContactStatusId(catalogs, index) {
  if (index % 9 === 0) return byCode(catalogs.contactStatuses, "desactivado");
  if (index % 4 === 0)
    return byCode(catalogs.contactStatuses, "pendiente_activacion");
  return byCode(catalogs.contactStatuses, "activado");
}

function makeOpportunityStatusId(catalogs, index) {
  if (index % 11 === 0)
    return byCode(catalogs.opportunityStatuses, "desactivada");
  if (index % 3 === 0)
    return byCode(catalogs.opportunityStatuses, "pendiente_activacion");
  return byCode(catalogs.opportunityStatuses, "activada");
}

function buildAccountName(index, countryIso2) {
  const prefix = ACCOUNT_PREFIXES[index % ACCOUNT_PREFIXES.length];
  const suffix = ACCOUNT_SUFFIXES[(index * 2) % ACCOUNT_SUFFIXES.length];
  return `${prefix} ${suffix} ${countryIso2} ${String(index + 1).padStart(2, "0")}`;
}

function getDemoProviderBlueprint(index) {
  return (
    DEMO_PROVIDER_BLUEPRINTS[index] || {
      providerName: `Proveedor demo ${index + 1}`,
      priceListName: `Lista base demo ${String(index + 1).padStart(2, "0")}`,
      itemType: "producto",
      providerAliases: [],
    }
  );
}

function buildProviderName(index) {
  return getDemoProviderBlueprint(index).providerName;
}

function buildProviderPriceListName(index) {
  return getDemoProviderBlueprint(index).priceListName;
}

function buildProviderAliases(index) {
  return getDemoProviderBlueprint(index).providerAliases || [];
}

function buildProviderItemType(index) {
  return getDemoProviderBlueprint(index).itemType;
}

function buildProviderSeedItems(index) {
  return getDemoProviderBlueprint(index).seededItems || [];
}

function buildProviderPriceListIsActive(index) {
  return getDemoProviderBlueprint(index).isActive ?? 1;
}

function makeProviderStatusId(catalogs) {
  return byCode(catalogs.providerStatuses, "activado");
}

function makeProviderPriceItemsCount(index) {
  const seededItems = buildProviderSeedItems(index);
  if (seededItems.length > 0) {
    return seededItems.length;
  }

  if (index === BUNDLES_PROVIDER_INDEX) {
    return BUNDLES_GROUP_ITEMS_COUNT;
  }

  return (
    DEFAULT_COUNTS.providerPriceItemsMin +
    (index %
      (DEFAULT_COUNTS.providerPriceItemsMax -
        DEFAULT_COUNTS.providerPriceItemsMin +
        1))
  );
}

function makeProviderPriceItemStatusId({ catalogs, status = "activo" }) {
  const normalizedStatus = normalizeSeedText(status).trim();
  if (normalizedStatus === "inactivo") {
    return byCode(catalogs.providerPriceItemStatuses, "inactivo");
  }
  return byCode(catalogs.providerPriceItemStatuses, "activo");
}

function buildProviderPriceItemCode(providerIndex, itemIndex) {
  return `ITEM-${String(providerIndex + 1).padStart(2, "0")}-${String(itemIndex + 1).padStart(2, "0")}`;
}

function buildProviderPriceItemDescription({
  providerName,
  familyName,
  currencyCode,
}) {
  return `${familyName} para ${providerName} con referencia comercial en ${currencyCode}. Incluye alcance demo para cotizacion y seguimiento operativo.`;
}

function buildBundlesGroupItemCode(itemIndex) {
  return `BUNDLE-${String(itemIndex + 1).padStart(2, "0")}`;
}

function buildBundlesGroupItemDescription(itemIndex, componentCount) {
  return `Bundle demo ${String(itemIndex + 1).padStart(2, "0")} compuesto por ${componentCount} componentes activos para simulacion comercial.`;
}

function buildBundleComponents({
  itemIndex,
  productCandidates,
  serviceCandidates,
}) {
  if (!productCandidates.length || !serviceCandidates.length) {
    throw new Error(
      "No hay suficientes productos o servicios demo para construir Bundles",
    );
  }

  const targetComponentCount = 3 + (itemIndex % 5);
  const components = [];
  const usedIds = new Set();

  const serviceCandidate =
    serviceCandidates[itemIndex % serviceCandidates.length];
  components.push({
    componentItemId: Number(serviceCandidate.id),
    quantity: 1,
    price: Number(serviceCandidate.price),
    itemType: "servicio_propio",
  });
  usedIds.add(Number(serviceCandidate.id));

  let productCursor = itemIndex * 3;
  while (components.length < targetComponentCount) {
    const productCandidate =
      productCandidates[productCursor % productCandidates.length];
    productCursor += 1;

    if (usedIds.has(Number(productCandidate.id))) {
      continue;
    }

    components.push({
      componentItemId: Number(productCandidate.id),
      quantity: 1 + ((itemIndex + components.length) % 2),
      price: Number(productCandidate.price),
      itemType: "producto",
    });
    usedIds.add(Number(productCandidate.id));
  }

  return components;
}

function buildComponentLookupKey(providerName, code) {
  return `${normalizeSeedText(providerName).trim()}::${normalizeSeedText(code).trim()}`;
}

function resolveSeededBundleComponents({ components, itemLookup }) {
  return components.map((component, index) => {
    const lookupKey = buildComponentLookupKey(
      component.providerName,
      component.code,
    );
    const resolvedItem = itemLookup.get(lookupKey);

    if (!resolvedItem) {
      throw new Error(
        `No se encontro el componente ${component.providerName} / ${component.code} para el bundle demo`,
      );
    }

    return {
      componentItemId: Number(resolvedItem.id),
      quantity: Number(component.quantity || 1),
      price: Number(resolvedItem.price),
      itemType: resolvedItem.itemType,
      sortOrder: index,
    };
  });
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
    `DELETE ppi FROM provider_price_list_items ppi
     INNER JOIN providers p ON p.id = ppi.provider_id
     WHERE p.registration_code LIKE ?`,
    [`${DEMO_PROVIDER_REGISTRATION_PREFIX}%`],
  );
  await conn.query(
    `DELETE FROM providers
     WHERE registration_code LIKE ?`,
    [`${DEMO_PROVIDER_REGISTRATION_PREFIX}%`],
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
  await conn.query(`DELETE FROM users WHERE description LIKE ?`, [
    `${DEMO_MARKER}:%`,
  ]);
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
        "cotizaciones.operacion",
        "cotizaciones.ingreso",
        "proveedores.read",
        "proveedores.create",
        "proveedores.update",
        "proveedores_precios.read",
        "proveedores_precios.create",
        "proveedores_precios.update",
      ],
    });
    const presalesRoleId = await ensureRole(conn, {
      name: PRESALES_ROLE_NAME,
      description: "Rol demo para preventa",
      permissionCodes: [
        "cuentas.read",
        "contactos.read",
        "oportunidades.read",
        "cotizaciones.revision",
        "proveedores.read",
        "proveedores_precios.read",
      ],
    });
    const dirComercialRoleId = await ensureRole(conn, {
      name: "Director Comercial",
      description: "Acceso a cuentas, contactos y oportunidades",
      permissionCodes: [
        "cuentas.read",
        "cuentas.request",
        "cuentas.create",
        "cuentas.update",
        "contactos.read",
        "contactos.request",
        "contactos.create",
        "contactos.update",
        "oportunidades.read",
        "oportunidades.request",
        "oportunidades.create",
        "oportunidades.update",
        "cotizaciones.administracion",
        "proveedores.read",
        "proveedores.create",
        "proveedores.update",
        "proveedores_precios.read",
        "proveedores_precios.create",
        "proveedores_precios.update",
      ],
    });
    const ingOpsRoleId = await ensureRole(conn, {
      name: "Ingeniero Operaciones",
      description: "Acceso de lectura a cuentas, contactos y oportunidades",
      permissionCodes: [
        "cuentas.read",
        "contactos.read",
        "oportunidades.read",
        "cotizaciones.externo",
        "proveedores.read",
        "proveedores_precios.read",
      ],
    });
    const contabilidadRoleId = await ensureRole(conn, {
      name: "Contabilidad",
      description: "Acceso de lectura a cuentas, contactos y oportunidades",
      permissionCodes: [
        "cuentas.read",
        "contactos.read",
        "oportunidades.read",
        "cotizaciones.externo",
        "proveedores.read",
        "proveedores_precios.read",
      ],
    });
    const roleIdByName = new Map([
      [ADMIN_ROLE_NAME, adminRoleId],
      [SELLER_ROLE_NAME, sellerRoleId],
      [PRESALES_ROLE_NAME, presalesRoleId],
      [DIR_COMERCIAL_ROLE_NAME, dirComercialRoleId],
      [ING_OPS_ROLE_NAME, ingOpsRoleId],
      [CONTABILIDAD_ROLE_NAME, contabilidadRoleId],
    ]);

    for (const user of userSpecs) {
      if (!roleIdByName.has(user.roleName)) {
        throw new Error(
          `Rol demo no resuelto para usuario ${user.email}: ${user.roleName}`,
        );
      }
    }

    const now = new Date();
    const createdUsers = [];
    const reusableEmails = userSpecs
      .filter((user) => user.reusable)
      .map((user) => user.email);
    const reusablePlaceholders = reusableEmails.map(() => "?").join(", ");
    const [reusableRows] = reusableEmails.length
      ? await conn.query(
          `SELECT id, email FROM users WHERE email IN (${reusablePlaceholders})`,
          reusableEmails,
        )
      : [[]];
    const reusableByEmail = new Map(
      reusableRows.map((row) => [
        String(row.email).toLowerCase(),
        Number(row.id),
      ]),
    );
    let adminUserId = reusableByEmail.get(options.adminEmail) || null;

    for (const user of userSpecs.filter((spec) => spec.reusable)) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      const existingId = reusableByEmail.get(user.email);
      if (existingId) {
        await conn.query(
          `UPDATE users
           SET full_name = ?, status = 'active', password_hash = ?, avatar_url = ?, mobile = COALESCE(mobile, ?), updated_at = NOW(3)
           WHERE id = ?`,
          [
            user.fullName,
            passwordHash,
            user.avatarUrl,
            user.mobile,
            existingId,
          ],
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
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        [
          user.fullName,
          user.email,
          user.description,
          now,
          user.avatarUrl,
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
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        [
          user.fullName,
          user.email,
          user.description,
          now,
          user.avatarUrl,
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

    const sellerUsers = createdUsers.filter(
      (user) => user.roleName === SELLER_ROLE_NAME,
    );
    const presalesUsers = createdUsers.filter(
      (user) => user.roleName === PRESALES_ROLE_NAME,
    );
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
        accountTypeName: String(accountType.name),
        economicSectorName: String(sector.name),
        ownerIds,
        primarySellerId: ownerA.id,
      });
    }

    const createdContactsByAccount = new Map();
    let contactCounter = 0;
    for (let index = 0; index < createdAccounts.length; index += 1) {
      const account = createdAccounts[index];
      const totalContacts =
        options.contactsMin +
        (index % (options.contactsMax - options.contactsMin + 1));
      const accountContacts = [];
      for (
        let contactIndex = 0;
        contactIndex < totalContacts;
        contactIndex += 1
      ) {
        const firstName =
          FIRST_NAMES[(contactCounter + contactIndex) % FIRST_NAMES.length];
        const lastName =
          LAST_NAMES[
            (contactCounter + index + contactIndex) % LAST_NAMES.length
          ];
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
            POSITION_TITLES[
              (contactCounter + contactIndex) % POSITION_TITLES.length
            ],
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

    const createdOpportunities = [];
    let opportunityCounter = 0;
    for (let index = 0; index < createdAccounts.length; index += 1) {
      const account = createdAccounts[index];
      const contactIds = createdContactsByAccount.get(account.id) || [];
      for (
        let opportunityIndex = 0;
        opportunityIndex < options.opportunitiesPerAccount;
        opportunityIndex += 1
      ) {
        const contactId = contactIds[opportunityIndex % contactIds.length];
        const businessLine = pickRow(
          catalogs.businessLines,
          opportunityCounter + 2,
        );
        const presalesUser = presalesUsers.length
          ? presalesUsers[opportunityCounter % presalesUsers.length]
          : null;
        const commercialOutcome = buildOpportunityCommercialOutcome(
          catalogs,
          opportunityCounter,
          now,
        );
        const opportunityName = `${BUSINESS_NAMES[opportunityCounter % BUSINESS_NAMES.length]} ${account.accountName}`;
        const closeDate = new Date();
        closeDate.setDate(closeDate.getDate() + 15 + opportunityCounter * 3);
        const closeDateValue = closeDate.toISOString().slice(0, 10);
        const opportunityActivationStatusId = makeOpportunityStatusId(
          catalogs,
          opportunityCounter,
        );
        const opportunityActivationStatusCode =
          opportunityCounter % 11 === 0
            ? "desactivada"
            : opportunityCounter % 3 === 0
              ? "pendiente_activacion"
              : "activada";

        const [insert] = await conn.query(
          `INSERT INTO opportunities
            (name, amount_usd, account_id, close_date, contact_id, sales_stage_id, business_line_id,
             seller_user_id, presales_user_id, activation_status_id, commercial_status_id,
             commercial_closed_at, commercial_close_reason,
             created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            opportunityName,
            15000 + opportunityCounter * 1250,
            account.id,
            closeDateValue,
            contactId,
            Number(commercialOutcome.salesStageId),
            Number(businessLine.id),
            account.primarySellerId,
            opportunityIndex % 2 === 0 ? presalesUser?.id || null : null,
            opportunityActivationStatusId,
            Number(commercialOutcome.commercialStatusId),
            commercialOutcome.commercialClosedAt,
            commercialOutcome.commercialCloseReason,
            adminUserId,
            now,
            adminUserId,
            now,
          ],
        );
        await seedOpportunityStageAnswers({
          conn,
          opportunityId: Number(insert.insertId),
          activeSalesStageId: Number(commercialOutcome.salesStageId),
          commercialStatusCode: commercialOutcome.commercialStatusCode,
          catalogs,
          now,
          opportunityName,
          account,
          contactId,
          sellerUserId: account.primarySellerId,
        });
        createdOpportunities.push({
          id: Number(insert.insertId),
          accountId: account.id,
          accountName: account.accountName,
          contactId,
          name: opportunityName,
          activationStatusCode: opportunityActivationStatusCode,
        });
        opportunityCounter += 1;
      }
    }

    const usdCurrency = catalogs.currencies.find(
      (currency) => String(currency.code) === "USD",
    );

    if (!usdCurrency) {
      throw new Error(
        "No se encontro la moneda USD para sembrar proveedores demo",
      );
    }

    let providerPriceItemsCounter = 0;
    const productComponentCandidates = [];
    const serviceComponentCandidates = [];
    const itemLookup = new Map();
    const createdProviders = [];
    let createdProvidersCounter = 0;
    for (let index = 0; index < DEFAULT_COUNTS.providers; index += 1) {
      const country = pickRow(catalogs.countries, index + 1);
      const providerStatusId = makeProviderStatusId(catalogs);
      const providerName = buildProviderName(index);
      const providerAliases = buildProviderAliases(index);
      const registrationCode = `${DEMO_PROVIDER_REGISTRATION_PREFIX}${String(index + 1).padStart(3, "0")}`;
      const providerLookupNames = [providerName, ...providerAliases];
      const providerLookupPlaceholders = providerLookupNames
        .map(() => "?")
        .join(", ");
      const [existingProviders] = await conn.query(
        `SELECT id, name
         FROM providers
         WHERE name IN (${providerLookupPlaceholders})
         ORDER BY FIELD(name, ${providerLookupPlaceholders})
         LIMIT 1`,
        [...providerLookupNames, ...providerLookupNames],
      );

      let providerId;
      if (existingProviders.length) {
        providerId = Number(existingProviders[0].id);
      } else {
        const [providerInsert] = await conn.query(
          `INSERT INTO providers
            (name, registration_code, address_line, country_id, city, postal_code, state_region,
             activation_status_id, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            providerName,
            registrationCode,
            `Parque industrial demo ${index + 1}`,
            Number(country.id),
            `Ciudad proveedor ${country.iso2}`,
            `${30000 + index}`,
            `Region proveedor ${country.iso2}`,
            providerStatusId,
            adminUserId,
            now,
            adminUserId,
            now,
          ],
        );
        providerId = Number(providerInsert.insertId);
        createdProvidersCounter += 1;
      }

      createdProviders.push({ id: providerId, name: providerName });
      const providerPriceListName = buildProviderPriceListName(index);
      const providerPriceListIsActive = buildProviderPriceListIsActive(index);
      const listCurrency = usdCurrency;
      const listItemType = buildProviderItemType(index);

      const [existingLists] = await conn.query(
        `SELECT id
         FROM provider_price_lists
         WHERE provider_id = ?
           AND name = ?
         LIMIT 1`,
        [providerId, providerPriceListName],
      );
      if (existingLists.length) {
        continue;
      }

      await conn.query(
        `UPDATE provider_price_lists
         SET is_active = 0,
             updated_by = ?,
             updated_at = ?
         WHERE provider_id = ?
           AND is_active = 1`,
        [adminUserId, now, providerId],
      );

      const [priceListInsert] = await conn.query(
        `INSERT INTO provider_price_lists
          (provider_id, name, currency_id, product_type_id, item_type, is_active, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          providerId,
          providerPriceListName,
          Number(listCurrency.id),
          byCode(catalogs.productTypes, listItemType),
          listItemType,
          providerPriceListIsActive,
          adminUserId,
          now,
          adminUserId,
          now,
        ],
      );
      const providerPriceListId = Number(priceListInsert.insertId);

      const seededItems = buildProviderSeedItems(index);
      const totalItems = makeProviderPriceItemsCount(index);
      for (let itemIndex = 0; itemIndex < totalItems; itemIndex += 1) {
        const familyName = pickRow(PROVIDER_PRICE_FAMILIES, index + itemIndex);
        const seededItem = seededItems[itemIndex] || null;
        if (listItemType === "grupo_productos") {
          const bundleComponents = seededItem?.components?.length
            ? resolveSeededBundleComponents({
                components: seededItem.components,
                itemLookup,
              })
            : buildBundleComponents({
                itemIndex,
                productCandidates: productComponentCandidates,
                serviceCandidates: serviceComponentCandidates,
              });
          const bundlePrice = seededItem
            ? Number(seededItem.price)
            : Number(
                bundleComponents
                  .reduce(
                    (sum, component) =>
                      sum + Number(component.price) * Number(component.quantity),
                    0,
                  )
                  .toFixed(2),
              );

          const [groupItemInsert] = await conn.query(
            `INSERT INTO provider_price_list_items
              (provider_id, price_list_id, code, description, product_type_id, item_type, price, currency_id, activation_status_id,
               created_by, created_at, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              providerId,
              providerPriceListId,
              seededItem?.code || buildBundlesGroupItemCode(itemIndex),
              seededItem?.description ||
                buildBundlesGroupItemDescription(
                  itemIndex,
                  bundleComponents.length,
                ),
              byCode(catalogs.productTypes, listItemType),
              listItemType,
              bundlePrice,
              Number(listCurrency.id),
              makeProviderPriceItemStatusId({
                catalogs,
                status: seededItem?.status,
              }),
              adminUserId,
              now,
              adminUserId,
              now,
            ],
          );

          const groupItemId = Number(groupItemInsert.insertId);
          for (
            let componentIndex = 0;
            componentIndex < bundleComponents.length;
            componentIndex += 1
          ) {
            const component = bundleComponents[componentIndex];
            await conn.query(
              `INSERT INTO provider_price_list_item_components
                (grupo_item_id, component_item_id, quantity, sort_order, created_by, created_at, updated_by, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                groupItemId,
                Number(component.componentItemId),
                Number(component.quantity),
                component.sortOrder ?? componentIndex,
                adminUserId,
                now,
                adminUserId,
                now,
              ],
            );
          }
        } else {
          const itemPrice = seededItem
            ? Number(seededItem.price)
            : 850 + index * 115 + itemIndex * 47.5;
          const [itemInsert] = await conn.query(
            `INSERT INTO provider_price_list_items
              (provider_id, price_list_id, code, description, product_type_id, item_type, price, currency_id, activation_status_id,
               created_by, created_at, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              providerId,
              providerPriceListId,
              seededItem?.code || buildProviderPriceItemCode(index, itemIndex),
              seededItem?.description ||
                buildProviderPriceItemDescription({
                  providerName,
                  familyName,
                  currencyCode: listCurrency.code,
                }),
              byCode(catalogs.productTypes, listItemType),
              listItemType,
              itemPrice,
              Number(listCurrency.id),
              makeProviderPriceItemStatusId({
                catalogs,
                status: seededItem?.status,
              }),
              adminUserId,
              now,
              adminUserId,
              now,
            ],
          );

          const insertedItem = {
            id: Number(itemInsert.insertId),
            providerName,
            code: seededItem?.code || buildProviderPriceItemCode(index, itemIndex),
            itemType: listItemType,
            price: Number(itemPrice),
          };
          itemLookup.set(
            buildComponentLookupKey(insertedItem.providerName, insertedItem.code),
            insertedItem,
          );
          if (listItemType === "servicio_propio") {
            serviceComponentCandidates.push(insertedItem);
          } else {
            productComponentCandidates.push(insertedItem);
          }
        }

        providerPriceItemsCounter += 1;
      }
    }

    const quotationSeedResult = await seedDemoQuotations({
      conn,
      catalogs,
      adminUserId,
      opportunities: createdOpportunities,
      providers: createdProviders,
      now,
    });

    return {
      adminUserId,
      createdUsers: createdUsers.length,
      createdAccounts: createdAccounts.length,
      createdContacts: contactCounter,
      createdOpportunities: opportunityCounter,
      createdQuotations: quotationSeedResult.createdQuotations,
      createdQuotationVersions: quotationSeedResult.createdQuotationVersions,
      createdProviders: createdProvidersCounter,
      createdProviderPriceItems: providerPriceItemsCounter,
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
    throw new Error(
      "Hay colisiones con usuarios existentes no demo. Ajusta emails o limpia manualmente antes de sembrar.",
    );
  }
  if (
    !options.reset &&
    (safetyState.existingDemoUsers.length > 0 ||
      safetyState.existingDemoAccounts.length > 0 ||
      safetyState.existingDemoProviders.length > 0)
  ) {
    throw new Error(
      "Ya existe data demo. Usa --reset para regenerarla de forma segura.",
    );
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
  console.log(`Cotizaciones creadas: ${result.createdQuotations}`);
  console.log(
    `Versiones de cotizacion creadas: ${result.createdQuotationVersions}`,
  );
  console.log(`Proveedores creados: ${result.createdProviders}`);
  console.log(
    `Precios de proveedores creados: ${result.createdProviderPriceItems}`,
  );
  console.log(
    `Administrador: ${options.adminEmail} / ${options.adminPassword}`,
  );
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
