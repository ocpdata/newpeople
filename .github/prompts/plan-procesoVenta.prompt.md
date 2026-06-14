## Tareas Ejecutables Para Agent: Proceso comercial de oportunidades

Ejecuta este trabajo en orden. No abras una tarea nueva si la actual no quedó validada. Mantén cambios pequeños y no rompas permisos actuales ni el estado de activación existente.

## Reglas fijas

- Toda oportunidad nueva inicia en Contacto Inicial y En proceso.
- Ganada no es etapa; es estado comercial.
- Ganada solo puede aplicarse desde Waiting.
- Perdida y Anulada pueden aplicarse desde cualquier etapa, con motivo obligatorio.
- Solo se puede retroceder entre etapas mientras la oportunidad esté En proceso.
- Una oportunidad Ganada, Perdida o Anulada ya no puede avanzar ni retroceder.
- El backend valida estas reglas aunque el frontend intente saltárselas.

## Restricciones

- No mezclar estado comercial con estado de activación.
- No dejar validaciones críticas solo en frontend.
- Si `PUT /api/opportunities/:id` queda confuso, crear endpoints explícitos para transición, respuestas y cierre.
- Mantener auditoría suficiente para reconstruir cambios de etapa, respuestas y cierres.

## Tarea 1: Modelo de datos

Objetivo:
dejar la base lista para soportar etapas, estado comercial, preguntas por etapa y respuestas históricas.

Haz esto en este orden:

1. Revisa el estado actual del catálogo `opportunity_sales_stages` y documenta cómo está sembrado hoy `Ganada`, porque la migración debe partir de ese dato real.
2. Crea un nuevo catálogo para estados comerciales de oportunidad con estos valores:
   En proceso;
   Ganada;
   Perdida;
   Anulada.
3. Extiende `opportunities` con columnas para:
   `commercial_status_id`;
   `commercial_closed_at`;
   `commercial_close_reason`.
4. Define `commercial_status_id` como obligatorio y siembra `En proceso` como valor por defecto lógico para toda oportunidad existente o nueva.
5. Migra oportunidades existentes:
   si alguna está hoy en etapa `Ganada`, conviértela a etapa `Waiting` + estado comercial `Ganada`;
   el resto debe quedar en estado comercial `En proceso` salvo que exista otra evidencia persistida, en cuyo caso documenta la decisión y aplica la opción más segura.
6. Ajusta el catálogo `opportunity_sales_stages` para que solo existan 7 etapas operativas y `Waiting` quede como la última. `Ganada` ya no debe permanecer como etapa operativa activa.
7. Crea una tabla para definiciones de preguntas por etapa con al menos:
   referencia a etapa;
   orden;
   texto de pregunta;
   tipo de respuesta;
   obligatoriedad;
   flag de activa;
   timestamps mínimos si el esquema del proyecto los usa en catálogos equivalentes.
8. Crea una tabla para respuestas históricas por oportunidad y etapa con al menos:
   referencia a oportunidad;
   referencia a etapa;
   referencia a pregunta o snapshot equivalente;
   valor de respuesta;
   versión o timestamp suficiente para conservar histórico;
   usuario y fecha de captura si el modelo actual de auditoría lo requiere.
9. Decide explícitamente si la respuesta debe conservar copia del texto de la pregunta además del `question_id`. Si hay riesgo de que las preguntas cambien con el tiempo, conserva snapshot suficiente para no romper historial.
10. Siembra todas las preguntas iniciales del proceso comercial, asociadas a la etapa correcta y en el orden correcto.
11. Deja el `schema.sql` idempotente y compatible con ambientes ya existentes, siguiendo el patrón actual del archivo para columnas, constraints, seeds y migraciones progresivas.

Subtareas SQL sugeridas:

1. Crear o alterar catálogos primero.
2. Alterar `opportunities` después.
3. Migrar datos existentes antes de retirar `Ganada` del catálogo operativo.
4. Crear tablas nuevas de preguntas y respuestas.
5. Insertar seeds finales.
6. Ejecutar checks de consistencia al final.

Checks de consistencia que debes dejar resueltos:

