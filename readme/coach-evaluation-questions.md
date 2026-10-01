# Preguntas de evaluacion del Chat Coach

Esta bateria define preguntas representativas para validar el comportamiento del Chat Coach. La respuesta no tiene que coincidir palabra por palabra; deben coincidir la intencion, las entidades, los filtros, los datos, la evidencia, los permisos y las operaciones.

La version ejecutable de esta lista esta en:

- `apps/api/test/fixtures/coach-evaluation-cases.json`
- `apps/api/test/coach-evaluation-matrix.test.js`

Para ejecutarla:

```text
cd apps/api
npm exec -- vitest run --maxWorkers=1 test/coach-evaluation-matrix.test.js
```

## Contrato de cada caso

Cada caso define:

- `id`: identificador estable.
- `question`: pregunta del vendedor.
- `context`: contexto inicial esperado.
- `intent`: intencion esperada.
- `filters`: filtros que deben aplicarse.
- `tools`: herramientas esperadas.
- `expected`: resultado verificable.
- `mustNot`: comportamiento que no debe ocurrir.

## Reglas semanticas base

- `activada` describe el estado de activacion.
- `abierta` o `en proceso` describe una oportunidad no terminal.
- `ganada`, `perdida` y `anulada` son estados comerciales terminales.
- Las oportunidades terminales no forman parte del pipeline abierto.
- Una pregunta plural solicita una coleccion.
- Una pregunta singular ambigua solicita aclaracion.
- Una coincidencia exacta por nombre de oportunidad tiene prioridad sobre una coincidencia por cuenta.
- Un correo es una solicitud de redaccion, no un conteo de oportunidades.
- Una operacion siempre requiere confirmacion.

## 1. Consultas generales

### COACH-GEN-001

- Pregunta: `Que cuentas tienen la mayor cantidad de oportunidades abiertas?`
- Contexto: general.
- Intencion: `pipeline_coverage`.
- Filtros: `lifecycle=open`, `activationStatus=activada`.
- Herramientas: `searchOpportunities` o resumen determinista de pipeline.
- Resultado: ranking de cuentas ordenado por cantidad.
- Evidencia: conteo calculado desde oportunidades autorizadas.
- No debe: contar oportunidades ganadas como abiertas ni dejar el conteo al criterio libre del modelo.

### COACH-GEN-002

- Pregunta: `Cuales son las oportunidades de mayor monto?`
- Contexto: general.
- Intencion: `pipeline_coverage` o `context_query`.
- Filtros: oportunidades autorizadas; ordenar por `amountUsd` descendente.
- Resultado: lista con nombre, cuenta, monto y etapa.
- No debe: mezclar oportunidades fuera del alcance del usuario.

### COACH-GEN-003

- Pregunta: `Que oportunidades tienen riesgo?`
- Contexto: general.
- Intencion: `at_risk_opportunities` o `risk_diagnosis`.
- Filtros: oportunidades abiertas y activadas.
- Resultado: riesgo, evidencia y siguiente paso.
- No debe: presentar una inferencia como hecho confirmado.

## 2. Consultas por cuenta

### COACH-ACCOUNT-001

- Pregunta: `Cuales son las oportunidades abiertas de Totalplay?`
- Contexto: general.
- Intencion: `context_query`.
- Entidad: cuenta Totalplay.
- Filtros: `account=Totalplay`, `lifecycle=open`, `activationStatus=activada`.
- Resultado del fixture actual: 8 oportunidades abiertas.
- Evidencia: nombres, etapas y montos de las 8 oportunidades.
- No debe: incluir las 6 oportunidades ganadas de Totalplay.

### COACH-ACCOUNT-002

- Pregunta: `Cuantas oportunidades activadas tiene Totalplay, aunque esten ganadas?`
- Contexto: general.
- Intencion: `context_query`.
- Entidad: cuenta Totalplay.
- Filtros: `account=Totalplay`, `activationStatus=activada`, sin filtro `lifecycle=open`.
- Resultado del fixture actual: 14 oportunidades activadas.
- No debe: responder 8 si la pregunta pide activadas sin limitarse a abiertas.

### COACH-ACCOUNT-003

- Pregunta: `Que oportunidades ganadas tiene Totalplay?`
- Contexto: general.
- Intencion: `context_query`.
- Entidad: cuenta Totalplay.
- Filtros: `commercialStatus=ganada`, `activationStatus=activada`.
- Resultado del fixture actual: 6 oportunidades ganadas.
- No debe: sumarlas al pipeline abierto.

### COACH-ACCOUNT-004

- Pregunta: `Que riesgos tiene Totalplay?`
- Contexto: general.
- Intencion: `risk_diagnosis`.
- Entidad: cuenta Totalplay.
- Resultado: riesgos con evidencia y acciones sugeridas.
- No debe: cambiar silenciosamente a otra cuenta.

## 3. Consultas por oportunidad

### COACH-OPP-001

- Pregunta: `Dame el detalle de la oportunidad Vrf 2027 de Totalplay.`
- Contexto: general.
- Intencion: `context_query`.
- Entidad: oportunidad exacta `Vrf 2027`.
- Herramientas: `getOpportunity`, `getOpportunityActivities`.
- Resultado: monto, etapa, estado, fecha y actividades del registro exacto.
- No debe: pedir seleccion si el nombre es inequívoco.

### COACH-OPP-002

- Pregunta: `En que etapa esta Vrf 2027?`
- Contexto: oportunidad `Vrf 2027`.
- Intencion: `context_query`.
- Resultado: etapa exacta desde CRM.
- No debe: usar el valor de otra oportunidad de Totalplay.

