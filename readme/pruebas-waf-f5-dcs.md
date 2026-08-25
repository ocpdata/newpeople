# Pruebas del WAF con F5 Distributed Cloud Services

Guia para validar el WAF que protege `https://newpip.digitalvs.com`.

Estas pruebas estan pensadas para ejecutarse una por una desde una terminal,
mientras la politica WAF esta en modo **Monitoring/Detection**. En este modo una
solicitud maliciosa puede devolver `200`; el resultado principal se confirma en
los eventos de seguridad de F5 DCS, no solo en el codigo HTTP.

## 1. Reglas de seguridad

- Ejecuta las pruebas solo contra esta aplicacion y con autorizacion.
- Usa una cuenta de pruebas, nunca credenciales reales de clientes.
- Ejecuta una prueba, espera unos segundos y busca su evento en F5 antes de
  continuar.
- No ejecutes escaneos masivos, fuzzing indiscriminado ni pruebas de DoS.
- No incluyas secretos, tokens reales ni datos personales en los payloads.
- Anota para cada prueba la hora UTC, URL, metodo, resultado HTTP y request ID.

## 2. Variables de la sesion

Define el dominio y, cuando sea necesario, una ruta real de la API:

```bash
export BASE_URL='https://newpip.digitalvs.com'
export API_PATH='/api/RUTA_REAL'
```

`API_PATH` debe reemplazarse por un endpoint que realmente procese parametros.
Puedes identificarlo en el navegador, en DevTools > Network, filtrando por
`/api/`, o en la documentacion de la API.

Para una prueba autenticada usa un token temporal de una cuenta de pruebas:

```bash
export TOKEN='TOKEN_TEMPORAL_DE_PRUEBAS'
```

No guardes el token en este README ni lo pegues en reportes compartidos.

## 3. Registro base de trafico normal

### Prueba 1: pagina principal

```bash
curl -i "$BASE_URL/"
```

**Esperado:** respuesta normal de la aplicacion, normalmente `200`.

**En F5:** debe aparecer como trafico permitido, sin una firma de ataque.

### Prueba 2: recurso estatico

```bash
curl -I "$BASE_URL/assets/index-XNOTm6s4.js"
```

Usa el nombre actual del archivo JavaScript que devuelve la pagina si cambio.

**Esperado:** `200` y `Content-Type` de JavaScript. No debe haber falso
positivo del WAF.

### Prueba 3: ruta inexistente

```bash
curl -i "$BASE_URL/ruta-que-no-existe-para-pruebas"
```

**Esperado:** `404`, o el fallback de SPA si esa es la configuracion actual.

**En F5:** debe registrarse como solicitud normal, sin clasificacion de ataque.

## 4. Metodos HTTP

### Prueba 4: TRACE

```bash
curl -i -X TRACE "$BASE_URL/"
```

**Esperado:** `405` o bloqueo por politica. No debe reflejar headers o contenido
de la solicitud.

### Prueba 5: metodo no utilizado

```bash
curl -i -X DELETE "$BASE_URL/"
```

**Esperado:** `405` o bloqueo. No debe eliminar ningun recurso.

### Prueba 6: OPTIONS

```bash
curl -i -X OPTIONS "$BASE_URL/"
```

**Esperado:** respuesta coherente con CORS y los metodos permitidos. No debe
exponer informacion interna.

## 5. Rutas y archivos sensibles

Ejecuta cada comando por separado.

### Prueba 7: archivo de entorno

```bash
curl -i "$BASE_URL/.env"
```

### Prueba 8: configuracion de Git

```bash
curl -i "$BASE_URL/.git/config"
```

### Prueba 9: estado del servidor

```bash
curl -i "$BASE_URL/server-status"
```

**Esperado para las tres:** `403` o `404`, y nunca contenido del archivo,
credenciales, variables de entorno o diagnosticos del servidor. Un `200` con
el HTML de la SPA no significa que el archivo se haya expuesto, pero conviene
configurar esas rutas para responder explicitamente `404` o `403`.

## 6. Path traversal

Estas solicitudes son no destructivas y solo prueban la inspeccion del WAF.

### Prueba 10: traversal en la ruta

```bash
curl -i --path-as-is "$BASE_URL/../../etc/passwd"
```

### Prueba 11: traversal en un parametro