1. Ninguna oportunidad debe quedar apuntando a una etapa inexistente.
2. Ninguna oportunidad debe quedar sin `commercial_status_id`.
3. Ninguna oportunidad marcada como `Ganada` debe quedar fuera de `Waiting`.
4. Todas las etapas operativas deben conservar orden único y correcto.
5. Todas las preguntas semilla deben quedar vinculadas a una etapa válida.
6. El esquema debe poder recrearse desde cero y también actualizar una base ya existente.

Archivos probables:

- `apps/api/sql/schema.sql`

Validación mínima:

1. Ejecuta reset de base.
2. Verifica que existan 7 etapas operativas correctas.
3. Verifica que existan 4 estados comerciales.
4. Verifica que ninguna oportunidad existente quede con `Ganada` como etapa operativa.
5. Verifica que las preguntas semilla quedaron asociadas a sus etapas.
6. Verifica que las tablas nuevas admiten histórico sin sobrescribir respuestas previas.

Definición de terminado:

- La base soporta el flujo sin columnas temporales ni soluciones ad hoc y deja preparada la implementación del backend sin ambigüedad de modelo.

## Tarea 2: Backend de catálogos y reglas

Objetivo:
hacer que la API controle creación, transición, cierre y persistencia de respuestas.

Haz esto en este orden:

1. Revisa el contrato actual de `POST /api/opportunities`, `PUT /api/opportunities/:id`, `PATCH /api/opportunities/:id/status` y catálogos existentes para decidir qué se conserva y qué debe separarse.
2. Ajusta creación de oportunidad para que ignore cualquier etapa inicial o estado comercial enviado por cliente y siempre persista:
   etapa `Contacto Inicial`;
   estado comercial `En proceso`;
   estado de activación actual según permisos ya existentes.
3. Decide explícitamente si la API nueva vive sobre endpoints nuevos o sobre una extensión del recurso actual. Si mezclar todo en `PUT` degrada claridad, crea endpoints explícitos para:
   guardar respuestas de etapa;
   avanzar etapa;
   retroceder etapa;
   cerrar comercialmente.
4. Expón catálogos backend para:
   estados comerciales;
   preguntas configuradas por etapa;
   cualquier metadato necesario para renderizar el cuestionario actual.
5. Implementa lectura del contexto comercial de una oportunidad, incluyendo:
   etapa actual;
   estado comercial actual;
   preguntas activas de la etapa;
   respuestas históricas relevantes.
6. Implementa guardado de respuestas con histórico, de forma que una nueva captura no destruya la anterior y quede trazabilidad de quién respondió y cuándo.
7. Centraliza la validación de transición en helpers o lógica de dominio reutilizable, no dispersa en varios handlers. Esa validación debe cubrir:
   etapa actual;
   estado comercial actual;
   preguntas obligatorias completas;
   reglas de avance;
   reglas de retroceso;
   reglas de cierre.
8. Implementa avance de etapa solo si todas las preguntas obligatorias de la etapa actual están respondidas correctamente.
9. Implementa retroceso de etapa solo si la oportunidad sigue en `En proceso`.
10. Implementa cierre comercial con estas reglas:
    `Ganada` solo desde `Waiting`;
    `Perdida` desde cualquier etapa con motivo obligatorio;
    `Anulada` desde cualquier etapa con motivo obligatorio.
11. Bloquea cualquier transición adicional si la oportunidad ya está `Ganada`, `Perdida` o `Anulada`.
12. Define con claridad la respuesta de error de negocio cuando una transición no sea válida. No devuelvas errores ambiguos; el cliente debe saber exactamente qué regla falló.
13. Registra auditoría semántica para:
    guardado de respuestas;
    avance de etapa;
    retroceso de etapa;
    cierre comercial;
    cualquier cambio relevante en estado comercial.
14. Mantén compatibilidad con permisos existentes de lectura, creación, actualización y cambio de activación. El nuevo flujo comercial no debe abrir bypasses de autorización.

Subtareas backend sugeridas:

1. Extender catálogos y lecturas primero.
2. Ajustar creación de oportunidad después.
3. Implementar guardado de respuestas.
4. Implementar helpers de validación de transición.
5. Implementar endpoints de avanzar, retroceder y cerrar.
6. Integrar auditoría semántica al final.

Decisiones de contrato que debes dejar cerradas:

