import { query } from './src/db.js';

(async () => {
  try {
    // Get all qualified leads by seller with assignment and qualification dates
    const results = await query(`
      SELECT 
        u.id AS seller_id,
        u.full_name AS seller_name,
        i.id AS lead_id,
        i.title AS lead_title,
        i.updated_at AS qualified_at,
        MIN(CASE WHEN JSON_EXTRACT(al.changed_fields, '$.seller_user_id.after') IS NOT NULL 
                 THEN al.created_at END) AS assigned_at,
        MIN(CASE WHEN JSON_EXTRACT(al.changed_fields, '$.analysis_status.after') = 'lead_qualified'
                 THEN al.created_at END) AS qualified_audit_at
      FROM interactions i
      INNER JOIN users u ON u.id = i.seller_user_id
      LEFT JOIN audit_log al ON al.entity_type = 'interaction'
        AND al.entity_id = i.id
        AND al.action = 'updated'
        AND (JSON_EXTRACT(al.changed_fields, '$.seller_user_id.after') IS NOT NULL
             OR JSON_EXTRACT(al.changed_fields, '$.analysis_status.after') = 'lead_qualified')
      WHERE i.analysis_status = 'lead_qualified'
        AND i.seller_user_id IS NOT NULL
      GROUP BY u.id, i.id
      ORDER BY u.id, i.updated_at DESC
      LIMIT 100
    `);

    console.log('\n' + '='.repeat(120));
    console.log('TIEMPOS DE CONVERSIÓN L→O (Lead a Oportunidad)');
    console.log('='.repeat(120) + '\n');

    const resultBySeller = new Map();
    const DEFAULT_DAYS = 120;

    results.forEach((row) => {
      const sellerId = row.seller_id;
      const sellerName = row.seller_name;
      const leadId = row.lead_id;
      const leadTitle = row.lead_title;

      if (!resultBySeller.has(sellerId)) {
        resultBySeller.set(sellerId, {
          seller_name: sellerName,
          leads: [],
          days_array: []
        });
      }

      let days = 0;
      if (row.assigned_at && row.qualified_audit_at) {
        const assignedDate = new Date(row.assigned_at);
        const qualifiedDate = new Date(row.qualified_audit_at);
        days = Math.max(0, Math.floor((qualifiedDate - assignedDate) / (1000 * 60 * 60 * 24)));
      } else {
        days = DEFAULT_DAYS;
      }

      resultBySeller.get(sellerId).leads.push({
        lead_id: leadId,
        lead_title: leadTitle.substring(0, 50),
        assigned_at: row.assigned_at,
        qualified_at: row.qualified_audit_at,
        days: days,
        has_audit: row.assigned_at && row.qualified_audit_at ? 'Sí' : 'No'
      });

      resultBySeller.get(sellerId).days_array.push(days);
    });

    // Create summary
    const summary = [];
    resultBySeller.forEach((data, sellerId) => {
      const avgDays = data.days_array.length > 0
        ? Math.round(data.days_array.reduce((sum, d) => sum + d, 0) / data.days_array.length)
        : 0;
      summary.push({
        seller_id: sellerId,
        seller_name: data.seller_name,
        leads_counted: data.days_array.length,
        average_days: avgDays
      });
    });

    summary.sort((a, b) => a.average_days - b.average_days);

    console.log('RANKING (Menor tiempo es mejor):\n');
    summary.forEach((s, idx) => {
      const status = s.average_days <= 7 ? '🔥' : s.average_days <= 30 ? '⚡' : '⏳';
      console.log(`${status} ${String(idx + 1).padStart(2)}. ${s.seller_name.padEnd(25)} | ${String(s.average_days).padStart(3)} días | ${s.leads_counted} leads`);
    });

    console.log('\n' + '='.repeat(120));
    console.log('\nDETALLE POR VENDEDOR:\n');

    resultBySeller.forEach((data, sellerId) => {
      const avgDays = data.days_array.length > 0
        ? Math.round(data.days_array.reduce((sum, d) => sum + d, 0) / data.days_array.length)
        : 0;

      console.log(`\n📊 ${data.seller_name.toUpperCase()}`);
      console.log(`   Promedio L→O: ${avgDays} días`);
      console.log(`   Total leads calificados analizados: ${data.leads.length}`);
      
      if (data.leads.length > 0 && data.leads.length <= 3) {
        console.log(`   \n   Desglose:`);
        data.leads.forEach((lead, idx) => {
          console.log(`     ${idx + 1}. "${lead.lead_title}..." → ${lead.days} días (Auditoría: ${lead.has_audit})`);
        });
      }
    });

    console.log('\n' + '='.repeat(120) + '\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();
