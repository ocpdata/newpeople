# Definiciones funcionales de tableros de leads v1

## Objetivo

Definir la primera version funcional de los tableros de leads para que el equipo
de producto, negocio, UX y desarrollo implemente una solucion consistente,
medible y gobernable.

Esta version cubre:

- estructura del modulo y sus tableros;
- permisos y alcance por rol;
- definiciones oficiales de KPIs;
- definiciones operativas de seguimiento;
- filtros, drilldowns y acciones permitidas;
- criterios de implementacion para una primera entrega.

No cubre diseno visual detallado ni especificacion tecnica de API o base de
datos.

## Alcance de la version

La version v1 se implementa como un solo modulo de tableros de leads dentro del
modulo de leads existente.

La solucion incluye 3 vistas:

- tablero ejecutivo;
- tablero de gestion comercial;
- tablero operativo.

Los 3 tableros comparten el mismo universo funcional de leads, pero exponen
datos, acciones y nivel de detalle distintos segun permisos y alcance.

## Objetivos de negocio

- dar visibilidad a la gerencia sobre volumen, conversion, velocidad y riesgo;
- permitir a lideres comerciales gestionar carga, disciplina y seguimiento;
- permitir a operacion comercial controlar colas, vencimientos y calidad de
  datos;
- unificar definiciones de lead trabajado, lead calificado, seguimiento vencido
  y lead estancado;
- asegurar que los tableros sirvan para priorizar y accionar, no solo para
  consultar.

## Estructura funcional

### Modulo

- nombre sugerido: `Tableros de leads`;
- ubicacion: dentro del modulo de leads;
- acceso: entrada unica con cambio de vista interno.

### Vistas internas

1. `Ejecutivo`
2. `Gestion comercial`
3. `Operativo`

## Modelo de permisos

### Permiso base

- `leads.dashboard.access`: permite entrar a la seccion de tableros.

### Permisos por tablero

- `leads.dashboard.executive.view`
- `leads.dashboard.management.view`
- `leads.dashboard.operations.view`

### Permisos de alcance

- `leads.scope.self`: solo leads propios.
- `leads.scope.team`: leads del equipo.
- `leads.scope.all`: todos los leads autorizados.

### Permisos funcionales complementarios

- `leads.dashboard.drilldown.view`: permite abrir el detalle detras de un KPI.
- `leads.dashboard.export`: permite exportar la vista actual.
- `leads.dashboard.reassign`: permite reasignar leads desde lista o tablero.
- `leads.dashboard.sla.manage`: permite ajustar umbrales y reglas operativas de
  SLA y alertas.

### Regla de acceso

Para visualizar cualquier tablero, el usuario debe tener:

1. `leads.dashboard.access`
2. al menos un permiso de tablero
3. al menos un permiso de alcance

## Roles funcionales v1

### Vendedor

- alcance: `self`
- vista principal recomendada: bandeja personal de leads
- acceso opcional a tableros: gestion comercial solo en modo personal

### Lider comercial

- alcance: `team`
- tableros principales: gestion comercial
- tablero opcional: operativo del equipo

### Gerente comercial

- alcance: `all`
- tableros principales: ejecutivo y gestion comercial
- tablero opcional: operativo

### Operacion comercial

- alcance: `team` o `all`
- tablero principal: operativo
- tablero opcional: gestion comercial

### Direccion comercial

- alcance: `all`
- tablero principal: ejecutivo
- tablero opcional: gestion comercial

### BI / Revenue Ops

- alcance: `all`
- acceso recomendado: los 3 tableros
- foco: analisis, exportacion y trazabilidad

### Admin

- alcance: `all`
- acceso completo a los 3 tableros y permisos funcionales avanzados

## Definiciones operativas oficiales

Las siguientes definiciones son oficiales para tableros, alertas y filtros.

### Lead activo

Lead cuyo estado actual no es cierre definitivo.

Incluye:

