import { query } from "../db.js";

let ready;
export function ensureEvaluationSchema() {
  if (!ready) ready = createSchema().catch((error) => { ready = null; throw error; });
  return ready;
}
async function createSchema() {
  await query(`CREATE TABLE IF NOT EXISTS customer_chat_evaluation_control (
    id INT PRIMARY KEY
  ) ENGINE=InnoDB`);
  await query("INSERT IGNORE INTO customer_chat_evaluation_control(id) VALUES(1)");
  await query(`CREATE TABLE IF NOT EXISTS customer_chat_evaluation_runs (
    id CHAR(36) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    request_key CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL,
    parent_id CHAR(36) NULL, status VARCHAR(32) NOT NULL,
    configuration JSON NOT NULL, cancel_requested TINYINT NOT NULL DEFAULT 0,
    worker_id CHAR(36) NULL, heartbeat_at DATETIME(3) NULL,
    error_message TEXT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at DATETIME(3) NULL,
    UNIQUE KEY evaluation_request(user_id,request_key), KEY evaluation_queue(status,created_at),
    KEY evaluation_owner(user_id,created_at)
  ) ENGINE=InnoDB`);
  await query(`CREATE TABLE IF NOT EXISTS customer_chat_evaluation_cases (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, run_id CHAR(36) NOT NULL,
    case_id VARCHAR(32) NOT NULL, repetition INT NOT NULL, ordinal INT NOT NULL,
    definition_json JSON NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'pending',
    result_json JSON NULL, review_json JSON NULL,
    session_id BIGINT UNSIGNED NULL, job_id BIGINT UNSIGNED NULL,
    started_at DATETIME(3) NULL, finished_at DATETIME(3) NULL,
    UNIQUE KEY evaluation_case(run_id,case_id,repetition), KEY evaluation_case_order(run_id,ordinal),
    KEY evaluation_session(session_id),
    FOREIGN KEY (run_id) REFERENCES customer_chat_evaluation_runs(id)
  ) ENGINE=InnoDB`);
  await query(`CREATE TABLE IF NOT EXISTS customer_chat_evaluation_actions (
    action_key VARCHAR(100) PRIMARY KEY, run_id CHAR(36) NOT NULL,
    case_row_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL, operation_id BIGINT UNSIGNED NULL,
    status VARCHAR(32) NOT NULL, proposal_json JSON NOT NULL, result_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), finished_at DATETIME(3) NULL,
    KEY evaluation_action_case(run_id,case_row_id),
    FOREIGN KEY (run_id) REFERENCES customer_chat_evaluation_runs(id),
    FOREIGN KEY (case_row_id) REFERENCES customer_chat_evaluation_cases(id)
  ) ENGINE=InnoDB`);
  await query(`CREATE TABLE IF NOT EXISTS customer_chat_evaluation_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, run_id CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL, event_type VARCHAR(40) NOT NULL,
    metadata_json JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY evaluation_events(run_id,id),
    FOREIGN KEY (run_id) REFERENCES customer_chat_evaluation_runs(id)
  ) ENGINE=InnoDB`);
}
