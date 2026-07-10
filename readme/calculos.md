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
