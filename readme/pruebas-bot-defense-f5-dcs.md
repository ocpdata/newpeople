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

| Campo                      | Valor recomendado                                      |
| -------------------------- | ------------------------------------------------------ |
| Name                       | `newpip-login`                                         |
| Description                | `Endpoint de inicio de sesion de NewPeople`            |
| HTTP Methods               | `POST`                                                 |
| Endpoint Label             | `Login` o `Authentication`                             |
| Protocol                   | `BOTH`                                                 |
| Domain Matcher             | `newpip.digitalvs.com`                                 |
| Path Match                 | `Exact`                                                |
| Prefix/path                | `/api/auth/login`                                      |
| HTTP Query Parameters      | Ninguno inicialmente                                   |
| HTTP Headers               | Ninguno inicialmente                                   |
| Traffic Channel            | `Web Traffic`                                          |
| Bot Traffic Mitigation     | `Flag` durante la validacion                           |
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

En una VM Linux sin entorno grafico, instala tambien las dependencias de
Chromium y Xvfb:

```bash
sudo npx playwright install-deps chromium
sudo apt-get install -y xvfb xauth
```

La API detecta que no existe `DISPLAY` y ejecuta automaticamente la prueba con
`xvfb-run -a`. Asi conserva el navegador visible del perfil que representa al
usuario legitimo mediante un display virtual.

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
las respuestas del dominio y el estado de JavaScript. Despues de cargar el
sensor, usa `WAF_LOGIN_EMAIL` y `WAF_LOGIN_PASSWORD`, las mismas credenciales de
prueba usadas por WAF, para iniciar sesion en `/api/auth/login`. El reporte debe
incluir `protected_endpoint_status=200` cuando las credenciales son validas (o
la respuesta de mitigacion configurada en F5).

Resultado local esperado:

```text
F5_CORRELATION: attempt=1 total=4
F5_CORRELATION: done state=QUERIED
Resultados correlacionados con eventos de Bot Defense en F5 DCS.
```

F5 puede tardar en indexar los eventos. El script espera y reintenta la consulta
antes de generar el reporte final.

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

Bot Defense reutiliza las mismas variables de credenciales que WAF. Para
ejecutar las pruebas desde la aplicacion, configura ambas en `apps/api/.env` y
reinicia la API:

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

Al terminar las navegaciones, el script consulta automaticamente la API de
eventos de F5 DCS. Primero busca `X-Bot-Test-ID`; si F5 no conserva el header,
usa la ventana temporal y el tipo de automatizacion esperado. Para cada evento
registra:

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

| Perfil                   | Resultado local   | Validación en F5                           |
| ------------------------ | ----------------- | ------------------------------------------ |
| Navegador visible        | HTTP y navegación | Human/Allow o acción configurada           |
| Navegador headless       | HTTP y navegación | Clasificación esperada para automatización |
| JavaScript deshabilitado | HTML parcial      | Flag/Challenge/Block según política        |
| Ráfaga corta             | Varias sesiones   | Cambio de riesgo o mitigación, si aplica   |

## 11. Interpretar el reporte TSV

El archivo contiene:

```text
test_id, utc, profile, http_status, result, details, evento_f5, accion_f5,
categoria_f5, confianza_correlacion, id_evento_f5, id_solicitud_f5,
detalle_f5, detalle_respuesta
```

Los separadores reales son tabulaciones. Valores importantes:

- `PASS_NO_EVENT`: el navegador legitimo no genero un evento de seguridad.
- `PASS_BLOCKED`: F5 detecto y bloqueo la automatizacion.
- `DETECTED_ALLOWED`: F5 detecto la automatizacion, pero la politica la permitio.
- `FAIL_NO_EVENT`: no se encontro el evento esperado para un perfil automatizado.
- `FAIL_UNEXPECTED_EVENT`: F5 genero un falso positivo para el navegador legitimo.
- `ERROR_F5`: no fue posible consultar la API de eventos.
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

La correlacion depende de que F5 indexe el evento dentro del periodo de
reintentos. La confianza es alta cuando el evento conserva `X-Bot-Test-ID` y
media cuando se asocia por hora y tipo de automatizacion. La evidencia
definitiva sigue siendo el evento de F5 y sus campos de clasificacion y accion.

El reporte generado por defecto es `bot-defense-results.tsv`; está excluido de
Git. Para compartir resultados, revisa y elimina cualquier dato sensible antes
de enviarlo.