- `Creado`
- `Lead no asignado`
- `Lead asignado`
- cualquier estado intermedio vigente equivalente

Excluye:

- `Lead calificado` si en una fase futura se considera cerrado al convertir
  completamente;
- `Lead descalificado`;
- cualquier estado definitivo futuro de cierre.

Nota v1:

- mientras `Lead calificado` siga siendo parte activa de seguimiento comercial,
  se tratara como activo para mediciones operativas, salvo que negocio decida lo
  contrario antes de construir.

### Primer contacto valido

Se considera primer contacto valido el primer evento comercial verificable con
fecha asociada, por ejemplo:

- llamada realizada;
- correo enviado;
- mensaje o WhatsApp registrado;
- reunion agendada o realizada.

No cuenta como contacto:

- abrir el lead;
- editar campos administrativos;
- cargar un archivo sin interaccion comercial;
- reanalizar documentos.

### Seguimiento vencido

Un lead esta en `seguimiento vencido` cuando se cumplen todas estas
condiciones:

1. el lead esta en estado activo;
2. existe una proxima accion comprometida;
3. la fecha u hora compromiso ya vencio;
4. la accion no fue cerrada ni reemplazada por una nueva accion vigente.

### Lead sin contacto

Un lead esta en `sin contacto` cuando no existe un primer contacto valido
registrado.

### Lead estancado

Un lead esta en `estancado` cuando:

1. permanece en el mismo estado mas alla del umbral definido; y
2. no registra avance comercial relevante en ese periodo.

Se considera avance comercial relevante:

- nuevo contacto valido;
- actualizacion de siguiente paso con nueva fecha compromiso;
- vinculacion o creacion de cuenta;
- vinculacion o creacion de contacto;
- creacion o vinculacion de oportunidad;
- cambio de estado con fundamento comercial.

No se considera avance relevante:

- cambio cosmetico de texto;
- reordenamiento sin decision comercial;
- apertura o consulta del modal.

Umbrales recomendados v1:

- `Creado` o equivalente inicial: 2 dias habiles
- `Lead no asignado`: 3 dias habiles
- `Lead asignado`: 5 dias habiles
- `Lead calificado` sin oportunidad adicional pendiente: 3 dias habiles

### Lead calificado

Un lead esta en `calificado` cuando cumple las siguientes condiciones minimas:

1. existe una cuenta resuelta;
2. existe al menos un contacto util resuelto;
3. existe interes comercial confirmado;
4. existe continuidad comercial definida, normalmente mediante oportunidad o
   siguiente paso comercial formal.

Regla operativa v1:

- dado que el estado estructural actual del sistema marca `Lead calificado`
  cuando el lead ya tiene cuenta, contacto, vendedor y oportunidad, el tablero
  v1 debe respetar esa definicion persistida del sistema para sus KPI oficiales.

## KPIs oficiales

Todos los KPIs deben tener formula unica y campo de fecha de referencia
explicito.

### Volumen

#### Leads creados

- definicion: total de leads creados en el periodo seleccionado
- fecha de referencia: `created_at`

#### Leads activos

- definicion: total de leads en estado activo segun la definicion oficial
- fecha de referencia: foto actual al momento de la consulta

#### Leads trabajados

- definicion: leads con al menos una accion comercial valida dentro del periodo
- acciones validas:
  - primer contacto registrado
  - actualizacion de seguimiento comercial
  - cambio de estado comercial relevante
  - vinculacion o creacion de cuenta
  - vinculacion o creacion de contacto
  - vinculacion o creacion de oportunidad

### Conversion

#### Tasa de contacto

- formula: leads con primer contacto valido / leads creados en el periodo
- formato: porcentaje

#### Tasa de calificacion

- formula ejecutiva v1: leads que alcanzaron estado `Lead calificado` / leads
  creados en el periodo
- formato: porcentaje

#### Tasa de conversion a oportunidad

