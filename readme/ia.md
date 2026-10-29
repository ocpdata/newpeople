# Uso de IA en el proyecto

## Alcance actual

El uso de IA en este repositorio hoy esta concentrado en el modulo de cuentas, especificamente en la ayuda para completar el borrador de una cuenta antes de guardarla.

Objetivo actual:

- enriquecer un borrador de cuenta con informacion publica verificable;
- sugerir descripcion de empresa, sitio web, direccion, ciudad, estado o region, codigo postal, telefono y registro fiscal;
- dejar evidencia y warnings cuando la confianza no sea suficiente.

La IA no guarda registros por si sola ni modifica datos persistidos. Solo propone sugerencias que el usuario puede aplicar manualmente desde la UI.

## Flujo funcional

### 1. Disparo desde la UI

En la creacion de cuentas, la web arma un payload con el borrador actual y lo envia a `POST /api/accounts/draft-analysis`.

Datos relevantes del borrador:

- nombre de la empresa;
- tipo de cuenta;
- sector economico;
- sitio web, telefono y datos de ubicacion ya capturados;
- `companyDescription` como campo canonico de descripcion.

Opciones activas hoy:

- `allowExternalFetch`;
- `allowAiSynthesis`;
- `allowWebSearchTool`.

La llamada desde frontend usa un timeout mayor porque la investigacion con web search puede tardar mas que un request CRUD normal.

### 2. Entrada backend

La ruta valida el request con Zod y delega al modulo de analisis de cuentas.

Entry point actual:

- `apps/api/src/accounts/draft-analysis/index.js`

La estructura interna del modulo sigue este patron:

- `schemas.js`: contrato y normalizacion;
- `service.js`: entry point del caso de uso;
- `pipeline.js`: orquestacion por etapas;
- `profile.js`: perfiles y prompts de investigacion estructurada;
- `providers/structuredAccountDraftAnalysisProvider.js`: adaptador hacia OpenAI Responses API;
- `core.js`: heuristicas, descubrimiento publico y merge de resultados.

### 3. Etapas del pipeline

El pipeline actual trabaja por etapas:

1. `context`
   Calcula duplicados potenciales, hallazgos de calidad de datos y contexto de catalogos.
2. `discovery`
   Usa heuristicas y fetch publico para buscar sitio, contacto, direccion y registro sin depender de IA generativa.
3. `structured_extraction`
   Usa investigacion estructurada con web search para completar o corregir los campos faltantes.

La IA no reemplaza toda la logica previa. Las heuristicas siguen siendo utiles para:

- discovery barato y rapido;
- merge de resultados;
- fallback cuando OpenAI no esta disponible;
- reglas de consistencia y armado de sugerencias.

## Como se usa OpenAI

### API usada

Se usa OpenAI Responses API con la herramienta `web_search_preview`.

Archivo base:

- `apps/api/src/structuredWebResearch.js`

La llamada manda:

- `systemPrompt` con instrucciones de evidencia y no invencion;
- `subject` con la empresa objetivo;
- `context` con pais, ciudad, estado, website preferido, tipo y sector cuando existan;
- `currentValues` con lo que el usuario ya capturo;
- `expectedJsonShape` para forzar una salida estructurada.

### Perfiles de investigacion

El proyecto define perfiles separados para distintos usos:

- `accountCompanyResearchProfile`: resumen, website, contacto y registro;
- `accountLocationResearchProfile`: direccion, ciudad, estado, codigo postal y telefono;
- `accountAnalysisResearchProfile`: salida completa para el analisis del borrador de cuenta.

Estos perfiles viven entre:

- `apps/api/src/aiResearchProfiles.js`
- `apps/api/src/accounts/draft-analysis/profile.js`

### Salida esperada

La salida estructurada prioriza estos campos:

- `suggestedCompanyDescription`
- `suggestedWebsite`
- `suggestedContactData.addressLine`
- `suggestedContactData.city`
- `suggestedContactData.stateRegion`
- `suggestedContactData.postalCode`
- `suggestedContactData.phone`
- `suggestedRegistrationCode`
- `warnings`

Cada sugerencia viaja con senales de confianza y razon cuando aplica.

## Principios de uso

