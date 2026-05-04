import express from "express";
import cors from "cors";
import { query } from "./db.js";
import { authRequired, loadUser } from "./auth.js";
import authRoutes from "./routes.auth.js";
import userRoutes from "./routes.users.js";
import roleRoutes from "./routes.roles.js";
import accountRoutes from "./routes.accounts.js";
import contactRoutes from "./routes.contacts.js";
import providerRoutes from "./routes.providers.js";
import opportunityRoutes from "./routes.opportunities.js";
import quotationRoutes from "./routes.quotations.js";
import interactionRoutes from "./routes.interactions.js";
import potentialOpportunityRoutes from "./routes.potential-opportunities.js";
import catalogRoutes from "./routes.catalogs.js";
import auditRoutes from "./routes.audit.js";
import executionCommercialRoutes from "./routes.execution-commercial.js";
import commercialEnablementRoutes from "./routes.commercial-enablement.js";
import settingsRoutes from "./routes.settings.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const nowRows = await query("SELECT NOW(3) AS now");
    res.json({ ok: true, dbNow: nowRows[0].now });
  });

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
    "/api/commercial-enablement",
    authRequired,
    loadUser,
    commercialEnablementRoutes,
  );
  app.use(
    "/api/potential-opportunities",
    authRequired,
    loadUser,
    potentialOpportunityRoutes,
  );
  app.use("/api", authRequired, loadUser, quotationRoutes);
  app.use("/api/catalogs", authRequired, loadUser, catalogRoutes);
  app.use("/api/audit", authRequired, loadUser, auditRoutes);
  app.use("/api/settings", authRequired, loadUser, settingsRoutes);

  app.use((err, _req, res, _next) => {
    const status = Number(err?.status) || 500;
    if (status >= 500) {
      console.error(err);
      return res.status(500).json({ message: "Error interno del servidor" });
    }

    return res.status(status).json({
      message: err?.message || "No fue posible completar la solicitud",
    });
  });

  return app;
}

export const app = createApp();
