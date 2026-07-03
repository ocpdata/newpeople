# Landing

## Alcance

Este documento describe el modulo de Landing Pages del CRM, incluyendo:

- creacion/actualizacion de landing por evento;
- edicion de versiones (HTML y esquema de formulario);
- importacion por URL y carga de HTML;
- publicacion de la landing;
- recepcion de envios publicos;
- gestion de registros enviados (submissions), notas operativas y envio a CRM;
- permisos requeridos por accion.

No cubre en detalle la logica interna de Leads, Cuentas, Contactos y Oportunidades fuera de lo necesario para entender la conversion desde submissions.

## Logica de negocio

### Modelo funcional

- Cada evento puede tener una landing asociada.
- La landing maneja versionado: se pueden crear multiples versiones antes de publicar.
- Solo una version activa/publicada atiende la ruta publica del slug.
- Los envios publicos quedan registrados como submissions y se pueden reprocesar hacia CRM desde el modulo.

### Ciclo de vida de una landing

1. Crear/actualizar landing para un evento (`draft`).
2. Editar contenido y esquema del formulario en versiones.
3. Publicar una version (`published`).
4. Consumir landing publica por slug.
5. Capturar submissions y, cuando aplique, enviarlas a CRM.

### Submissions y CRM

- Los envios publicos se guardan con payload crudo y payload normalizado.
- El procesamiento comercial puede ejecutarse por worker y tambien por reproceso manual.
- Desde UI se permite:
  - consultar submissions por evento,
  - guardar notas de usuario por submission,
  - enviar/reenviar una submission a flujo CRM.
- Al enviar manualmente una submission, se marca `sent_to_leads_at` y `sent_to_leads_by`.

## Permisos requeridos

Permisos del modulo:

- `landing.read`: ver modulo de landing, listados y detalle de landing pages.
- `landing.create`: crear landing por evento.
- `landing.update`: editar landing/versiones, importar URL, subir HTML y configurar confirmacion.
- `landing.publish`: publicar landing.
- `landing.submissions.read`: ver submissions por evento.
- `landing.submissions.reprocess`: guardar notas de submission y reprocesar/enviar submissions a CRM.

Asignacion automatica actual:

- roles admin/sistema: reciben todos los permisos de landing;
- roles con `desarrollo_comercial.read` o `desarrollo_comercial.update`: reciben `landing.read` y `landing.submissions.read`;
- roles con `desarrollo_comercial.update`: ademas reciben `landing.create`, `landing.update`, `landing.publish` y `landing.submissions.reprocess`.

## API relacionada (resumen)

Privada (requiere autenticacion + permisos):

- `PUT /api/landing/v1/events/:eventId/landing` (crear/actualizar landing por evento)
- `GET /api/landing/v1/landing-pages` (listar landings)
- `GET /api/landing/v1/events/:eventId/landing` (resolver landing por evento)
- `GET /api/landing/v1/landing-pages/:landingPageId` (detalle + versiones)
- `PATCH /api/landing/v1/landing-pages/:landingPageId/versions/:versionId` (editar version)
- `POST /api/landing/v1/landing-pages/:landingPageId/import-url` (importar URL)
- `POST /api/landing/v1/landing-pages/:landingPageId/versions/html-upload` (subir HTML)
- `PATCH /api/landing/v1/landing-pages/:landingPageId/confirmation-config` (config de confirmacion)
- `POST /api/landing/v1/landing-pages/:landingPageId/publish` (publicar)
- `GET /api/landing/v1/events/:eventId/submissions` (listar submissions)
- `PATCH /api/landing/v1/submissions/:submissionId/notes` (guardar notas)
- `POST /api/landing/v1/submissions/:submissionId/reprocess` (reprocesar/envio a CRM)

Publica (sin auth, para captacion):

- `GET /landing/:slug.html` (render landing publicada)
- `POST /api/public/landing/v1/:slug/submit` (registrar envio del formulario)

## Consideraciones operativas

- El endpoint publico de submit solo acepta landings `published` con version activa.
- El schema del formulario se valida antes de publicar y al recibir submissions.
- Se recomienda definir slugs estables por evento para no romper enlaces de campana.
- Si se requiere separar gobierno de "editar notas" vs "reprocesar a CRM", hoy ambos comparten `landing.submissions.reprocess` y podria evaluarse un permiso adicional en el futuro.

## Estado actual de la aplicacion (2026-07)

- Submissions: soportan notas operativas por registro y marcador explicito de envio a leads (`sent_to_leads_at`).
- UX de registros por evento: incluye filtro local, orden por columnas y estado visual de envio.
- Publicacion: mantiene flujo de versionado con estado publicado y URL publica por slug.