### 1. La IA propone, el usuario decide

La UI permite aplicar sugerencias al formulario, pero no persiste automaticamente resultados de IA.

### 2. Solo evidencia publica verificable

Los prompts piden explicitamente no inventar datos. Si no hay evidencia clara, se deben devolver cadenas vacias, confianza baja y warnings breves.

### 3. La descripcion canonica es `companyDescription`

Se elimino la ambiguedad anterior entre varias descripciones. Hoy el modulo trabaja con un solo campo canonico y una sola sugerencia principal: `suggestedCompanyDescription`.

### 4. Heuristicas y IA trabajan juntas

La IA no se usa sola. El sistema combina:

- contexto del CRM;
- descubrimiento publico por heuristicas;
- fetch de website publico;
- investigacion estructurada con web search;
- reglas de merge y validacion locales.

## Configuracion necesaria

Variables relevantes en `apps/api/.env`:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `OPENAI_ENABLE_WEB_SEARCH=true`

Si falta API key o el web search esta deshabilitado, la parte estructurada devuelve `null` y el pipeline cae a heuristicas y fuentes publicas no generativas.

## Servicios de IA (Configuración > Crédito IA)

La sección **Crédito IA** está organizada en cinco pestañas:

- **Resumen:** una tarjeta por proveedor (OpenAI, Tavily y Pinecone Assistant)
  con el consumo del mes, el límite, el porcentaje de aviso y el estado.
- **Módulos:** proveedor de IA por módulo y casillas para usar Tavily y Pinecone
  donde el módulo realmente los usa.
- **Consumo:** uso diario, por módulo, por modelo, los 10 usuarios que más
  consumen, errores recientes y exportación a Excel.
- **Crédito por usuario:** porcentaje del saldo capturado de OpenAI para cada
  usuario activo (ver abajo).
- **Tarifas:** precios por modelo, ahora capturados en USD por millón de tokens.

Lectura y edición usan los permisos existentes
(`ia.budget.read_all`/`configuracion.read` y `ia.budget.manage`/`configuracion.update`).

### Modelos por tipo de trabajo

Cada proveedor define un modelo por tipo de trabajo: **Rápido** (antes
`OPENAI_MODEL`), **Avanzado** (enrutador, analista y redacción del chat de
Cliente existente; antes `OPENAI_ROUTER_MODEL`/`OPENAI_ANALYST_MODEL`) y
**Transcripción** (antes `OPENAI_TRANSCRIPTION_MODEL`). Un módulo puede
personalizar sus modelos como opción avanzada. Todas las llamadas a modelos
pasan por `apps/api/src/ai-services/client.js` (`aiFetch`) y eligen el modelo con
`aiModelFor(featureCode, rol)`; el código de funcionalidad determina el módulo
según `apps/api/src/ai-services/catalog.js`.

Mientras no se guarde una configuración, se usan los valores del `.env`, por lo
que el comportamiento es idéntico al anterior. La configuración guardada vive en
`ai_service_settings` (con versión y auditoría en `ai_service_settings_audit`) y
cada proceso de la API la recarga cada minuto. No se puede guardar un modelo sin
tarifa vigente: la pantalla muestra el motivo en el módulo afectado.

Por ahora el único proveedor de modelos conectado es OpenAI; agregar otro
(por ejemplo Gemini) requiere su adaptador, porque la mayoría de las llamadas usan
la API Responses de OpenAI.

### Medición, límites y avisos

| Proveedor | Origen del uso | Costo |
|---|---|---|
| OpenAI | Medido por el CRM (`ai_usage_ledger`) | Tarifas por modelo |
| Tavily | Leído de Tavily (`/usage`, cada hora) y medido por el CRM por llamada | Créditos × precio del plan, o el precio capturado |
| Pinecone Assistant | Medido por el CRM con los tokens y unidades que reporta Pinecone | Según el plan (Starter y Builder: incluido) |

El uso de Tavily y Pinecone se registra en `ai_service_usage_events` y los
errores de los proveedores en `ai_service_call_errors`. El CRM solo ve lo que
pasa por él: si la misma cuenta de Pinecone se usa fuera del CRM, el uso real
será mayor.

