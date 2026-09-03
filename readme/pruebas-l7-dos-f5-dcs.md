# Pruebas DDoS L7 con F5 Distributed Cloud Services

Guia para validar de forma controlada el umbral RPS, la mitigacion y la
recuperacion de
`https://newpip.digitalvs.com/api/accounts/l7-dos-test`.

La carga se ejecuta mediante Grafana Cloud k6 desde seis zonas y usa un perfil
fijo de hasta 150 RPS. El orquestador local conserva el seguimiento del trabajo,
la cancelacion, la correlacion con F5 y el reporte TSV.

Las zonas configuradas están en Estados Unidos (Columbus), Brasil (São Paulo),
Alemania (Frankfurt), Reino Unido (Londres), Sudáfrica (Ciudad del Cabo) y Japón
(Tokio).

## 1. Requisitos y seguridad

- Ejecuta la prueba solo con autorizacion y en una ventana acordada.
- La ejecucion desde la aplicacion requiere `pruebas.admin`.
- Solo se permite un trabajo de pruebas de seguridad activo a la vez.
- El destino debe usar HTTPS y pertenecer a `DOS_ALLOWED_HOSTS`.
- Ejecuta primero `--dry-run`.
- Confirma que el proyecto k6 admite 100 VUs y las seis zonas configuradas.
- No modifiques el perfil fijo sin revisar capacidad, cuota y monitoreo.

## 2. Configuracion

Configura estas variables en `apps/api/.env` y reinicia la API:

```bash
XC_API_URL=https://tenant.console.ves.volterra.io
XC_API_P12_FILE=/ruta/segura/credencial.p12
XC_P12_PASSWORD=REEMPLAZAR
XC_NAMESPACE=REEMPLAZAR
XC_LB_NAME=REEMPLAZAR

K6_CLOUD_TOKEN=REEMPLAZAR
K6_CLOUD_STACK_ID=REEMPLAZAR
K6_CLOUD_PROJECT_ID=REEMPLAZAR
DOS_TARGET_URL=https://newpip.digitalvs.com/api/accounts/l7-dos-test
DOS_ALLOWED_HOSTS=newpip.digitalvs.com
DOS_LOCAL_HEALTH_URL=http://127.0.0.1:4000/health
```

La VM debe tener `k6`. El despliegue de `vm_newpeople` lo instala de forma
idempotente desde el repositorio oficial.

## 3. Fases

| ID                   | Carga   | Duracion | Resultado esperado               |
| -------------------- | ------- | -------- | -------------------------------- |
| `dos-baseline`       | 50 RPS  | 10 s     | Sin mitigacion                   |
| `dos-pre-threshold`  | 90 RPS  | 15 s     | Sin mitigacion                   |
| `dos-threshold`      | 100 RPS | 20 s     | Revisar el comportamiento del F5 |
| `dos-over-threshold` | 150 RPS | 60 s     | Mitigacion F5                    |
| `dos-recovery`       | 20 RPS  | 15 s     | Servicio saludable               |

La carga completa dura dos minutos. La fase sobreumbral se sostiene durante
un minuto para que F5 pueda distinguirla de un pico breve. Las solicitudes
mantienen una URL estable, deshabilitan cache y reutilizan conexiones.

`/api/accounts/l7-dos-test` es una ruta reservada para esta prueba. No consulta
ni expone cuentas: responde `204` solo cuando recibe los identificadores DoS
del runner y devuelve `404` al trafico normal. En F5, excluye esta ruta del
Request Rate Limiter de 50 RPS y mantenla incluida en L7 DDoS Protection.
La respuesta `401` indica que el endpoint nuevo aun no esta desplegado y que la
solicitud entro al middleware normal de autenticacion de cuentas. El runner
detiene la prueba en ese caso para no confundir ese evento con una deteccion
DoS. La respuesta esperada del preflight es `204`.

Al finalizar se consulta `DOS_LOCAL_HEALTH_URL`. Si la API local se degrada, el
script marca la recuperacion como `FAIL_ORIGIN_DEGRADED`.

La prueba Rate Limit se ejecuta desde el repositorio independiente
`ocpdata/test-rate-limit` mediante un runner efimero de GitHub Actions. No se
ejecuta desde la VM de origen ni consulta eventos administrativos de F5; valida
la aplicacion del limite mediante la respuesta HTTP `429`.

Client-Side Defense se valida por separado mediante Playwright desde el
workflow `client-side-defense.yml`; no reutiliza Bot Defense.

## 4. Simulacion y ejecucion

La simulacion valida configuracion y muestra las cinco fases sin enviar carga:

```bash
node scripts/test-l7-dos.mjs --dry-run
```

La ejecucion completa debe hacerse desde la tarjeta **DDoS L7** de la interfaz.
Un administrador confirma el perfil fijo e inicia el trabajo. Las fases forman
una unica ejecucion Cloud y no pueden iniciarse por separado.

No ejecutes manualmente la fase sobreumbral en produccion fuera de la ventana
autorizada.

## 5. Correlacion F5

Cada solicitud incluye:

```text
X-DOS-Test-ID: dos-cloud-managed
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
mayor a 150 RPS. Las credenciales de eventos no activan por si solas esa
proteccion.

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

El reporte TSV incluye las cinco ventanas de carga, datos F5, `run_id`, URL de
la ejecucion Cloud, codigo de salida k6 y detalle de salud. Las metricas de
solicitudes y latencia se consultan en la URL de Grafana Cloud.
