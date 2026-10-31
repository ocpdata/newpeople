# Rendimiento y costo del chat de Cliente existente

## Qué se midió

El reporte `npm run report:customer-chat:metrics --workspace=apps/api` (opciones `--days=N` o `--since=AAAA-MM-DD`, `--json`, `--output=archivo.json`) lee `customer_intelligence_jobs` y `ai_usage_ledger`. La línea base de octubre de 2026 (176 turnos en 90 días) mostró:

| Medida | Línea base |
| --- | --- |
| Turnos fallidos | 5,1% |
| Latencia de turnos completados (p50 / p90 / p95) | 6,7 s / 13,7 s / 19,4 s |
| Llamadas al proveedor por turno | 3,8 en promedio, 8 como máximo |
| Tiempo del turno esperando al proveedor | 95% (el resto es CRM y procesamiento) |
| Costo por turno completado | USD 0,008 |
| Tokens de entrada servidos desde caché | 8,2% |

Conclusiones:

- **Casi todo el tiempo es espera de modelos y es secuencial.** Optimizar consultas a la base o código propio casi no cambia la latencia.
- **El costo está en la interpretación (`account_chat.intent`):** unos 14.000 tokens de entrada por llamada, el 66% del costo total. Casi nada se reutilizaba de la caché.
- **La cola lenta (p95) son las consultas del analista** (`dossier_analyst`, entre 5 y 34 s con `gpt-6.1-sol`).

## Cambios incluidos

1. **Clave de caché de prompts.** Cada llamada estructurada envía `prompt_cache_key` por función. En una prueba con el código real, la interpretación pasó de 0% a 91% de tokens en caché (22.400 de 24.650) y de 2,9 s a 1,8–2,0 s. Solo se envía a `api.openai.com`; para desactivarla, `OPENAI_PROMPT_CACHE_KEY=false`. La clave aplica a todas las funciones que usan `runStructuredWebResearch`, no solo al chat.
2. **Retención de la caché (opcional, normalmente innecesaria).** `OPENAI_PROMPT_CACHE_RETENTION=24h` pide la retención extendida de OpenAI. Según su documentación, para los modelos anteriores a GPT-5.6 (como `gpt-4.1-mini`) las organizaciones **sin retención cero de datos ya usan 24h por defecto**, así que normalmente no cambia nada; con retención cero de datos, el valor por defecto es `in_memory` (5–10 minutos). No es el control de `gpt-6.1-sol` (familia GPT-5.6 y posteriores): allí la duración se elige con `prompt_cache_options.ttl` (`30m` o `12h`) y la escritura en caché cuesta 1,25× (30 min) o 2,5× (12 h) la entrada normal, por lo que no se activó. Lo que OpenAI guarda en caché son tensores clave-valor cifrados, no el texto. Verifica la política de tu organización antes de fijar un valor; el efecto real se ve en el porcentaje de "prompt en caché" del reporte.
3. **Cancelar detiene las llamadas en curso.** Antes, cancelar un turno solo ocultaba su resultado y el proveedor seguía trabajando (con su costo). Ahora el turno corre dentro de un contexto ([turn-context.js](../apps/api/src/commercial-intelligence/turn-context.js)) y cancelar aborta de inmediato la llamada en vuelo; si la cancelación ocurre en otro proceso, el turno la detecta en menos de 2 s.
4. **Límites por turno.** Un turno que supera `CUSTOMER_CHAT_MAX_LLM_CALLS_PER_TURN` llamadas (16 por defecto; el máximo medido es 8) o `CUSTOMER_CHAT_MAX_TURN_MS` (180000 ms por defecto) se detiene con un mensaje claro y no puede seguir gastando.
5. **Reporte ampliado:** porcentaje en caché por función, costo por turno, proporción del turno esperando al proveedor y `--since` para medir solo el tráfico posterior a un cambio.

## Cómo comprobar el efecto

Después de desplegar, deja correr tráfico real y compara:

```bash
npm run report:customer-chat:metrics --workspace=apps/api -- --since=AAAA-MM-DD
```

El indicador es "prompt en caché" y el costo por turno de `account_chat.intent`. La caché depende del tráfico: con pocos turnos por hora y sin retención extendida, muchos turnos seguirán siendo "fríos".

## Lo que no se cambió y por qué

Estas mejoras alteran el comportamiento del modelo y necesitan evaluación con casos reales y revisión humana antes de adoptarse:

- **Reducir el prompt de interpretación** (unos 80.000 caracteres de reglas más un esquema de 35.000): bajaría costo y latencia, pero es la pieza más ajustada del chat. Se debe validar con la evaluación live de interpretación (umbrales en [evaluacion-live-chat-cliente-existente.md](./evaluacion-live-chat-cliente-existente.md)).
- **Bajar el esfuerzo de razonamiento o el modelo del analista** (`OPENAI_ANALYST_*`): reduciría la cola de 15–34 s, con riesgo de respuestas menos completas. Requiere comparar respuestas en el laboratorio de pruebas.
- **Evitar la llamada de selección de datos (`snapshot_selection`, ~1 s en cada turno)** con reglas deterministas: ahorra un segundo, pero puede omitir el historial de contactos o el catálogo cuando se necesitan.
- **Segunda llamada de revisión de la interpretación** (en la mayoría de las acciones): es un control de seguridad; no se elimina sin evidencia.
