import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { query } from "./db.js";
import { authRequired, loadUser } from "./auth.js";
import authRoutes from "./routes.auth.js";
import userRoutes from "./routes.users.js";
import roleRoutes from "./routes.roles.js";
import accountRoutes from "./routes.accounts.js";
import catalogRoutes from "./routes.catalogs.js";

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
app.use("/api/catalogs", authRequired, loadUser, catalogRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Error interno del servidor" });
});

app.listen(config.port, () => {
  console.log(`API running on http://localhost:${config.port}`);
});
