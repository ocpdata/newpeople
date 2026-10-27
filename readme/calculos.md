# Calculos y Planeacion Comercial del CRM

Este documento reúne las reglas de Planeación Comercial y las formulas que usa la aplicacion para mostrar tasas, promedios y objetivos operativos.

## Planeación comercial

### Objetivo y alcance

Planeación Comercial permite definir las metas de los cuatro trimestres de un año por vendedor y configurar las tasas de comisión. También muestra el seguimiento de cuota, ventas aceptadas y comisiones.

La interfaz está en `/commercial-planning` y presenta estas secciones:

- **Metas:** cuotas y margen esperado por vendedor para T1–T4, con moneda compartida por año.
- **Comisiones · Configuración:** porcentajes de productos, servicios y renovaciones para los cuatro trimestres.
- **Parámetros vendedor:** ticket promedio, conversiones y tiempos usados por las proyecciones.
- **Comisiones · Seguimiento:** resultados por trimestre, año, vendedor y cotización aceptada.

### Permisos

- `planeacion_comercial.read`: consultar planeación y comisiones.
- `planeacion_comercial.create`: guardar por primera vez metas o configuración anual.
- `planeacion_comercial.update`: editar años que ya tienen períodos.
- `planeacion_comercial.audit.read`: consultar auditoría mediante las herramientas de auditoría autorizadas.
- `comercial.seller.eligible`: determinar qué vendedores pueden configurarse.

No existe un estado ni una acción para cerrar períodos. Los cuatro trimestres permanecen editables.

### Endpoints anuales

- `GET /api/commercial-planning/years/:year`: devuelve T1–T4, moneda anual, vendedores elegibles y metas.
- `PUT /api/commercial-planning/years/:year/targets`: guarda las metas de los cuatro trimestres.
- `GET /api/commercial-planning/years/:year/commission-configs`: devuelve la configuración de comisiones de T1–T4.
- `PUT /api/commercial-planning/years/:year/commission-configs`: guarda las tasas de comisión de los cuatro trimestres.
- El guardado materializa los períodos faltantes. No hay endpoint de alta manual.

### Reglas operativas

- Metas y Configuración de comisiones tienen selectores de año propios, independientes entre sí y del seguimiento.
- Cada vendedor tiene como máximo una meta por trimestre. Guardar las cuotas las hace vigentes de inmediato.
- La moneda de Metas es compartida por los cuatro trimestres; cambiarla no convierte importes existentes.
- Si los períodos heredados de un año contienen monedas distintas, la lectura y el guardado responden con conflicto; no se reinterpretan importes.
- Las tasas de comisión siguen guardándose por período y vendedor. Al editar la configuración anual se conservan las notas históricas aunque no se presenten en esa tabla.
- El cálculo de comisiones conserva sus reglas de cuota, margen mínimo y elegibilidad por ítem descritas en [comisiones.md](./comisiones.md).
- El seguimiento cuenta únicamente cotizaciones aceptadas y asigna cada una al trimestre de su evento de auditoría `declarar_ganada`; si no existe, usa el primer evento de aceptación y luego `updated_at`. La API expone la fecha efectiva como `wonAt` y el estado como `statusCode`.
- Las metas se guardan directamente por trimestre, sin versiones, borradores ni publicación.

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
- para cada oportunidad con auditoria de entrada a "desarrollo", se calcula `DATEDIFF(commercial_closed_at, fecha_entrada_desarrollo)`;
- las oportunidades sin esa auditoria no se incluyen en el promedio histórico;
- se promedian los días de las oportunidades auditables; la muestra puede ser menor que 20.

Formula base:

`tiempo_promedio_O_V = promedio(días en desarrollo para cada oportunidad ganada)`

Donde:

- Con auditoría: `días = DATEDIFF(commercial_closed_at, audit_log.created_at)`.
- Sin auditoría: la oportunidad se excluye del promedio histórico; no se le asignan 120 días.

Ejemplo práctico:

- Vendedor A: 2 oportunidades ganadas
  - Opp 1: Entró en desarrollo 4/6, cerrada 2/7 = 28 días (con auditoría)
  - Opp 2: sin registro en auditoría, se excluye
  - Promedio histórico: **28 días** (una oportunidad auditable)

