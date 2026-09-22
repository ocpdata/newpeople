import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.test") });

const dbName = process.env.DB_NAME || "newpeople_crm_test";

if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  throw new Error(`Nombre de base invalido para pruebas: ${dbName}`);
}

if (dbName === "newpeople_crm") {
  throw new Error(
    "La base de pruebas no puede apuntar a newpeople_crm. Usa otra DB_NAME en .env.test.",
  );
}

async function main() {
  const schemaPath = resolve(__dirname, "../sql/schema.sql");
  const rawSchema = await fs.readFile(schemaPath, "utf8");
  const testSchema = rawSchema.replace(/newpeople_crm/g, dbName);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await connection.query(testSchema);
    const now = new Date();
    await connection.query(
      `INSERT INTO countries (iso2, iso3, name, is_active, created_at, updated_at)
       VALUES ('MX', 'MEX', 'Mexico', 1, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      [now, now],
    );
    await connection.query(
      `INSERT INTO currencies (code, name, symbol, decimals, is_active, created_at, updated_at)
       VALUES ('USD', 'Dolar estadounidense', '$', 2, 1, ?, ?),
              ('MXN', 'Peso mexicano', '$', 2, 1, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      [now, now, now, now],
    );
    await connection.query(
      `INSERT INTO country_currency (country_id, currency_id, valid_from, valid_to, created_at)
       SELECT c.id, curr.id, CURRENT_DATE(), NULL, NOW(3)
       FROM countries c
       CROSS JOIN currencies curr
       WHERE c.iso2 = 'MX' AND curr.code IN ('USD', 'MXN')
         AND NOT EXISTS (
           SELECT 1 FROM country_currency existing
           WHERE existing.country_id = c.id AND existing.currency_id = curr.id
         )`,
    );
    const seedCodeNames = async (table, values) => {
      for (const [code, name] of values) {
        await connection.query(
          `INSERT INTO ${table} (code, name, is_active) VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
          [code, name],
        );
      }
    };
    await seedCodeNames("account_types", [["empresa", "Empresa"]]);
    await seedCodeNames("economic_sectors", [["tecnologia", "Tecnologia"]]);
    await seedCodeNames("account_activation_statuses", [["activada", "Activada"], ["desactivada", "Desactivada"], ["pendiente_activacion", "Pendiente de activacion"]]);
    await seedCodeNames("contact_purchase_participations", [["ninguno", "Ninguno"]]);
    await seedCodeNames("contact_relationship_types", [["ninguno", "Ninguno"]]);
    await seedCodeNames("contact_hierarchy_levels", [["usuario", "Usuario"], ["directivo", "Directivo"]]);
    await seedCodeNames("contact_influence_levels", [["baja", "Baja"], ["media", "Media"], ["alta", "Alta"]]);
    await seedCodeNames("contact_employment_statuses", [["activo", "Activo"]]);
    await seedCodeNames("contact_activation_statuses", [["activado", "Activado"], ["desactivado", "Desactivado"], ["pendiente_activacion", "Pendiente de activacion"]]);
    await seedCodeNames("provider_activation_statuses", [["activado", "Activado"], ["desactivado", "Desactivado"]]);
    await seedCodeNames("provider_price_list_item_statuses", [["activo", "Activo"], ["inactivo", "Inactivo"]]);
    await seedCodeNames("opportunity_business_lines", [["general", "General"]]);
    const stages = [
      ["contacto_inicial", "Contacto Inicial", 1],
      ["identificacion_oportunidad", "Identificación de Oportunidad", 2],
      ["desarrollo", "Desarrollo", 3],
      ["cotizacion", "Cotizacion", 4],
      ["demostracion", "Demostracion", 5],
      ["negociacion", "Negociacion", 6],
      ["waiting", "Waiting", 7],
    ];
    for (const [code, name, stageOrder] of stages) {
      await connection.query(
        `INSERT INTO opportunity_sales_stages (code, name, stage_order, is_active)
         VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
        [code, name, stageOrder],
      );
    }
    const questions = [
      ["contacto_inicial", "contacto_inicial_interes_cliente", "¿Qué necesidad, iniciativa, problema o interés concreto expresa el cliente que justifique abrir esta oportunidad?", 1],
      ["identificacion_oportunidad", "identificacion_requerimiento_tecnico", "¿Qué requerimiento técnico, funcional, operativo o de integración solicita el cliente?", 1],
      ["identificacion_oportunidad", "identificacion_motivacion_principal", "¿Cuál es el motivo de negocio principal detrás de este requerimiento y qué problema quiere resolver o qué resultado quiere lograr el cliente?", 2],
      ["identificacion_oportunidad", "identificacion_presupuesto_cliente", "¿Qué se sabe del presupuesto del cliente, de sus restricciones presupuestales o de cómo conseguiría el presupuesto para este proyecto?", 3],
      ["identificacion_oportunidad", "identificacion_fecha_adquisicion", "¿Cuál es la fecha objetivo para adquirir o implementar la solución, por qué debe cumplirse esa fecha y qué impacto tendría no hacerlo a tiempo?", 4],
      ["identificacion_oportunidad", "identificacion_decisor_proceso_compra", "¿Quiénes participan en la decisión de compra y cómo es el proceso de aprobación o adquisición para esta oportunidad?", 5],
      ["identificacion_oportunidad", "identificacion_ventajas_fortalezas", "¿Qué ventajas o fortalezas tenemos para esta oportunidad en función de las necesidades y prioridades del cliente?", 6],
      ["identificacion_oportunidad", "identificacion_estrategia", "¿Qué estrategia comercial y técnica se seguirá para avanzar esta oportunidad con base en la información disponible?", 7],
      ["desarrollo", "desarrollo_informacion_adicional", "¿Qué información adicional relevante se obtuvo en las reuniones o sesiones de desarrollo sobre alcance, necesidades, restricciones o prioridades?", 1],
      ["desarrollo", "desarrollo_presentacion_solucion", "¿Cómo se presentó o explicó la solución técnica al cliente y cómo se relacionó con su problema o necesidad?", 2],
      ["desarrollo", "desarrollo_propuesta", "¿Qué solución, alcance, arquitectura, servicio o alternativa se ha propuesto al cliente?", 3],
      ["desarrollo", "desarrollo_puntos_tecnicos", "¿Cuáles son los puntos técnicos más importantes para el proyecto y cuáles son críticos para el éxito de la solución?", 4],
      ["desarrollo", "desarrollo_aceptacion_propuesta", "¿Qué nivel de aceptación, validación o conformidad ha mostrado el cliente respecto de la propuesta técnica?", 5],
      ["desarrollo", "desarrollo_observaciones_condiciones", "¿Qué observaciones, dudas, restricciones o condiciones indicó el cliente como requisito para aceptar o avanzar con la propuesta técnica?", 6],
      ["desarrollo", "desarrollo_riesgo_tecnico", "¿Qué riesgos técnicos, dependencias, vacíos de información o factores de complejidad podrían afectar la solución o su implementación?", 7],
      ["cotizacion", "cotizacion_propuesta_economica", "¿La propuesta económica se alinea con el presupuesto, rango esperado o expectativas del cliente para este proyecto?", 1],
      ["cotizacion", "cotizacion_condiciones_comerciales", "¿Las condiciones comerciales de la propuesta coinciden con las necesidades del cliente para este proyecto?", 2],
      ["demostracion", "demostracion_motivo", "¿Por qué el cliente solicitó o aceptó una demostración y qué quería validar?", 1],
      ["demostracion", "demostracion_criterios_exito", "¿Cuáles son los criterios concretos de éxito o validación para considerar exitosa la demostración?", 2],
      ["demostracion", "demostracion_siguientes_pasos", "¿Cuáles son los siguientes pasos esperados después de cumplir los criterios de éxito de la demostración?", 3],
      ["demostracion", "demostracion_resultado", "¿Cuál fue el resultado de la demostración y cuál fue la reacción o conclusión del cliente?", 4],
      ["negociacion", "negociacion_precio_condiciones", "¿Cuáles son el precio objetivo, los límites de negociación y las mejores condiciones que podrían aceptarse para cerrar con este cliente?", 1],
      ["negociacion", "negociacion_puntos_cliente", "¿Cuáles son los puntos, condiciones o factores que el cliente valora más en esta negociación?", 2],
      ["negociacion", "negociacion_puntos_nosotros", "¿Cuáles son los puntos más importantes que debemos proteger o priorizar nosotros en esta negociación?", 3],
      ["waiting", "waiting_acuerdo_o_postores", "¿Se llegó a un acuerdo o el cliente sigue evaluando la decisión entre varios postores?", 1],
    ];
    for (const [stageCode, code, prompt, displayOrder] of questions) {
      const [stageRows] = await connection.query(
        "SELECT id FROM opportunity_sales_stages WHERE code = ? LIMIT 1",
        [stageCode],
      );
      await connection.query(
        `INSERT INTO opportunity_stage_questions
          (sales_stage_id, code, prompt, response_type, display_order, is_required, is_active)
         VALUES (?, ?, ?, 'text', ?, 1, 1)
         ON DUPLICATE KEY UPDATE prompt = VALUES(prompt), display_order = VALUES(display_order), is_required = 1, is_active = 1`,
        [stageRows[0].id, code, prompt, displayOrder],
      );
    }
    await seedCodeNames("opportunity_activation_statuses", [["activada", "Activada"], ["desactivada", "Desactivada"], ["pendiente_activacion", "Pendiente de activacion"]]);
    await seedCodeNames("opportunity_commercial_statuses", [["en_proceso", "En proceso"], ["ganada", "Ganada"], ["perdida", "Perdida"], ["anulada", "Anulada"]]);
    await seedCodeNames("quotation_statuses", [["borrador", "Borrador"], ["aprobada", "Aprobada"]]);
    await seedCodeNames("quotation_actions", [["crear_cotizacion", "Crear cotizacion"], ["editar_cotizacion", "Editar cotizacion"], ["aprobar_cotizacion", "Aprobar cotizacion"]]);
    await seedCodeNames("quotation_activation_statuses", [["activada", "Activada"]]);
    await seedCodeNames("quotation_section_inclusion_types", [["incluida", "Incluida"]]);
    console.log(`Test DB ready: ${dbName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});