```bash
curl -iG "$BASE_URL/" --data-urlencode 'file=../../../../etc/passwd'
```

**Esperado en Monitoring:** puede ser `200`, pero F5 debe registrar una
 deteccion de path traversal si la firma aplica.

**Esperado en Blocking:** bloqueo, normalmente `403` o la respuesta configurada
por la politica.

## 7. SQL Injection

Prueba estos payloads solo contra un endpoint que procese el parametro indicado.
Usa `--data-urlencode` para que la shell y `curl` no rechacen comillas.

### Prueba 12: parametro de busqueda

```bash
curl -iG "$BASE_URL$API_PATH" \
  --data-urlencode "search=' OR '1'='1"
```

### Prueba 13: parametro numerico

```bash
curl -iG "$BASE_URL$API_PATH" \
  --data-urlencode 'id=1 UNION SELECT 1'
```

### Prueba 14: comentario SQL

```bash
curl -iG "$BASE_URL$API_PATH" \
  --data-urlencode 'search=test'
```

Para la prueba 14, reemplaza `test` por un comentario SQL codificado y
no destructivo, adaptado al parametro real. No uses comandos de escritura,
DROP, UPDATE ni DELETE.

**Esperado en Monitoring:** la aplicacion puede responder normalmente, pero F5
debe crear un evento de SQL Injection.

**Esperado en Blocking:** F5 debe bloquear la solicitud.

## 8. Cross-Site Scripting (XSS)

### Prueba 15: XSS reflejado

```bash
curl -iG "$BASE_URL$API_PATH" \
  --data-urlencode 'q=<script>alert(1)</script>'
```

### Prueba 16: atributo HTML

```bash
curl -iG "$BASE_URL$API_PATH" \
  --data-urlencode 'q=" onmouseover="alert(1)'
```

No abras el resultado esperando ejecutar JavaScript. La prueba es revisar la
respuesta y el evento WAF; nunca insertes el payload en datos persistentes.

**Esperado en Monitoring:** evento de XSS en F5, aunque la respuesta sea `200`.

**Esperado en Blocking:** solicitud bloqueada.

## 9. Payload JSON en la API

Ejecuta esto solo contra una ruta real que acepte JSON y no modifique datos.

### Prueba 17: SQL Injection en JSON

```bash
curl -i -X POST "$BASE_URL$API_PATH" \
  -H 'Content-Type: application/json' \
  --data '{"search":"'"'"' OR '"'"'1'"'"'='"'"'1"'"'"}'
```

### Prueba 18: XSS en JSON

```bash
curl -i -X POST "$BASE_URL$API_PATH" \
  -H 'Content-Type: application/json' \
  --data '{"name":"<script>alert(1)</script>"}'
```

Si el endpoint requiere autenticacion, agrega:

```bash
  -H "Authorization: Bearer $TOKEN"
```

**Esperado:** en Monitoring, evento clasificado en F5; en Blocking, rechazo
segun la politica. La API puede devolver `400` por validacion propia, lo cual
tambien es un resultado valido, pero debe existir el evento correspondiente en
F5 si la firma fue detectada.

## 10. User-Agent y automatizacion

### Prueba 19: User-Agent de herramienta

```bash
curl -i -A 'sqlmap' "$BASE_URL/"
```

### Prueba 20: User-Agent de scanner

```bash
curl -i -A 'nikto' "$BASE_URL/"
```

### Prueba 21: User-Agent personalizado

```bash
curl -i -A 'waf-validation-test' "$BASE_URL/"
```

Un User-Agent por si solo no prueba que F5 pueda identificar un bot. El
resultado depende de la configuracion de bot protection. Confirma en la
consola si la politica registra, desafia o permite la solicitud.

## 11. Rate limiting

No automatices esta prueba con un bucle agresivo. Realiza solicitudes manuales
y controladas contra una ruta publica o de login de pruebas:

```bash
curl -i "$BASE_URL/"
curl -i "$BASE_URL/"
curl -i "$BASE_URL/"
```

Repite lentamente hasta alcanzar el umbral configurado.

**Verifica:**

- numero de solicitudes que activa el limite;
- ventana de tiempo;
- duracion del bloqueo;
- codigo HTTP o challenge;
- evento de rate limiting en F5;
- que una solicitud normal despues de la ventana vuelva a pasar.

No pruebes con cientos o miles de solicitudes desde una sola terminal.

