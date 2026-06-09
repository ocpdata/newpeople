# Modulo Calendario Comercial - Documento Funcional Corto

## 1. Objetivo
Definir reglas operativas y de seguridad para el nuevo modulo Calendario Comercial, con foco en:

1. Permisos especificos del modulo.
2. Timezone oficial para alertas del dia.
3. Fuente unica de verdad para actividad pendiente.

## 2. Alcance funcional
El modulo Calendario Comercial debe incluir dos secciones:

1. Calendario de actividades creadas (vista dia, semana, mes).
2. Alertas del dia (pendientes de hoy, vencidas, proximas).

Debe permitir seleccionar vendedor solo cuando el usuario tenga permiso global.

## 3. Reglas finales

### 3.1 Permisos del modulo calendario
Se definen estos permisos nuevos:

1. `calendario_comercial.read`: acceso al modulo y visualizacion de agenda propia.
2. `calendario_comercial.read_all`: visualizacion de agenda de todos los vendedores.
3. `calendario_comercial.update`: crear, reprogramar o actualizar estado desde calendario.

Reglas de acceso:

1. Un usuario con `calendario_comercial.read` y sin `calendario_comercial.read_all` solo puede ver su agenda.
2. El selector de vendedor se habilita solo para usuarios con `calendario_comercial.read_all`.
3. Para usar acciones de edicion en calendario, el usuario debe tener `calendario_comercial.update`.

### 3.2 Timezone oficial para alertas del dia
Timezone oficial de negocio:

1. `America/Mexico_City`

Reglas de tiempo:

1. El calculo de "hoy" y "vencido" se hace en `America/Mexico_City`.
2. Los timestamps se almacenan en UTC en base de datos.
3. La visualizacion al usuario se presenta en `America/Mexico_City` para mantener consistencia operativa.

Definiciones:

1. Pendiente hoy: actividad cuya fecha/hora cae dentro del dia operativo actual.
2. Vencida: actividad pendiente con fecha/hora menor al momento actual.
3. Proxima: actividad pendiente dentro de las siguientes 24 horas.

### 3.3 Fuente unica de "actividad pendiente"
La fuente unica de pendientes para calendario y alertas es la capa de ejecucion comercial.

Reglas unificadas por tipo:

1. Actividad pendiente: estado en `pending`, `confirmed`, `rescheduled`, `in_progress`, `blocked`.
2. Accion pendiente: estado en `pending`, `in_progress`, `blocked`.
3. Dependencia pendiente: estado en `open` o `pending` (normalizar a `pending` en evoluciones futuras).
4. No pendientes: `done`, `cancelled`, `missed`.

Regla transversal:

1. Cualquier pantalla que muestre "pendientes" (calendario, alertas, dashboard) debe reutilizar la misma definicion y no recalcular con criterios distintos.

## 4. Criterios de aceptacion

### 4.1 Permisos y alcance
1. Dado un vendedor con `calendario_comercial.read` y sin `calendario_comercial.read_all`, cuando entra al modulo, entonces solo visualiza sus actividades.
2. Dado un vendedor sin `calendario_comercial.read_all`, cuando abre el filtro de vendedor, entonces no puede seleccionar otros usuarios.
3. Dado un gerente con `calendario_comercial.read_all`, cuando entra al modulo, entonces puede cambiar el vendedor y ver su agenda.
4. Dado un usuario sin `calendario_comercial.update`, cuando intenta editar una actividad desde calendario, entonces la accion se bloquea por permisos.

### 4.2 Timezone y alertas
1. Dado una actividad programada para hoy en `America/Mexico_City`, cuando se muestra la seccion alertas, entonces aparece en "Pendientes de hoy".
2. Dado una actividad pendiente con fecha/hora pasada respecto a `America/Mexico_City`, cuando se recalculan alertas, entonces aparece como "Vencida".
3. Dado un usuario en otra zona horaria local, cuando consulta calendario, entonces la clasificacion "hoy/vencida/proxima" coincide con `America/Mexico_City`.

### 4.3 Fuente unica de pendientes
1. Dado el mismo rango y usuario, cuando se consulta calendario y alertas, entonces el total de pendientes coincide entre ambas vistas.
2. Dado una actividad que cambia a `done`, cuando se refresca calendario y alertas, entonces deja de contarse como pendiente en ambas vistas.
3. Dado una actividad `rescheduled`, cuando se recalcula el dia objetivo, entonces sigue contandose como pendiente hasta su cierre.

## 5. Matriz de permisos por rol

| Rol | calendario_comercial.read | calendario_comercial.read_all | calendario_comercial.update | Alcance esperado |
| --- | --- | --- | --- | --- |
| Administrador | Si | Si | Si | Todo el equipo |
| Gerente comercial / Lider comercial | Si | Si | Si | Todo el equipo |
| Preventa (si gestiona agenda de equipo) | Si | Si | Si | Todo el equipo o segun politica |
| Vendedor | Si | No | Si | Solo su agenda |
| Auditor / consulta | Si | Si (opcional) | No | Solo lectura |

Nota operativa:

1. Si un rol no tiene `calendario_comercial.read`, no debe ver el modulo en navegacion ni por URL directa.

## 6. Definiciones de salida del modulo

### 6.1 Seccion Calendario
Debe mostrar:

1. Actividades por dia/semana/mes.
2. Estado de cada actividad.
3. Vendedor seleccionado (si aplica).

### 6.2 Seccion Alertas del dia
Debe mostrar al menos:

1. Cantidad de pendientes de hoy.
2. Cantidad de vencidas.
3. Listado priorizado por urgencia con acceso directo a la actividad.

## 7. Riesgos controlados con estas reglas

1. Evitar fuga de informacion entre vendedores por falta de alcance.
2. Evitar discrepancias de "hoy" por timezone entre backend y frontend.
3. Evitar diferencias de conteo entre calendario y alertas por definiciones distintas de pendiente.