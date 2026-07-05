import express from "express";
import cors from "cors";
import { query } from "./db.js";
import { config } from "./config.js";
import { authRequired, loadUser } from "./auth.js";
import authRoutes from "./routes.auth.js";
import userRoutes from "./routes.users.js";
import roleRoutes from "./routes.roles.js";
import accountRoutes from "./routes.accounts.js";
import contactRoutes from "./routes.contacts.js";
import providerRoutes from "./routes.providers.js";
import opportunityRoutes from "./routes.opportunities.js";
import quotationRoutes from "./routes.quotations.js";
import quotationPublicRoutes from "./routes.quotations-public.js";
import interactionRoutes from "./routes.interactions.js";
import catalogRoutes from "./routes.catalogs.js";
import auditRoutes from "./routes.audit.js";
import executionCommercialRoutes from "./routes.execution-commercial.js";
import commercialTrackingRoutes from "./routes.commercial-tracking.js";
import commercialEnablementRoutes from "./routes.commercial-enablement.js";
import commercialPlanningRoutes from "./routes.commercial-planning.js";
import manufacturerRegistrationRoutes from "./routes.manufacturer-registrations.js";
import settingsRoutes from "./routes.settings.js";
import toolsRoutes from "./routes.tools.js";
import aiRoutes from "./routes.ai.js";
import chatbotRoutes from "./routes.chatbot.js";
import landingRoutes, {
  publicRouter as publicLandingRoutes,
} from "./routes.landing.js";
import campaignRoutes from "./routes.campaigns.js";
import campaignEmailRoutes from "./routes.campaign-emails.js";

export function createApp() {
  const app = express();
  const requestBodyLimit = config.requestBodyLimit;

  function isProposalModulePath(pathname = "") {
    return [
      "/proposals",
      "/proposal-templates",
      "/proposal-assets",
      "/api/proposals",
      "/api/proposal-templates",
      "/api/proposal-assets",
      "/api/quotation-versions",
      "/api/settings/document-branding",
      "/api/settings/proposal-content",
    ].some((prefix) => pathname.startsWith(prefix));
  }

  function getSqlErrorDetail(err) {
    const message = String(err?.sqlMessage || err?.message || "").trim();
    const code = String(err?.code || "").trim();

    if (!message) return "";
    return code ? `${code}: ${message}` : message;
  }

  app.use(cors());
  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

  app.get("/health", async (_req, res) => {
    const nowRows = await query("SELECT NOW(3) AS now");
    res.json({ ok: true, dbNow: nowRows[0].now });
  });

  app.use("/api/public", quotationPublicRoutes);
  app.use("/", publicLandingRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/users", authRequired, loadUser, userRoutes);
  app.use("/api/roles", authRequired, loadUser, roleRoutes);
  app.use("/api/accounts", authRequired, loadUser, accountRoutes);
  app.use("/api/contacts", authRequired, loadUser, contactRoutes);
  app.use("/api/providers", authRequired, loadUser, providerRoutes);
  app.use("/api/opportunities", authRequired, loadUser, opportunityRoutes);
  app.use("/api/interactions", authRequired, loadUser, interactionRoutes);
  app.use(
    "/api/execution-commercial",
    authRequired,
    loadUser,
    executionCommercialRoutes,
  );
  app.use(
    "/api/commercial-development",
    authRequired,
    loadUser,
    executionCommercialRoutes,
  );
  app.use(
    "/api/commercial-tracking",
    authRequired,
    loadUser,
    commercialTrackingRoutes,
  );
  app.use(
    "/api/commercial-enablement",
    authRequired,
    loadUser,
    commercialEnablementRoutes,
  );
  app.use(
    "/api/commercial-planning",
    authRequired,
    loadUser,
    commercialPlanningRoutes,
  );
  app.use("/api", authRequired, loadUser, manufacturerRegistrationRoutes);
  app.use("/api", authRequired, loadUser, quotationRoutes);
  app.use("/api/catalogs", authRequired, loadUser, catalogRoutes);
  app.use("/api/audit", authRequired, loadUser, auditRoutes);
  app.use("/api/settings", authRequired, loadUser, settingsRoutes);
  app.use("/api/tools", authRequired, loadUser, toolsRoutes);
  app.use("/api", authRequired, loadUser, aiRoutes);
  app.use("/api/chatbot", authRequired, loadUser, chatbotRoutes);
  app.use("/api/landing/v1", authRequired, loadUser, landingRoutes);
  app.use("/api/campaigns", authRequired, loadUser, campaignRoutes);
  app.use("/api/campaign-emails", authRequired, loadUser, campaignEmailRoutes);

  app.use((err, req, res, _next) => {
    const status = Number(err?.status) || 500;
    if (status === 413 || err?.type === "entity.too.large") {
      return res.status(413).json({
        message:
          "El archivo es demasiado grande para esta solicitud. Intenta con una imagen mas liviana.",
      });
    }

    if (status >= 500) {
      console.error(err);
      const sqlDetail = getSqlErrorDetail(err);
      const requestPath = String(req?.originalUrl || req?.path || "");
      if (isProposalModulePath(requestPath) && sqlDetail) {
        return res.status(500).json({
          message: `Error interno del servidor: ${sqlDetail}`,
          sqlError: {
            code: String(err?.code || ""),
            message: String(err?.sqlMessage || err?.message || ""),
            sql: String(err?.sql || ""),
          },
        });
      }

      return res.status(500).json({ message: "Error interno del servidor" });
    }

    return res.status(status).json({
      message: err?.message || "No fue posible completar la solicitud",
    });
  });

  return app;
}

export const app = createApp();