Cada proveedor tiene un **límite mensual** (OpenAI en USD, Tavily en créditos;
en Pinecone lo fija el plan), un **porcentaje de aviso** (80 % por defecto) y la
opción **Solo avisar** o **Detener el servicio**. El mes se cuenta en la zona
horaria comercial. Al cruzar un umbral se crea un aviso por proveedor, métrica
y mes (`ai_service_alerts`), visible en una banda superior para quien puede
leer la configuración de IA; quien puede administrarla lo marca como entendido.

**Saldo de OpenAI.** OpenAI no ofrece una forma oficial de leer el saldo
prepagado. En la tarjeta de OpenAI se captura el saldo de su página de
facturación; el servidor registra la fecha y hora de la captura y el CRM muestra
**saldo estimado = saldo capturado − consumo medido por el CRM desde esa
captura**. Se puede definir un monto de aviso; el aviso se reactiva con cada
nueva captura. Las llamadas a OpenAI que no pasan por el CRM no se descuentan,
por lo que conviene volver a capturar el saldo al recargar o al notar
diferencias.

### Crédito por usuario

Cada usuario **activo** puede recibir un porcentaje del saldo capturado de
OpenAI: su asignación es `porcentaje × saldo capturado` y solo descuenta lo que
él gasta desde la captura (consumo medido por el CRM). Los porcentajes suman como
máximo 100 %; lo no asignado es una **reserva compartida** que usan los usuarios
sin porcentaje, y el gasto de todos ellos se descuenta de esa reserva, por lo que
el total nunca supera el saldo capturado. Cada nueva captura de saldo reinicia
las asignaciones.

- Sin saldo capturado no hay límite por usuario; el consumo solo se mide.
- Al agotarse la asignación o la reserva, las funciones de IA responden
  `AI_BUDGET_EXCEEDED` con un mensaje para pedir más porcentaje o un nuevo saldo.
- Un solo porcentaje de aviso (80 % por defecto) aplica a todas las asignaciones;
  la barra superior y el chatbot muestran el porcentaje disponible solo cuando hay
  límite.
- **Repartir en partes iguales** asigna el mismo porcentaje a quienes usaron IA en
  los últimos 90 días.
- Los porcentajes de usuarios inactivos dejan de contar y se conservan por si se
  reactivan.
- El plan vive en `ai_user_allocation_plan` con versión y auditoría
  (`ai_user_allocation_plan_audit`). Endpoints: `GET/PUT /api/admin/ai/allocations`.
- Se retiraron las recargas, los ajustes manuales y el crédito inicial de USD 5 de
  las billeteras por usuario. Sus movimientos (`ai_wallet_transactions`) se pueden
  consultar en el detalle de cada usuario.

## Consideraciones operativas

### Formato de Responses API

La respuesta de OpenAI no siempre llega en `output_text`. En este proyecto ya se observo el caso real donde el JSON viene dentro de `output[].content[].text`.

Por eso el parser de `structuredWebResearch.js` debe soportar ambos formatos. Si no lo hace, el sistema aparenta que la IA no encontro nada y termina usando solo registro o sugerencias heuristicas.

### Tiempo de respuesta

La investigacion con web search puede tardar mas que un endpoint tradicional. Por eso la llamada del frontend para `draft-analysis` usa un timeout dedicado mas alto que el timeout global de Axios.

### Calidad de datos

El analisis puede devolver campos vacios aunque la IA este funcionando correctamente. Eso ocurre cuando:

- no hay evidencia publica suficiente;
- las fuentes publicas son ambiguas;
- el nombre de la empresa no identifica una entidad unica;
- hay conflicto entre datos encontrados.

En esos casos deben prevalecer warnings y confianza baja, no valores inventados.

## Biblioteca Documentación RAG

El módulo **Documentación RAG** administra una biblioteca de documentos en
Pinecone Assistant. Los temas agrupan los archivos y permiten habilitar o
deshabilitar su uso en las consultas. Los archivos se cargan, reemplazan y
eliminan desde la aplicación; Pinecone Assistant realiza su extracción,
fragmentación e indexación. El sistema conserva en la base de datos los
metadatos, estados de operación y resúmenes breves.

