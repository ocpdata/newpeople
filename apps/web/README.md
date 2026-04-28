# NewPeople CRM — Frontend

SPA construida con React + Vite. Consume la API Express de `apps/api`.

## Stack

- React 18
- Vite 5
- React Router
- Axios (cliente HTTP con JWT)

## Estructura relevante

```
src/
  AppShell.jsx              — rutas protegidas y shell principal
  api.js                    — cliente HTTP y helpers de errores
  AuthPages.jsx             — login y set-password
  QuotationsPage.jsx        — modulo principal de cotizaciones
  quotations/               — edicion, resumen, preview model y helpers del modulo
  audit/                    — auditoria global
  accounts/ contacts/ ...   — modulos por dominio
  main.jsx                  — entrada de la aplicacion
```

## Levantar en desarrollo

```bash
npm run dev
```

Web disponible en http://localhost:5173.

## Build de produccion

```bash
npm run build
```

## Pruebas E2E

```bash
npm run test:e2e
```

Requiere Playwright instalado (`npx playwright install`).

## Modulos implementados

- Autenticacion (login, set-password con token temporal)
- Usuarios (lista paginada, alta/edicion en modal, auditoria)
- Roles (diseno 3 columnas: roles / permisos / usuarios del rol)
- Cuentas (lista paginada, alta/edicion en modal, propietarios, auditoria)
- Contactos (lista paginada, alta/edicion en modal, jerarquia, auditoria)
- Oportunidades (lista paginada, alta/edicion en modal, auditoria)
- Cotizaciones (listado independiente, versiones, edicion completa, bundles, resumen y vista previa PDF)
- Auditoria global (filtros, paginacion, entidad por nombre)

## Cotizaciones en frontend

El modulo de cotizaciones usa un flujo local intensivo en cliente:

- la edicion trabaja sobre cambios locales hasta guardar la version completa;
- la vista previa oficial ya no usa impresion HTML como flujo principal;
- el boton `Vista previa` envia el modelo actual al backend y abre un PDF inline en una pestaña nueva;
- la tabla de edicion soporta bundles de catalogo y bundles manuales, con colapso por seccion;
- la numeracion visible de filas en edicion se recalcula sobre las filas visibles.
- `Precio Lista M.O.` edita la base original del proveedor con separacion de miles en UI.
- `Precio de lista` se muestra como valor convertido en la moneda de la cotizacion y reacciona al cambiar moneda o tipo de cambio.
- El frontend conserva `originalCurrencyCode` y `originalListPriceUnit` por item para recalcular `listPriceUnit` sin perder la referencia original.

Archivos relevantes:

- `src/quotations/useQuotationsSection.js`
- `src/quotations/QuotationEditorContent.jsx`
- `src/quotations/quotationPrintModel.js`

## Patron de encabezado unificado

Todos los modulos usan el mismo patron visual:

- Titulo con icono SVG (`.module-title-with-icon`).
- Subtitulo descriptivo (`.roles-subtitle`).
- Boton primario de creacion alineado a la derecha.
- Barra de filtros con pills de estado + campo de busqueda inline.

## Paginacion

Los modulos Usuarios, Cuentas, Contactos y Oportunidades incluyen controles de
paginacion con selector de registros por pagina (10 / 50 / 100) y navegacion
previo/siguiente.

## Pruebas E2E destacadas

La suite de Playwright cubre regresiones visibles de:

- set-password;
- oportunidades y contactos;
- proveedores;
- cotizaciones, incluyendo bundles, versiones, vista previa PDF y cambios locales.
