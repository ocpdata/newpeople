import { query } from './src/db.js';

const from = '2026-03-16 00:00:00';
const to = '2026-06-16 23:59:59';
const email = 'ocarrillo@accessq.com.mx';

const u = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
const uid = Number(u[0]?.id || 0);
if (!uid) {
  console.log('user not found');
  process.exit(0);
}

const accessJoin = 'LEFT JOIN account_owners ao_scope ON ao_scope.account_id = i.account_id AND ao_scope.user_id = ?';
const accessCond = "((i.seller_user_id IS NOT NULL AND i.seller_user_id = ?) OR (i.seller_user_id IS NULL AND (ao_scope.user_id IS NOT NULL OR i.created_by = ?)))";

const createdSql = `
SELECT DATE_FORMAT(i.created_at, '%x-W%v') wk, COUNT(*) c
FROM interactions i
LEFT JOIN accounts a ON a.id = i.account_id
${accessJoin}
WHERE ${accessCond}
  AND i.created_at BETWEEN ? AND ?
GROUP BY wk
ORDER BY wk`;

const qualifiedSql = `
SELECT DATE_FORMAT(i.updated_at, '%x-W%v') wk, COUNT(*) c
FROM interactions i
LEFT JOIN accounts a ON a.id = i.account_id
${accessJoin}
WHERE ${accessCond}
  AND i.analysis_status = 'lead_qualified'
  AND i.updated_at BETWEEN ? AND ?
GROUP BY wk
ORDER BY wk`;

const qtotalSql = `
SELECT COUNT(*) c
FROM interactions i
LEFT JOIN accounts a ON a.id = i.account_id
${accessJoin}
WHERE ${accessCond}
  AND i.analysis_status = 'lead_qualified'`;

const created = await query(createdSql, [uid, uid, uid, from, to]);
const qualified = await query(qualifiedSql, [uid, uid, uid, from, to]);
const qtotal = await query(qtotalSql, [uid, uid, uid]);

console.log(JSON.stringify({ uid, created, qualified, qualifiedVisibleTotal: Number(qtotal[0]?.c || 0) }, null, 2));
