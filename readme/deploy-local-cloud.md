# Operacion Local y Nube

Este runbook permite operar la misma aplicacion en local y en nube cambiando solo variables de entorno.

## 1. Contrato de entorno

API:

- Base local: `apps/api/.env.example`
- Base nube/S3: `apps/api/.env.aws-s3.example`
- Validacion runtime: `apps/api/src/validateConfig.js`
- Chat de Cliente existente: el motor de expedientes y el contrato de turno B3
  para acciones son obligatorios; no hay variables para desactivarlos ni ruta
  anterior de respaldo. Las variables retiradas `CUSTOMER_TURN_CONTRACT_MODE`,
  `CUSTOMER_TURN_CONTRACT_PILOT_USER_IDS` y `CUSTOMER_DOSSIER_ENGINE_MODE` ya no
  se leen y pueden eliminarse de los entornos.
- Redaccion conversacional B10 de Cliente existente:
  `CUSTOMER_CONVERSATIONAL_RESPONSE_ENABLED=true` por defecto, efectiva solo
  en turnos con contrato B3. Usa el proveedor y presupuesto de IA configurados.
  Agrega como maximo dos llamadas (redaccion y auditoria) por turno elegible,
  no por componente. Los entregables de contenido ya completados y las respuestas
  individuales generadas y auditadas no se vuelven a redactar. Dispone de hasta
  20 segundos, dentro del plazo restante del turno (90 segundos desde el inicio
  cuando no se proporciona uno). Para rollback, usar `false` y reiniciar la API;
  no cambia datos, permisos ni los resultados historicos.

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

### Importar una biblioteca RAG existente en Pinecone

Los archivos de Pinecone y el catalogo SQL de Documentacion RAG son independientes.
Un despliegue de codigo no copia el catalogo entre bases de datos.

1. Configura `PINECONE_API_KEY`, `PINECONE_ASSISTANT_NAME` y
   `PINECONE_ASSISTANT_REGION` en el backend destino para acceder al proyecto y
   Assistant que contienen los archivos. Guardarlos en GitHub no los inyecta
   automaticamente: el workflow de despliegue debe transportarlos al proceso.
2. Con permiso `documentacion_rag.manage`, abre Documentacion RAG > Documentos >
   **Importar desde Pinecone**.
3. Revisa la vista previa. Selecciona hasta 200 archivos disponibles por lote.
   Los archivos deben conservar los metadatos `document_id`, `version_id`,
   `topic_id` y `topic_name` que escribe la aplicacion al cargarlos.
4. Si hay un conflicto de nombre/identificador de tema, selecciona explicitamente
   un tema local activo. Metadatos incompletos, versiones ambiguas, operaciones
   locales en curso y archivos no disponibles quedan bloqueados.
5. Confirma. Se crean solo registros locales faltantes, conservando los IDs
   documentales y de Pinecone. Los resumenes se generan por el worker existente.
6. Verifica que el documento aparece disponible y que Mi Coach recupera evidencia.

La vista previa usa `GET /api/documentacion-rag/pinecone-import/preview` y la
confirmacion `POST /api/documentacion-rag/pinecone-import`; ambas exigen permiso
de administracion. La confirmacion vuelve a consultar Pinecone y valida los IDs
de documento/version mostrados. Las importaciones se serializan con un bloqueo
SQL y se escriben en una transaccion; los registros existentes no se sobrescriben.
Un fallo SQL revierte el lote y se informa como error, no como importacion exitosa.

No se suben ni eliminan archivos remotos, ni se crea un Assistant ausente.
La API de listado devuelve todos los archivos sin paginacion. El tipo MIME se
infiere del nombre y el tamano queda como no disponible porque el listado no lo
incluye. Los enlaces originales y resumenes editados en otro entorno no se
recuperan de los metadatos actuales.

**Compartir Assistant no crea copias independientes:** reemplazar o borrar un
archivo desde localhost puede afectar su disponibilidad en la VM, y viceversa.
La importacion no sincroniza cambios posteriores ni limpia registros locales.

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
