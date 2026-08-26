# Pruebas de Bot Defense con F5 Distributed Cloud Services

Guia para validar Bot Defense en la aplicacion:

```text
https://newpip.digitalvs.com
```

El script usa Playwright para generar sesiones de navegador controladas. No
sustituye la consola de F5 DCS: el navegador registra el resultado HTTP y la
navegacion, mientras que F5 debe confirmar el `Risk Score`, la clasificacion del
cliente y la accion aplicada.

## 1. Requisitos y seguridad

- Ejecuta estas pruebas solo sobre `newpip.digitalvs.com` y con autorizacion.
- Usa una cuenta de pruebas, nunca una cuenta de cliente.
- No uses cientos de sesiones ni conviertas `--burst` en una prueba de carga.
- No guardes passwords, tokens ni cookies en archivos o reportes.
- Ejecuta primero `--dry-run`.
- En F5 empieza con `Flag` o `Monitoring` y revisa falsos positivos antes de
  activar `Challenge` o `Block`.

## 2. Configuracion del endpoint en F5 DCS

Para que Bot Defense pueda evaluar el login, configura un Protected App
Endpoint con estos valores:

| Campo | Valor recomendado |
|---|---|
| Name | `newpip-login` |
| Description | `Endpoint de inicio de sesion de NewPeople` |
| HTTP Methods | `POST` |
| Endpoint Label | `Login` o `Authentication` |
| Protocol | `BOTH` |
| Domain Matcher | `newpip.digitalvs.com` |
| Path Match | `Exact` |
| Prefix/path | `/api/auth/login` |
| HTTP Query Parameters | Ninguno inicialmente |
| HTTP Headers | Ninguno inicialmente |
| Traffic Channel | `Web Traffic` |
| Bot Traffic Mitigation | `Flag` durante la validacion |
| Include Mitigation Headers | `No Headers`, salvo que F5 requiera otra configuracion |

La aplicacion usa el endpoint:

```text
POST https://newpip.digitalvs.com/api/auth/login
```

El JavaScript de Bot Defense debe estar publicado e insertado en la aplicacion.
Con la configuracion mostrada por F5, confirma que `/common.js` sea accesible y
que el HTML cargue el script sin errores.

Para API protegida puedes agregar endpoints como:

```text
GET /api/accounts
GET /api/contacts
GET /api/providers
GET /api/opportunities
GET /api/quotations
```

Usa `GET` y `Prefix` solo cuando quieras proteger una familia completa de
rutas. No agregues endpoints de creacion o modificacion para estas pruebas.

## 3. Preparar el entorno

Desde la raiz del repositorio:

```bash
npm install
```

El paquete Playwright esta instalado como dependencia de `apps/web` y se
resuelve desde `node_modules` de la raiz. Si el navegador Chromium no esta
instalado, ejecuta:

```bash
npx playwright install chromium
```

## 4. Modo simulacion

La simulacion no abre el navegador ni envia solicitudes:

```bash
./scripts/test-bot-defense.mjs \
  --dry-run \
  --output /tmp/bot-defense-dry-run.tsv
```

Debe mostrar tres perfiles:

- `browser-headless`;
- `headless`;
- `javascript-disabled`.

## 5. Prueba base headless

Ejecuta una iteracion de cada perfil:

```bash
./scripts/test-bot-defense.mjs \
  --output /tmp/bot-defense-results.tsv
```

El script visita la pagina principal con un contexto nuevo por perfil. Registra
las respuestas del dominio y el estado de JavaScript.

Resultado local esperado:

```text
bot-browser-headless-1 | perfil: browser-headless | HTTP 200 | REVIEW_F5
bot-headless-1 | perfil: headless | HTTP 200 | REVIEW_F5
bot-javascript-disabled-1 | perfil: javascript-disabled | HTTP 200 | REVIEW_F5
```

`REVIEW_F5` no significa aprobado ni bloqueado. Significa que debes consultar
el evento correspondiente en F5.

## 6. Prueba con navegador visible

Ejecuta el perfil visible:

```bash
./scripts/test-bot-defense.mjs \
  --headed \
  --output /tmp/bot-defense-headed.tsv
```

En F5 compara el navegador visible con los perfiles headless. El navegador
visible debería comportarse como una sesión legítima, salvo que la política
clasifique la automatización de Playwright de otra manera.

## 7. Prueba con login de cuenta de pruebas

Proporciona el correo mediante variable de entorno. El password se solicita de
forma oculta si no existe `WAF_LOGIN_PASSWORD`:

```bash
export WAF_LOGIN_EMAIL='usuario-pruebas@example.com'
./scripts/test-bot-defense.mjs \
  --output /tmp/bot-defense-login.tsv
```

También puedes proporcionar el password por variable, aunque el prompt
interactivo evita dejarlo en el historial:

```bash
export WAF_LOGIN_EMAIL='usuario-pruebas@example.com'
export WAF_LOGIN_PASSWORD='PASSWORD_TEMPORAL'
./scripts/test-bot-defense.mjs \
  --output /tmp/bot-defense-login.tsv
```

El script solo intenta login si encuentra ambos valores y el formulario es
visible. Registra `login_attempted=true`; esto no confirma por sí mismo que F5
haya clasificado la sesión como humana.

## 8. Prueba de sesiones repetitivas

Usa cinco sesiones headless rápidas, como máximo para una comprobación corta:

```bash
./scripts/test-bot-defense.mjs \
  --burst \
  --output /tmp/bot-defense-burst.tsv
```

Esta prueba sirve para observar si cambia el riesgo o aparece una mitigación.
No representa una prueba de rendimiento ni de denegación de servicio.

## 9. Qué hace cada perfil

### `browser-headless`

Chromium con JavaScript y cookies habilitados. Por defecto corre headless; con
`--headed` corre visible. Sirve como referencia de navegador completo.

### `headless`

Chromium headless, contexto nuevo y navegación rápida. Sirve para observar si
Bot Defense diferencia una automatización rápida.

### `javascript-disabled`

Contexto de Chromium con JavaScript deshabilitado. Normalmente solo carga el
HTML inicial y no puede ejecutar la SPA ni el JavaScript de Bot Defense.

## 10. Correlacionar en F5 DCS

Cada sesión envía el header:

```text
X-Bot-Test-ID: bot-headless-1
```

Busca en F5 por ese valor o por el `test_id` del reporte. Para cada evento
confirma:

- host `newpip.digitalvs.com`;
- hora UTC;
- IP de origen;
- método y ruta;
- User-Agent;
- `Event Type`;
- `Mode`;
- `Risk Score`;
- clasificación `Human`, `Bot` u otra disponible;
- acción `Allow`, `Flag`, `Challenge` o `Block`;
- request ID;
- cookies o challenge emitidos, sin guardar sus valores sensibles.

La comparación mínima recomendada es:

| Perfil | Resultado local | Validación en F5 |
|---|---|---|
| Navegador visible | HTTP y navegación | Human/Allow o acción configurada |
| Navegador headless | HTTP y navegación | Clasificación esperada para automatización |
| JavaScript deshabilitado | HTML parcial | Flag/Challenge/Block según política |
| Ráfaga corta | Varias sesiones | Cambio de riesgo o mitigación, si aplica |

## 11. Interpretar el reporte TSV

El archivo contiene:

```text
test_id, utc, profile, http_status, result, details
```

Los separadores reales son tabulaciones. Valores importantes:

- `REVIEW_F5`: la solicitud terminó y requiere confirmación en F5.
- `ERROR`: Playwright no pudo completar la sesión.
- `NOT_RUN`: se ejecutó `--dry-run`.
- `HTTP 200`: la aplicación respondió, pero no demuestra `Allow` ni `Block`.
- `HTTP 403`, `429` u otro bloqueo: puede ser F5, nginx o la aplicación; hay
  que confirmar el evento y la política en F5.

## 12. Criterios de aprobación

Considera la prueba exitosa cuando:

- la sesión legítima puede cargar y usar la aplicación;
- Bot Defense no genera falsos positivos para usuarios normales;
- los perfiles automatizados producen la clasificación esperada;
- las sesiones sin JavaScript reciben la acción definida;
- F5 registra `Risk Score`, clasificación y acción;
- los eventos se pueden correlacionar con `X-Bot-Test-ID`;
- el endpoint `/api/auth/login` aparece como Protected App Endpoint;
- no existe un ciclo infinito de challenge;
- los endpoints API protegidos tienen una política coherente.

## 13. Limitaciones

El script no consulta la API de eventos de F5 DCS. Por eso no puede afirmar
localmente que una solicitud fue bloqueada, aunque reciba `HTTP 200` o `HTTP
403`. La evidencia definitiva es el evento de F5 y sus campos `Mode`, `Risk
Score`, clasificación y acción.

El reporte generado por defecto es `bot-defense-results.tsv`; está excluido de
Git. Para compartir resultados, revisa y elimina cualquier dato sensible antes
de enviarlo.
