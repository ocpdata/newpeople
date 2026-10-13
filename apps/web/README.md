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

## Cliente existente en Mi Coach

Seleccionar una cuenta establece el contexto y habilita el chat, pero no ejecuta
ni muestra el análisis comercial. La identificación básica permanece visible.

**Analizar cuenta** reúne el resumen comercial, salud y señales, próximo paso,
historial de oportunidades, mapa de relaciones, productos y renovaciones,
hipótesis de expansión y hallazgos adicionales. Las tarjetas no repiten los
hallazgos que ya están representados en esas secciones. La vista utiliza el
snapshot autorizado devuelto por el análisis, con su fecha de captura.

**Actualizar análisis** recalcula el resultado. Durante la actualización, o si
esta falla, el último resultado se conserva identificado como anterior. Cambiar
de cuenta limpia el resultado y descarta las respuestas tardías del análisis
previo. El chat, el enriquecimiento público, el resumen ejecutivo y la
preparación de llamada siguen disponibles sin exigir un análisis previo.

### Recuperacion de respuestas del chat

Cada turno muestra su estado junto al mensaje. La consulta del resultado
reintenta hasta tres fallos transitorios consecutivos; nunca reenvia la pregunta.
Si se interrumpe o se agota la espera, **Recuperar respuesta** consulta el mismo
job. El identificador pendiente se conserva en la sesion del navegador por
cuenta, incluso al recargar, y se elimina al recibir la respuesta o al iniciar
una nueva conversacion. Un job fallido se muestra como error, no como pendiente.

Mientras se carga el historial o se recupera un turno no se envian preguntas
nuevas. Las respuestas tardias de otra cuenta o conversacion se descartan de la
vista; al volver a la cuenta se puede recuperar su job pendiente sin duplicar
mensajes ni respuestas ya guardadas en el historial. El hilo se desplaza al
ultimo mensaje o estado recibido. Los errores al cargar el historial se muestran
en el chat y permiten **Recargar conversacion** sin borrar la sesion guardada.

## Organizacion de Administracion

Las secciones se agrupan en este orden:

- **Gobierno y alcance:** Configuracion de gobierno; Politicas del canal y contexto.
- **Interpretacion y comportamiento:** Intenciones y enrutamiento; Clasificador
  semantico · B3; Prompts del planificador · B6; Reglas conversacionales.
- **Validacion y diagnostico:** Reglas del servidor; Observabilidad de la decision final.

El orden facilita la administracion; no representa una secuencia estricta de
ejecucion B1-B11. Las secciones conservan sus controles y permisos.
En **Reglas del servidor**, las categorias 3 y 8 muestran las protecciones
obligatorias de correspondencia del objetivo y de la respuesta. No son casillas
editables: bloquean sustituciones de entidades o respuestas sobre otro objetivo,
ademas de las comprobaciones de permisos y evidencia existentes.

## Administracion del clasificador B3

La seccion **Clasificador semantico · B3** permite editar, guardar, recargar y
restaurar instrucciones versionadas para los tres canales. Muestra version,
autor, fecha y estado de conexion, y conserva el borrador ante errores de
guardado. Cargar el texto predeterminado no lo guarda automaticamente.
Cada editor muestra el numero de caracteres del borrador y el limite de 8000,
actualizados al escribir, recargar o restaurar instrucciones.

Solo **Cliente existente** aplica las instrucciones guardadas a los turnos
nuevos. Coach y Cuenta nueva aparecen como configuracion preparada sin efecto
en ejecucion. Los prompts del planificador B6 son una seccion independiente.
Ningun texto editable concede permisos ni modifica el esquema de respuesta,
catalogo, umbrales o confirmaciones del servidor.

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
- Configuracion IA (credito por usuario + tarifas por modelo con vigencia)

## Configuracion IA: credito y tarifas

En `Configuracion > Credito IA` la UI ahora permite:

- Administrar wallets por usuario (recarga, ajuste y politica).
- Consultar tarifas IA por modelo (input/output/cached por millon).
- Crear tarifas manuales con vigencia.
- Cerrar vigencia de tarifas activas.
- Ejecutar sincronizacion automatica con flujo de preview y aplicar.

Esta pantalla consume endpoints de administracion IA bajo `/api/admin/ai/*`.

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

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
