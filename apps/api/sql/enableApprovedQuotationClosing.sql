INSERT INTO quotation_action_permissions
  (status_id, action_id, permission_id, is_allowed)
SELECT qs.id, qa.id, p.id, 1
FROM quotation_statuses qs
CROSS JOIN quotation_actions qa
CROSS JOIN permissions p
WHERE qs.code = 'aprobada'
  AND qa.code IN ('declarar_perdida', 'declarar_anulada')
  AND p.code = 'cotizaciones.operacion'
ON DUPLICATE KEY UPDATE is_allowed = 1, updated_at = NOW(3);
