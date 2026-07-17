# Lead (Interaction) Audit Log Reference

## 1. Audit Log Structure for Leads

The audit_log table records lead/interaction changes with the following key columns:

```
- module: "interacciones"
- action: string (see below)
- entity_type: "interaction"
- entity_id: interaction.id
- status: "success" or "error"
- detail: human-readable description
- changed_fields: JSON object with before/after values
- performed_by_user_id, performed_by_name, performed_by_email
- created_at: timestamp of when change occurred
```

## 2. Common Action Names for Lead Status Changes

| Action              | When It Occurs                      | Main Fields Changed                         |
| ------------------- | ----------------------------------- | ------------------------------------------- |
| `"created"`         | When a lead is first created        | (initial creation)                          |
| `"analyzed"`        | When lead is analyzed/AI processing | Various JSON fields (summary, topics, etc.) |
| `"updated"`         | When lead details or status changes | Multiple fields depending on change type    |
| `"lead_email_sent"` | When email is sent from lead        | (not analysis_status change)                |
| `"deleted"`         | When lead is deleted                | (record removed)                            |

## 3. Lead Status Values in Interactions Table

The `analysis_status` field in interactions table holds:

- `"created"` - Initial state, no account/contacts
- `"lead_unassigned"` - Has account & contacts, no seller assigned yet
- `"lead_assigned"` - Has seller assigned, no opportunity yet
- `"lead_qualified"` - Converted to opportunity (seller + opportunity linked)
- `"lead_disqualified"` - Lead was rejected/not viable

## 4. Seller Assignment Tracking

**Direct Fields in interactions table:**

- `seller_user_id` - The assigned seller's user ID

**When tracking seller assignment:**

- A lead gets `seller_user_id` set when transitioning from `lead_unassigned` → `lead_assigned` or `lead_qualified`
- This happens in the lead resolution endpoint when calling:
  ```sql
  UPDATE interactions SET seller_user_id = ?, analysis_status = ? WHERE id = ?
  ```

**Audit Log will record:**

```json
{
  "module": "interacciones",
  "action": "updated",
  "entity_type": "interaction",
  "entity_id": <interaction_id>,
  "changed_fields": {
    "seller_user_id": {
      "before": null,
      "after": <user_id>
    },
    "analysis_status": {
      "before": "lead_unassigned",
      "after": "lead_assigned"
    }
  },
  "detail": "Lead actualizado",
  "after": {
    "assignedSellerUserId": <user_id>,
    "resolvedAccountId": <account_id>
  }
}
```

## 5. Lead Qualification Tracking

When a lead moves to `"lead_qualified"`:

- It happens when: seller_user_id IS NOT NULL AND primary_opportunity_id IS NOT NULL
- The `resolved_at` field is set to NOW(3)
- Audit log recorded with `analysis_status` change from `"lead_assigned"` to `"lead_qualified"`

**Important: There's also a separate table:**

- `interaction_lead_outcome_events` - tracks detailed commercial outcomes
  - Records: `from_status_code`, `to_status_code`, substatus, reason, required_action
  - Has `created_at` timestamp for each event

## 6. Working Sample Queries

### Get when a specific lead was assigned to a seller:

```sql
SELECT
  al.created_at AS assigned_at,
  al.performed_by_name AS assigned_by,
  JSON_EXTRACT(al.changed_fields, '$.seller_user_id.after') AS seller_user_id,
  JSON_EXTRACT(al.changed_fields, '$.analysis_status.after') AS new_status
FROM audit_log al
WHERE al.module = 'interacciones'
  AND al.action = 'updated'
  AND al.entity_type = 'interaction'
  AND al.entity_id = ?
  AND JSON_EXTRACT(al.changed_fields, '$.seller_user_id.before') IS NULL
  AND JSON_EXTRACT(al.changed_fields, '$.seller_user_id.after') IS NOT NULL
LIMIT 1;
```

### Get when a lead was qualified:

```sql
SELECT
  al.created_at AS qualified_at,
  al.performed_by_name AS qualified_by,
  JSON_EXTRACT(al.changed_fields, '$.analysis_status.after') AS status,
  al.detail
FROM audit_log al
WHERE al.module = 'interacciones'
  AND al.action = 'updated'
  AND al.entity_type = 'interaction'
  AND al.entity_id = ?
  AND JSON_EXTRACT(al.changed_fields, '$.analysis_status.after') = 'lead_qualified'
LIMIT 1;
```

### Get all status transitions for a lead (full history):

```sql
SELECT
  al.created_at,
  al.action,
  al.detail,
  al.performed_by_name,
  JSON_EXTRACT(al.changed_fields, '$.analysis_status.before') AS old_status,
  JSON_EXTRACT(al.changed_fields, '$.analysis_status.after') AS new_status,
  JSON_EXTRACT(al.changed_fields, '$.seller_user_id.after') AS seller_user_id,
  al.changed_fields
FROM audit_log al
WHERE al.module = 'interacciones'
  AND al.entity_type = 'interaction'
  AND al.entity_id = ?
ORDER BY al.created_at ASC;
```

