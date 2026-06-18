# Cotizaciones - Politicas y reglas de validacion con IA

## Objetivo

Definir las politicas funcionales para aprobar cotizaciones con IA, validando en linea contra uno o varios documentos adjuntos de proveedor, sin depender de una importacion previa de productos.

## Alcance

Estas reglas aplican al flujo de `aprobar` cuando `approvalMode = with_ai`.

No aplican a:

- aprobacion sin IA (`approvalMode = without_ai`);
- acciones de workflow distintas a `aprobar`;
- validaciones de otros modulos.

## Principios funcionales

- La evidencia de respaldo debe venir de documentos adjuntos a la version de cotizacion.
- La validacion debe ser en linea al momento de aprobar.
- No se debe exigir que exista una importacion aplicada en historial.
- Los items de Access Quality no se revisan en este flujo.
- Solo los items revisables pueden bloquear la aprobacion por respaldo o costo proveedor.

## Definiciones

### Item revisable

Item de cotizacion que cumple todo lo siguiente:

- `itemType != grupo_productos`;
- proveedor distinto de Access Quality;
- tiene `productCode` valido para buscar evidencia directa en documentos adjuntos.

### Item excluido

Item que no participa en validacion de respaldo/costo proveedor:

- items de Access Quality;
- `grupo_productos` padre (la evaluacion se hace sobre lineas reales revisables).

### Documento elegible

Documento adjunto a la version de cotizacion con:

- `ai_enabled = true`;
- no eliminado.

## Regla de exclusion Access Quality

Si un item pertenece a Access Quality, ese item queda fuera de:

- validacion de existencia en documentos proveedor;
- validacion de costo proveedor;
- conteo de faltantes y bloqueos de respaldo.

Notas:

- La exclusion se decide por proveedor del item (no por texto detectado en un documento).
- Los aliases de nombre de Access Quality deben normalizarse y tratarse como el mismo proveedor.

## Politica de evidencia en linea (existencia)

Para cada item revisable, el sistema debe validar existencia en los documentos elegibles de la version:

1. Construir conjunto de documentos elegibles de la version actual.
2. Extraer evidencia por documento (IA + fallback deterministico).
3. Consolidar evidencia entre todos los documentos.
4. Marcar item como respaldado si existe match valido por codigo/proveedor.

### Fuentes de evidencia aceptadas por item

- Match exacto de codigo de proveedor.
- Match por codigo normalizado (sin separadores/formato).
- Match por similitud alta de codigo, con umbral definido.
- Match por variante de codigo equivalente (ejemplo: prefijo duplicado en el SKU).

### Regla multi-documento

Un item puede respaldarse en cualquiera de los documentos elegibles.

No se requiere que todos los items aparezcan en el mismo documento.

## Politica de costos en linea

Para cada item revisable y respaldado:

1. Ubicar el renglon del documento donde aparece el `productCode` del item.
2. Extraer montos de ese renglon (admite enteros y decimales; descarta porcentajes).
3. Si hay varios montos (ejemplo: MSRP, reseller, total), seleccionar el monto mas cercano al costo cotizado.
4. Si en el renglon no hay monto, buscar en una ventana corta de contexto y marcar evidencia de baja confianza.
5. Comparar el costo seleccionado contra costo cotizado con tolerancia tecnica.

Resultado:

- si el costo coincide dentro de tolerancia: valida;
- si excede tolerancia con evidencia de alta confianza: bloqueo por descuadre de costo proveedor;
- si excede tolerancia con evidencia de baja confianza: advertencia (no bloqueo), requiere revision manual.

## Reglas de bloqueo

### Bloqueo por evidencia insuficiente

Bloquear cuando exista al menos un item revisable sin respaldo documental valido.

### Bloqueo por costo no conforme

Bloquear cuando exista al menos un item revisable respaldado con descuadre de costo fuera de tolerancia y evidencia de alta confianza.

### Bloqueo por falta de documentos elegibles

Bloquear si hay items revisables y no hay documentos elegibles para validarlos.

## Reglas de advertencia (no bloqueo)