1. Qué endpoint devuelve el cuestionario vigente de una oportunidad.
2. Qué endpoint guarda respuestas sin mover etapa.
3. Qué endpoint ejecuta avance o retroceso.
4. Qué endpoint ejecuta cierre comercial.
5. Qué shape de payload usa respuestas por pregunta.
6. Qué shape de error devuelve una transición inválida.

Checks de consistencia que debes dejar resueltos:

1. Ningún cliente puede crear una oportunidad fuera de `Contacto Inicial` y `En proceso`.
2. Ningún cliente puede marcar `Ganada` fuera de `Waiting`.
3. Ningún cliente puede mover una oportunidad ya cerrada.
4. Ningún cliente puede avanzar sin responder obligatorios.
5. El estado de activación sigue separado del estado comercial.
6. La auditoría permite reconstruir el historial del flujo comercial.

Archivos probables:

- `apps/api/src/routes.opportunities.js`
- `apps/api/src/routes.catalogs.js`
- `apps/api/src/audit.js`

Validación mínima:

1. Crear oportunidad y comprobar etapa y estado iniciales.
2. Intentar avanzar sin respuestas completas y validar rechazo.
3. Avanzar con respuestas válidas.
4. Retroceder mientras siga En proceso.
5. Intentar Ganada antes de Waiting y validar rechazo.
6. Cerrar como Ganada desde Waiting.
7. Cerrar como Perdida o Anulada con motivo.
8. Confirmar que una oportunidad cerrada ya no se mueve.
9. Confirmar que el estado de activación no cambió por usar el flujo comercial.
10. Confirmar que la auditoría registra eventos suficientes del flujo.

Definición de terminado:

- Las reglas críticas viven en backend, son imposibles de saltar desde cliente y exponen un contrato lo bastante claro para que frontend implemente el flujo sin lógica duplicada.

## Tarea 3: Pruebas backend

Objetivo:
blindar el flujo comercial antes de abrir más superficie en UI.

Haz esto en este orden:

1. Identifica primero el setup mínimo reutilizable para crear:
   una oportunidad base válida;
   preguntas por etapa;
   respuestas completas o incompletas;
   usuarios con permisos suficientes;
   usuarios sin permisos suficientes cuando aplique.
2. Crea helpers o fixtures locales en la suite para no repetir armado de oportunidades, etapas, respuestas y cierres en cada test.
3. Agrega pruebas de creación asegurando que el backend siempre fuerce:
   `Contacto Inicial`;
   `En proceso`;
   separación correcta respecto al estado de activación.
4. Agrega pruebas de contrato negativo para confirmar que el cliente no puede imponer una etapa inicial o un estado comercial inicial arbitrarios.
5. Agrega pruebas de guardado de respuestas con histórico para verificar:
   que una nueva captura no borra la anterior;
   que las respuestas quedan asociadas a la etapa correcta;
   que el sistema conserva suficiente trazabilidad.
6. Agrega pruebas de avance de etapa con al menos estos casos:
   respuestas obligatorias completas;
   respuestas faltantes;
   oportunidad ya cerrada;
   intento de salto inválido si el backend lo prohíbe explícitamente.
7. Agrega pruebas de retroceso con al menos estos casos:
   retroceso válido mientras esté `En proceso`;
   rechazo si ya está `Ganada`;
   rechazo si ya está `Perdida`;
   rechazo si ya está `Anulada`.
8. Agrega pruebas de cierre comercial con al menos estos casos:
   `Ganada` desde `Waiting`;
   rechazo de `Ganada` fuera de `Waiting`;
   `Perdida` con motivo;
   `Perdida` sin motivo;
   `Anulada` con motivo;
   `Anulada` sin motivo.
9. Agrega pruebas de inmutabilidad del flujo una vez cerrada la oportunidad para confirmar que ya no se puede:
   avanzar;
   retroceder;
   volver a cerrar con otro estado si eso no está permitido por el contrato.
10. Agrega pruebas para garantizar que el estado de activación no se altera por usar endpoints del flujo comercial.
11. Agrega pruebas mínimas de autorización cuando el contrato nuevo reutilice permisos existentes, para confirmar que el flujo comercial no abrió bypasses.
12. Agrega pruebas de auditoría semántica para verificar que existan registros trazables al menos para:
    guardado de respuestas;
    avance de etapa;
    retroceso de etapa;
    cierre comercial.
