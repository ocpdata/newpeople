import { installOpportunityCommercialHistory } from "../src/commercial-intelligence/opportunity-history-store.js";
import { pool } from "../src/db.js";

if (!process.argv.includes("--apply")) {
  console.error("Registra estados base en auditoria persistente para G06. No crea triggers ni cambia oportunidades. Ejecuta con --apply para confirmar.");
  process.exitCode = 1;
} else {
  try {
    const counts = await installOpportunityCommercialHistory();
    console.log("Historia comercial instalada. Eventos por procedencia:", counts);
  } catch (error) {
    console.error("No se completó la instalación de historia comercial:", error.code || error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