### COACH-OPP-003

- Pregunta: `Que falta para avanzar esta oportunidad?`
- Contexto: oportunidad seleccionada.
- Intencion: `opportunity_preparation`.
- Herramientas: `getOpportunity`, actividades y preparación de etapa.
- Resultado: avances, pendientes, riesgos, siguiente paso y recomendación.
- No debe: avanzar de etapa automáticamente.

### COACH-OPP-004

- Pregunta: `Dame el detalle de la oportunidad de Totalplay.`
- Contexto: general.
- Intencion: `clarification`.
- Resultado: candidatos de oportunidad diferenciados.
- No debe: seleccionar una oportunidad arbitrariamente.

## 4. Continuidad y aislamiento

### COACH-CONTEXT-001

- Secuencia:
  1. `Selecciona Totalplay.`
  2. `Que oportunidades abiertas tiene?`
  3. `Cual requiere seguimiento?`
- Resultado: las tres preguntas usan la cuenta y contexto compatibles.
- No debe: mezclar otra cuenta ni perder el contexto activo.

### COACH-CONTEXT-002

- Secuencia:
  1. Seleccionar Totalplay.
  2. Seleccionar una oportunidad de otra cuenta.
- Resultado: aclaracion o cambio controlado de contexto.
- No debe: conservar entidades incompatibles en la misma sesion.

### COACH-CONTEXT-003

- Secuencia:
  1. Preguntar en Coach.
  2. Cambiar a Cliente existente.
  3. Cambiar a Cuenta nueva.
- Resultado: cada espacio conserva su propio contexto.
- No debe: mostrar mensajes o sesiones de otro espacio.

## 5. Acciones y operaciones

### COACH-ACTION-001

- Pregunta: `Agenda una llamada con el cliente para confirmar el siguiente paso.`
- Intencion: `action_proposal`.
- Operacion: `activity`.
- Resultado: titulo, oportunidad, tipo, estado, prioridad, notas y criterio de exito.
- Confirmacion: obligatoria.
- No debe: crear la actividad automaticamente.

### COACH-ACTION-002

- Pregunta: `Actualiza el monto de esta oportunidad a 100000.`
- Intencion: `action_proposal`.
- Operacion: `opportunity_field`.
- Resultado: valor actual, nuevo valor y evidencia.
- Confirmacion: obligatoria.
- No debe: ejecutar si el valor actual cambio.

### COACH-ACTION-003

- Pregunta: `Dame un modelo de correo para enviarlo a Eduardo para buscar mas oportunidades.`
- Intencion: redaccion de correo.
- Resultado: borrador de correo y destinatario pendiente de validar.
- Confirmacion: necesaria antes de cualquier envio.
- No debe: responder con un conteo de oportunidades.

### COACH-ACTION-004

- Pregunta: `Actualiza la oportunidad.`
- Intencion: `clarification` o `missing_fields`.
- Resultado: solicita campo, valor y oportunidad.
- No debe: inventar el campo o el valor.

## 6. Ambiguedad y entidades

### COACH-ENTITY-001

- Pregunta: `Revisa Seguridad.`
- Intencion: `clarification`.
- Resultado: candidatos tipados y diferenciados.
- No debe: escoger por coincidencia parcial.

### COACH-ENTITY-002

- Pregunta: `Dime las oportunidades activas de Totalplay.`
- Intencion: `context_query`.
- Resultado: coleccion de oportunidades.
- No debe: pedir seleccionar una sola oportunidad.

### COACH-ENTITY-003

- Pregunta: `Revisa la oportunidad Vrf 2027 de Totalplay.`
- Intencion: `context_query`.
- Resultado: una oportunidad exacta.
- No debe: devolver candidatos de todas las oportunidades de Totalplay.

## 7. Permisos y alcance

### COACH-SECURITY-001

- Usuario con acceso a la cuenta.
- Resultado: datos autorizados.

### COACH-SECURITY-002

- Usuario sin ownership ni permiso global.
- Pregunta: `Que oportunidades tiene una cuenta ajena?`
- Resultado: registro no disponible o acceso denegado.
- No debe: filtrar datos de la cuenta.

### COACH-SECURITY-003

- Usuario con lectura pero sin actualización.
- Pregunta: `Cambia el monto de la oportunidad.`
- Resultado: propuesta no ejecutable o rechazo por permiso.
- No debe: ejecutar la operación.

## 8. Fallbacks y errores

### COACH-ERROR-001

- IA no disponible.
- Pregunta: `Que oportunidades abiertas tiene Totalplay?`
- Resultado: fallback determinista con conteo y evidencia CRM.
- No debe: inventar un conteo ni depender de texto libre del modelo.

### COACH-ERROR-002

- Tool no autorizada.
- Resultado: error recuperable y visible.
- No debe: ejecutar una herramienta fuera del catálogo del usuario.

### COACH-ERROR-003

- La oportunidad cambia mientras se confirma una operación.
- Resultado: conflicto de versión y solicitud de nueva revisión.
- No debe: sobrescribir el cambio ajeno.

## 9. Criterios de evaluacion

Un caso pasa cuando coinciden los invariantes estructurados:

- Intencion.
- Entidades e IDs.
- Filtros.
- Herramientas.
- Conteos.
- Evidencia.
- Confianza.
- Aclaraciones.
- Operaciones.
- Permisos.
- Contexto activo.

La redaccion puede variar. Los datos, filtros, permisos y acciones no.