13. Si el contrato de error fue definido en la Tarea 2, agrega pruebas que validen también mensajes o códigos de error suficientemente específicos para transiciones inválidas.

Matriz mínima de casos que no puede quedar sin cubrir:

1. Creación automática en `Contacto Inicial` y `En proceso`.
2. Rechazo de etapa inicial arbitraria.
3. Rechazo de estado comercial inicial arbitrario.
4. Guardado histórico de respuestas.
5. Avance válido con obligatorios completos.
6. Rechazo de avance por obligatorios incompletos.
7. Retroceso válido mientras esté `En proceso`.
8. Rechazo de retroceso cuando ya esté cerrada.
9. `Ganada` válida solo desde `Waiting`.
10. `Ganada` inválida fuera de `Waiting`.
11. `Perdida` requiere motivo.
12. `Anulada` requiere motivo.
13. Flujo comercial no altera estado de activación.
14. Auditoría del flujo existe y es suficiente.

Subtareas de prueba sugeridas:

1. Preparar fixtures y helpers.
2. Cubrir creación y contrato base.
3. Cubrir respuestas y avance.
4. Cubrir retroceso y cierres.
5. Cubrir autorización y auditoría.
6. Ejecutar suite y depurar duplicaciones o casos frágiles.

Checks de cobertura que debes dejar resueltos:

1. Todas las reglas cerradas del negocio tienen al menos una prueba positiva o negativa.
2. Las reglas de rechazo tienen al menos un test que pruebe el fallo explícitamente.
3. No dependes solo de happy paths.
4. La suite puede correr sobre base reconstruida sin orden manual de ejecución.
5. Las pruebas nuevas no dependen de datos residuales de otras suites.
6. Los helpers introducidos no esconden reglas importantes ni vuelven opaco el test.

Archivos probables:

- `apps/api/test/api.integration.test.js`

Validación mínima:

1. Ejecuta la suite de integración del API.
2. Confirma que los casos nuevos cubren creación, respuestas, avance, retroceso, cierre, activación y auditoría.
3. Si alguna prueba es inestable por timestamps u orden de eventos, estabilízala antes de cerrar.

Definición de terminado:

- El flujo crítico queda cubierto y estable, con pruebas suficientes para detectar regresiones de contrato y de reglas de negocio antes de tocar la UI.

## Tarea 4: Frontend operativo

Objetivo:
permitir operar el flujo comercial desde la UI sin confundir etapa, estado comercial y activación.

Haz esto en este orden:

1. Revisa cómo está resuelto hoy el CRUD de oportunidades en la UI y decide si el flujo comercial cabe razonablemente en el modal actual o si conviene extraer componentes nuevos antes de seguir agregando complejidad.
2. Separa de forma explícita en la UI estos tres conceptos, sin mezclarlos visual ni semánticamente:
   etapa operativa;
   estado comercial;
   estado de activación.
3. Define una zona visible de progreso comercial que muestre al menos:
   etapa actual;
   estado comercial actual;
   acciones disponibles según el estado;
   restricciones cuando la oportunidad ya esté cerrada.
4. Muestra el cuestionario correspondiente a la etapa actual consumiendo el catálogo del backend, no hardcodeando preguntas en frontend.
5. Decide explícitamente cómo representará la UI los tipos de pregunta definidos por backend. Si en esta fase solo existe un tipo de respuesta simple, deja el punto documentado para no crear una abstracción falsa.
6. Implementa carga del contexto comercial de la oportunidad incluyendo:
   etapa actual;
   estado comercial;
   preguntas activas;
   respuestas previas relevantes;
   historial mínimo si el diseño lo requiere.
7. Implementa guardado de respuestas con feedback claro al usuario:
   loading;
   éxito;
   error de validación;
   error de red.
8. Implementa acciones explícitas para:
   guardar respuestas sin mover etapa;
   avanzar etapa;
   retroceder etapa;
   cerrar como Ganada;
   cerrar como Perdida;
   cerrar como Anulada.
9. Asegura que la UI respete las reglas del backend también a nivel de affordance:
   deshabilita acciones inválidas;
   no muestres `Ganada` como opción si no está en `Waiting`;
   exige motivo para `Perdida` y `Anulada` antes de enviar;
   bloquea acciones de transición si la oportunidad ya está cerrada.