- Vendedor B: 3 oportunidades ganadas, todas sin auditoría
  - No hay promedio histórico calculable; se usa el valor configurado si corresponde.

Cuando se habilita el uso de histórico para probabilidad de cuota, el promedio histórico se usa si es mayor que cero; si no, se usa `average_opportunity_to_win_days` configurado. Si no existe un promedio efectivo mayor que cero, el pipeline siguiente Q usa un factor temporal neutro (`1`) para las oportunidades existentes; el cálculo de cumplimiento Q actual no atribuye pipeline cerrable por tiempo.

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

## Cobertura del pipeline siguiente Q (Seller League TV)

La tarjeta muestra que porcentaje del pipeline requerido para cubrir la cuota del siguiente trimestre esta disponible o podria construirse antes de terminar el trimestre actual. El porcentaje es una razon de cobertura redondeada, no una probabilidad estadistica de ganar una oportunidad.

### 1. Pipeline existente de oportunidades del siguiente Q

`nextQuarterOpenPipelineUsd` conserva la suma bruta en USD de las oportunidades que cumplen todas estas condiciones:

- Su fecha de cierre (`close_date`) cae entre el inicio y el final del siguiente trimestre, ambos inclusive.
- Estan activadas (`activation_status_code = 'activada'`).
- Siguen en proceso (`commercial_status_code = 'en_proceso'`); no estan ganadas ni perdidas.
- Pertenecen al vendedor y al alcance de lectura permitido para quien consulta el tablero.

Se incluyen oportunidades de cualquier etapa comercial. Su `close_date` se usa para decidir si pertenecen al siguiente Q. Una vez incluidas, todas se ponderan con el tiempo disponible desde ahora hasta el ultimo dia de ese trimestre; no se usa la fecha individual de cierre como horizonte del factor. No se asigna una tasa O→V distinta por etapa: la misma conversion promedio efectiva del vendedor se aplica despues, al calcular el pipeline requerido.

Formula de este componente:

- **Pipeline existente:** `nextQuarterOpenPipelineUsd = sum(amountUsd)` para todas las oportunidades abiertas que cumplen los filtros anteriores.
- **Dias disponibles hasta el fin del siguiente Q:** `daysUntilNextQuarterEnd = max(0, floor((endOfDay(fin_siguiente_Q) - ahora) / 86400000))`. Este plazo comun se aplica a todas las oportunidades incluidas.
- **Duracion estimada en su etapa:** `stageDays_i = max(1, opportunityToWinEffectiveDays * stageTimeMultiplier_i)`.
- **Factor temporal individual:** `stageTimeFactor_i = clamp(daysUntilNextQuarterEnd / stageDays_i, 0, 1)`.
- **Importe ponderado individual:** `weightedAmountUsd_i = amountUsd_i * stageTimeFactor_i`.
- **Pipeline existente ponderado:** `nextQuarterTimeWeightedOpenPipelineUsd = sum(weightedAmountUsd_i)` para todas las oportunidades del siguiente Q.

Los multiplicadores de etapa son los mismos que se utilizan en Cumplimiento Q actual:

| Etapa | Multiplicador |
| --- | ---: |
| Contacto inicial | 1.0 |
| Identificación de oportunidad | 0.8 |
| Desarrollo | 0.6 |
| Cotización | 0.4 |
| Demostración | 0.3 |
| Negociación | 0.2 |
| Waiting | 0.1 |

#### Ejemplo 1: ponderacion por etapa

Supongamos que hoy faltan `60` dias para el ultimo dia del siguiente Q y el promedio O→V efectivo del vendedor es `180` dias. Las tres oportunidades tienen `close_date` dentro del siguiente Q. La fecha individual de cada una no cambia el plazo usado por el factor: las tres tienen los mismos `60` dias disponibles.

| Oportunidad | Etapa | Importe | Multiplicador | `stageDays` | Factor (`min(1, 60 / stageDays)`) | Importe ponderado |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | Desarrollo | USD 100,000 | 0.6 | 108 dias | 0.5556 | USD 55,556 |
| B | Cotizacion | USD 150,000 | 0.4 | 72 dias | 0.8333 | USD 125,000 |
| C | Negociacion | USD 200,000 | 0.2 | 36 dias | 1.0000 | USD 200,000 |

