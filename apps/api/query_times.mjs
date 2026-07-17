import { query } from "./src/db.js";

(async () => {
  try {
    // Get development stage ID
    const devStageRows = await query(
      `SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1`,
    );

    if (!devStageRows.length) {
      console.log("No development stage found");
      return;
    }

    const developmentStageId = devStageRows[0].id;

    // Get last 20 won opportunities per seller with stage entry dates
    const results = await query(
      `
      SELECT 
        u.id AS seller_id,
        u.full_name AS seller_name,
        o.id AS opportunity_id,
        o.commercial_closed_at,
        MIN(al.created_at) AS development_entered_at,
        DATEDIFF(o.commercial_closed_at, MIN(al.created_at)) AS days_in_development
      FROM opportunities o
      INNER JOIN users u ON u.id = o.seller_user_id
      INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
      INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
      LEFT JOIN audit_log al ON al.entity_type = 'opportunity' 
        AND al.entity_id = o.id 
        AND al.action = 'stage_advanced'
        AND JSON_EXTRACT(al.changed_fields, '$.sales_stage_id.after') = ?
      WHERE oas.code = 'activada'
        AND ocs.code = 'ganada'
        AND o.seller_user_id IS NOT NULL
      GROUP BY u.id, o.id
      ORDER BY u.id, o.commercial_closed_at DESC
      LIMIT 200
    `,
      [developmentStageId],
    );

    // Process results
    const resultBySeller = new Map();
    const DEFAULT_DAYS_WITHOUT_AUDIT = 120;

    results.forEach((row) => {
      const sellerId = row.seller_id;
      const sellerName = row.seller_name;
      const daysInDev = row.days_in_development || 0;

      if (!resultBySeller.has(sellerId)) {
        resultBySeller.set(sellerId, {
          seller_name: sellerName,
          opportunities: [],
          days_array: [],
        });
      }

      resultBySeller.get(sellerId).opportunities.push({
        opportunity_id: row.opportunity_id,
        closed_at: row.commercial_closed_at,
        dev_entered_at: row.development_entered_at,
        days: Math.max(0, daysInDev),
      });

      if (row.development_entered_at && daysInDev !== null) {
        // Has audit trail: use actual days
        resultBySeller.get(sellerId).days_array.push(Math.max(0, daysInDev));
      } else {
        // No audit trail: use default value
        resultBySeller
          .get(sellerId)
          .days_array.push(DEFAULT_DAYS_WITHOUT_AUDIT);
      }
    });

    // Calculate averages and display
    console.log("\n" + "=".repeat(90));
    console.log("TIEMPOS DE CONVERSIÓN O→V (Oportunidad a Venta)");
    console.log("=".repeat(90) + "\n");

    const sellerSummary = [];

    resultBySeller.forEach((data, sellerId) => {
      const avgDays =
        data.days_array.length > 0
          ? Math.round(
              data.days_array.reduce((sum, d) => sum + d, 0) /
                data.days_array.length,
            )
          : 0;

      sellerSummary.push({
        seller_id: sellerId,
        seller_name: data.seller_name,
        total_won: data.opportunities.length,
        with_audit_trail: data.days_array.length,
        average_days: avgDays,
        min_days:
          data.days_array.length > 0 ? Math.min(...data.days_array) : null,
        max_days:
          data.days_array.length > 0 ? Math.max(...data.days_array) : null,
      });
    });

    sellerSummary.sort((a, b) => b.average_days - a.average_days);

    console.log("RANKING DE VELOCIDAD DE CIERRE:\n");
    sellerSummary.forEach((s, idx) => {
      const status =
        s.average_days <= 30 ? "🔥" : s.average_days <= 60 ? "⚡" : "⏳";
      console.log(
        `${status} ${String(idx + 1).padStart(2)}. ${s.seller_name.padEnd(25)} | ${String(s.average_days).padStart(3)} días promedio | ${s.with_audit_trail}/${s.total_won} opp. ganadas`,
      );
    });

    console.log("\n" + "=".repeat(90));
    console.log("\nDETALLE POR VENDEDOR:\n");

    resultBySeller.forEach((data, sellerId) => {
      const avgDays =
        data.days_array.length > 0
          ? Math.round(
              data.days_array.reduce((sum, d) => sum + d, 0) /
                data.days_array.length,
            )
          : 0;

      console.log(`\n📊 ${data.seller_name.toUpperCase()}`);
      console.log(`   Promedio O→V: ${avgDays} días`);
      console.log(`   Oportunidades ganadas: ${data.opportunities.length}`);
      console.log(`   Con registro en auditoría: ${data.days_array.length}`);
      console.log(
        `   Rango: ${data.days_array.length > 0 ? `${Math.min(...data.days_array)} a ${Math.max(...data.days_array)} días` : "N/A"}`,
      );

      if (data.days_array.length > 0) {
        const sorted = [...data.days_array].sort((a, b) => a - b);
        const median =
          sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
        console.log(`   Mediana: ${Math.round(median)} días`);
      }
    });

    console.log("\n" + "=".repeat(90) + "\n");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    process.exit(0);
  }
})();