El permiso `documentacion_rag.access` permite entrar y consultar el contenido
del módulo. `documentacion_rag.manage` permite además administrar temas y
documentos, e incluye acceso aunque no se asigne también el permiso de lectura.
Ambos permisos se asignan inicialmente a los roles de sistema y al rol
Administrador; otros roles se configuran desde la administración de roles. Los
usuarios que no tienen esos permisos también pueden consultar los documentos
activos a través del chatbot. La respuesta puede usar los fragmentos como
evidencia, pero no debe citar ni identificar los documentos RAG.

Configuración en `apps/api/.env`:

- `PINECONE_API_KEY`: clave de Pinecone.
- `PINECONE_ASSISTANT_NAME`: Assistant que usa el módulo; por defecto,
  `newpeople-documentacion-rag`.
- `PINECONE_ASSISTANT_REGION`: región del Assistant, `us` o `eu`; por defecto,
  `us`.
- `PINECONE_ASSISTANT_API_VERSION`: versión REST; por defecto, `2026-07`.
- `PINECONE_ASSISTANT_MAX_FILE_BYTES`: límite por archivo en bytes; por defecto,
  50 MiB.

El backend usa la REST API de Assistant, por lo que no requiere instalar el SDK
de Pinecone. Las operaciones de carga, reemplazo y eliminación se actualizan
consultando el estado de Pinecone. La sustitución conserva la versión activa
hasta que la nueva queda disponible; el backend mantiene el seguimiento en
segundo plano, aunque el administrador cierre la pestaña. Los formatos
aceptados son PDF, DOCX, JSON, Markdown y TXT. Las hojas de cálculo (XLSX, XLS,
CSV) y las presentaciones (PPTX) se convierten a texto Markdown antes de
cargarse; el documento conserva el nombre original con la extensión `.md`.

Cada documento puede clasificarse con un **tipo** (cuestionario, manual, guía de
diseño, arquitectura de referencia, configuración modelo, hoja de
dimensionamiento u otro), una **versión del producto** y una marca **vigente**.
El tipo se infiere del nombre del archivo cuando usa el formato
`[Tipo] Título` (por ejemplo `[Cuestionario] F5 XC WAAP - levantamiento.docx`) y
puede ajustarse desde la tarjeta del documento. Los documentos no vigentes no se
usan en la consulta por tema del alcance técnico de las propuestas (ver
[Alcance técnico de propuestas](./alcance-tecnico-propuestas.md)).

La biblioteca contiene conocimiento de la empresa y de los fabricantes. **No se
cargan en ella documentos de clientes**: esos viven en la oportunidad.

Además de cargar archivos locales, los administradores pueden importar enlaces
públicos a archivos admitidos o a páginas web. Las páginas HTML se convierten a
Markdown; la importación no rastrea el sitio ni sigue enlaces internos. El
contenido remoto debe caber en el límite configurado y pasar validaciones de
destino público, redirecciones y tiempo de espera. El sistema conserva la URL
de origen como referencia administrativa; la IA utiliza el contenido importado
en el momento de la carga y no sincroniza cambios posteriores de la página.

## Estado actual

Uso implementado y activo hoy:

- asistencia con IA para el borrador de cuentas;
- investigacion estructurada con OpenAI web search;
- merge con heuristicas y evidencia publica;
- aplicacion manual de sugerencias desde la UI.

Uso no implementado de forma transversal todavia:

- contactos;
- oportunidades;
- proveedores;
- cotizaciones;
- guardado automatico basado en IA;
- procesamiento asincrono con cola real.

## Validacion recomendada

Para validar esta funcionalidad:

```bash
cd /Users/ocarrillo/Documents/newpeople
npm run test --prefix apps/api -- --run test/api.integration.test.js -t "cuentas draft-analysis"
```

Para validar el camino puntual de investigacion estructurada:

```bash
cd /Users/ocarrillo/Documents/newpeople
npm run test --prefix apps/api -- --run test/api.integration.test.js -t "cuentas draft-analysis completa ubicacion con busqueda publica asistida cuando la heuristica no alcanza"
```

Para validar la UI:

```bash
cd /Users/ocarrillo/Documents/newpeople
npm run build --prefix apps/web
```

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