### Calculate time between assignment and qualification:

```sql
SELECT
  i.id AS interaction_id,
  i.title,
  u.full_name AS seller_name,
  assignment.created_at AS assigned_at,
  qualification.created_at AS qualified_at,
  TIMESTAMPDIFF(HOUR, assignment.created_at, qualification.created_at) AS hours_to_qualify,
  TIMESTAMPDIFF(DAY, assignment.created_at, qualification.created_at) AS days_to_qualify
FROM interactions i
LEFT JOIN users u ON u.id = i.seller_user_id
LEFT JOIN audit_log assignment ON (
  assignment.module = 'interacciones'
  AND assignment.entity_type = 'interaction'
  AND assignment.entity_id = i.id
  AND assignment.action = 'updated'
  AND JSON_EXTRACT(assignment.changed_fields, '$.seller_user_id.after') IS NOT NULL
  AND JSON_EXTRACT(assignment.changed_fields, '$.seller_user_id.before') IS NULL
)
LEFT JOIN audit_log qualification ON (
  qualification.module = 'interacciones'
  AND qualification.entity_type = 'interaction'
  AND qualification.entity_id = i.id
  AND qualification.action = 'updated'
  AND JSON_EXTRACT(qualification.changed_fields, '$.analysis_status.after') = 'lead_qualified'
)
WHERE i.analysis_status = 'lead_qualified'
  AND assignment.created_at IS NOT NULL
  AND qualification.created_at IS NOT NULL
ORDER BY days_to_qualify DESC;
```

## 7. Key Field Names from interactions Table

| Field                    | Type            | Meaning                                                                  |
| ------------------------ | --------------- | ------------------------------------------------------------------------ |
| `analysis_status`        | VARCHAR(40)     | Current lead status (created/unassigned/assigned/qualified/disqualified) |
| `seller_user_id`         | BIGINT UNSIGNED | Assigned seller's user ID                                                |
| `account_id`             | BIGINT UNSIGNED | Linked account ID                                                        |
| `primary_opportunity_id` | BIGINT UNSIGNED | Linked opportunity ID (if qualified)                                     |
| `resolved_at`            | DATETIME(3)     | When lead reached final status                                           |
| `created_at`             | DATETIME(3)     | When lead was created                                                    |
| `updated_at`             | DATETIME(3)     | Last modification time                                                   |

## 8. How changed_fields JSON Works

When using `logAuditEvent()` function, it compares `before` and `after` objects and creates JSON:

```javascript
{
  "fieldName": {
    "before": <old_value>,
    "after": <new_value>
  }
}
```

Only fields that actually changed are included. Access with:

- `JSON_EXTRACT(changed_fields, '$.fieldName.before')`
- `JSON_EXTRACT(changed_fields, '$.fieldName.after')`

## 9. Metrics Used in Commercial Tracking

From `routes.commercial-tracking.js`, these functions load lead metrics:

- `loadQuarterLeadCountsBySeller()` - Counts all created leads by seller in quarter
- `loadQuarterQualifiedLeadCountsBySeller()` - Counts qualified leads (analysis_status = 'lead_qualified') by seller
- `loadRecentLeadConversionBySeller()` - Gets conversion rates (lead → opportunity)

The queries filter on:

- `i.seller_user_id IS NOT NULL` - Lead must be assigned
- `i.analysis_status IN ('created', 'lead_unassigned', 'lead_assigned', 'lead_qualified', 'lead_disqualified')`
- `i.created_at BETWEEN ? AND ?` - Time period

## 10. Real Example: Lead Status Transitions in Audit Log

A typical lead's journey would appear as:

```
1. action='created' → detail='Lead creado'

2. action='analyzed' → detail='Lead reanalizado'
   changed_fields includes: summary, topics_json, actions_taken_json

3. action='updated' → detail='Lead actualizado'
   changed_fields: {
     "account_id": { "before": null, "after": 123 },
     "analysis_status": { "before": "created", "after": "lead_unassigned" }
   }

4. action='updated' → detail='Lead actualizado'
   changed_fields: {
     "seller_user_id": { "before": null, "after": 456 },
     "analysis_status": { "before": "lead_unassigned", "after": "lead_assigned" }
   }
   after: { "assignedSellerUserId": 456, ... }

5. action='updated' → detail='Lead actualizado (vinculadas existentes: 0; creadas: 1)'
   changed_fields: {
     "primary_opportunity_id": { "before": null, "after": 789 },
     "analysis_status": { "before": "lead_assigned", "after": "lead_qualified" }
   }
   after: { "createdOpportunityIds": [789], ... }
```
