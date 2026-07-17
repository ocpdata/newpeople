import('./src/db.js').then(async ({ query }) => {
  try {
    // Simulate the loadLeadToOpportunityDaysBySeller function
    const params = [];
    const whereClauses = [
      "i.seller_user_id IS NOT NULL",
      "i.analysis_status = 'lead_qualified'",
    ];
    const normalizedSampleSize = 20;
    params.push(normalizedSampleSize);

    const qualifiedLeads = await query(
      `SELECT recent.lead_id, recent.seller_user_id, recent.created_at, recent.updated_at,
              FLOOR(DATEDIFF(recent.updated_at, recent.created_at)) AS days_to_qualified
       FROM (
         SELECT i.id AS lead_id, i.seller_user_id, i.created_at, i.updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY i.seller_user_id
                  ORDER BY i.updated_at DESC, i.id DESC
                ) AS row_position
         FROM interactions i
         WHERE ${whereClauses.join(" AND ")}
       ) recent
       WHERE recent.row_position <= ?`,
      params,
    );

    const resultBySeller = new Map();
    qualifiedLeads.forEach((leadRow) => {
      const sellerId = Number(leadRow.seller_user_id || 0);
      const daysToQualified = Number(leadRow.days_to_qualified || 0);
      if (!sellerId) return;
      if (!resultBySeller.has(sellerId)) {
        resultBySeller.set(sellerId, []);
      }
      resultBySeller.get(sellerId).push(Math.max(0, daysToQualified));
    });

    const averageBySellerId = new Map(
      Array.from(resultBySeller.entries()).map(([sellerId, daysArray]) => [
        sellerId,
        daysArray.length > 0
          ? Math.round(daysArray.reduce((sum, d) => sum + d, 0) / daysArray.length)
          : 0,
      ]),
    );

    console.log('\n✅ RESULTADO DE loadLeadToOpportunityDaysBySeller():\n');
    
    // Get seller names for display
    const sellers = await query('SELECT id, full_name FROM users ORDER BY full_name');
    sellers.forEach(seller => {
      const days = averageBySellerId.get(seller.id);
      if (days !== undefined) {
        console.log(`   ${seller.full_name.padEnd(25)} → ${String(days).padStart(3)} días`);
      }
    });
    
    console.log('\n');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
});