- formula v1: leads con al menos una oportunidad creada o vinculada / leads
  creados en el periodo
- formato: porcentaje

#### Tasa de descalificacion

- formula: leads descalificados / leads creados en el periodo
- formato: porcentaje

### Velocidad

#### Tiempo promedio a primer contacto

- formula: promedio entre `created_at` y fecha del primer contacto valido
- formato: horas o dias

#### Tiempo promedio a calificacion

- formula: promedio entre `created_at` y fecha en que el lead alcanzo estado
  `Lead calificado`
- formato: dias

#### Tiempo promedio a oportunidad

- formula: promedio entre `created_at` y fecha de primera oportunidad
  vinculada o creada
- formato: dias

#### Tiempo desde ultima actividad

- formula: diferencia entre fecha actual y fecha de la ultima actividad
  comercial valida
- formato: dias

### Disciplina comercial

#### Porcentaje con proximo paso definido

- formula: leads activos con siguiente accion y fecha compromiso / leads activos
- formato: porcentaje

#### Porcentaje con seguimiento vencido

- formula: leads activos en seguimiento vencido / leads activos
- formato: porcentaje

#### Porcentaje sin contacto

- formula: leads activos sin primer contacto valido / leads activos
- formato: porcentaje

#### Porcentaje estancado

- formula: leads activos en estado estancado / leads activos
- formato: porcentaje

### Carga

#### Carga activa por vendedor

- definicion: cantidad de leads activos asignados a cada vendedor
- formato: numero absoluto

#### Leads criticos por vendedor

- definicion: leads del vendedor con prioridad alta y seguimiento vencido o sin
  actividad dentro del SLA
- formato: numero absoluto

### Calidad

#### Descalificacion por motivo

- definicion: distribucion absoluta y porcentual por motivo oficial de
  descalificacion

#### Conversion por fuente

- definicion: leads que llegan a oportunidad o a calificacion agrupados por
  fuente

## Filtros globales compartidos

Los 3 tableros deben compartir la misma logica base de filtros.

### Filtros obligatorios v1

- periodo
- fuente del lead
- estado del lead
- vendedor responsable
- equipo comercial
- prioridad
- aging
- con proximo paso / sin proximo paso
- seguimiento vencido / no vencido
- con oportunidad / sin oportunidad

### Reglas de filtros

- los filtros deben respetar el alcance por permiso del usuario;
- los filtros activos deben reflejarse en KPIs, graficas y listas;
- el drilldown debe heredar los filtros vigentes del tablero origen.

## Especificacion por tablero

### 1. Tablero ejecutivo

#### Objetivo

Dar visibilidad gerencial del estado general del pipeline de leads.

#### Roles objetivo

- gerente comercial
- direccion comercial
- BI / Revenue Ops
- admin

#### KPIs visibles

- leads creados
- leads activos
- leads trabajados
- leads calificados
- leads descalificados
- oportunidades creadas desde leads
- tasa de contacto
- tasa de calificacion
- tasa de conversion a oportunidad
- tiempo promedio a primer contacto
- tiempo promedio a calificacion
- porcentaje con seguimiento vencido
- porcentaje con proximo paso definido
- conversion por fuente
- descalificacion por motivo

#### Visualizaciones recomendadas

- tarjetas resumen superiores
- embudo de conversion
- serie temporal por semana o mes
- ranking de fuentes
- ranking agregado por vendedor o equipo
- matriz de aging por estado
- bloque de alertas ejecutivas

#### Filtros visibles

- periodo
- fuente
- equipo
- vendedor
- estado
- prioridad
- con oportunidad / sin oportunidad

#### Drilldowns

Con `leads.dashboard.drilldown.view`:

- abrir lista de leads detras de cualquier KPI agregable;
- abrir leads de una fuente concreta;
- abrir leads de un vendedor o equipo;
- abrir leads descalificados por motivo;
- abrir leads con seguimiento vencido.

