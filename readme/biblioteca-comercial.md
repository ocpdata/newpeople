# Biblioteca de ventas

## Objetivo

Buscador de materiales (archivos y enlaces) listos para enviar. El vendedor escribe lo que necesita, previsualiza el material y lo descarga o comparte en pocos clics; tambien alimenta propuestas, cotizaciones y correos comerciales.

## Pantallas

- **Buscar**: caja de busqueda unica (todos los terminos deben coincidir, en cualquier orden; busca en titulo, resumen, fabricante, tecnologia, etiquetas y texto del documento), atajos Favoritos, Recientes y Nuevos, filtros (Tipo, Fabricante, Tecnologia y "Mas filtros"), tarjetas con insignia Para cliente / Solo interno y panel lateral con vista previa, "Cuando usarlo", materiales relacionados y acciones.
- **Mis materiales**: lista de los materiales propios (los gestores pueden ver todos) con estado, vencimiento y acciones Editar, Desactivar/Reactivar y Eliminar.
- **Catalogos** (solo `admin`): fabricantes, tecnologias, soluciones, industrias y tipos.
- **Subir**: modal de tres pasos (archivo o enlace, revision, publicar). Con archivo, la IA propone los datos; se detecta un archivo identico ya existente.

## Permisos y acceso

- Buscar y usar: `enablement_comercial.use` (tambien `read`, `analytics`, `update`).
- Subir y editar lo propio, activar y desactivar lo propio: `enablement_comercial.upload`.
- Gestionar cualquier material y eliminar: `enablement_comercial.manage`.
- Administrar catalogos: `enablement_comercial.admin`.

## Ruta de UI

- `/commercial-enablement`

## Endpoints principales

- `GET /api/commercial-enablement/bootstrap` (permisos y catalogos)
- `GET /api/commercial-enablement/assets` (busqueda paginada; parametros `q`, `shortcut` = `favorites|recent|new`, `status` = `active|inactive|all`, `mine`, `sort`, `page`, `pageSize` y filtros por codigo)
- `GET /api/commercial-enablement/assets/:publicId` (detalle con materiales relacionados)
- `POST /api/commercial-enablement/assets`, `PUT .../assets/:publicId`, `DELETE .../assets/:publicId`
- `POST .../assets/:publicId/activate` y `.../deactivate`
- `POST .../assets/:publicId/files`, `PUT .../files/:filePublicId` (reemplazar archivo), `POST .../links`
- `POST .../assets/:publicId/favorite` y `DELETE` (quitar)
- `POST .../assets/:publicId/share-link` (enlace compartible)
- `GET /api/public/library-shares/:token/download` (descarga publica del enlace compartible)
- `POST /api/commercial-enablement/intake-sessions`, `.../analyze`, `.../review`, `.../create-asset`, `.../cancel`
- `POST/PUT/DELETE /api/commercial-enablement/catalogs/...`

## Reglas operativas

- Solo hay dos estados: **Activo** (`published`) y **Desactivado** (`archived`). Quien solo busca nunca ve materiales desactivados.
- Quien sube puede activar y desactivar sus propios materiales; `manage` puede con cualquiera. Eliminar exige `manage` o `admin`, borra el archivo almacenado y es irreversible.
- Campos obligatorios para activar: titulo, tipo, fabricante o tecnologia (o solucion) y un archivo o URL. "Se puede enviar al cliente" se guarda como visibilidad `client_safe` (Para cliente) o interna.
- Cada material tiene un unico recurso: un archivo o una URL. Reemplazar el archivo conserva el mismo material.
- **Materiales tipo URL**: vencen a los 30 dias (`expires_at`). Un material vencido cuenta como Desactivado en toda la aplicacion; **Reactivar** renueva 30 dias. Los archivos no vencen.
- **Enlaces compartibles**: solo para materiales Activos y Para cliente. Un archivo genera un enlace publico que vence a los 30 dias; se valida en cada descarga (desactivar, eliminar o volver interno un material invalida sus enlaces). En materiales tipo URL el enlace es la propia URL.
- Los selectores de adjuntos de correos y campanas, y las fuentes de propuestas, solo ofrecen materiales activos para cliente.

## Estado actual (2026-10-28)

- Pantalla de busqueda, Mis materiales y Catalogos operativas; reemplazan las pestanas anteriores de uso, carga y gobierno.
- Fuera de alcance por decision: analitica de uso, indicadores de calidad, colecciones, relaciones manuales y fecha de revision.
- Pendiente (siguiente entrega): enviar por correo y usar en propuesta desde el panel, y material sugerido en la oportunidad.
