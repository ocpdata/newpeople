# Administracion de Mi Coach

## Proposito

Este documento describe la pantalla **Mi Coach > Administracion** y las reglas que gobiernan sus canales conversacionales. La administracion permite ajustar configuracion global, limites de lectura y operacion, ejemplos de intenciones y reglas de respuesta.

La interfaz es de gobierno: no reemplaza los permisos de cada usuario ni los formularios y confirmaciones de los modulos CRM.

## Acceso

La pantalla y sus endpoints requieren el permiso `mi_coach.admin`. Tener permiso para usar Coach (`mi_coach.use`) o confirmar una operacion (`mi_coach.execute`) no concede por si mismo acceso administrativo.

La mayoria de los cambios se guardan de forma explicita con el boton de su seccion. Los cambios administrativos relevantes quedan auditados. Los catalogos de intenciones mantienen historial de revisiones y permiten restaurar una revision anterior.

## Secciones

### Intenciones y enrutamiento

La seccion tiene un selector unico para **Coach**, **Cliente existente** y **Cuenta nueva**. Cambiar el canal solo cambia el catalogo que se edita; no combina sesiones, permisos ni datos entre canales.

**Coach**

- El catalogo muestra intenciones como `seller_coaching`, `stage_readiness`, `account_query`, `opportunity_query` y `operation`.
- Se pueden editar los ejemplos de cada intencion. El servidor acepta entre 1 y 30 ejemplos, de hasta 240 caracteres cada uno.
- La vista muestra el contexto requerido y las herramientas posibles. Son datos informativos del catalogo; no se editan desde este panel.
- **Probar** simula la clasificacion y muestra intencion, modo, confianza, destino de detalle, contexto requerido y herramientas previstas. La prueba no ejecuta herramientas ni cambia el CRM.
- **Guardar ejemplos** actualiza los ejemplos del catalogo y registra una revision.
- Los modos de interaccion son coaching, contexto breve, exploracion detallada y propuesta de operacion. La exploracion detallada se deriva al espacio autorizado; no se habilita como lectura profunda desde Coach.

El runtime separa el objetivo de interaccion del tema CRM. B3 elige el grupo de politica (`seller_coaching`, `brief_context`, `operation` o `default`); B6 clasifica la intencion y propone lecturas. El servidor valida el resultado y restringe las herramientas. Los ejemplos de esta seccion orientan el clasificador de B6, pero no reemplazan la seleccion de politica de B3.

**Cliente existente**

- La IA propone la intencion y las lecturas en B6; el servidor valida el plan contra el catalogo, la cuenta seleccionada, los permisos y el alcance configurado.
- Por intencion se pueden ajustar activacion, prioridad, ejemplos, herramientas permitidas y contexto requerido.
- La prioridad acepta valores de 0 a 200. Las herramientas solo pueden reducirse a un subconjunto permitido por el catalogo fijo del canal.
- El contexto obligatorio definido por el servidor no se puede eliminar.

**Cuenta nueva**

- Usa las mismas clases de ajuste por intencion, dentro del catalogo y herramientas propios del canal.
- Su clasificador es determinista: compara patrones y ejemplos configurados y elige la intencion habilitada de mayor prioridad. No usa el planificador IA de B6 de Cliente existente.
- `prospect_profile` es la intencion general de respaldo y no se puede desactivar. El contexto obligatorio de la sesion de prospeccion y los limites de herramientas se validan en el servidor.

En ambos canales, **Probar** simula el enrutamiento sin ejecutar herramientas ni crear registros. Guardar o restaurar una revision deja el cambio auditado.

### Reglas conversacionales

Las reglas conversacionales son instrucciones de texto que se agregan al contexto del modelo. Orientan como responder, por ejemplo, a distinguir evidencia de inferencias, respetar la continuidad de entidades o proponer una operacion sin afirmar que ya se ejecuto.

- **Comunes a todos los chats** se aplican en todos los canales.
- Las reglas **especificas por canal** pueden limitarse a Coach, Cliente existente o Cuenta nueva.
- Coach admite reglas para `default` y para los procesos canonicos `seller_coaching`, `brief_context` y `operation`. Si no existe una regla para una intencion, se usa `default`.
- Cliente existente y Cuenta nueva usan una unica configuracion por canal (`default`).
- Cada regla tiene titulo, instruccion, orden y estado activa/inactiva. Los grupos comunes y por canal se pueden desplegar por separado.

