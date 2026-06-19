import { query } from './src/db.js';

const email = 'ocarrillo@accessq.com.mx';
const rows = await query(
  `SELECT u.id, u.email, p.code
   FROM users u
   JOIN user_roles ur ON ur.user_id = u.id
   JOIN role_permissions rp ON rp.role_id = ur.role_id
   JOIN permissions p ON p.id = rp.permission_id
   WHERE u.email = ?
     AND (p.code LIKE 'interacciones.%' OR p.code LIKE 'leads.%')
   ORDER BY p.code`,
  [email],
);
console.log(JSON.stringify(rows, null, 2));