## 12. Login y rutas autenticadas

Usa un usuario de pruebas y una ruta real.

### Prueba 22: credenciales invalidas

```bash
curl -i -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"email":"waf-test-invalid@example.com","password":"invalid-password"}'
```

**Esperado:** error de autenticacion sin revelar si el correo existe. Revisa si
F5 registra el evento de abuso o si el control pertenece al rate limiting de la
aplicacion.

### Prueba 23: parametro inesperado

```bash
curl -i -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"email":"waf-test-invalid@example.com","password":"invalid-password","unexpected":"test"}'
```

**Esperado:** rechazo por validacion o respuesta normal controlada; nunca error
interno con stack trace.

## 13. Tamano y headers

### Prueba 24: URL con muchos parametros

```bash
curl -iG "$BASE_URL$API_PATH" \
  --data-urlencode 'p1=test' \
  --data-urlencode 'p2=test' \
  --data-urlencode 'p3=test' \
  --data-urlencode 'p4=test' \
  --data-urlencode 'p5=test'
```

Aumenta gradualmente solo si el limite de la politica se esta verificando.

### Prueba 25: headers de seguridad

```bash
curl -sI "$BASE_URL/"
```

Revisa si existen, segun la arquitectura, `Strict-Transport-Security`,
`Content-Security-Policy`, `X-Content-Type-Options` y proteccion contra
clickjacking. Estos headers pueden configurarse en la aplicacion, nginx o F5;
la ausencia no demuestra por si sola un fallo del WAF.

## 14. Origen y bypass del WAF

Obtén la IP o hostname real de la VM desde AWS. No asumas que la IP que resuelve
el dominio es la IP del origen.

### Prueba 26: acceso directo al origen

```bash
curl -i --connect-to newpip.digitalvs.com:443:ORIGIN_IP:443 \
  'https://newpip.digitalvs.com/'
```

Reemplaza `ORIGIN_IP` por la direccion real de la VM y conserva el hostname TLS.

**Esperado:** el origen no debe ser accesible directamente desde Internet.
Debe aceptar trafico solo desde F5, VPN o las redes autorizadas. Si responde,
configura el Security Group/NACL/firewall de AWS para cerrar el bypass.

No bloquees la IP del WAF sin confirmar primero los rangos oficiales que usa tu
configuracion de F5 DCS.

## 15. Revision en F5 DCS

Para cada prueba, busca el evento por la hora exacta y confirma:

- hostname `newpip.digitalvs.com`;
- path y metodo;
- IP de origen;
- User-Agent;
- categoria o firma detectada;
- politica aplicada;
- accion `Detected`, `Allowed`, `Blocked`, `Challenged` o `Rate Limited`;
- request ID o correlation ID;
- pais y ASN, si estan disponibles;
- servicio de origen al que fue enviada la solicitud.

En Monitoring, el criterio de exito para un ataque es que F5 lo detecte y lo
registre correctamente, aunque la respuesta sea `200`. El criterio de exito
para trafico normal es que pase sin una deteccion incorrecta.

## 16. Reporte de resultados

Registra cada prueba con esta tabla:

| # | Fecha UTC | Metodo y URL | HTTP | Evento F5 | Categoria | Accion | Resultado |
|---|---|---|---:|---|---|---|---|
| 1 |  |  |  |  |  |  |  |

Usa `PASS` cuando la deteccion y la accion coincidan con la politica. Usa
`FAIL` si no aparece el evento, la categoria es incorrecta, existe un falso
positivo o el origen puede evadir F5.

## 17. Paso posterior a Blocking

No cambies directamente toda la politica a bloqueo sin revisar primero los
falsos positivos.

1. Ejecuta todas las pruebas en Monitoring.
2. Corrige rutas, firmas o excepciones que generen falsos positivos.
3. Define una ventana de bajo trafico para el cambio.
4. Cambia a Blocking o aplica una politica de prueba a una ruta controlada.
5. Repite las pruebas maliciosas y verifica `403`, challenge o la accion definida.
6. Repite login, cargas, formularios, busquedas y uso normal.
7. Vigila los eventos despues del cambio y documenta cualquier excepcion.

El WAF se considera validado cuando detecta los ataques en Monitoring, bloquea
los mismos ataques en Blocking, permite el trafico legitimo y no existe acceso
directo al origen.
