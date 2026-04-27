import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFileName =
  process.env.API_ENV === "test" ||
  process.env.NODE_ENV === "test" ||
  process.env.VITEST
    ? "../.env.test"
    : "../.env";

dotenv.config({ path: resolve(__dirname, envFileName) });

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "change-this-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  app: {
    inviteSetupUrl:
      process.env.APP_INVITE_SETUP_URL || "http://localhost:5173/set-password",
    passwordSetupTokenMinutes: Number(
      process.env.APP_PASSWORD_SETUP_TOKEN_MINUTES || 1440,
    ),
  },
  mail: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "no-reply@newpeople.local",
  },
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "newpeople_crm",
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  },
  documents: {
    quotation: {
      company: {
        logoPath:
          process.env.QUOTATION_COMPANY_LOGO_PATH ||
          resolve(__dirname, "../../web/src/assets/hero.png"),
        legalName:
          process.env.QUOTATION_COMPANY_LEGAL_NAME ||
          "Access Quality S.A. de C.V.",
        taxId: process.env.QUOTATION_COMPANY_TAX_ID || "RFC: AQU110118AV2",
        addressLines: (
          process.env.QUOTATION_COMPANY_ADDRESS_LINES ||
          [
            "Montecito #38, Piso 7, Oficina 1, WTC, Col. Napoles",
            "Benito Juarez, CDMX, CP 03810",
          ].join("|")
        )
          .split("|")
          .map((line) => line.trim())
          .filter(Boolean),
        email: process.env.QUOTATION_COMPANY_EMAIL || "",
        phone: process.env.QUOTATION_COMPANY_PHONE || "",
      },
    },
  },
};
