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

## Variables y despliegue

Regla base: en entornos reales el frontend debe consumir la API por mismo origen usando rutas relativas como `/api/auth/login`.

`VITE_API_URL` solo se debe usar para desarrollo local o para un despliegue donde realmente necesites forzar otro origen HTTPS compatible. Si no se define, el cliente usa `window.location.origin`.

### Local

Objetivo:

- Web en `http://localhost:5173`
- API en `http://localhost:4000`

Configuracion:

- Usa `apps/web/.env.local` o `apps/web/.env` con `VITE_API_URL=http://localhost:4000`.
- Corre `npm run dev` en `apps/web`.
- El proxy de Vite reenviara `/api` y `/health` a `http://localhost:4000`.

Resultado:

- Puedes seguir desarrollando localmente sin cambiar el codigo del cliente.

### VM directa

Ejemplo:

- Frontend visible en `http://newpeople.digitalvs.com`
- API publicada bajo `http://newpeople.digitalvs.com/api`

Configuracion:

- Construye el frontend sin `VITE_API_URL`.
- Sirve los archivos estaticos en `/`.
- Sirve o proxya `/api` y `/health` en el mismo host.

Resultado:

- El frontend llamara a `http://newpeople.digitalvs.com/api/...` usando el mismo origen del navegador.

### VM detras de F5 DCS

Ejemplo:

- Usuario entra a `https://newpip.digitalvs.com`
- Origen real en VM: `http://newpeople.digitalvs.com`

Configuracion obligatoria:

- Construye el frontend sin `VITE_API_URL`.
- El navegador debe ver solo `https://newpip.digitalvs.com` para frontend y API.
- F5 debe publicar tanto `/` como `/api` en el mismo host `newpip.digitalvs.com`.

Resultado:

- El frontend llamara a `https://newpip.digitalvs.com/api/...`.
- F5 reenviara esas rutas al origen real.
- No habra `Mixed Content`.

### Que no hacer

- No construyas el frontend con `VITE_API_URL=http://newpeople.digitalvs.com` si luego lo vas a servir en `https://newpip.digitalvs.com`.
- No hagas que el navegador salte del host publicado por F5 al host interno/directo para consumir la API.
- No reutilices un build viejo cuyo bundle ya haya horneado una URL absoluta HTTP.

### Checklist de release para VM y F5

1. `VITE_API_URL` sin definir al momento de ejecutar `npm run build`.
2. El host visible al usuario publica `/` y `/api`.
3. Si usas CDN o cache en F5, purga cache despues del deploy.
4. Verifica en DevTools que `bootstrap-status`, `login` y `me` salgan al mismo host que cargo la pagina.
5. Si el sitio visible es HTTPS, ninguna llamada del navegador debe ir a un origen HTTP.

## Build de produccion

```bash
npm run build
```

Para VM y F5, ejecuta este build sin `VITE_API_URL` para que el cliente use mismo origen.

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
