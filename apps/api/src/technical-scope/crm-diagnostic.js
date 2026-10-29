import { query } from "../db.js";
import { listPlaybooksWithContent } from "./playbooks.js";

const MAX_MATCHED_OPPORTUNITIES = 2000;

function keywordsOf(playbook) {
  const moduleKeywords = (playbook.content?.modules || []).flatMap((module) => module.detectKeywords || []);
  return Array.from(
    new Set(
      [...(playbook.detectionKeywords || []), ...moduleKeywords]
        .map((keyword) => String(keyword || "").trim().toLowerCase())
        .filter((keyword) => keyword.length >= 3),
    ),
  );
}

// Opportunities whose name or quoted items mention the solution keywords.
export async function findOpportunityIdsForKeywords(keywords) {
  if (!keywords.length) return [];
  const nameClauses = keywords.map(() => "LOWER(o.name) LIKE ?").join(" OR ");
  const itemClauses = keywords
    .map(() => "LOWER(CONCAT(qsi.product_code, ' ', qsi.product_description)) LIKE ?")
    .join(" OR ");
  const likes = keywords.map((keyword) => `%${keyword}%`);
  const rows = await query(
    `SELECT DISTINCT o.id
     FROM opportunities o
     WHERE (${nameClauses})
        OR EXISTS (
          SELECT 1
          FROM quotations q
          INNER JOIN quotation_versions qv ON qv.quotation_id = q.id
          INNER JOIN quotation_sections qs ON qs.quotation_version_id = qv.id
          INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qs.id
          WHERE q.opportunity_id = o.id AND (${itemClauses})
        )
     LIMIT ${MAX_MATCHED_OPPORTUNITIES}`,
    [...likes, ...likes],
  );
  return rows.map((row) => Number(row.id));
}

async function countFor(table, idColumn, opportunityIds, extraWhere = "") {
  if (!opportunityIds.length) return 0;
  const rows = await query(
    `SELECT COUNT(*) AS total FROM ${table}
     WHERE ${idColumn} IN (${opportunityIds.map(() => "?").join(", ")}) ${extraWhere}`,
    opportunityIds,
  );
  return Number(rows[0]?.total || 0);
}

// Read-only count of the evidence available in the CRM for each solution.
export async function runCrmDiagnostic({ playbooks = null } = {}) {
  const list = playbooks || (await listPlaybooksWithContent());
  const results = [];
  for (const playbook of list) {
    const keywords = keywordsOf(playbook);
    const opportunityIds = await findOpportunityIdsForKeywords(keywords);
    const byStatus = {};
    if (opportunityIds.length) {
      const rows = await query(
        `SELECT ocs.code AS status_code, COUNT(*) AS total
         FROM opportunities o
         INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
         WHERE o.id IN (${opportunityIds.map(() => "?").join(", ")})
         GROUP BY ocs.code`,
        opportunityIds,
      );
      for (const row of rows) byStatus[row.status_code] = Number(row.total);
    }
    const [proposals, documents, stageAnswers, quotations] = await Promise.all([
      countFor("proposals", "opportunity_id", opportunityIds),
      countFor("opportunity_document_links", "opportunity_id", opportunityIds),
      countFor("opportunity_stage_question_answers", "opportunity_id", opportunityIds),
      countFor("quotations", "opportunity_id", opportunityIds),
    ]);
    results.push({
      playbookCode: playbook.code,
      playbookName: playbook.name,
      keywords,
      opportunities: opportunityIds.length,
      byCommercialStatus: byStatus,
      proposals,
      quotations,
      documents,
      stageAnswers,
    });
  }
  return results;
}
