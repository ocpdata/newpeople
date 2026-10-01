# Preguntas por Etapa del Proceso Comercial

## Objetivo

Las preguntas por etapa estructuran la información que el vendedor debe capturar para evaluar si una oportunidad está suficientemente desarrollada y si puede avanzar con seguridad dentro del proceso comercial.

No son preguntas aisladas del formulario: representan evidencia comercial sobre la necesidad del cliente, el proceso de compra, la estrategia y el siguiente paso.

## Etapas operativas

El proceso comercial contempla siete etapas:

1. Contacto inicial
2. Identificación de oportunidad
3. Desarrollo
4. Cotización
5. Demostración
6. Negociación
7. Waiting

Cada etapa puede tener su propio conjunto de preguntas. Las preguntas activas se muestran en la oportunidad según la etapa consultada.

## Catálogo exacto implementado

Todas las preguntas listadas actualmente están activas y son obligatorias (`is_active = 1`, `is_required = 1`). El orden corresponde a `display_order`.

### Contacto inicial

1. `contacto_inicial_interes_cliente`: ¿Qué necesidad, iniciativa, problema o interés concreto expresa el cliente que justifique abrir esta oportunidad?

### Identificación de la oportunidad

1. `identificacion_requerimiento_tecnico`: ¿Qué requerimiento técnico, funcional, operativo o de integración solicita el cliente?
2. `identificacion_motivacion_principal`: ¿Cuál es el motivo de negocio principal detrás de este requerimiento y qué problema quiere resolver o qué resultado quiere lograr el cliente?
3. `identificacion_presupuesto_cliente`: ¿Qué se sabe del presupuesto del cliente, de sus restricciones presupuestales o de cómo conseguiría el presupuesto para este proyecto?
4. `identificacion_fecha_adquisicion`: ¿Cuál es la fecha objetivo para adquirir o implementar la solución, por qué debe cumplirse esa fecha y qué impacto tendría no hacerlo a tiempo?
5. `identificacion_decisor_proceso_compra`: ¿Quiénes participan en la decisión de compra y cómo es el proceso de aprobación o adquisición para esta oportunidad?
6. `identificacion_ventajas_fortalezas`: ¿Qué ventajas o fortalezas tenemos para esta oportunidad en función de las necesidades y prioridades del cliente?
7. `identificacion_estrategia`: ¿Qué estrategia comercial y técnica se seguirá para avanzar esta oportunidad con base en la información disponible?

### Desarrollo

1. `desarrollo_informacion_adicional`: ¿Qué información adicional relevante se obtuvo en las reuniones o sesiones de desarrollo sobre alcance, necesidades, restricciones o prioridades?
2. `desarrollo_presentacion_solucion`: ¿Cómo se presentó o explicó la solución técnica al cliente y cómo se relacionó con su problema o necesidad?
3. `desarrollo_propuesta`: ¿Qué solución, alcance, arquitectura, servicio o alternativa se ha propuesto al cliente?
4. `desarrollo_puntos_tecnicos`: ¿Cuáles son los puntos técnicos más importantes para el proyecto y cuáles son críticos para el éxito de la solución?
5. `desarrollo_aceptacion_propuesta`: ¿Qué nivel de aceptación, validación o conformidad ha mostrado el cliente respecto de la propuesta técnica?
6. `desarrollo_observaciones_condiciones`: ¿Qué observaciones, dudas, restricciones o condiciones indicó el cliente como requisito para aceptar o avanzar con la propuesta técnica?
7. `desarrollo_riesgo_tecnico`: ¿Qué riesgos técnicos, dependencias, vacíos de información o factores de complejidad podrían afectar la solución o su implementación?

### Cotización

1. `cotizacion_propuesta_economica`: ¿La propuesta económica se alinea con el presupuesto, rango esperado o expectativas del cliente para este proyecto?
2. `cotizacion_condiciones_comerciales`: ¿Las condiciones comerciales de la propuesta coinciden con las necesidades del cliente para este proyecto?

### Demostración