10. Mantén la edición de datos base de oportunidad separada del flujo comercial tanto como sea posible, para que el usuario entienda cuándo está editando datos y cuándo está moviendo el proceso.
11. Ajusta el listado de oportunidades para mostrar por separado:
    etapa operativa;
    estado comercial;
    estado de activación.
12. Agrega badges, labels y filtros coherentes con el nuevo modelo. El usuario debe poder distinguir rápidamente una oportunidad:
    activa pero perdida;
    en proceso;
    anulada;
    ganada.
13. Asegura que la UI reaccione correctamente a respuestas del backend cuando una transición sea inválida. Los mensajes de error deben reflejar la regla fallida y no quedarse en un genérico poco útil.
14. Si el archivo actual `App.jsx` se vuelve demasiado difícil de mantener, extrae componentes del flujo comercial en lugar de seguir acumulando lógica inline.

Subtareas frontend sugeridas:

1. Preparar estado local y mapeo del contrato backend.
2. Renderizar contexto comercial y cuestionario.
3. Implementar guardado de respuestas.
4. Implementar acciones de avanzar, retroceder y cerrar.
5. Ajustar listado, badges y filtros.
6. Refactorizar componentes si el modal actual queda demasiado cargado.

Decisiones de UX que debes dejar cerradas:

1. Dónde vive visualmente el progreso comercial dentro de la pantalla o modal.
2. Cómo se muestran las preguntas y respuestas previas.
3. Cómo se solicita el motivo para `Perdida` y `Anulada`.
4. Cómo se diferencia una acción de guardar respuestas de una acción de mover etapa.
5. Qué badges y filtros se exponen en el listado.
6. Qué feedback ve el usuario cuando el backend rechaza una transición.

Checks de consistencia que debes dejar resueltos:

1. La UI no vuelve a introducir `Ganada` como etapa operativa.
2. La UI no mezcla estado comercial con estado de activación.
3. La UI no permite aparentar transiciones que el backend siempre rechazará.
4. El cuestionario mostrado corresponde a la etapa actual real de la oportunidad.
5. Una oportunidad cerrada se ve cerrada y no expone acciones inválidas.
6. El listado refleja correctamente el nuevo modelo sin romper filtros existentes innecesariamente.

Archivos probables:

- `apps/web/src/App.jsx`

Validación mínima:

1. Prueba manual de creación y apertura de oportunidad con contexto comercial visible.
2. Prueba manual de guardado de respuestas.
3. Prueba manual de avance y retroceso.
4. Prueba manual de cierre a Ganada, Perdida y Anulada.
5. Verifica badges, filtros y labels del listado.
6. Verifica que una transición inválida muestre feedback útil sin romper la pantalla.

Definición de terminado:

- La UI permite operar el flujo sin violar reglas ni mezclar conceptos, y consume el contrato backend sin duplicar lógica crítica de negocio en frontend.

## Tarea 5: Configuración de preguntas

Objetivo:
permitir que las preguntas por etapa se administren desde la aplicación.

Haz esto en este orden:

1. Define primero el alcance real del módulo de administración de preguntas para no construir un “mini CMS” innecesario. En esta fase debe administrar preguntas por etapa, no un sistema genérico transversal para todo el producto.
2. Decide dónde vive esta administración dentro de la UI actual:
   como pantalla independiente;
   como submódulo dentro de catálogos;
   como panel asociado al flujo comercial.
3. Diseña una vista que permita navegar claramente por etapas y ver las preguntas de cada una en orden. El usuario debe entender rápido qué preguntas pertenecen a cada etapa sin recorrer formularios ambiguos.
4. Implementa listado por etapa mostrando al menos:
   orden;
   texto de la pregunta;
   tipo de respuesta;
   obligatoriedad;
   estado activa/inactiva.
5. Implementa creación de preguntas nuevas con validaciones mínimas de frontend alineadas al contrato backend:
   etapa obligatoria;
   texto obligatorio;
   tipo válido;
   orden válido o estrategia automática de orden;
   obligatoriedad.
