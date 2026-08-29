# Pruebas DoS L7 con F5 Distributed Cloud Services

Guia para validar de forma controlada el umbral RPS, la mitigacion y la
recuperacion de
`https://newpip.digitalvs.com/api/accounts/l7-dos-test`.

Esta prueba genera carga desde un solo servidor. Es una validacion DoS L7, no
una prueba DDoS distribuida.

## 1. Requisitos y seguridad

- Ejecuta la prueba solo con autorizacion y en una ventana acordada.
- La ejecucion desde la aplicacion requiere `pruebas.admin`.
- Solo se permite un trabajo de pruebas de seguridad activo a la vez.
- El destino debe usar HTTPS y pertenecer a `DOS_ALLOWED_HOSTS`.
- Ejecuta primero `--dry-run`.
- Alinea el umbral configurado en F5 con `DOS_RPS_THRESHOLD`.
- No aumentes `DOS_MAX_RPS_ALLOWED` sin revisar capacidad y monitoreo.

El umbral inicial es 100 RPS y el techo de carga es 120 RPS. Como la fase
sobreumbral genera 120% del umbral, el servidor rechaza valores que excedan
ese techo.

## 2. Configuracion

Configura estas variables en `apps/api/.env` y reinicia la API:

```bash
XC_API_URL=https://tenant.console.ves.volterra.io
XC_API_P12_FILE=/ruta/segura/credencial.p12
XC_P12_PASSWORD=REEMPLAZAR
XC_NAMESPACE=REEMPLAZAR
XC_LB_NAME=REEMPLAZAR

DOS_RPS_THRESHOLD=100
DOS_MAX_RPS_ALLOWED=120
DOS_TARGET_URL=https://newpip.digitalvs.com/api/accounts/l7-dos-test
DOS_ALLOWED_HOSTS=newpip.digitalvs.com
DOS_LOCAL_HEALTH_URL=http://127.0.0.1:4000/health
```

La VM debe tener `k6`. El despliegue de `vm_newpeople` lo instala de forma
idempotente desde el repositorio oficial.

## 3. Fases

| ID                   | Carga | Duracion | Resultado esperado                  |
| -------------------- | ----- | -------- | ----------------------------------- |
| `dos-baseline`       | 10%   | 10 s     | Sin mitigacion                      |
| `dos-pre-threshold`  | 80%   | 15 s     | Sin mitigacion                      |
| `dos-threshold`      | 100%  | 20 s     | Revisar el comportamiento del F5    |
| `dos-over-threshold` | 120%  | 60 s     | Evento F5 con `Challenge` o `Block` |
| `dos-recovery`       | 10%   | 15 s     | Origen saludable y trafico normal   |

La carga completa dura 120 segundos. La fase sobreumbral se sostiene durante
60 segundos para que F5 pueda distinguirla de un pico breve de trafico.
Cada solicitud usa una query unica, deshabilita cache y cierra su conexion al
terminar. Esto evita que CDN/keep-alive oculten el patron HTTP flood sin elevar
el limite configurado de RPS.

`/api/accounts/l7-dos-test` es una ruta reservada para esta prueba. No consulta
ni expone cuentas: responde `204` solo cuando recibe los identificadores DoS
del runner y devuelve `404` al trafico normal. En F5, excluye esta ruta del
Request Rate Limiter de 50 RPS y mantenla incluida en L7 DDoS Protection.
La respuesta `401` indica que el endpoint nuevo aun no esta desplegado y que la
solicitud entro al middleware normal de autenticacion de cuentas. El runner
detiene la prueba en ese caso para no confundir ese evento con una deteccion
DoS. La respuesta esperada del preflight es `204`.

Antes y despues de cada fase se consulta `DOS_LOCAL_HEALTH_URL`. Si la API
local se degrada, el script marca `FAIL_ORIGIN_DEGRADED` y no inicia las fases
restantes.

## 4. Simulacion y ejecucion

La simulacion valida configuracion y muestra las cinco fases sin enviar carga:

```bash
node scripts/test-l7-dos.mjs --dry-run --threshold-rps 100
```

La ejecucion completa debe hacerse desde la tarjeta **DoS L7** de la interfaz.
Un administrador define el umbral, confirma el techo calculado e inicia el
trabajo. Para una comprobacion operativa de una sola fase:

```bash
node scripts/test-l7-dos.mjs --threshold-rps 100 --only dos-baseline
```

No ejecutes manualmente la fase sobreumbral en produccion fuera de la ventana
autorizada.

## 5. Correlacion F5

Cada solicitud incluye:

```text
X-DOS-Test-ID: dos-over-threshold
X-DOS-Run-ID: dos-AAAAMMDD...
```

El script consulta los eventos de Application Security al terminar la carga.
Prioriza el ID exacto de fase; si F5 no conserva ese header, limita la
correlacion por `run_id` y ventana temporal. Registra accion, categoria, ID de
evento, ID de solicitud y confianza de correlacion.

Un HTTP 403 o 429 se contabiliza como respuesta bloqueada, pero no demuestra
por si solo que F5 aplico mitigacion. La confirmacion requiere un evento F5 y
una accion de mitigacion correlacionados.

Si no aparece ningun evento despues de la fase sobreumbral, verifica en la
consola F5 que HTTP DDoS Protection este habilitado para el Load Balancer
`XC_LB_NAME`, que haya terminado el aprendizaje y que el umbral efectivo no sea
mayor a `DOS_RPS_THRESHOLD`. Las credenciales de eventos no activan por si
solas esa proteccion.

## 6. Interpretacion

| Resultado                | Significado                                      |
| ------------------------ | ------------------------------------------------ |
| `PASS_NO_MITIGATION`     | Trafico bajo el umbral sin mitigacion            |
| `PASS_BLOCKED`           | Mitigacion F5 detectada donde se esperaba        |
| `PASS_RECOVERED`         | La API recupero salud despues de la carga        |
| `FAIL_EARLY_BLOCK`       | F5 mitigo antes del umbral esperado              |
| `FAIL_NO_EVENT`          | No se encontro evento F5 sobre el umbral         |
| `FAIL_NOT_BLOCKED`       | Hubo evento F5, pero no una accion de mitigacion |
| `FAIL_ORIGIN_DEGRADED`   | La API local fallo su comprobacion de salud      |
| `INCONCLUSIVE_THRESHOLD` | El comportamiento justo en el umbral es ambiguo  |
| `ERROR_F5`               | No fue posible consultar o interpretar F5        |

El reporte TSV incluye RPS objetivo, solicitudes, respuestas exitosas,
bloqueadas y erradas, latencias promedio/p95/p99, datos F5, `run_id` y detalle
de salud.
