import { query } from './src/db.js';

(async () => {
  try {
    // Get development stage ID
    const devStageRows = await query(
      `SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1`
    );
    
    const developmentStageId = devStageRows[0].id;

    // Get all won opportunities for Jacob with full details
    const results = await query(`
      SELECT 
        u.id AS seller_id,
        u.full_name AS seller_name,
        o.id AS opportunity_id,
        o.name AS opportunity_name,
        o.commercial_closed_at AS closed_date,
        al.created_at AS dev_entered_date,
        al.detail AS audit_detail,
        JSON_EXTRACT(al.changed_fields, '$.sales_stage_id.before') AS before_stage_id,
        JSON_EXTRACT(al.changed_fields, '$.sales_stage_id.after') AS after_stage_id,
        DATEDIFF(o.commercial_closed_at, al.created_at) AS days_in_development
      FROM opportunities o
      INNER JOIN users u ON u.id = o.seller_user_id
      INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
      INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
      LEFT JOIN audit_log al ON al.entity_type = 'opportunity' 
        AND al.entity_id = o.id 
        AND al.action = 'stage_advanced'
        AND JSON_EXTRACT(al.changed_fields, '$.sales_stage_id.after') = ?
      WHERE u.full_name = 'Jacob Hernandez'
        AND oas.code = 'activada'
        AND ocs.code = 'ganada'
        AND o.seller_user_id IS NOT NULL
      ORDER BY o.commercial_closed_at DESC
    `, [developmentStageId]);

    console.log('\n' + '='.repeat(120));
    console.log('DESGLOSE DETALLADO: JACOB HERNANDEZ - CÁLCULO O→V');
    console.log('='.repeat(120) + '\n');

    if (!results.length) {
      console.log('No oportunidades ganadas encontradas para Jacob Hernandez');
      return;
    }

    console.log(`Total oportunidades ganadas: ${results.length}\n`);

    results.forEach((row, idx) => {
      console.log(`\n📌 Oportunidad ${idx + 1}:`);
      console.log(`   ID: ${row.opportunity_id}`);
      console.log(`   Nombre: ${row.opportunity_name || 'N/A'}`);
      console.log(`   ─────────────────────────────────────────────────────`);
      
      if (row.dev_entered_date) {
        const devDate = new Date(row.dev_entered_date);
        const closedDate = new Date(row.closed_date);
        const days = Math.max(0, Math.floor((closedDate - devDate) / (1000 * 60 * 60 * 24)));
        
        console.log(`   📅 Entró en "desarrollo": ${devDate.toLocaleDateString('es-ES')} (${devDate.toLocaleTimeString('es-ES')})`);
        console.log(`   📅 Cerrada como venta:    ${closedDate.toLocaleDateString('es-ES')} (${closedDate.toLocaleTimeString('es-ES')})`);
        console.log(`   ⏱️  DÍAS EN DESARROLLO: ${days} días`);
      } else {
        console.log(`   ⚠️  Sin registro en auditoría de entrada a "desarrollo"`);
        console.log(`   📅 Cerrada como venta: ${new Date(row.closed_date).toLocaleDateString('es-ES')}`);
      }
    });

    // Calculate final average
    const daysArray = results
      .filter(r => r.dev_entered_date)
      .map(r => {
        const devDate = new Date(r.dev_entered_date);
        const closedDate = new Date(r.closed_date);
        return Math.max(0, Math.floor((closedDate - devDate) / (1000 * 60 * 60 * 24)));
      });

    if (daysArray.length > 0) {
      const avgDays = Math.round(daysArray.reduce((sum, d) => sum + d, 0) / daysArray.length);
      console.log(`\n${'─'.repeat(120)}`);
      console.log(`\n🎯 CÁLCULO FINAL:`);
      console.log(`   Días totales: ${daysArray.join(' + ')} = ${daysArray.reduce((sum, d) => sum + d, 0)} días`);
      console.log(`   Total oportunidades con auditoría: ${daysArray.length}/${results.length}`);
      console.log(`   Promedio: ${daysArray.reduce((sum, d) => sum + d, 0)} ÷ ${daysArray.length} = ${avgDays} días`);
      console.log(`\n   ✅ TIEMPO O→V PROMEDIO DE JACOB: ${avgDays} días`);
    } else {
      console.log(`\n${'─'.repeat(120)}`);
      console.log(`\n⚠️  CÁLCULO FINAL:`);
      console.log(`   Jacob tiene oportunidades ganadas (${results.length}), pero NINGUNA tiene registro en auditoría`);
      console.log(`   de entrada a etapa "desarrollo"`);
      const defaultTotal = results.length * 120;
      const avgDays = Math.round(defaultTotal / results.length);
      console.log(`   Cálculo: (${results.length} opp × 120 días) ÷ ${results.length} = ${avgDays} días`);
      console.log(`\n   ✅ TIEMPO O→V PROMEDIO DE JACOB: ${avgDays} días`);
    }

    console.log('\n' + '='.repeat(120) + '\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();
