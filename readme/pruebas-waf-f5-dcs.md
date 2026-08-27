# Pruebas del WAF con F5 Distributed Cloud Services

Guia operativa para ejecutar las pruebas del WAF de `newpip.digitalvs.com`, consultar los eventos de F5 DCS y entender el resultado.

## Inicio rapido

### 1. Configura F5

Abre [scripts/waf-env.example](../scripts/waf-env.example). Ese archivo contiene los nombres exactos de las variables que reconoce el script.

En tu terminal:

1. Define las variables mostradas en el archivo.
2. Sustituye el marcador del password por el password real del certificado.
3. Verifica que la ruta del certificado corresponda a tu equipo.

El archivo de ejemplo no debe contener el password real.

### 2. Prepara el script

Ejecuta una sola vez:

> chmod +x scripts/test-waf.sh

### 3. Ejecuta las pruebas

> ./scripts/test-waf.sh --output waf-results.tsv

El script realiza las solicitudes, espera la indexacion de F5, consulta los eventos y genera el archivo `waf-results.tsv`.

### 4. Abre el resultado

Abre `waf-results.tsv` con Excel, Numbers o una hoja de calculo. El separador es tabulador.

Revisa primero estas columnas:

- **resultado**: conclusion de la prueba.
- **prueba**: identificador del caso ejecutado.
- **que se esperaba**: comportamiento correcto.
- **que ocurrio**: explicacion del veredicto.
- **http**: codigo devuelto al cliente.
- **evento F5**: indica si se encontro evidencia en F5.
- **accion F5**: indica si F5 detecto, permitio o bloqueo.
- **categoria F5**: clasificacion asignada por F5.

## Como interpretar el resultado

### PASÓ

La respuesta y la evidencia de F5 coinciden con lo esperado. No requiere accion adicional.

Ejemplo: F5 detecto una inyeccion SQL en modo monitoreo, aunque la respuesta HTTP fue `200`.

### FALLÓ

No se cumplio una condicion obligatoria.

Causas frecuentes:

- F5 no genero el evento esperado.
- La categoria detectada no corresponde al ataque enviado.
- La politica estaba en modo bloqueo, pero F5 permitio la solicitud.
- El origen fue accesible directamente y se pudo evitar F5.

### REVISAR

El script encontro una situacion que no puede decidir de forma segura.

Ejemplo: la ruta `/.env` respondio HTTP `200`. Debe confirmarse que la respuesta sea una pagina generica y no el contenido real del archivo.

### ERROR

La prueba no pudo evaluarse por un problema tecnico.

Revisa conectividad, certificado, password, URL de F5 y permisos de la credencial.

### NO EJECUTADA

La prueba fue simulada mediante la opcion `--dry-run`; no se envio una solicitud real.

## Modos de la politica

El modo configurado en [scripts/waf-env.example](../scripts/waf-env.example) no cambia la politica de F5. Solo informa al script que comportamiento debe validar.

- **monitoring**: F5 debe detectar el ataque, pero puede permitirlo.
- **blocking**: F5 debe detectar y bloquear, denegar, desafiar o limitar la solicitud.

Usa el modo que realmente tenga configurado el HTTP Load Balancer durante la prueba.

## Variantes de ejecucion

### Simular sin enviar solicitudes

> ./scripts/test-waf.sh --dry-run --output waf-dry-run.tsv

### Ejecutar sin consultar F5

> ./scripts/test-waf.sh --skip-f5 --output waf-results.tsv

Los resultados quedaran como `REVISAR` porque no existe evidencia de F5.

### Probar una ruta autenticada de lectura

> ./scripts/test-waf.sh --api-path /api/accounts --login-email usuario-pruebas@example.com --output waf-auth-results.tsv

El script solicita el password de forma interactiva. Usa solamente una cuenta de pruebas.

### Usar un token temporal

