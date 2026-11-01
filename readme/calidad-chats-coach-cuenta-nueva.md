# Calidad de los chats de Coach y Cuenta nueva

Medición propia de Coach y Cuenta nueva. Es independiente de la de Cliente existente: usa sus propias tablas, rutas y pantalla, y no modifica ningún archivo de ese chat.

## Qué se mide

| Fuente | Qué es | Cómo se registra | Umbral inicial |
| --- | --- | --- | --- |
| Laboratorio (`lab`) | Casos deterministas, sin IA ni costo, sobre entidades, búsqueda, respuestas de la sesión y reglas de operaciones | `npm run quality:lab --workspace=apps/api -- --channel=coach\|prospect` | 90% de los casos |
| IA real (`live`) | Reservada para un banco con proveedor real (todavía no existe) | — | 85% de los casos |
| Producción (`production_monitor`) | Turnos y valoraciones reales de los últimos 7 días | Automático una vez al día o con **Actualizar monitoreo de producción** | 90% de turnos sin fallo, 75% de valoraciones positivas (con al menos 5), p95 ≤ 30 s |

Los umbrales son iniciales y deben ajustarse cuando cada canal tenga una línea base medida con uso real. Cada ejecución queda como **Dentro del umbral**, **Bajo el umbral** o **Bajó frente a la anterior** (cae 5 puntos o más frente a la ejecución anterior del mismo canal y fuente).

### Casos del laboratorio

- Coach: `apps/api/src/channel-quality/lab/coach-cases.json` (32 casos).
- Cuenta nueva: `apps/api/src/channel-quality/lab/prospect-cases.json` (30 casos).
- Los casos con `knownGap` documentan un comportamiento que hoy es incorrecto (por ejemplo, que mencionar la cuenta no desambigüe dos oportunidades con el mismo nombre). No cuentan en la nota principal; se reportan aparte como **Brechas conocidas corregidas**. Cuando una brecha se corrige, su prueba falla a propósito: se quita `knownGap` para que el caso pase a la nota principal.
- Pruebas: `test/coach-evaluation-matrix.test.js` y `test/prospect-evaluation-lab.test.js`.

## Dónde se ve

**Mi Agente > Calidad Coach y Cuenta nueva** (permiso `mi_coach.evaluations_read`; actualizar el monitoreo requiere `mi_coach.evaluations_execute`). Muestra, por canal, el último resultado de cada fuente, su tendencia y las ejecuciones recientes.

## Valoraciones de las respuestas

Cada respuesta de Coach y de Cuenta nueva muestra 👍/👎. Se guardan en `coach_turn_quality_traces` (`feedback_rating`) mediante `POST /api/mi-agent/coach/quality/:traceId/feedback`, y alimentan la satisfacción del monitoreo de producción.

## Informe de uso

```text
npm run report:chat-channels --workspace=apps/api -- [--days=30 | --since=YYYY-MM-DD] [--json]
```

Es de solo lectura. Para cada canal (Cliente existente solo como referencia) muestra sesiones, turnos, errores, aclaraciones, latencia y valoraciones. Ejecútalo con el entorno de producción para decidir dónde invertir.

## Implementación

- Tabla: `chat_channel_quality_runs` (se crea sola). Canales permitidos: `coach` y `prospect`.
- Código: `apps/api/src/channel-quality/` (`gates.js`, `store.js`, `production-monitor.js`, `usage.js`, `routes.js`, `lab/`).
- Rutas: `GET /api/mi-agent/channel-quality/:channel` y `POST /api/mi-agent/channel-quality/:channel/production-snapshot`.
- El monitoreo diario arranca con el servidor (`startChannelQualityMonitorWorker`).
- Pantalla: `apps/web/src/coach/ChannelQualityPanel.jsx`.
- `apps/api/test/channel-write-paths.test.js` audita que los chats de Coach y Cuenta nueva no escriban en tablas de negocio y que las conversiones y operaciones requieran confirmación.

## Alcance y límites

- No se modifica Cliente existente ni el motor compartido que importa (`coach/conversation-engine.js`, `coach/channel-intents.js`, `coach/operation-contract.js`, etc.).
- Por eso las mejoras que viven en el motor compartido (ventana de mensajes, memoria de peticiones anteriores, guardas de campos) no se llevaron a estos canales.
