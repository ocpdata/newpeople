import { query } from './src/db.js';

const rows = await query(`
  SELECT i.seller_user_id,
         u.full_name,
         FLOOR(DATEDIFF(CURDATE(), i.created_at)) AS days_since_creation,
         FLOOR(DATEDIFF(CURDATE(), i.created_at) / 7) AS weeks_ago
  FROM interactions i
  INNER JOIN users u ON u.id = i.seller_user_id
  WHERE i.seller_user_id IS NOT NULL
    AND DATEDIFF(CURDATE(), i.created_at) BETWEEN 0 AND 69
`);

const bySeller = new Map();
for (const row of rows) {
  const sellerId = Number(row.seller_user_id || 0);
  const weeksAgo = Number(row.weeks_ago || 0);
  const days = Math.max(0, Number(row.days_since_creation || 0));
  if (!sellerId || weeksAgo < 0 || weeksAgo >= 10) continue;
  const idx = 9 - weeksAgo;

  if (!bySeller.has(sellerId)) {
    bySeller.set(sellerId, {
      name: row.full_name,
      buckets: Array.from({ length: 10 }, () => ({ sum: 0, count: 0 })),
    });
  }

  const bucket = bySeller.get(sellerId).buckets[idx];
  bucket.sum += days;
  bucket.count += 1;
}

console.log('\nSeries (S1..S10) de dias por semana:\n');
for (const [, seller] of bySeller) {
  const series = seller.buckets.map((bucket) =>
    bucket.count > 0 ? Math.round(bucket.sum / bucket.count) : 0,
  );
  console.log(`${seller.name}: [${series.join(', ')}]`);
}
