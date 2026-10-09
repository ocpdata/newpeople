import { describe, expect, it } from "vitest";
import {
  getControlledCoachOperationPolicy,
  getDelegatedCoachOperationPermissions,
  hasAnyPermission,
  validateControlledCoachOperation,
} from "../src/coach/operation-policy.js";

const delegatedPermissionMatrix = [
  ["activity", ["calendario_comercial.update"]],
  ["lead_resolve", ["interacciones.resolve"]],
  ["create_lead", ["interacciones.update"]],
  ["create_contact_mapping", ["contactos.update"]],
  ["create_account", ["cuentas.create", "cuentas.request"]],
  ["create_contact", ["contactos.create", "contactos.request"]],
  ["create_opportunity", ["oportunidades.create", "oportunidades.request"]],
  [
    "create_quotation",
    [
      "cotizaciones.operacion",
      "cotizaciones.ingreso",
      "cotizaciones.administracion",
    ],
  ],
  ["create_proposal", ["propuestas.create"]],
];

describe("Coach operation policy", () => {
  it("maps controlled operations to their domain permissions", () => {
    expect(getControlledCoachOperationPolicy("account_field")).toMatchObject({
      domainPermission: "cuentas.update",
      entityIdField: "accountId",
    });
    expect(
      getControlledCoachOperationPolicy("lead_call_outcome"),
    ).toMatchObject({
      domainPermission: "interacciones.update",
      entityIdField: "interactionId",
    });
  });

  it("rejects unknown kinds and fields instead of using a fallback", () => {
    expect(validateControlledCoachOperation({ kind: "invented" })).toEqual({
      ok: false,
      code: "COACH_OPERATION_UNSUPPORTED",
    });
    expect(
      validateControlledCoachOperation({
        kind: "account_field",
        accountId: 20,
        field: "activation_status_id",
      }),
    ).toMatchObject({ ok: false, code: "COACH_FIELD_NOT_ALLOWED" });
  });

  it("keeps delegated creation permissions explicit", () => {
    expect(getDelegatedCoachOperationPermissions("create_account")).toEqual([
      "cuentas.create",
      "cuentas.request",
    ]);
    expect(getDelegatedCoachOperationPermissions("unknown")).toBeNull();
  });

  it.each(delegatedPermissionMatrix)(
    "requires an explicit domain permission for %s",
    (kind, permissions) => {
      expect(getDelegatedCoachOperationPermissions(kind)).toEqual(permissions);
      expect(
        hasAnyPermission(
          { permissionSet: new Set(["mi_coach.use", "mi_coach.execute"]) },
          permissions,
        ),
      ).toBe(false);
      expect(
        hasAnyPermission(
          { permissionSet: new Set([permissions.at(-1)]) },
          permissions,
        ),
      ).toBe(true);
    },
  );
});
