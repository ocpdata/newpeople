# Facturacion a clientes

Desde **Facturacion**, selecciona las cotizaciones aceptadas y abre
**Crear factura con seleccionadas**. Los items deben pertenecer a la misma
cuenta y moneda.

## Facturas y prefacturas

En **Items de cotizaciones seleccionadas** puedes ajustar cantidades y elegir:

- **Confirmar creacion de factura**: muestra el modelo y permite crear una factura.
- **Crear prefactura**: muestra un modelo sin validez fiscal y permite guardar
  una prefactura sin numero de factura.

Una prefactura queda guardada en el servidor y reserva las cantidades
seleccionadas. Estas cantidades dejan de estar disponibles para otras facturas
o prefacturas, pero no se consideran facturadas.

Los indicadores distinguen **Facturado**, **Reservado** y **Disponible**.
Las cantidades disponibles se consultan nuevamente al abrir los items y se
validan en el servidor al guardar para evitar reservas simultaneas excesivas.
Las copias de un mismo item comparten su limite disponible.

## Convertir en factura

En **Facturas y prefacturas registradas**, el boton **Convertir en factura**
solicita la fecha de factura, proponiendo el dia actual de la zona horaria del
negocio. Al confirmar, la misma prefactura se convierte en factura conservando
sus items e identificador interno. La reserva pasa a facturada, sin descontar
las cantidades dos veces.

El servidor asigna el numero `AQ-AAAA-N` al crear una factura directamente o
convertir una prefactura. Guardar una prefactura no consume un numero. Una
factura no puede convertirse nuevamente.

En el listado, **Numero de factura** muestra el numero asignado a las facturas
y **Sin asignar** para las prefacturas. La columna **Tipo** distingue ambos
documentos; el ID interno no se presenta como numero comercial.
La columna **Nombre de oportunidad** muestra los nombres de las oportunidades
de las cotizaciones incluidas, sin repetirlos. Se consultan desde el servidor
independientemente del listado de cotizaciones aceptadas.
**Nombre de cuenta** muestra la cuenta asociada al documento, junto al nombre
de oportunidad.

El listado permite filtrar por **Fecha de inicio**, **Fecha de fin**, **Tipo de
documento** y **Cuenta**. Las fechas incluyen ambos extremos y corresponden a
la fecha del documento; puedes indicar solo uno de los limites. Los filtros se
combinan automaticamente y **Limpiar filtros** restablece el listado completo.
Se muestra el numero de documentos visibles y se valida que inicio no sea
posterior a fin. Estos filtros solo afectan la tabla, no los calculos de
cantidades facturadas, reservadas o disponibles.

Eliminar una prefactura libera sus cantidades reservadas. La eliminacion
requiere confirmacion y conserva las restricciones de acceso del modulo.
Los errores al guardar o convertir se muestran en el modal sin perder los
datos ingresados.

## Tipo de cambio e importes en USD

Al crear una factura o prefactura, el modelo incluye el campo **Tipo de cambio
a USD**. La convencion es **1 USD = X unidades de la moneda del documento**.
Por ejemplo, un total de MXN 20,000 con tasa 20 equivale a USD 1,000:

`total USD = total en moneda original / tipo de cambio`

Para monedas distintas de USD se propone la ultima tasa disponible de
Frankfurter. Se puede editar manualmente o consultar de nuevo con **Usar ultima
tasa disponible**. Se muestra la fecha de publicacion cuando el proveedor la
informa. Es una tasa de referencia, no una cotizacion bancaria en tiempo real;
puede corresponder al ultimo dia habil. La consulta usa cache de hasta seis
horas. Si falla, se informa el error y se permite ingresar la tasa manualmente.
Una respuesta pendiente no sobrescribe una tasa editada por el usuario.

La tasa debe ser positiva, con hasta ocho decimales. Para USD se fija en 1 y
no es editable. El servidor valida la tasa y calcula subtotal, IVA (16%), total
y equivalente en USD, redondeados a dos decimales.

Cada documento conserva su moneda, importes, tasa seleccionada, origen manual
o sugerido y fecha de publicacion disponible. El listado agrega **Monto en
moneda del documento**, **Tipo de cambio a USD** y **Monto en USD**; ambos montos
incluyen IVA. Consultar el listado no actualiza la tasa guardada.

Al convertir una prefactura se propone su tasa guardada. Puedes conservarla,
editarla o consultar la ultima tasa disponible. La conversion mantiene los
items y el total en moneda original; solo recalcula el equivalente en USD.

Los documentos anteriores sin datos monetarios historicos muestran **No
disponible** en las nuevas columnas. No se asigna retroactivamente la tasa
actual ni se supone una tasa 1. Al convertir una prefactura anterior se informa
que sus importes se calcularan con los items guardados y la moneda de la
cotizacion accesible; se debe confirmar una tasa valida. Si no es posible
determinar la moneda en la interfaz, se bloquea la conversion.