6. Implementa edición de preguntas existentes sin perder claridad sobre qué campos son editables y qué cambios impactan inmediatamente al flujo comercial.
7. Implementa activación y desactivación sin borrar historial ni romper preguntas ya respondidas en oportunidades existentes.
8. Implementa reordenamiento de preguntas dentro de una etapa. Si el backend define el orden como entero explícito, la UI debe reflejarlo con claridad y resolver colisiones de orden de forma consistente.
9. Asegura que el módulo de oportunidades consuma el catálogo actualizado después de cambios administrativos sin necesidad de recargar manualmente toda la aplicación, salvo que el contrato actual lo obligue.
10. Si el backend soporta diferentes tipos de respuesta, deja la UI preparada para renderizarlos de forma comprensible, pero sin sobre-abstractar si hoy solo hay uno o pocos tipos reales.
11. Expón claramente al usuario qué cambios son estructurales para el flujo actual y qué cambios solo afectan preguntas futuras, especialmente si existe histórico persistido.
12. Maneja feedback de operación para crear, editar, activar, desactivar y reordenar:
    loading;
    éxito;
    error de validación;
    error de concurrencia si aplica;
    error de red.

Subtareas frontend sugeridas:

1. Preparar navegación y estado del módulo de administración.
2. Renderizar listado por etapa.
3. Implementar formulario de alta y edición.
4. Implementar activar o desactivar.
5. Implementar reordenamiento.
6. Integrar refresco o invalidación del catálogo consumido por oportunidades.

Decisiones de UX que debes dejar cerradas:

1. Cómo selecciona el usuario la etapa a administrar.
2. Cómo se distingue una pregunta activa de una inactiva.
3. Cómo se resuelve el orden de preguntas en alta y reordenamiento.
4. Cómo se editan preguntas sin confundir al usuario sobre el impacto en oportunidades.
5. Qué feedback ve el usuario cuando una operación administrativa falla.
6. Cómo refleja oportunidades un cambio reciente del catálogo.

Checks de consistencia que debes dejar resueltos:

1. No se pueden crear preguntas sin etapa válida.
2. No se pueden crear preguntas sin texto suficiente.
3. No se puede dejar un orden inconsistente dentro de una etapa.
4. Desactivar una pregunta no destruye histórico previo.
5. El módulo de oportunidades consume el catálogo actualizado sin quedar desfasado innecesariamente.
6. La UI de administración no introduce tipos o estados que el backend no reconozca.

Archivos probables:

- `apps/web/src/App.jsx`

Validación mínima:

1. Crea una pregunta en una etapa válida.
2. Edita una pregunta existente.
3. Desactiva una pregunta y valida que ya no aparezca como activa en oportunidades.
4. Cambia el orden y valida el reflejo en oportunidades.
5. Verifica mensajes de error útiles para operaciones inválidas o fallidas.

Definición de terminado:

- El negocio puede ajustar el cuestionario sin tocar código, con operaciones claras, consistentes y alineadas al contrato backend, y el módulo de oportunidades refleja esos cambios sin ambigüedad.

## Tarea 6: E2E y documentación

Objetivo:
cerrar el flujo con pruebas visibles y documentación mínima suficiente.

Haz esto en este orden:

1. Define primero qué parte del flujo cubrirás con pruebas E2E y qué parte puede quedarse validada por pruebas frontend o integración ya existentes. No dupliques cobertura sin valor, pero tampoco dejes sin cubrir el flujo visible del usuario.
2. Identifica el camino crítico mínimo que debe quedar automatizado de punta a punta en UI:
   abrir una oportunidad;
   visualizar etapa, estado comercial y activación;
   responder preguntas;
   avanzar etapa;
   retroceder etapa;
   cerrar comercialmente.
3. Agrega pruebas E2E o frontend visibles para el flujo principal, priorizando estabilidad sobre exhaustividad visual. Si una prueba UI cubre una regla ya blindada en backend, enfócala en experiencia de usuario, no en repetir la misma lógica interna.
4. Cubre explícitamente al menos estos escenarios visibles:
   render correcto del contexto comercial;
   guardado de respuestas con feedback;
   avance exitoso;
   rechazo visible por respuestas incompletas;
   retroceso válido;
   cierre a Ganada desde Waiting;
   cierre a Perdida con motivo;
   cierre a Anulada con motivo;
   ocultamiento o deshabilitación de acciones inválidas cuando la oportunidad ya está cerrada.