Calculo de la oportunidad A: `stageDays = 180 * 0.6 = 108`; `factor = min(1, 60 / 108) = 0.5556`; `ponderado = 100,000 * 0.5556 = 55,556`.

El pipeline bruto suma `USD 450,000`; despues de ponderar por etapa, el pipeline existente aporta aproximadamente `USD 380,556`. La tasa O→V no se aplica aqui oportunidad por oportunidad; se usa una sola vez al calcular el pipeline requerido.

`opportunityToWinEffectiveDays` es el promedio O→V efectivo del vendedor, histórico cuando está habilitado y disponible, o configurado como respaldo. Si no hay un promedio mayor que cero, el factor temporal es neutro (`1`) para no descontar pipeline por falta de datos. Si la etapa no tiene multiplicador explícito, se usa `1`.

### 2. Pipeline que podria construirse desde leads

El componente de pipeline nuevo es una estimacion agregada por vendedor; el factor de tiempo se calcula una vez para esa proyeccion, no por lead ni por oportunidad:

- **Semanas restantes:** `weeksRemaining = max(0, (fin_trimestre_actual_23_59_59 - ahora) / (7 * 24 * 60 * 60 * 1000))`.
- **Factor de tiempo:** `timeBuildFactor = clamp(daysRemaining / leadToOpportunityDays, 0, 1)`.
- **Leads por semana:** promedio de las ultimas 4 semanas de `leadsPerWeekWeeklyCounts`.
- **Oportunidades construibles:** `buildableOpportunities = leadsPerWeek * weeksRemaining * leadToOpportunityRatio * timeBuildFactor`.
- **Pipeline construible:** `buildableFunnelUsd = buildableOpportunities * averageSaleTicketAmount`.

`timeBuildFactor` representa que parte del ciclo promedio Lead→Oportunidad cabe en el tiempo restante. Por ejemplo, si quedan 10 dias y ese ciclo toma 20 dias, el factor es `0.5`; si quedan 20 dias o mas, es `1`; si no queda tiempo, es `0`. Si `leadToOpportunityDays` no esta disponible, el fallback es `20` dias, con un minimo efectivo de `1` dia.

#### Ejemplo 2: pipeline construido desde leads

Supongamos `60` dias restantes, un promedio de `3` leads por semana, conversion L→O de `10%`, `20` dias promedio para convertir un lead en oportunidad y ticket promedio de `USD 100,000`:

- `weeksRemaining = 60 / 7 = 8.5714`.
- `timeBuildFactor = clamp(60 / 20, 0, 1) = 1`.
- `buildableOpportunities = 3 * 8.5714 * 0.10 * 1 = 2.5714` oportunidades esperadas.
- `buildableFunnelUsd = 2.5714 * 100,000 = USD 257,142.86` aproximadamente.

Las `2.571` oportunidades son una expectativa agregada, no una cantidad de registros que se creen en el CRM.

### 3. Pipeline requerido y cobertura

Cuando ya existe una cuota para el siguiente Q, se usan esa cuota y el pipeline abierto de oportunidades filtrado para ese Q. Si aun no hay una cuota del siguiente Q, se usan como respaldo la cuota y el pipeline abierto del Q actual.

- **Cuota de referencia:** `quotaReferenceUsd = nextQuarterQuotaAmountUsd` si es mayor que `0`; de lo contrario, `quotaAmountUsd`.
- **Pipeline existente usado:** `existingFunnelUsd = nextQuarterTimeWeightedOpenPipelineUsd` si hay cuota configurada para el siguiente Q; de lo contrario, se usa `timeWeightedCurrentOpenPipelineUsd` del Q actual.
- **Conversión O→V efectiva:** `opportunityToWinRatio = clamp(opportunityToWinEffectiveRatio, 0, 1)`.
- **Pipeline disponible proyectado:** `projectedAvailableFunnelUsd = existingFunnelUsd + buildableFunnelUsd`.
- **Pipeline requerido:** `requiredFunnelUsd = quotaReferenceUsd / max(opportunityToWinRatio, 0.0001)`.
- **Cobertura:** `readinessRatio = projectedAvailableFunnelUsd / requiredFunnelUsd`; `coveragePct = round(readinessRatio * 100)`.
- **Brecha:** `funnelGapUsd = max(0, requiredFunnelUsd - projectedAvailableFunnelUsd)`.

