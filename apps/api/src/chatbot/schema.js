import { query } from "../db.js";

let ensurePromise = null;

export async function ensureChatbotSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS chatbot_sessions (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          public_id VARCHAR(64) NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          status ENUM('active','closed') NOT NULL DEFAULT 'active',
          locale VARCHAR(16) NOT NULL DEFAULT 'es',
          context_json JSON NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          UNIQUE KEY uq_chatbot_sessions_public_id (public_id),
          KEY idx_chatbot_sessions_user (user_id, created_at),
          CONSTRAINT fk_chatbot_sessions_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS chatbot_messages (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          public_id VARCHAR(64) NOT NULL,
          session_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          role ENUM('user','assistant','system') NOT NULL,
          content_text MEDIUMTEXT NOT NULL,
          source_json JSON NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          UNIQUE KEY uq_chatbot_messages_public_id (public_id),
          KEY idx_chatbot_messages_session (session_id, id),
          CONSTRAINT fk_chatbot_messages_session
            FOREIGN KEY (session_id) REFERENCES chatbot_sessions(id)
            ON DELETE CASCADE,
          CONSTRAINT fk_chatbot_messages_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS chatbot_jobs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          public_id VARCHAR(64) NOT NULL,
          session_id BIGINT UNSIGNED NOT NULL,
          message_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          feature_code VARCHAR(100) NOT NULL,
          status ENUM('queued','running','completed','failed','cancelled','expired') NOT NULL DEFAULT 'queued',
          request_json JSON NULL,
          result_json JSON NULL,
          error_code VARCHAR(80) NULL,
          error_message TEXT NULL,
          progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
          attempts INT UNSIGNED NOT NULL DEFAULT 0,
          lease_token VARCHAR(64) NULL,
          lease_expires_at DATETIME(3) NULL,
          started_at DATETIME(3) NULL,
          finished_at DATETIME(3) NULL,
          expires_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          UNIQUE KEY uq_chatbot_jobs_public_id (public_id),
          KEY idx_chatbot_jobs_process (status, lease_expires_at, created_at),
          KEY idx_chatbot_jobs_session (session_id, created_at),
          CONSTRAINT fk_chatbot_jobs_session
            FOREIGN KEY (session_id) REFERENCES chatbot_sessions(id)
            ON DELETE CASCADE,
          CONSTRAINT fk_chatbot_jobs_message
            FOREIGN KEY (message_id) REFERENCES chatbot_messages(id)
            ON DELETE CASCADE,
          CONSTRAINT fk_chatbot_jobs_user
            FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }

  return ensurePromise;
}