1. `demostracion_motivo`: ¿Por qué el cliente solicitó o aceptó una demostración y qué quería validar?
2. `demostracion_criterios_exito`: ¿Cuáles son los criterios concretos de éxito o validación para considerar exitosa la demostración?
3. `demostracion_siguientes_pasos`: ¿Cuáles son los siguientes pasos esperados después de cumplir los criterios de éxito de la demostración?
4. `demostracion_resultado`: ¿Cuál fue el resultado de la demostración y cuál fue la reacción o conclusión del cliente?

### Negociación

1. `negociacion_precio_condiciones`: ¿Cuáles son el precio objetivo, los límites de negociación y las mejores condiciones que podrían aceptarse para cerrar con este cliente?
2. `negociacion_puntos_cliente`: ¿Cuáles son los puntos, condiciones o factores que el cliente valora más en esta negociación?
3. `negociacion_puntos_nosotros`: ¿Cuáles son los puntos más importantes que debemos proteger o priorizar nosotros en esta negociación?

### Waiting

1. `waiting_acuerdo_o_postores`: ¿Se llegó a un acuerdo o el cliente sigue evaluando la decisión entre varios postores?

`Waiting` no significa que la oportunidad esté ganada. El cierre como Ganada es un estado comercial separado y requiere la validación correspondiente.

## Configuración del catálogo

Las preguntas se administran desde **Configuración del proceso comercial** en:

- `/opportunities/questions`

Cada pregunta tiene, como mínimo:

- Etapa comercial asociada.
- Código.
- Texto de la pregunta.
- Tipo de respuesta.
- Orden de despliegue.
- Indicador de obligatoriedad.
- Estado activo o inactivo.

La administración no requiere modificar código.

### Permisos

- Lectura: `proceso_comercial_config.read`
- Edición: `proceso_comercial_config.update`

### Endpoints

- `GET /api/catalogs/opportunity-sales-stages`
- `GET /api/catalogs/opportunity-stage-questions`
- `GET /api/catalogs/opportunity-stage-questions-admin?salesStageId=...`
- `POST /api/catalogs/opportunity-stage-questions`
- `PUT /api/catalogs/opportunity-stage-questions/:questionId`
- `PATCH /api/catalogs/opportunity-stage-questions/:questionId/status`
- `PATCH /api/catalogs/opportunity-stage-questions/:questionId/order`
- `POST /api/catalogs/opportunity-stage-questions/reorder`

## Reglas operativas

- Las preguntas activas se muestran en la captura operativa.
- El orden configurado determina el orden de presentación.
- Una pregunta obligatoria debe tener respuesta para permitir avanzar desde la etapa actual.
- Las preguntas de etapas futuras pueden consultarse en modo lectura.
- Solo la etapa actual permite guardar respuestas operativas.
- Una oportunidad cerrada no puede guardar nuevas respuestas de etapa.
- Desactivar una pregunta afecta la captura futura; no elimina automáticamente las respuestas históricas.
- Las respuestas pertenecen a una oportunidad y a una pregunta concreta.
- Las respuestas deben conservar trazabilidad y no deben sobrescribirse sin registrar el cambio conforme a la auditoría aplicable.

## Relación con Mi Coach

Mi Coach usa las preguntas y respuestas disponibles en el contexto de la oportunidad para responder consultas y detectar información relevante.

Si el vendedor escribe una afirmación que coincide claramente con una pregunta de etapa, Mi Coach puede proponer una operación `stage_answer` con:

- La pregunta identificada.
- El `questionId` real.
- El texto que propone guardar.
- La respuesta anterior, si existe.
- La opción de reemplazar o agregar.

Mi Coach no guarda la respuesta automáticamente. El vendedor debe revisar y confirmar la operación.

El contexto seleccionado de cuenta, oportunidad y contacto determina el alcance de la consulta. Una oportunidad seleccionada debe ser la entidad principal para sus preguntas y respuestas.

## API de respuestas

- `GET /api/opportunities/:opportunityId/commercial-context`
- `GET /api/opportunities/:opportunityId/stage-view/:salesStageId`
- `POST /api/opportunities/:opportunityId/stage-answers`
- `POST /api/opportunities/:opportunityId/stage-transition`

## Referencias

- [Configuración del proceso comercial](./configuracion-proceso-comercial.md)
- [Oportunidades](./oportunidades.md)
- [Proceso comercial](./proceso-comercial.md)
- [Especificación funcional del Chat Coach](./especificacion-chat-coach.md)