Estas instrucciones orientan al modelo, pero no son controles de seguridad: una regla de texto no concede permisos ni autoriza lecturas o escrituras. El servidor aplica por separado las politicas de negocio, permisos, ownership, contexto y confirmaciones.

### Politicas del canal y contexto

La seccion configura lo que cada canal puede consultar o proponer. Coach ofrece una configuracion general y ajustes opcionales por intencion; Cliente existente y Cuenta nueva tienen una configuracion por canal. Si no hay ajuste especifico de Coach, se usa la configuracion general.

**Dominios de consulta**

- **Cuentas:** datos generales de cuentas autorizadas.
- **Contactos:** contactos relacionados con el contexto autorizado.
- **Leads:** leads visibles para el usuario y permitidos por el canal.
- **Oportunidades y pipeline:** oportunidades, etapas, estado, activacion y resumen de pipeline, segun el canal.
- **Cotizaciones:** contenido comercial accesible; las validaciones evitan exponer costos internos o margenes.

Desactivar un dominio reduce las lecturas disponibles para el chat, pero no amplia los permisos del usuario. El canal Cuenta nueva mantiene sus restricciones: no habilita consultas de contactos CRM, leads, oportunidades ni cotizaciones desde ese alcance.

**Operaciones que el canal puede proponer**

La lista depende del canal. Coach puede proponer borradores de actividad, respuestas de etapa, resultados de llamada de lead y cambios permitidos en campos CRM. Cliente existente agrega operaciones acotadas a la cuenta seleccionada, como crear un contacto, crear una oportunidad o vincular un contacto existente. Cuenta nueva propone conversiones de cuenta, contacto u oportunidad desde la sesion de prospeccion.

Habilitar una operacion solo permite que el chat la proponga. La escritura final sigue sujeta a permisos especificos, validacion de contexto y propiedad, revision del usuario y confirmacion del modulo correspondiente.

### Configuracion de gobierno

Esta seccion contiene controles globales para toda la organizacion.

| Control                                    | Efecto                                                                                                                                        | Valor inicial o limite                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Etapas del pipeline calificado             | Define que etapas se incluyen en ese indicador.                                                                                               | Desarrollo, Cotizacion, Demostracion, Negociacion y Waiting. |
| Etapas del monto comprometido              | Define que etapas cuentan como comprometidas; deben ser parte del pipeline calificado.                                                        | Negociacion y Waiting.                                       |
| Fuentes externas habilitadas               | Permite iniciar investigaciones que consultan fuentes publicas externas. Si esta apagado, el servidor rechaza la investigacion externa.       | Desactivado.                                                 |
| Conversiones de prospeccion habilitadas    | Permite convertir datos de Cuenta nueva en registros CRM. No reemplaza permisos, revisiones de duplicados ni confirmaciones.                  | Activado.                                                    |
| Incluir oportunidades ganadas              | Permite que oportunidades ganadas aparezcan en el historial autorizado de Cliente existente. No las convierte en oportunidades abiertas.      | Activado.                                                    |
| Incluir oportunidades perdidas             | Permite incluir oportunidades perdidas en ese historial.                                                                                      | Activado.                                                    |
| Incluir oportunidades anuladas             | Permite incluir oportunidades anuladas en ese historial.                                                                                      | Desactivado.                                                 |
| Limite diario de investigacion por usuario | Limita investigaciones externas por usuario durante la ventana movil de 24 horas. Al alcanzar el limite, la API responde con limite excedido. | 25; minimo 1, maximo 500.                                    |
| Retencion de hallazgos                     | Determina la antiguedad maxima de hallazgos, jobs de inteligencia y sesiones de prospeccion que conserva la limpieza de gobierno.             | 365 dias; minimo 30, maximo 3650.                            |
| Notas                                      | Texto administrativo para documentar la configuracion.                                                                                        | Hasta 1000 caracteres.                                       |

El pipeline abierto se determina aparte de las etapas elegidas: una oportunidad abierta debe estar activada y en estado comercial **En proceso**. La inclusion de ganadas, perdidas o anuladas controla su presencia en el historial; no cambia su estado ni los calculos de pipeline abierto.