Sin ese permiso:

- el tablero solo es de consulta agregada.

#### Acciones permitidas por permiso

- sin permisos extra: ver KPIs y graficas;
- con `leads.dashboard.drilldown.view`: abrir listas y detalle;
- con `leads.dashboard.export`: exportar dataset visible;
- con `leads.dashboard.reassign`: opcional solo desde listas filtradas;
- con `leads.dashboard.sla.manage`: editar umbrales de alertas ejecutivas.

### 2. Tablero de gestion comercial

#### Objetivo

Gestionar carga, disciplina y conversion del equipo comercial.

#### Roles objetivo

- lider comercial
- gerente comercial
- direccion comercial
- operacion comercial, si participa en seguimiento del equipo
- admin

#### KPIs visibles

- leads nuevos por vendedor
- leads activos por vendedor
- leads sin primer contacto
- leads sin actividad reciente
- leads con seguimiento vencido
- leads sin proximo paso
- leads calificados sin oportunidad adicional pendiente, si aplica el proceso
- tiempo promedio a primer contacto por vendedor
- tiempo promedio entre seguimientos
- tasa de calificacion por vendedor
- tasa de conversion a oportunidad por vendedor
- carga activa por vendedor
- leads estancados por vendedor y estado
- leads de prioridad alta sin movimiento

#### Visualizaciones recomendadas

- tabla comparativa por vendedor
- ranking de carga y conversion
- heatmap de aging por vendedor y estado
- bloque de excepciones del equipo
- cola critica del dia

#### Filtros visibles

- periodo
- equipo
- vendedor
- fuente
- estado
- prioridad
- aging
- vencido / no vencido
- con proximo paso / sin proximo paso
- con oportunidad / sin oportunidad

#### Drilldowns

Con `leads.dashboard.drilldown.view`:

- abrir leads sin primer contacto;
- abrir leads vencidos del equipo;
- abrir leads sin proximo paso;
- abrir cartera de un vendedor;
- abrir leads estancados;
- abrir leads de prioridad alta sin actividad.

#### Acciones permitidas por permiso

- sin permisos extra: ver comparativos y colas;
- con `leads.dashboard.drilldown.view`: abrir listas y detalle;
- con `leads.dashboard.export`: exportar listados y resumenes;
- con `leads.dashboard.reassign`: reasignar leads dentro del alcance permitido;
- con `leads.dashboard.sla.manage`: editar metas y umbrales del equipo.

### 3. Tablero operativo

#### Objetivo

Controlar backlog, vencimientos, calidad de datos y excepciones del proceso.

#### Roles objetivo

- operacion comercial
- lider operativo
- lider comercial, si participa en control diario
- BI / Revenue Ops
- admin

#### KPIs visibles

- leads nuevos sin asignar
- leads asignados sin primer contacto
- leads sin proximo paso
- leads con seguimiento vencido
- leads estancados
- leads con cuenta no resuelta
- leads con contacto no resuelto
- leads con oportunidad sugerida no creada
- leads con datos incompletos
- leads duplicados o sospechosos
- backlog operativo total
- cumplimiento diario de SLA

#### Visualizaciones recomendadas

- tarjetas KPI operativas
- tabla principal de colas
- lista de incidencias
- lista de pendientes criticos
- resumen diario de SLA

#### Filtros visibles

- hoy / 7 dias / periodo personalizado
- equipo
- vendedor
- estado
- sin asignar
- sin contacto
- sin proximo paso
- incompleto
- duplicado
- vencido / no vencido
- prioridad

#### Drilldowns

Con `leads.dashboard.drilldown.view`:

- abrir cola de leads nuevos sin asignar;
- abrir cola de leads sin proximo paso;
- abrir cola de leads vencidos;
- abrir lista de duplicados o sospechosos;
- abrir lista de oportunidades sugeridas no creadas;
- abrir registros con datos incompletos.

#### Acciones permitidas por permiso

