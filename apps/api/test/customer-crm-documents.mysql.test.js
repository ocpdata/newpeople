import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listCustomerCrmDocuments, readCustomerCrmDocument } from "../src/coach/customer-document-access.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("CRM document reads in isolated MySQL", () => {
  const database = `newpeople_crm_docs_test_${randomUUID().replace(/-/g, "")}`;
  let admin, pool;
  const execute = async (...args) => (await pool.query(...args))[0];
  const user = { id: 9, permissionSet: new Set(["cuentas.read", "oportunidades.read", "cotizaciones.operacion"]) };
  const scope = { user, accountId: 1, opportunityId: 10, source: "opportunity_document", execute };
  const quoted = { ...scope, source: "quotation_document", quotationId: 18 };
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET };
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE ${database}`);
    pool = mysql.createPool({ ...options, database, connectionLimit: 2 });
    const statements = [
      "CREATE TABLE account_activation_statuses(id INT PRIMARY KEY, code VARCHAR(30))",
      "CREATE TABLE accounts(id INT PRIMARY KEY, activation_status_id INT)",
      "CREATE TABLE opportunities(id INT PRIMARY KEY, account_id INT)",
      "CREATE TABLE account_owners(account_id INT, user_id INT)",
      "CREATE TABLE quotations(id INT PRIMARY KEY, opportunity_id INT, latest_version_id INT)",
      "CREATE TABLE quotation_versions(id INT PRIMARY KEY, quotation_id INT, version_number INT)",
      `CREATE TABLE documents(id INT PRIMARY KEY, public_id VARCHAR(80), original_file_name VARCHAR(300),
        mime_type VARCHAR(100), file_extension VARCHAR(20), byte_size INT, processing_status VARCHAR(30), is_deleted INT)`,
      `CREATE TABLE document_contents(document_id INT PRIMARY KEY, extraction_status VARCHAR(30),
        transcription_status VARCHAR(30), normalized_text TEXT, raw_text TEXT, transcript_text TEXT, content_summary TEXT)`,
      "CREATE TABLE opportunity_document_links(opportunity_id INT, document_id INT, link_type VARCHAR(30))",
      "CREATE TABLE quotation_version_documents(quotation_version_id INT, document_id INT, ai_enabled INT)",
    ];
    for (const statement of statements) await execute(statement);
  });
  beforeEach(async () => {
    for (const table of ["quotation_version_documents", "opportunity_document_links", "document_contents",
      "documents", "quotation_versions", "quotations", "account_owners", "opportunities", "accounts", "account_activation_statuses"]) {
      await execute(`DELETE FROM ${table}`);
    }
    await execute("INSERT INTO account_activation_statuses VALUES(1,'activada'),(2,'desactivada')");
    await execute("INSERT INTO accounts VALUES(1,1),(2,1)");
    await execute("INSERT INTO opportunities VALUES(10,1),(20,2)");
    await execute("INSERT INTO account_owners VALUES(1,9),(2,99)");
    await execute("INSERT INTO quotations VALUES(18,10,108),(28,20,208)");
    await execute("INSERT INTO quotation_versions VALUES(103,18,3),(108,18,8),(208,28,1)");
    await execute(`INSERT INTO documents VALUES
      (7,'doc_7','requisitos.txt','text/plain','txt',29,'completed',0),
      (8,'doc_8','propuesta.txt','text/plain','txt',29,'completed',0),
      (9,'doc_9','eliminado.txt','text/plain','txt',29,'completed',1),
      (20,'doc_20','otra-cuenta.txt','text/plain','txt',29,'completed',0)`);
    await execute(`INSERT INTO document_contents(document_id,extraction_status,normalized_text)
      VALUES(7,'completed','Garantía de doce meses.'),(8,'completed','Garantía de seis meses.'),(20,'completed','No autorizado.')`);
    await execute("INSERT INTO opportunity_document_links VALUES(10,7,'source'),(10,7,'support'),(10,9,'source'),(20,20,'source')");
    await execute("INSERT INTO quotation_version_documents VALUES(103,7,1),(108,8,1),(108,9,1),(208,20,1)");
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE ${database}`);
      await admin.end();
    }
  });
  it("deduplicates opportunity links and excludes deleted and unrelated files", async () => {
    const result = await listCustomerCrmDocuments(scope);
    expect(result.candidates.map((item) => item.documentId)).toEqual([7]);
    expect((await readCustomerCrmDocument({ ...scope, documentId: 7 })).text).toContain("doce");
    await expect(readCustomerCrmDocument({ ...scope, documentId: 20 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_UNAVAILABLE" });
  });
  it("revalidates candidate IDs against quotation revision, deletion and ownership", async () => {
    const result = await listCustomerCrmDocuments({ ...quoted, documentIds: [7, 8, 9, 20] });
    expect(result.candidates.map((item) => item.documentId)).toEqual([8]);
    expect((await listCustomerCrmDocuments({ ...quoted, versionNumber: 3, documentIds: [7, 8, 20] }))
      .candidates.map((item) => item.documentId)).toEqual([7]);
    await execute("DELETE FROM quotation_version_documents WHERE document_id=8");
    expect((await listCustomerCrmDocuments({ ...quoted, documentIds: [8] })).candidates).toEqual([]);
    await execute("DELETE FROM account_owners WHERE account_id=1");
    await expect(listCustomerCrmDocuments({ ...quoted, documentIds: [8] }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_SCOPE_UNAVAILABLE" });
  });
  it("finds an explicitly named older document beyond the first 50 without broadening scope", async () => {
    for (let id = 30; id < 82; id++) {
      await execute(`INSERT INTO documents(id,public_id,original_file_name,processing_status,is_deleted)
        VALUES(?,?,?,'uploaded',0)`, [id, `doc_${id}`, `archivo-${id}.txt`]);
      await execute("INSERT INTO opportunity_document_links VALUES(10,?,'source')", [id]);
    }
    expect((await listCustomerCrmDocuments(scope)).truncated).toBe(true);
    expect((await listCustomerCrmDocuments({ ...scope, documentReference: "requisitos.txt" }))
      .candidates.map((item) => item.documentId)).toEqual([7]);
    expect((await listCustomerCrmDocuments({ ...scope, documentReference: "otra-cuenta.txt" }))
      .candidates).toEqual([]);
  });
  it("does not widen account or ownership scope", async () => {
    await expect(listCustomerCrmDocuments({ ...scope, opportunityId: 20 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_SCOPE_UNAVAILABLE" });
    await expect(listCustomerCrmDocuments({ ...scope, opportunityId: 20, accountId: 2 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_SCOPE_UNAVAILABLE" });
  });
  it("requires both module-wide scopes for unowned opportunity documents", async () => {
    const global = { ...user, permissionSet: new Set([...user.permissionSet, "cuentas.read_all", "oportunidades.read_all"]) };
    expect((await listCustomerCrmDocuments({ ...scope, user: global, accountId: 2, opportunityId: 20 }))
      .candidates.map((item) => item.documentId)).toEqual([20]);
  });
  it("returns latest files by default and only the requested revision when explicit", async () => {
    expect((await listCustomerCrmDocuments(quoted)).candidates.map((item) => item.documentId)).toEqual([8]);
    const result = await listCustomerCrmDocuments({ ...quoted, versionNumber: 3 });
    expect(result.candidates.map((item) => item.documentId)).toEqual([7]);
    expect(result.version).toMatchObject({ versionId: 103, versionNumber: 3 });
    await expect(readCustomerCrmDocument({ ...quoted, versionNumber: 3, documentId: 8 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_UNAVAILABLE" });
  });
  it("does not traverse from a quotation to another opportunity", async () => {
    await expect(listCustomerCrmDocuments({ ...quoted, quotationId: 28 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_VERSION_UNAVAILABLE" });
  });
  it("lists disabled metadata but never returns disabled content", async () => {
    await execute("UPDATE quotation_version_documents SET ai_enabled=0 WHERE document_id=8");
    expect((await listCustomerCrmDocuments(quoted)).candidates[0].aiEnabled).toBe(false);
    await expect(readCustomerCrmDocument({ ...quoted, documentId: 8 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_UNAVAILABLE" });
  });
  it("revalidates ownership and association after the listing", async () => {
    await listCustomerCrmDocuments(scope);
    await execute("DELETE FROM account_owners WHERE account_id=1");
    await expect(readCustomerCrmDocument({ ...scope, documentId: 7 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_SCOPE_UNAVAILABLE" });
    await execute("INSERT INTO account_owners VALUES(1,9)");
    await execute("DELETE FROM opportunity_document_links WHERE document_id=7");
    await expect(readCustomerCrmDocument({ ...scope, documentId: 7 }))
      .rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_UNAVAILABLE" });
  });
  it("blocks inactive accounts", async () => {
    await execute("UPDATE accounts SET activation_status_id=2 WHERE id=1");
    await expect(listCustomerCrmDocuments(scope)).rejects.toMatchObject({ code: "CUSTOMER_DOCUMENT_SCOPE_UNAVAILABLE" });
  });
  it("reads an uploaded quotation attachment with the existing real local text extractor", async () => {
    await execute("DELETE FROM document_contents WHERE document_id=8");
    await execute("UPDATE documents SET processing_status='uploaded' WHERE id=8");
    const result = await readCustomerCrmDocument({ ...quoted, documentId: 8,
      openContent: async ({ documentPublicId }) => {
        expect(documentPublicId).toBe("doc_8");
        return { stream: Readable.from([Buffer.from("Requisitos técnicos sintéticos.")]) };
      },
    });
    expect(result).toMatchObject({ status: "ready", versionNumber: 8, text: "Requisitos técnicos sintéticos." });
    expect(await execute("SELECT document_id FROM document_contents WHERE document_id=8")).toEqual([]);
  });
});