`opportunityToWinRatio` es una tasa efectiva agregada por vendedor: usa la conversion observada en sus ultimas 20 oportunidades cuando es mayor que `0`; si no, usa la tasa configurada (`opportunities_to_wins_ratio`). La misma tasa se aplica al pipeline completo; no cambia segun la etapa de cada oportunidad. Si el ratio es cero, el divisor minimo `0.0001` evita dividir entre cero y hace que el pipeline requerido sea muy alto.

El resultado puede superar `100%` si el pipeline proyectado excede el requerido. En la UI se muestra redondeado; los estados de lectura usan `Listo` desde `100%` y `Justo` desde `80%` cuando existe cuota del siguiente Q.

#### Ejemplo 3: cobertura completa

Usando los resultados anteriores, supongamos una cuota del siguiente Q de `USD 1,000,000` y conversion O→V promedio de `20%`:

- Pipeline existente ponderado por etapas: `USD 380,555.56`.
- Pipeline construido desde leads: `USD 257,142.86`.
- `projectedAvailableFunnelUsd = 380,555.56 + 257,142.86 = USD 637,698.42`.
- `requiredFunnelUsd = 1,000,000 / 0.20 = USD 5,000,000`.
- `coveragePct = round(637,698.42 / 5,000,000 * 100) = 13%`.
- `funnelGapUsd = 5,000,000 - 637,698.42 = USD 4,362,301.58`.

La conversion O→V promedio se aplica una sola vez, en `requiredFunnelUsd`. Aplicarla tambien a los importes ponderados reduciria dos veces la conversion esperada.

### 4. Ejemplo real (Jacob Hernandez, corte observado)

Valores de entrada:

- `daysRemaining`: `80`
- `weeksRemaining`: `11.4525408614`
- `nextQuarterQuotaAmountUsd`: `500,000`
- `opportunityToWinRatio`: `0.3684210526`
- `leadToOpportunityRatio`: `0.0769230769`
- `leadToOpportunityDays`: `20`
- `leadsPerWeekWeeklyCounts`: `[0, 0, 0, 1, 0, 2, 3, 7, 0, 0]`
- `averageSaleTicketAmount`: `354,739.58`
- `nextQuarterTimeWeightedOpenPipelineUsd`: `2,000`

Paso 1: factor de construccion

```text
timeBuildFactor = clamp(80 / 20, 0, 1) = 1
```

Paso 2: leads por semana (ultimas 4 semanas)

```text
ultimas4 = [3, 7, 0, 0]
leadsPerWeek = (3 + 7 + 0 + 0) / 4 = 2.5
```

Paso 3: oportunidades y pipeline construibles

```text
buildableOpportunities = 2.5 * 11.4525408614 * 0.0769230769 * 1
                      = 2.2024117041

buildableFunnelUsd = 2.2024117041 * 354,739.58
                   = 781,282.6029
```

Paso 4: pipeline disponible proyectado

```text
projectedAvailableFunnelUsd = 2,000 + 781,282.6029
                            = 783,282.6029
```

Paso 5: pipeline requerido

```text
requiredFunnelUsd = 500,000 / 0.3684210526
                  = 1,357,142.8571
```

Paso 6: cobertura y brecha

```text
readinessRatio = 783,282.6029 / 1,357,142.8571
               = 0.5771556021

coveragePct = round(0.5771556021 * 100)
            = round(57.71556021)
            = 58%

funnelGapUsd = 1,357,142.8571 - 783,282.6029
             = 573,860.2542
             = 573,860 (aprox)
```

Interpretacion: la cobertura proyectada es `58%` y faltan aproximadamente `USD 573,860` de pipeline respecto al requerido. No significa que haya una probabilidad estadistica de `58%` de ganar la cuota.

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
