import request from "supertest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "../src/app.js";
import { query } from "../src/db.js";
import { ensureCommercialEnablementPermissions } from "../src/commercial-enablement/permissions.js";
import { ensureCommercialPlanningSchema } from "../src/commercial-planning/schema.js";
import {
  TEST_PREFIX,
  cleanupArtifacts,
  createRole,
  createUser,
  login,
} from "./helpers/apiTestUtils.js";
import { suggestCommercialEnablementForContext } from "../src/commercial-enablement/service.js";
import {
  assertLibraryAttachmentsShareable,
  listCommercialLibraryFilesForEmail,
  recordLibraryAttachmentsUsage,
} from "../src/commercial-email/shared.js";

describe("Biblioteca de ventas", () => {
  const cleanup = { userIds: [], roleIds: [] };
  const tokens = {};
  const actors = {};

  async function createActor(key, permissionCodes) {
    const roleId = await createRole({
      name: `${TEST_PREFIX}_lib_${key}`,
      permissionCodes,
    });
    cleanup.roleIds.push(roleId);
    const email = `${TEST_PREFIX}.lib.${key}@example.com`;
    const userId = await createUser({
      fullName: `Library ${key}`,
      email,
      roleIds: [roleId],
    });
    cleanup.userIds.push(userId);
    actors[key] = { id: userId, permissionSet: new Set(permissionCodes) };
    const response = await login(request(app), email);
    tokens[key] = response.body.token;
  }

  const auth = (key) => ({ Authorization: `Bearer ${tokens[key]}` });

  async function createMaterial(key, suffix, overrides = {}) {
    const response = await request(app)
      .post("/api/commercial-enablement/assets")
      .set(auth(key))
      .send({
        title: `${TEST_PREFIX} ${suffix}`,
        assetTypeCode: "solution_brief",
        status: "archived",
        sourceType: "url",
        visibilityLevel: "client_safe",
        manufacturerCodes: ["fortinet"],
        ...overrides,
      });
    expect(response.status).toBe(201);
    return response.body;
  }

  async function addLinkAndActivate(key, asset, url = "https://example.com/m") {
    const link = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/links`)
      .set(auth(key))
      .send({ url, label: "Fuente" });
    expect(link.status).toBe(201);
    const activated = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/activate`)
      .set(auth(key))
      .send({});
    expect(activated.status).toBe(200);
    return activated.body;
  }

  async function search(key, params) {
    const response = await request(app)
      .get("/api/commercial-enablement/assets")
      .set(auth(key))
      .query(params);
    expect(response.status).toBe(200);
    return response.body;
  }

  beforeAll(async () => {
    await ensureCommercialEnablementPermissions();
    await ensureCommercialPlanningSchema();
    await createActor("manager", ["enablement_comercial.manage"]);
    await createActor("uploader", ["enablement_comercial.upload"]);
    await createActor("seller", ["enablement_comercial.use"]);
  });

  afterAll(async () => {
    await query(`DELETE FROM commercial_enablement_items WHERE title LIKE ?`, [
      `${TEST_PREFIX}%`,
    ]);
    await cleanupArtifacts(cleanup);
  });

  test("la busqueda exige todos los terminos sin importar el orden y pagina en el servidor", async () => {
    const first = await createMaterial("manager", "Fortinet salud caso de exito");
    const second = await createMaterial("manager", "Cisco banca brochure", {
      manufacturerCodes: ["cisco"],
    });
    const third = await createMaterial("manager", "Fortinet banca datasheet");
    await addLinkAndActivate("manager", first, "https://example.com/a");
    await addLinkAndActivate("manager", second, "https://example.com/b");
    await addLinkAndActivate("manager", third, "https://example.com/c");

    const byTerms = await search("seller", {
      q: `${TEST_PREFIX} salud fortinet exito`,
    });
    expect(byTerms.total).toBe(1);
    expect(byTerms.items[0].publicId).toBe(first.publicId);

    const noMatch = await search("seller", {
      q: `${TEST_PREFIX} salud banca`,
    });
    expect(noMatch.total).toBe(0);

    const paged = await search("seller", {
      q: `${TEST_PREFIX} fortinet`,
      pageSize: 1,
      page: 1,
    });
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(1);
    expect(paged.hasMore).toBe(true);
    expect(paged.items[0].searchText).toBeUndefined();

    const byManufacturer = await search("seller", {
      q: TEST_PREFIX,
      manufacturerCodes: "cisco",
    });
    expect(byManufacturer.items.map((item) => item.publicId)).toEqual([
      second.publicId,
    ]);
  });

  test("solo existen Activo y Desactivado; quien solo busca no ve lo desactivado", async () => {
    const asset = await createMaterial("uploader", "Material desactivable");
    expect(asset.status).toBe("archived");
    expect(asset.statusLabel).toBe("Desactivado");

    const activated = await addLinkAndActivate("uploader", asset);
    expect(activated.statusLabel).toBe("Activo");
    expect(
      (await search("seller", { q: `${TEST_PREFIX} desactivable` })).total,
    ).toBe(1);

    const deactivated = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/deactivate`)
      .set(auth("uploader"))
      .send({});
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.statusLabel).toBe("Desactivado");

    expect(
      (await search("seller", { q: `${TEST_PREFIX} desactivable` })).total,
    ).toBe(0);
    const hidden = await request(app)
      .get(`/api/commercial-enablement/assets/${asset.publicId}`)
      .set(auth("seller"));
    expect(hidden.status).toBe(404);

    const mine = await search("uploader", {
      q: `${TEST_PREFIX} desactivable`,
      status: "all",
    });
    expect(mine.total).toBe(1);
  });

  test("quien sube solo desactiva lo propio y eliminar exige manage", async () => {
    const managerAsset = await createMaterial("manager", "Material del gestor");
    await addLinkAndActivate("manager", managerAsset);

    const foreignDeactivate = await request(app)
      .post(
        `/api/commercial-enablement/assets/${managerAsset.publicId}/deactivate`,
      )
      .set(auth("uploader"))
      .send({});
    expect([403, 404]).toContain(foreignDeactivate.status);

    const ownAsset = await createMaterial("uploader", "Material propio");
    const uploaderDelete = await request(app)
      .delete(`/api/commercial-enablement/assets/${ownAsset.publicId}`)
      .set(auth("uploader"));
    expect(uploaderDelete.status).toBe(403);

    const managerDelete = await request(app)
      .delete(`/api/commercial-enablement/assets/${ownAsset.publicId}`)
      .set(auth("manager"));
    expect(managerDelete.status).toBe(200);
    const gone = await request(app)
      .get(`/api/commercial-enablement/assets/${ownAsset.publicId}`)
      .set(auth("manager"));
    expect(gone.status).toBe(404);
  });

  test("un material tipo URL vence a los 30 dias y reactivar renueva la vigencia", async () => {
    const asset = await createMaterial("manager", "Material con enlace");
    const activated = await addLinkAndActivate("manager", asset);
    const expiresInMs = new Date(activated.expiresAt).getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);

    await query(
      `UPDATE commercial_enablement_items
       SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 DAY)
       WHERE public_id = ?`,
      [asset.publicId],
    );
    expect(
      (await search("seller", { q: `${TEST_PREFIX} con enlace` })).total,
    ).toBe(0);
    const expired = await request(app)
      .get(`/api/commercial-enablement/assets/${asset.publicId}`)
      .set(auth("manager"));
    expect(expired.body).toEqual(
      expect.objectContaining({
        status: "archived",
        statusLabel: "Desactivado",
        isExpired: true,
      }),
    );

    const renewed = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/activate`)
      .set(auth("manager"))
      .send({});
    expect(renewed.status).toBe(200);
    expect(renewed.body.isActive).toBe(true);
    expect(
      (await search("seller", { q: `${TEST_PREFIX} con enlace` })).total,
    ).toBe(1);
  });

  test("filtra por origen, vencimiento y si se comparte con el cliente", async () => {
    const link = await createMaterial("manager", "filtro enlace");
    await addLinkAndActivate("manager", link);
    const expiring = await createMaterial("manager", "filtro por vencer");
    await addLinkAndActivate("manager", expiring);
    const expired = await createMaterial("manager", "filtro vencido");
    await addLinkAndActivate("manager", expired);
    const internal = await createMaterial("manager", "filtro interno", {
      visibilityLevel: "internal_sales",
    });
    await addLinkAndActivate("manager", internal);

    await query(
      `UPDATE commercial_enablement_items
       SET expires_at = DATE_ADD(NOW(3), INTERVAL 3 DAY) WHERE public_id = ?`,
      [expiring.publicId],
    );
    await query(
      `UPDATE commercial_enablement_items
       SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 DAY) WHERE public_id = ?`,
      [expired.publicId],
    );

    const base = { q: `${TEST_PREFIX} filtro`, status: "all" };
    const titles = async (extra) =>
      (await search("manager", { ...base, ...extra })).items
        .map((item) => item.publicId)
        .sort();

    expect(await titles({ sourceType: "url" })).toHaveLength(4);
    expect(await titles({ sourceType: "file" })).toHaveLength(0);
    expect(await titles({ expiry: "expired" })).toEqual([expired.publicId]);
    expect(await titles({ expiry: "expiring" })).toEqual([expiring.publicId]);
    expect(await titles({ sharing: "internal" })).toEqual([internal.publicId]);
    expect(await titles({ sharing: "client" })).toHaveLength(3);
  });

  test("los enlaces compartibles de archivos se validan en cada descarga", async () => {
    const asset = await createMaterial("manager", "Folleto compartible", {
      sourceType: "file",
    });
    const upload = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/files`)
      .set(auth("manager"))
      .attach("file", Buffer.from("%PDF-1.4 folleto de prueba"), {
        filename: "folleto.pdf",
        contentType: "application/pdf",
      });
    expect(upload.status).toBe(201);
    const activated = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/activate`)
      .set(auth("manager"))
      .send({});
    expect(activated.status).toBe(200);
    expect(activated.body.expiresAt).toBeNull();

    const share = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/share-link`)
      .set(auth("seller"))
      .send({});
    expect(share.status).toBe(200);
    const shareExpiresInMs =
      new Date(share.body.expiresAt).getTime() - Date.now();
    expect(shareExpiresInMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(share.body.url).toContain("/api/public/library-shares/");

    const publicPath = new URL(share.body.url).pathname;
    const download = await request(app).get(publicPath);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment");

    await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/deactivate`)
      .set(auth("manager"))
      .send({});
    const afterDeactivate = await request(app).get(publicPath);
    expect(afterDeactivate.status).toBe(410);

    const unknown = await request(app).get(
      "/api/public/library-shares/token-inexistente/download",
    );
    expect(unknown.status).toBe(404);
  });

  test("solo los materiales para cliente pueden compartirse", async () => {
    const internal = await createMaterial("manager", "Material interno", {
      visibilityLevel: "internal_sales",
    });
    await addLinkAndActivate("manager", internal);
    const share = await request(app)
      .post(`/api/commercial-enablement/assets/${internal.publicId}/share-link`)
      .set(auth("seller"))
      .send({});
    expect(share.status).toBe(409);

    const clientAsset = await createMaterial("manager", "Material de cliente");
    await addLinkAndActivate(
      "manager",
      clientAsset,
      "https://example.com/original",
    );
    const urlShare = await request(app)
      .post(
        `/api/commercial-enablement/assets/${clientAsset.publicId}/share-link`,
      )
      .set(auth("seller"))
      .send({});
    expect(urlShare.status).toBe(200);
    expect(urlShare.body.url).toBe("https://example.com/original");
  });

  async function createPdfMaterial(suffix, overrides = {}) {
    const asset = await createMaterial("manager", suffix, {
      sourceType: "file",
      ...overrides,
    });
    const upload = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/files`)
      .set(auth("manager"))
      .attach("file", Buffer.from("%PDF-1.4 prueba"), {
        filename: "material.pdf",
        contentType: "application/pdf",
      });
    expect(upload.status).toBe(201);
    const activated = await request(app)
      .post(`/api/commercial-enablement/assets/${asset.publicId}/activate`)
      .set(auth("manager"))
      .send({});
    expect(activated.status).toBe(200);
    return activated.body;
  }

  test("sugiere materiales para cliente segun fabricante y etapa de la oportunidad", async () => {
    const match = await createMaterial("manager", "Caso Zyxel salud", {
      manufacturerCodes: ["zyxel"],
    });
    await addLinkAndActivate("manager", match, "https://example.com/zyxel");
    const internal = await createMaterial("manager", "Interno Zyxel", {
      manufacturerCodes: ["zyxel"],
      visibilityLevel: "internal_sales",
    });
    await addLinkAndActivate("manager", internal, "https://example.com/zyxel-i");

    const suggestions = await suggestCommercialEnablementForContext({
      user: actors.seller,
      text: "Proyecto Zyxel para hospital regional",
      stageCode: "descubrimiento",
    });
    expect(suggestions.map((item) => item.publicId)).toEqual([match.publicId]);
    expect(suggestions[0].reasons).toContain("Zyxel");

    const none = await suggestCommercialEnablementForContext({
      user: actors.seller,
      text: "Proyecto sin relacion",
    });
    expect(none.map((item) => item.publicId)).not.toContain(match.publicId);
  });

  test("los adjuntos de correo solo admiten materiales activos para cliente y registran el envio", async () => {
    const client = await createPdfMaterial("Folleto adjuntable");
    const internal = await createPdfMaterial("Folleto interno adjuntable", {
      visibilityLevel: "internal_sales",
    });

    const options = await listCommercialLibraryFilesForEmail({
      user: actors.seller,
      includeAssetPublicId: client.publicId,
    });
    const optionIds = options.map((option) => option.resourcePublicId);
    expect(optionIds).toContain(client.publicId);
    const internalOptions = await listCommercialLibraryFilesForEmail({
      user: actors.seller,
      includeAssetPublicId: internal.publicId,
    });
    expect(
      internalOptions.map((option) => option.resourcePublicId),
    ).not.toContain(internal.publicId);

    const attachment = (asset) => ({
      sourceType: "library_file",
      resourcePublicId: asset.publicId,
    });
    await expect(
      assertLibraryAttachmentsShareable({
        user: actors.seller,
        attachments: [attachment(client)],
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertLibraryAttachmentsShareable({
        user: actors.manager,
        attachments: [attachment(internal)],
      }),
    ).rejects.toMatchObject({ status: 400 });

    await recordLibraryAttachmentsUsage({
      user: actors.seller,
      attachments: [attachment(client)],
      eventType: "emailed",
      contextType: "opportunity",
      contextEntityId: 1,
    });
    const recent = await search("seller", { shortcut: "recent" });
    expect(recent.items.map((item) => item.publicId)).toContain(client.publicId);
  });
});
