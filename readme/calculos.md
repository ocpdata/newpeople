# Calculos del CRM

Este documento resume las formulas que usa la aplicacion para mostrar tasas, promedios y objetivos operativos.

## Principios generales

- Cuando existe un valor calculado reciente, la UI debe preferir ese valor.
- Cuando no hay base suficiente para calcular, se usa el valor configurado en la planeacion comercial.
- Para el calculo de metas, una tasa calculada en `0` se trata como no utilizable y se reemplaza por la tasa configurada.
- Las tasas se expresan como decimales entre `0` y `1` en backend y como porcentaje en UI.

## Conversion de leads a oportunidades

La pantalla de ritmo comercial calcula la conversion de leads a oportunidad usando los ultimos 20 leads del vendedor, o menos si todavia no llega a 20.

Formula base:

```text
conversion = leads calificados / total de leads considerados
```

Regla operativa:

- se consideran solo los ultimos 20 leads del vendedor, o menos si no tiene 20;
- la tasa se calcula como leads calificados entre total de leads considerados;
- si la tasa calculada existe (incluyendo `0`), se muestra esa tasa calculada;
- solo si no se puede calcular (por ejemplo, no hay leads considerados), se muestra el valor configurado del vendedor;
- la relacion configurada se almacena como `leads_to_opportunities_ratio` y se transforma a tasa equivalente cuando se necesita mostrarla como conversion.

Regla para metas:

- para calcular `leadTargetCount`, si la tasa calculada de leads a oportunidad es `0` o no es calculable, se usa `leads_to_opportunities_ratio`;
- la meta de leads se calcula como `objetivo_oportunidades / tasa_leads_a_oportunidad_efectiva`;
- el resultado de meta de leads se redondea hacia arriba (`ceil`).

## Conversion de oportunidades a ventas

Esta es la tasa que se usa para medir el cierre comercial del vendedor.

Regla operativa:

- se toman las ultimas 20 oportunidades del vendedor;
- si tiene menos de 20, se usan todas las que tenga;
- se consideran solo oportunidades activas;
- se excluyen oportunidades anuladas;
- la conversion se calcula como `ganadas / total de oportunidades consideradas`.

Formula base:

```text
conversion = oportunidades ganadas / oportunidades totales consideradas
```

Regla de respaldo:

- si no existe base suficiente para calcular la tasa,
  se usa el valor configurado en `commercial_planning_seller_parameters.opportunities_to_wins_ratio`.

Regla para metas:

- para calcular `opportunityCreatedTargetCount`, si la tasa calculada de oportunidades a venta es `0` o no es calculable, se usa `opportunities_to_wins_ratio`.

## Ticket promedio de venta

El ticket promedio que ve el vendedor se obtiene de la media de las ultimas ventas ganadas.

Regla operativa:

- se toma el promedio de los ultimos 10 cierres ganados;
- si no hay ventas recientes, se usa `average_sale_ticket_amount` configurado;
- si tampoco hay configuracion, el valor final es `0`.

Formula base:

```text
ticket_promedio = promedio de los ultimos 10 cierres ganados
```

## Tiempo de Oportunidad a Venta (O→V)

Este metrica mide el promedio de dias que tarda una oportunidad desde que entra en etapa "desarrollo" hasta que se cierra como venta ganada.

Regla operativa:

- se toman las ultimas 20 oportunidades ganadas del vendedor;
- si tiene menos de 20, se usan todas las que tenga;
- se considera solo oportunidades con estatus `activada` y comercial `ganada`;
- para cada oportunidad:
  - si tiene registro en `audit_log` de cuando entro a etapa "desarrollo": se calcula como `DATEDIFF(commercial_closed_at, fecha_entrada_desarrollo)`;
  - si NO tiene registro en auditoría: se usa `120 días` como valor por defecto;
- se calcula el promedio de todos los valores (reales + por defecto).

Formula base:

```text
tiempo_promedio_O_V = promedio(días en desarrollo para cada oportunidad ganada)

Donde:
  - Si hay auditoría: días = DATEDIFF(commercial_closed_at, audit_log.created_at)
  - Si NO hay auditoría: días = 120 (valor por defecto)
```

Ejemplo práctico:

- Vendedor A: 2 oportunidades ganadas
  - Opp 1: Entró en desarrollo 4/6, cerrada 2/7 = 28 días (con auditoría)
  - Opp 2: Sin registro en auditoría = 120 días (por defecto)
  - Promedio: (28 + 120) / 2 = **74 días**

