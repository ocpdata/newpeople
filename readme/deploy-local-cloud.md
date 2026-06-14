# Operacion Local y Nube

Este runbook permite operar la misma aplicacion en local y en nube cambiando solo variables de entorno.

## 1. Contrato de entorno

API:

- Base local: `apps/api/.env.example`
- Base nube/S3: `apps/api/.env.aws-s3.example`
- Validacion runtime: `apps/api/src/validateConfig.js`

Web:

- Base local: `apps/web/.env.example`
- En nube deja `VITE_API_URL` sin definir para mismo origen.

## 2. Arranque local

1. Copia variables:
   - `cp apps/api/.env.example apps/api/.env`
   - `cp apps/web/.env.example apps/web/.env`
2. Ajusta DB local y valores SMTP segun tu ambiente.
3. Arranca:
   - `npm install`
   - `npm run dev`
4. Verifica:
   - `http://localhost:4000/health`
   - `http://localhost:5173`

## 3. Arranque en nube

1. Configura Secrets y Variables del entorno `production` en GitHub.
2. Usa `apps/api/.env.aws-s3.example` como referencia para valores requeridos.
3. Publica web y API bajo el mismo host visible para usuario final.
4. En build web no definas `VITE_API_URL`.

## 4. Validaciones CI/CD

CI automatico:

- Workflow: `.github/workflows/ci.yml`
- Corre en push/PR a main.
- Ejecuta: pruebas API, build web, lint web.

Smoke manual de despliegue:

- Workflow: `.github/workflows/smoke-cloud.yml`
- Ejecuta manualmente con `base_url` (ej. `https://newpip.digitalvs.com`).
- Valida:
  - `GET /health`
  - `GET /api/auth/bootstrap-status`

## 5. Checklist previo a produccion

1. `NODE_ENV=production`
2. `JWT_SECRET` distinto al default
3. Variables DB completas
4. Si `AUTH_GOOGLE_ENABLED=true`: client id/secret/redirect URI validos
5. Si `DOCUMENT_STORAGE_PROVIDER=s3_compatible`: bucket, region y credenciales completas
6. Build web sin `VITE_API_URL`
7. Smoke cloud exitoso

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
