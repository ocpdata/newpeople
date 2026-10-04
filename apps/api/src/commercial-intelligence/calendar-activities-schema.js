import { query } from "../db.js";

export async function ensureCommercialCalendarActivitiesSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS commercial_calendar_activities (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(20) NOT NULL,
      activity_type VARCHAR(60) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      scheduled_at DATETIME NULL,
      due_date DATE NULL,
      objective VARCHAR(255) NOT NULL,
      note TEXT NULL,
      success_criteria TEXT NULL,
      seller_user_id BIGINT UNSIGNED NULL,
      opportunity_id BIGINT UNSIGNED NULL,
      interaction_id BIGINT UNSIGNED NULL,
      account_id BIGINT UNSIGNED NULL,
      contact_id BIGINT UNSIGNED NULL,
      is_primary_next_step TINYINT(1) NOT NULL DEFAULT 0,
      created_by BIGINT UNSIGNED NOT NULL,
      updated_by BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_cca_schedule_status (scheduled_at, status),
      KEY idx_cca_kind_status (kind, status),
      KEY idx_cca_seller (seller_user_id),
      KEY idx_cca_opportunity (opportunity_id),
      KEY idx_cca_interaction (interaction_id),
      KEY idx_cca_account (account_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}
