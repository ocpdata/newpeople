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
