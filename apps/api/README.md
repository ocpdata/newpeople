# NewPeople CRM — API

API REST construida con Node.js, Express 5, MySQL2 y Zod. Centraliza autenticacion, permisos, workflow comercial, auditoria y generacion de PDF para cotizaciones.

## Stack

- Node.js 20+
- Express 5
- MySQL 8+
- Zod para validacion
- JWT para autenticacion
- Vitest + Supertest para integracion
- PDFKit para documentos PDF de cotizaciones

## Scripts

```bash
npm run dev
npm run start
npm run seed:demo:capture
npm run seed:demo
npm run seed:demo:reset-db
npm run test
npm run test:watch
```

`seed:demo` restaura unicamente el snapshot `scripts/demoSeedSnapshot.sql`.
Si ese archivo no existe, primero debes generarlo con `npm run seed:demo:capture`.

## Entradas principales

- `src/server.js`: arranque HTTP
- `src/app.js`: composicion de middlewares y rutas
- `src/config.js`: configuracion y branding documental
- `src/db.js`: pool MySQL
- `src/routes.*.js`: modulos funcionales
- `src/quotationPdf.js`: render PDF de cotizaciones

## Modulos principales

- Auth y set-password con token temporal de un solo uso
- Usuarios, roles y permisos RBAC
- Cuentas, contactos y oportunidades
- Flujo comercial de oportunidades con preguntas por etapa
- Proveedores y listas de precios con bundles
- Cotizaciones versionadas con guardado completo y workflow propio
- Auditoria transversal

## Cotizaciones

Puntos relevantes del backend:

- `PUT /api/quotation-versions/:versionId/full`: guarda una version completa con mezcla de crear, editar y eliminar filas/secciones en una sola transaccion.
- `POST /api/quotations/render-pdf`: genera el PDF oficial de vista previa a partir del estado local de la cotizacion, incluso con cambios sin guardar.
- `src/quotationPdf.js`: renderiza secciones, resumen, condiciones comerciales, notas y numeracion de pagina.
- `src/config.js`: define branding documental (`config.documents.quotation.company`).
- Cada item de cotizacion persiste `original_currency_code` y `original_list_price_unit` como base del proveedor.
- `list_price_unit` se guarda como valor convertido a la moneda de la cotizacion usando el tipo de cambio vigente al guardar.
- Al leer o clonar versiones, el backend devuelve ambos valores para que la UI pueda editar la base original sin perder el precio convertido.

## Pruebas

La suite prepara una base aislada antes de ejecutarse.

```bash
npm test
```

Prueba puntual util para PDF de cotizaciones:

```bash
npm test -- --run test/api.integration.test.js -t "cotizaciones genera un PDF inline desde cambios no guardados"
```

## Variables de entorno clave

- `PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_POOL_SIZE`
- `APP_INVITE_SETUP_URL`
- `APP_PASSWORD_SETUP_TOKEN_MINUTES`
- `SMTP_*`

## Documentacion relacionada

- `../../README.md`
- `../../readme/cotizaciones.md`
- `../../readme/pruebas.md`
