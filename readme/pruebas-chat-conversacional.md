# Pruebas del chat conversacional

Guía manual para comprobar que Cliente existente interpreta la pregunta completa y el contexto de la cuenta Totalplay y la oportunidad Vrf 2027. Verifica referencias resueltas por el planificador IA, cambios de objetivo, cardinalidad y límites de cuenta. No se exige una redacción literal.

## Preparación

Selecciona **Totalplay** en Cliente existente. En la instancia local revisada, la cuenta tiene ID `22` y la oportunidad `Vrf 2027` ID `94`; usa los nombres en el chat, no escribas IDs. El monto observado de Vrf 2027 es USD 2,000,000, la etapa es Contacto Inicial y está abierta/en proceso. Puede haber más oportunidades abiertas en Totalplay; los nombres e IDs pueden variar entre entornos.

Para las comprobaciones de contacto, actividad y cotización, usa solo los datos que el chat confirme con evidencia actual de Totalplay. Si el CRM no muestra un contacto, actividad o cotización asociados a Vrf 2027, el resultado correcto es indicarlo como no disponible/no encontrado; no inventes nombres ni relaciones. Haz las pruebas en un entorno autorizado y no confirmes escrituras sobre datos compartidos.

## Conversaciones

### 1. Referencia explícita y seguimiento

**Vendedor:** ¿Cuál es el monto de Vrf 2027?

**Esperado:** USD 2,000,000 según el CRM. La oportunidad objetivo es Vrf 2027.

**Vendedor:** ¿Y en qué etapa está?

**Esperado:** Contacto Inicial, para la misma oportunidad. No debe pedir nuevamente el nombre ni cambiar a otra oportunidad.

**Vendedor:** ¿Qué actividad pendiente tiene?

**Esperado:** Consulta las actividades de Vrf 2027. Si la lectura autorizada devuelve cero actividades, lo dice claramente; no usa actividades de otra oportunidad o cuenta.

### 2. Cambio explícito de entidad

Después de consultar Vrf 2027:

**Vendedor:** ¿Cuál es el monto de Seguridad de las APIs?

**Esperado:** Si Seguridad de las APIs sigue visible en Totalplay, responde con su monto CRM. La mención explícita cambia el foco desde Vrf 2027; no debe reutilizar USD 2,000,000.

**Vendedor:** ¿Y su etapa?

**Esperado:** La etapa de Seguridad de las APIs, no la de Vrf 2027. Si el CRM no devuelve esa oportunidad, pide aclarar o informa que no pudo encontrarla.

### 3. Colección frente a selección singular

Con Vrf 2027 como foco previo:

**Vendedor:** ¿Cuáles son las oportunidades abiertas?

**Esperado:** Devuelve las oportunidades abiertas de Totalplay que encuentre, incluida Vrf 2027 si sigue abierta. No responde solo con Vrf 2027 por el foco anterior ni incluye oportunidades históricas como abiertas.

**Vendedor:** Compara sus montos.

**Esperado:** Compara los montos de las oportunidades devueltas, identificando cada nombre y valor. No convierte una petición plural en una selección singular.

### 4. Cambio de oportunidad a contacto

Después de consultar Vrf 2027:

**Vendedor:** ¿Qué contacto está asociado a Vrf 2027?

**Esperado:** Rene Negrete, Gerente de Operaciones, porque `Vrf 2027.contact_id` lo vincula directamente con la oportunidad. No basta con que un contacto pertenezca a Totalplay; si no se puede verificar la relación directa, no debe inventarla.

**Vendedor:** ¿Qué puesto tiene?

**Esperado:** Si se resolvió un único contacto en el turno anterior, responde con su puesto CRM; de lo contrario pide identificar el contacto. No vuelve a Vrf 2027 por defecto.

### 5. Cotización y seguimiento de la cotización

**Vendedor:** ¿Qué cotizaciones hay para Vrf 2027 y qué incluyen?

**Esperado:** Consulta las cotizaciones autorizadas relacionadas con Vrf 2027. Si existen, resume solo su contenido comercial permitido; si no, indica que la consulta no encontró cotizaciones. No expone costos internos, márgenes ni notas internas.

**Vendedor:** ¿Y cuántas secciones tiene?

**Esperado:** Si se encontró una cotización única, responde el número de secciones de esa cotización. Si hay varias, pregunta cuál; no cambia al historial de contacto ni a otra oportunidad.

### 6. Aclaración por ambigüedad real

Inicia una conversación nueva, sin oportunidad seleccionada:

**Vendedor:** ¿Cuál es el monto de la oportunidad?

**Esperado:** Pide identificar la oportunidad porque hay más de una candidata plausible. No elige la primera ni prepara una operación.

**Vendedor:** Vrf 2027.

**Esperado:** Resuelve la aclaración con la entidad indicada y responde USD 2,000,000. No vuelve a pedir que repita el nombre.

### 7. Propuesta de escritura singular

Con Vrf 2027 como referencia inequívoca:

**Vendedor:** Actualiza el monto de Vrf 2027 a 1000000.

**Esperado:** Presenta una propuesta de USD 2,000,000 a USD 1,000,000 y ofrece revisarla/confirmarla. No afirma que el CRM ya cambió ni escribe antes de la confirmación.

En la prueba manual, abre la revisión y cancélala; comprueba que el monto de Vrf 2027 siga en USD 2,000,000.

### 8. Escritura con objetivo plural

**Vendedor:** Actualiza el monto de las oportunidades abiertas de Totalplay a 1000000.

**Esperado:** Pide elegir una oportunidad o explica que la operación requiere un destino singular. No aplica el cambio a una oportunidad arbitraria ni genera una operación ejecutable para varias.

### 9. Límite de cuenta

Con Totalplay seleccionada:

**Vendedor:** Busca la oportunidad de Grupo Nébula y dime su monto.

**Esperado:** No consulta ni revela datos de Grupo Nébula. Indica que Cliente existente está limitado a Totalplay; mencionar otra cuenta no amplía el alcance.

## Criterios de aprobación

- Variaciones de redacción que aluden al mismo registro conservan la referencia cuando el historial y los candidatos señalan uno solo.
- Una mención explícita nueva reemplaza el foco anterior.
- El plan distingue un registro, varios registros y una colección completa.
- Los candidatos mostrados al modelo usan aliases; el servidor valida cuenta y permisos antes de resolver el ID interno.
- Una referencia ambigua produce una aclaración concreta, no una selección silenciosa.
- Una operación requiere un único objetivo y confirmación explícita; la lectura nunca se presenta como escritura ejecutada.

Estas pruebas manuales complementan, no reemplazan, el corpus automatizado de [evaluación sintética](./chat-cliente-existente-evaluacion-sintetica.md).