- sin permisos extra: ver colas e incidencias;
- con `leads.dashboard.drilldown.view`: abrir listas y detalle;
- con `leads.dashboard.export`: exportar colas operativas;
- con `leads.dashboard.reassign`: reasignar o tomar leads dentro del alcance;
- con `leads.dashboard.sla.manage`: ajustar umbrales operativos y alertas.

## Acciones desde tablero vs acciones solo desde el lead

### Acciones permitidas desde el tablero

- cambiar filtros;
- navegar por drilldown;
- abrir detalle del lead;
- exportar la vista actual, si tiene permiso;
- reasignar lead, si tiene permiso;
- tomar leads no asignados, si tiene permiso;
- navegar a oportunidad vinculada.

### Acciones que solo deben hacerse dentro del lead

- calificar lead;
- descalificar lead;
- registrar motivo de descalificacion;
- capturar seguimiento comercial detallado;
- definir o corregir la proxima accion con contexto completo;
- vincular o crear cuenta;
- vincular o crear contacto;
- crear o vincular oportunidad;
- editar datos sensibles del lead;
- resolver conflictos de duplicado con criterio comercial.

### Regla funcional

El tablero sirve para detectar, priorizar y enrutar.

El lead sirve para decidir, documentar y ejecutar la resolucion comercial.

## Reglas de implementacion v1

- los KPIs deben recalcularse con los filtros activos;
- el alcance del usuario debe limitar KPIs, listas y exportaciones;
- un KPI no debe mostrarse como clickeable si el usuario no tiene
  `leads.dashboard.drilldown.view`;
- la exportacion siempre debe respetar el alcance del usuario;
- la reasignacion nunca debe estar disponible si el usuario no tiene
  `leads.dashboard.reassign`;
- el tablero ejecutivo debe priorizar agregacion y tendencias, no colas;
- el tablero operativo debe priorizar listas accionables y excepciones, no solo
  graficas.

## Criterios de aceptacion funcionales

### Generales

- el usuario solo ve los tableros para los que tiene permiso;
- el usuario solo ve datos dentro de su alcance;
- los filtros globales afectan KPIs, graficas y listas de manera consistente;
- el drilldown abre una lista coherente con el KPI origen y mantiene filtros;
- ninguna accion restringida aparece visible si el usuario no tiene permiso.

### Ejecutivo

- debe permitir entender volumen, conversion y velocidad sin abrir cada lead;
- debe permitir detectar fuentes, equipos o vendedores con riesgo u oportunidad.

### Gestion comercial

- debe permitir detectar rapidamente vendedores con atraso, sobrecarga o baja
  conversion;
- debe permitir entrar a las colas del equipo para accion inmediata.

### Operativo

- debe permitir identificar backlog, vencimientos, faltantes y excepciones del
  dia;
- debe permitir priorizar la normalizacion operativa sin editar masivamente el
  lead desde el tablero.

## Supuestos y decisiones abiertas

Estas definiciones se consideran listas para implementacion v1, con validacion
final de negocio sobre los siguientes puntos:

1. confirmar si `Lead calificado` se mantiene como estado operativo activo o se
   trata como cierre en algun reporte ejecutivo;
2. confirmar si el umbral de `estancado` por estado se mantiene como propuesta
   inicial o cambia por tipo de lead;
3. confirmar si operacion comercial puede reasignar directamente o solo sugerir
   reasignacion;
4. confirmar si el vendedor tendra una vista personal simplificada dentro de
   tableros o solo su bandeja de leads.

## Resultado esperado de la v1

La v1 debe entregar un modulo unico de tableros de leads capaz de:

- medir el funnel de leads con definiciones unicas;
- exponer alertas operativas accionables;
- separar lectura gerencial, gestion comercial y control operativo;
- respetar permisos y alcance sin ambiguedad;
- servir como base para futuras versiones con scoring, alertas avanzadas y
  automatizacion.