5. Si el módulo de administración de preguntas ya existe en esta fase, agrega al menos un escenario visible que demuestre que un cambio de catálogo se refleja en el flujo de oportunidades.
6. Mantén las pruebas E2E estables:
   evita selectores frágiles;
   evita depender de orden incidental de datos;
   controla datos semilla o mocks cuando corresponda;
   reduce pasos redundantes.
7. Actualiza la documentación funcional del módulo de oportunidades para explicar:
   las 7 etapas operativas;
   los 4 estados comerciales;
   la diferencia con el estado de activación;
   reglas de avance, retroceso y cierre;
   motivo obligatorio para Perdida y Anulada.
8. Actualiza el README del proyecto con un resumen suficiente del nuevo flujo comercial y sus capacidades visibles.
9. Si hubo decisiones técnicas relevantes que no son obvias, deja la documentación lo bastante clara para que otro desarrollador no tenga que reconstruirlas leyendo todo el código o el historial del PR.

Matriz mínima de escenarios visibles que no puede quedar sin cubrir:

1. Visualización de etapa, estado comercial y activación en la UI.
2. Guardado de respuestas de etapa con feedback visible.
3. Avance válido de etapa.
4. Rechazo visible de avance inválido.
5. Retroceso válido mientras esté En proceso.
6. Cierre como Ganada desde Waiting.
7. Cierre como Perdida con motivo.
8. Cierre como Anulada con motivo.
9. Bloqueo visual de acciones cuando la oportunidad ya está cerrada.
10. Reflejo del catálogo actualizado si la administración de preguntas ya forma parte del alcance implementado.

Subtareas sugeridas:

1. Estabilizar datos de prueba del flujo comercial.
2. Implementar escenarios E2E del camino crítico.
3. Cubrir errores visibles y estados deshabilitados.
4. Actualizar documentación funcional.
5. Actualizar README.
6. Ejecutar pruebas y corregir fragilidad de selectores o tiempos.

Decisiones que debes dejar cerradas:

1. Qué escenarios quedan en E2E y cuáles en pruebas frontend menores.
2. Qué datos de prueba usa el flujo comercial en UI.
3. Qué selectores se consideran estables para el módulo.
4. Qué nivel de detalle funcional debe quedar en README y cuál en documentación interna.

Checks de consistencia que debes dejar resueltos:

1. La documentación no vuelve a mezclar etapa, estado comercial y activación.
2. Las pruebas E2E no dependen de estados accidentales del ambiente.
3. Los escenarios visibles críticos están automatizados al menos una vez.
4. Las pruebas no quedan tan frágiles que fallen por orden incidental o timings evitables.
5. README y documentación funcional describen las mismas reglas esenciales sin contradicciones.

Archivos probables:

- `apps/web/e2e/contacts-opportunities.spec.js`
- `readme/oportunidades.md`
- `README.md`

Validación mínima:

1. Ejecuta pruebas frontend o E2E relacionadas con oportunidades.
2. Confirma que cubren al menos el camino crítico visible del flujo comercial.
3. Revisa documentación actualizada y valida que describe correctamente etapa, estado comercial y activación.
4. Si alguna prueba es frágil por selectores o tiempos, estabilízala antes de cerrar.

Definición de terminado:

- El flujo queda cubierto por pruebas visibles suficientemente estables, documentado sin contradicciones y entendible para otro desarrollador sin necesidad de reconstruir el diseño desde el código.

## Checklist final

1. Crear oportunidad siempre inicia en Contacto Inicial.
2. Crear oportunidad siempre inicia en En proceso.
3. Ganada ya no existe como etapa operativa.
4. Ganada solo puede aplicarse desde Waiting.
5. Perdida y Anulada exigen motivo.
6. El retroceso solo funciona mientras la oportunidad esté En proceso.
7. Una oportunidad cerrada ya no puede moverse.
8. Las preguntas son configurables desde la aplicación.
9. Existe histórico de respuestas por etapa.
10. La UI distingue correctamente etapa, estado comercial y activación.
11. El backend valida las reglas aunque el frontend intente saltárselas.
12. Hay pruebas suficientes para el flujo crítico.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