- Vendedor B: 3 oportunidades ganadas, todas sin auditoría
  - Promedio: (120 + 120 + 120) / 3 = **120 días**

Justificación del valor por defecto:

- El valor de `120 días` representa aproximadamente 4 meses de ciclo de venta;
- se usa como valor conservador cuando no hay datos auditables;
- refleja un ciclo comercial típico en la industria de soluciones empresariales.

## Probabilidad de cumplir cuota (Seller League TV)

Este indicador proyecta que tanto de la cuota actual podria cerrar el vendedor con lo ya ganado y con el funnel abierto que aun es cerrable en el tiempo restante del trimestre.

Formula base:

```text
timeFactor = clamp(daysRemaining / opportunityToWinDays, 0, 1)

closablePipelineUsd = funnelOpenAmountUsd * opportunityToWinEffectiveRatio * timeFactor

projectedCloseUsd = wonAmountUsd + closablePipelineUsd

projectedAttainmentRatio = projectedCloseUsd / quotaAmountUsd

probabilidad_pct = round(projectedAttainmentRatio * 100)

brecha_usd = max(0, quotaAmountUsd - projectedCloseUsd)
```

Notas operativas:

- `opportunityToWinEffectiveRatio` usa la conversion actual (`ganadas / total ultimas 20 oportunidades`) cuando existe y es mayor a `0`; si no, usa la configurada (`opportunities_to_wins_ratio`).
- `opportunityToWinDays` es el promedio O→V del vendedor.
- `timeFactor` nunca pasa de `1`, aunque `daysRemaining` sea mayor a `opportunityToWinDays`.

### Ejemplo real (Jacob Hernandez, corte observado)

Valores de entrada:

- `quotaAmountUsd`: `1,000,000`
- `wonAmountUsd`: `0`
- `funnelOpenAmountUsd`: `1,707,011.17`
- `opportunityToWinEffectiveRatio`: `0.3684210526`
- `daysRemaining`: `80`
- `opportunityToWinDays`: `1`

Paso 1: factor de tiempo

```text
timeFactor = clamp(80 / 1, 0, 1) = 1
```

Paso 2: pipeline cerrable

```text
closablePipelineUsd = 1,707,011.17 * 0.3684210526 * 1
                   = 628,898.8521
```

Paso 3: cierre proyectado

```text
projectedCloseUsd = 0 + 628,898.8521
                  = 628,898.8521
```

Paso 4: ratio proyectado

```text
projectedAttainmentRatio = 628,898.8521 / 1,000,000
                         = 0.6288988521
```

Paso 5: probabilidad mostrada

```text
probabilidad_pct = round(0.6288988521 * 100)
                = round(62.88988521)
                = 63
```

Paso 6: brecha

```text
brecha_usd = max(0, 1,000,000 - 628,898.8521)
           = 371,101.1479
           = 371,101 (mostrado en UI)
```

Resultado del ejemplo:

- Probabilidad de cumplir cuota: `63%`
- Brecha: `USD 371,101`

## Probabilidad de cumplir funnel siguiente Q (Seller League TV)

Este indicador estima que tan factible es cubrir el funnel requerido para la cuota del siguiente trimestre.

Formula base:

```text
weeksRemaining = max(0, (fin_trimestre_actual_23_59_59 - ahora) / (7 * 24 * 60 * 60 * 1000))

timeBuildFactor = clamp(daysRemaining / leadToOpportunityDays, 0, 1)

leadsPerWeek = promedio(ultimas 4 semanas de leadsPerWeekWeeklyCounts)

buildableOpportunities = leadsPerWeek * weeksRemaining * leadToOpportunityRatio * timeBuildFactor

buildableFunnelUsd = buildableOpportunities * averageSaleTicketAmount

projectedAvailableFunnelUsd = existingNextQuarterFunnelUsd + buildableFunnelUsd

requiredFunnelUsd = nextQuarterQuotaAmountUsd / max(opportunityToWinRatio, 0.0001)

readinessRatio = projectedAvailableFunnelUsd / requiredFunnelUsd

probabilidad_pct = round(readinessRatio * 100)

funnelGapUsd = max(0, requiredFunnelUsd - projectedAvailableFunnelUsd)
```