Emitir advertencia cuando:

- la extraccion parcial de un documento falle, pero exista evidencia suficiente en otros documentos;
- exista descuadre de costo con evidencia ambigua (baja confianza);
- no se detecte costo directo para un item respaldado por codigo;
- existan datos comerciales secundarios incompletos que no afecten existencia/costo de items revisables.

## Mensajeria funcional esperada

Los mensajes deben describir causa real y accion esperada.

Ejemplos de causa real:

- item revisable no encontrado en documentos;
- descuadre de costo proveedor en item revisable;
- no hay documentos elegibles para items revisables.

No debe mostrarse un mensaje de Access Quality cuando el problema real sea otro.

## Trazabilidad y auditoria

Al aprobar o rechazar por politicas IA, registrar:

- documentos usados en validacion;
- items revisables evaluados;
- items excluidos por Access Quality;
- items respaldados/no respaldados;
- comparativas de costo y tolerancias aplicadas;
- nivel de confianza de evidencia de costo por item y snippet usado;
- reglas de bloqueo/advertencia activadas.

## Prioridad de reglas

1. Exclusion de Access Quality.
2. Determinacion de items revisables.
3. Evidencia documental en linea por item revisable.
4. Validacion de costo en linea por item revisable respaldado.
5. Decision final de bloqueo o aprobacion.

## Criterios de aceptacion

- Si todos los items revisables existen en documentos elegibles y los costos coinciden, la aprobacion con IA procede.
- Si faltan items revisables en documentos, se bloquea con detalle por item.
- Si hay descuadre de costo en items revisables, se bloquea con detalle por item.
- Si el descuadre proviene de evidencia de baja confianza, no bloquea y se reporta como recomendacion.
- Los items de Access Quality no influyen en bloqueos de respaldo/costo proveedor.
- La evaluacion funciona aunque no exista importacion aplicada historica.

## Casos de prueba minimos

- Solo items Access Quality: no debe bloquear por respaldo/costo proveedor.
- Mixto Access Quality + otro proveedor: solo se revisa el proveedor no Access Quality.
- Varios documentos adjuntos: respaldo distribuido entre documentos debe pasar.
- Sin importacion historica, con adjuntos validos: debe pasar si hay evidencia y costo conforme.
- Con evidencia de existencia pero costo fuera de tolerancia: debe bloquear por costo.
- Documento con multiples columnas de monto en la misma fila (MSRP, descuento, reseller, total): debe tomar el monto comparable al costo cotizado, no bloquear por columna incorrecta.

## Ejemplo operativo (cotizacion 23)

Escenario real validado en desarrollo para documentar el criterio de costo directo por codigo.

### Item 1

- Codigo cotizado: `F5-F5-BIG-LTM-VE200MV23`
- Costo cotizado: `7142.00`
- Evidencia de linea en documento proveedor: `7142 | 39.00% | 4356.62 | 1 | 4356.62`
- Candidatos monetarios detectados: `7142`, `4356.62`, `4356.62`.
- Regla aplicada: elegir el monto mas cercano al costo cotizado.
- Costo seleccionado para comparar: `7142.00`.
- Resultado esperado: sin bloqueo por costo para este item.

### Item 2

- Codigo cotizado: `F5-SVC-BIG-VE+PREL13`
- Costo cotizado: `1214.14`
- Evidencia de linea en documento proveedor: `1214.14 | 12.00% | 1068.44 | 1 | 1068.44`
- Candidatos monetarios detectados: `1214.14`, `1068.44`, `1068.44`.
- Regla aplicada: elegir el monto mas cercano al costo cotizado.
- Costo seleccionado para comparar: `1214.14`.
- Resultado esperado: sin bloqueo por costo para este item.

### Nota de implementacion

- El parser de montos debe aceptar enteros y decimales.
- Los porcentajes (`%`) se excluyen del conjunto de candidatos de costo.
- Si la evidencia es de baja confianza (monto no detectado en la misma linea del codigo), el descuadre se reporta como advertencia y no como bloqueo.
