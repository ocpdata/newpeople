## Plan: Stepper de Proceso Comercial

Convertir el bloque actual de proceso comercial de la edición de oportunidades en un stepper clickeable por etapas, donde la etapa actual siga siendo la única editable y cualquier otra etapa se abra en modo lectura. Para soportarlo sin lógica duplicada en frontend, el backend debe exponer preguntas y últimas respuestas por cualquier etapa de una oportunidad, reutilizando las reglas existentes para edición, guardado, transición y cierre.

**Tareas simples**

1. Crear un endpoint para consultar una etapa específica de una oportunidad.
   Debe aceptar `opportunityId` y `salesStageId`.
   Debe validar acceso a la oportunidad.
   Debe validar que la etapa exista.
   Debe devolver la etapa pedida, sus preguntas activas y las últimas respuestas de esa etapa.

2. Reutilizar la lógica actual del backend para no duplicar consultas.
   Tomar como base los helpers ya existentes en [routes.opportunities.js](/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.opportunities.js).
   Si hace falta, crear un helper nuevo que construya una vista de etapa para cualquier `salesStageId`.

3. Mantener `commercial-context` funcionando como hoy.
   No romper el endpoint actual mientras se introduce la vista por etapa.
   Debe seguir devolviendo la etapa actual de la oportunidad.

4. Extender el estado del modal de edición en [App.jsx](/Users/ocarrillo/Documents/newpeople/apps/web/src/App.jsx).
   Agregar un estado para la etapa seleccionada en el stepper.
   Agregar un estado para la vista de preguntas y respuestas de la etapa seleccionada.
   Al abrir la oportunidad, la etapa seleccionada debe ser la etapa actual real.

5. Cargar la lista completa de etapas en el modal.
   Usar las etapas activas del catálogo para construir el stepper.
   La etapa actual debe quedar marcada visualmente.

6. Dibujar el stepper en el bloque `Proceso comercial`.
   Cada etapa debe verse como un step clickeable.
   Debe haber estados visuales mínimos: previa, actual, futura y cerrada.

7. Hacer que al hacer clic en un step se cargue esa etapa.
   Si la etapa ya fue consultada, se puede reutilizar localmente.
   Si no, consultar al backend.

8. Mostrar preguntas y respuestas de la etapa seleccionada.
   Si el usuario está viendo la etapa actual, mostrar inputs editables.
   Si está viendo otra etapa, mostrar la información en solo lectura.

9. Dejar claro en la UI cuándo una etapa es solo de consulta.
   Las etapas anteriores y futuras deben abrirse en modo lectura.
   Las futuras pueden verse aunque todavía no tengan respuestas.

10. Limitar las acciones del flujo a la etapa actual.
    `Guardar respuestas`, `Avanzar etapa`, `Retroceder etapa`, `Marcar ganada`, `Marcar perdida` y `Marcar anulada` solo deben estar activas cuando el step seleccionado coincida con la etapa actual.

11. Ajustar los textos de ayuda del bloque comercial.
    Debe quedar claro que el stepper sirve para navegar por etapas.
    Debe quedar claro que solo la etapa actual es editable.

12. Agregar estilos del stepper en [index.css](/Users/ocarrillo/Documents/newpeople/apps/web/src/index.css).
    Definir layout horizontal con wrap.
    Agregar conectores, estados y versión usable en móvil.

13. Refrescar correctamente el stepper después de acciones del flujo.
    Si la oportunidad avanza, retrocede o se cierra, el modal debe actualizar la etapa actual y la selección visible.

14. Actualizar las pruebas E2E en [contacts-opportunities.spec.js](/Users/ocarrillo/Documents/newpeople/apps/web/e2e/contacts-opportunities.spec.js).
    Agregar casos para apertura en etapa actual, clic en etapa anterior, clic en etapa futura, solo lectura fuera de la etapa actual y continuidad del flujo desde la etapa actual.

15. Actualizar la documentación en [oportunidades.md](/Users/ocarrillo/Documents/newpeople/readme/oportunidades.md).
    Explicar que el proceso comercial ahora se ve como stepper.
    Explicar que la etapa actual se abre por defecto.
    Explicar que las demás etapas son de consulta.

**Archivos principales**

- `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.opportunities.js` — hoy `GET /api/opportunities/:id/commercial-context` solo devuelve la etapa actual; aquí va el soporte de vista por etapa.
- `/Users/ocarrillo/Documents/newpeople/apps/web/src/App.jsx` — hoy el modal renderiza un bloque lineal con `commercialContext.answers` y acciones del flujo comercial.
- `/Users/ocarrillo/Documents/newpeople/apps/web/src/index.css` — aquí entra el stepper y sus estados visuales.
- `/Users/ocarrillo/Documents/newpeople/apps/web/e2e/contacts-opportunities.spec.js` — deberá migrarse al patrón stepper.
- `/Users/ocarrillo/Documents/newpeople/readme/oportunidades.md` — debe reflejar la navegación por etapas y la regla de solo lectura fuera de la etapa actual.

**Validación**

1. Probar el endpoint nuevo de vista por etapa con una oportunidad real y al menos tres etapas: actual, anterior y futura; confirmar que devuelve preguntas activas y últimas respuestas de la etapa solicitada sin alterar la oportunidad.
2. Abrir la edición de una oportunidad y validar manualmente que el stepper selecciona por defecto la etapa actual real.
3. Hacer clic en una etapa anterior y confirmar que se muestran sus preguntas/respuestas en solo lectura y que las acciones no operan fuera de la etapa actual.
4. Hacer clic en una etapa futura y confirmar que se muestran sus preguntas configuradas en modo lectura, sin habilitar edición ni saltos ilegales.
5. Volver a la etapa actual, guardar respuestas y avanzar etapa; confirmar que el stepper y la vista seleccionada se refrescan sobre la nueva etapa actual.
6. Ejecutar `cd /Users/ocarrillo/Documents/newpeople/apps/web && npm run test:e2e -- contacts-opportunities.spec.js`.
7. Ejecutar `cd /Users/ocarrillo/Documents/newpeople/apps/web && npm run build`.

**Decisiones ya tomadas**

- Los steps futuros serán visibles y clickeables en modo lectura.
- Solo la etapa actual será editable; el stepper sirve para navegar y revisar contexto por etapa, no para saltar el proceso.
- Hace falta un endpoint backend nuevo o equivalente para consultar cualquier etapa; con el contrato actual no alcanza porque `commercial-context` solo entrega la etapa actual.
- El alcance incluye el modal de edición de oportunidad y su contrato backend inmediato; no incluye un rediseño más amplio del módulo.

**Notas útiles**

1. Recomendación: cachear en frontend las vistas de etapa ya cargadas dentro del modal para evitar refetch al volver entre steps, invalidando esa cache después de guardar respuestas, avanzar, retroceder o cerrar.
2. Recomendación: deshabilitar visualmente acciones cuando el step seleccionado no coincide con la etapa actual, en lugar de ocultarlas, para mantener claro el modelo del flujo.
3. Riesgo a vigilar: si se permiten ver etapas futuras con preguntas activas pero sin respuestas, el copy debe dejar claro que es una vista previa, no una etapa alcanzada.