Notas operativas:

- Si existe cuota real de siguiente trimestre (`nextQuarterQuotaAmountUsd > 0`), se usa esa cuota y el funnel abierto de siguiente trimestre (`nextQuarterOpenPipelineUsd`).
- Si no existe cuota real de siguiente trimestre, se usa como respaldo la cuota actual y el funnel actual.
- `opportunityToWinRatio` usa la tasa efectiva del vendedor (`opportunityToWinEffectiveRatio`).
- Si `leadToOpportunityDays` no existe para el vendedor, se usa fallback de `20` dias.
- `weeksRemaining` se calcula con tiempo real desde `ahora` hasta el fin del trimestre actual (no solo con `daysRemaining/7`), por eso puede incluir decimales finos.

### Ejemplo real (Jacob Hernandez, corte observado)

Valores de entrada:

- `daysRemaining`: `80`
- `weeksRemaining`: `11.4525408614`
- `nextQuarterQuotaAmountUsd`: `500,000`
- `opportunityToWinRatio`: `0.3684210526`
- `leadToOpportunityRatio`: `0.0769230769`
- `leadToOpportunityDays`: `20`
- `leadsPerWeekWeeklyCounts`: `[0, 0, 0, 1, 0, 2, 3, 7, 0, 0]`
- `averageSaleTicketAmount`: `354,739.58`
- `existingNextQuarterFunnelUsd`: `2,000`

Paso 1: factor de construccion

```text
timeBuildFactor = clamp(80 / 20, 0, 1) = 1
```

Paso 2: leads por semana (ultimas 4 semanas)

```text
ultimas4 = [3, 7, 0, 0]
leadsPerWeek = (3 + 7 + 0 + 0) / 4 = 2.5
```

Paso 3: oportunidades construibles

```text
buildableOpportunities = 2.5 * 11.4525408614 * 0.0769230769 * 1
                      = 2.2024117041
```

Paso 4: funnel construible (USD)

```text
buildableFunnelUsd = 2.2024117041 * 354,739.58
                   = 781,282.6029
```

Paso 5: funnel total proyectado disponible

```text
projectedAvailableFunnelUsd = 2,000 + 781,282.6029
                            = 783,282.6029
```

Paso 6: funnel requerido para cubrir siguiente Q

```text
requiredFunnelUsd = 500,000 / 0.3684210526
                  = 1,357,142.8571
```

Paso 7: ratio de preparacion

```text
readinessRatio = 783,282.6029 / 1,357,142.8571
               = 0.5771556021
```

Paso 8: probabilidad mostrada

```text
probabilidad_pct = round(0.5771556021 * 100)
                = round(57.71556021)
                = 58
```

Paso 9: brecha de funnel

```text
funnelGapUsd = 1,357,142.8571 - 783,282.6029
             = 573,860.2542
             = 573,860 (aprox)
```

Resultado del ejemplo:

- Probabilidad de cumplir funnel siguiente Q: `58%`
- Brecha de funnel: `USD 573,860` (aprox)

## Objetivo de oportunidades creadas

El tablero estima cuantas oportunidades nuevas deberia crear un vendedor para cubrir su cuota.

Formula base:

```text
objetivo_oportunidades = cuota / (conversion_opportunidad_a_venta * ticket_promedio)
```

Donde:

- `cuota` es la cuota monetaria asignada al vendedor;
- `ticket_promedio` es el ticket promedio efectivo;
- `conversion_opportunidad_a_venta` es la conversion calculada cuando es mayor a `0`; si es `0` o no existe, se usa la configurada.

Interpretacion:

- a mayor conversion o mayor ticket promedio, menor sera el numero de oportunidades necesarias;
- si la conversion o el ticket promedio no se pueden determinar, se usa el valor configurado que corresponda antes de calcular la meta.

## Campos de configuracion relacionados

- `commercial_planning_seller_parameters.leads_to_opportunities_ratio`
- `commercial_planning_seller_parameters.opportunities_to_wins_ratio`
- `commercial_planning_seller_parameters.average_sale_ticket_amount`

## Lectura rapida

- Si hay datos recientes, manda el calculo real.
- En visualizacion de tasas, `0` se muestra como `0`.
- En calculo de metas, si la tasa calculada es `0` o no calculable, se usa la configuracion.
- Si no hay calculo ni configuracion, el valor queda en `0`.