> ./scripts/test-waf.sh --api-path /api/accounts --token TOKEN_TEMPORAL --output waf-auth-results.tsv

No guardes el token en el repositorio ni en reportes compartidos.

### Probar el limite de frecuencia

> ./scripts/test-waf.sh --rate-limit --output waf-rate-limit.tsv

La prueba es corta y controlada. No la conviertas en una prueba de carga.

### Probar acceso directo al origen

> ./scripts/test-waf.sh --origin-ip IP_PUBLICA_DE_LA_VM --output waf-origin-results.tsv

El resultado correcto es que el origen no sea accesible directamente desde Internet.

## Que valida el script

El conjunto principal incluye:

- pagina principal y endpoints publicos;
- archivos y rutas sensibles;
- recorrido de rutas;
- inyeccion SQL;
- secuencias de comandos entre sitios, XSS;
- metodos HTTP no permitidos;
- comportamiento de OPTIONS;
- User-Agent de herramienta;
- autenticacion opcional;
- limite de frecuencia opcional;
- acceso directo al origen opcional.

Las pruebas son no destructivas. No uses una ruta que cree, modifique o elimine datos para la opcion `--api-post-path`.

## Correlacion con F5

Cada solicitud incluye un identificador de ejecucion y un identificador de prueba. El script consulta Security Events al terminar y relaciona cada evento con su solicitud.

La confianza puede ser:

- **Alta**: F5 contiene el identificador de ejecucion y el de la prueba.
- **Media**: F5 contiene el identificador de la prueba dentro de la ventana consultada.
- **Ninguna**: no se encontro un evento correlacionable.

Consulta manualmente la consola de F5 cuando:

- el resultado sea `REVISAR` o `ERROR`;
- la confianza sea Media o Ninguna;
- el resultado no coincida con lo observado;
- necesites confirmar la firma original o la politica aplicada.

Busca primero por el ID de solicitud F5. Si no esta disponible, usa fecha UTC, URL, metodo e identificador de ejecucion.

## Solucion de problemas

### F5 responde HTTP 400

El script muestra el mensaje devuelto por la API. Verifica la URL del tenant, namespace, nombre del Load Balancer y endpoint de Security Events.

### F5 no registra un ataque

Comprueba en la consola:

- que la politica WAF este asociada al Load Balancer;
- que la solicitud haya llegado al Load Balancer correcto;
- que la firma esperada este activa;
- que el evento no haya tardado mas que la ventana de consulta;
- que no exista una excepcion para la ruta o parametro.

Un HTTP `200` no demuestra por si solo que la prueba fallo. En modo monitoreo puede ser correcto si F5 registro la deteccion.

### Una ruta sensible responde HTTP 200

Confirma el contenido de la respuesta. Puede ser la pagina generica de la aplicacion o una pagina de bloqueo servida con HTTP `200`.

Si la respuesta contiene variables, credenciales, configuracion Git o diagnosticos internos, la prueba fallo y existe exposicion de informacion.

### El certificado no funciona

Verifica que:

- el archivo sea un certificado PKCS#12 valido;
- el password corresponda al certificado;
- la credencial tenga permisos de lectura en F5;
- la ruta indicada sea correcta para el directorio desde donde ejecutas el script.

## Seguridad

- Ejecuta las pruebas solo con autorizacion.
- Usa cuentas y tokens temporales de pruebas.
- No incluyas secretos ni datos personales en los payloads.
- No realices fuzzing, escaneos masivos ni pruebas de denegacion de servicio.
- No guardes certificados, passwords, tokens ni resultados sensibles en Git.
- Revisa los falsos positivos antes de cambiar una politica completa a modo bloqueo.

## Criterio de validacion

El WAF se considera validado cuando:

- detecta ataques en modo monitoreo;
- bloquea los ataques esperados en modo bloqueo;
- permite el trafico legitimo sin falsos positivos;
- protege archivos y rutas sensibles;
- el origen no es accesible directamente desde Internet.