Las listas de etapas aceptan solo las siete etapas comerciales del catalogo. El servidor normaliza selecciones invalidas; siempre debe quedar al menos una etapa calificada y, si ninguna etapa comprometida sigue siendo valida, asigna una etapa calificada como respaldo.

La limpieza por retencion se ejecuta cuando el servicio carga el resumen de gobierno, no mediante un ajuste de politica separado. La configuracion del backend tambien conserva `requireEvidenceForExternalFindings` (activado por defecto), aunque no se muestra como control independiente en esta pantalla.

Los cambios globales se aplican al pulsar **Guardar configuracion**. El servidor normaliza los valores, los persiste y registra el cambio en auditoria.

## Modelo de configuracion y precedencia

La pantalla presenta controles separados porque resuelven problemas distintos:

1. El enrutamiento decide que intencion o tipo de solicitud atender.
2. Las reglas conversacionales orientan la redaccion y el criterio del modelo.
3. Las politicas de negocio limitan dominios y operaciones por canal e intencion.
4. Los permisos del usuario y las validaciones del servidor determinan el acceso efectivo.

Una instruccion conversacional no puede ampliar herramientas, desactivar permisos obligatorios ni saltarse confirmaciones. Los catalogos de herramientas y los contextos obligatorios son autoridad del servidor; la configuracion administrativa puede reducir el alcance permitido.

Las reglas comunes se combinan con las reglas activas del canal y del proceso aplicable. Para Coach, B3 elige el proceso de politica y B6 propone la intencion y lecturas; para Cliente existente, B6 propone el plan estructurado; Cuenta nueva resuelve su intencion con patrones deterministas. El canal seleccionado en administracion no altera estos flujos de ejecucion.

## Historial, migraciones y auditoria

- Los ejemplos de intencion de Coach y las configuraciones de enrutamiento por canal guardan revisiones y ofrecen restauracion.
- Las reglas conversacionales registran creacion, edicion y eliminacion en auditoria.
- Los cambios de reglas de negocio y de configuracion global tambien se auditan.
- Las migraciones de procesos antiguos a los grupos canonicos conservan snapshots antes de consolidar filas. La migracion de reglas no cambia permisos ni datos CRM.

## Endpoints administrativos

Todas estas rutas requieren `mi_coach.admin`. El prefijo es `/api/commercial-intelligence` salvo el endpoint de prueba IA indicado aparte.

| Ruta                                                     | Uso                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET /governance`                                        | Cargar configuracion global y resumen administrativo.                |
| `PUT /governance/settings`                               | Guardar limites y banderas globales; normaliza y audita los valores. |
| `GET /governance/business-rules?channel=...&process=...` | Leer politicas por canal y proceso.                                  |
| `PUT` o `DELETE /governance/business-rules`              | Guardar o restablecer politicas de negocio.                          |
| `GET /governance/rules?channel=...&process=...`          | Listar reglas conversacionales comunes y aplicables.                 |
| `POST /governance/rules`                                 | Crear una regla conversacional.                                      |
| `PUT` o `DELETE /governance/rules/:ruleId`               | Editar o eliminar una regla conversacional.                          |
| `GET /governance/intents`                                | Leer el catalogo de Coach y sus revisiones.                          |
| `PUT /governance/intents/:intentCode/examples`           | Actualizar ejemplos de una intencion de Coach.                       |
| `POST /api/mi-agent/coach/admin/intents/preview`         | Simular la clasificacion de una pregunta de Coach.                   |
| `GET /governance/channel-intents/:channel`               | Leer intenciones de Cliente existente o Cuenta nueva.                |
| `PUT /governance/channel-intents/:channel/:intentCode`   | Guardar ajustes de una intencion de canal.                           |
| `POST /governance/channel-intents/preview`               | Simular el enrutamiento por canal sin ejecutar herramientas.         |

Las rutas de revisiones para ambos catalogos permiten consultar el historial y restaurar una revision. Las restauraciones tambien se registran.

## Fuera del alcance de esta pantalla

La administracion no permite conceder permisos individuales, editar formularios de Cuentas u Oportunidades, escribir en el CRM directamente ni forzar al modelo a obedecer una instruccion. La seccion visible de metricas operativas no forma parte actualmente de esta pantalla; los datos y trazas del motor se gestionan por sus endpoints y herramientas de diagnostico.
