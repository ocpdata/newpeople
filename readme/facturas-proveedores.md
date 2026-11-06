# Facturas de proveedores

El modulo permite registrar facturas y prefacturas a partir de las ordenes
de compra a proveedores generadas en **Aceptacion de pedidos > Procesamiento
operativo**. No requiere culminar todas las etapas del procesamiento.

El acceso de consulta corresponde a los permisos de Aceptacion de pedidos.
Registrar y convertir documentos requiere **aceptar_pedido.procesamiento.update**,
**cotizaciones.operacion** o **cotizaciones.administracion**. La conversion
requiere ademas ser creador del documento o administrador de cotizaciones.
El servidor restringe las ordenes y documentos a las cuentas accesibles.

## Ordenes pendientes

El listado muestra cuenta, oportunidad, proveedor, numero y fecha de orden,
moneda y monto disponible con impuestos. El selector circular permite agrupar
ordenes del mismo proveedor y moneda, incluso de diferentes cuentas y
oportunidades.

**Registrar factura o prefactura** abre los datos del documento y los items
comprados. La disponibilidad se consulta nuevamente antes de abrir el modal
y se valida transaccionalmente en el servidor al guardar.

La cuenta, oportunidad, proveedor e items se obtienen de cada orden. No se
ingresan relaciones manuales que puedan contradecir la compra original.
Por item se muestran cantidad comprada, facturada, reservada y disponible.
Puedes excluir items o indicar cantidades parciales.

## Registro

- **Registrar factura** requiere numero de factura del proveedor, fecha y
  tipo de cambio valido. El sistema no genera numeros `AQ-...`.
- **Guardar prefactura** reserva las cantidades sin requerir numero de factura.
  La reserva no se considera facturada.
- No puede repetirse el numero de factura para el mismo proveedor, aunque
  cambie el uso de mayusculas o los espacios al inicio y al final.

Los costos y descuentos provienen de los items comprados. El IVA corresponde
a cada orden, incluso si un documento agrupa ordenes con diferentes tasas.
Los importes y relaciones quedan guardados con el documento.

El tipo de cambio usa **1 USD = X unidades de la moneda del documento**.
Para monedas distintas de USD se propone la ultima tasa disponible de
Frankfurter y se permite editarla. La consulta puede usar cache de hasta seis
horas; se muestra la fecha de publicacion disponible. Si falla, se informa el
error y se permite ingreso manual. Para USD se fija en 1.

`total USD = total en moneda original / tipo de cambio`

Registrar un documento no marca al proveedor como pagado ni modifica la
recepcion de productos.

Puedes seleccionar comprobantes opcionales al registrar o convertir. Se
adjuntan al registro ya guardado; si falla la carga, el modal permite reintentar
solo los adjuntos, sin crear otra factura ni duplicar las cantidades. Los
limites y tipos de archivo permitidos se validan en el servidor (por defecto
8 archivos por solicitud y 120 MiB en total). Los adjuntos pueden descargarse
desde **Ver documento**, con autenticacion y control de acceso.
La accion **Adjuntar comprobantes** del listado permite agregar archivos mas
adelante sin modificar los items del documento.

## Documentos registrados y conversion

El listado muestra oportunidades, cuentas, proveedor, numero de factura
o **Sin asignar**, tipo, fecha, ordenes vinculadas y montos original y en USD.
Permite filtrar por fechas inclusivas del documento, tipo, proveedor y cuenta.
Los filtros no modifican las reservas ni los saldos disponibles.

**Ver documento** permite consultar el contenido historico. **Convertir en
factura** solicita numero definitivo, fecha y tipo de cambio; propone la tasa
guardada y permite actualizarla. Conserva el mismo registro, items y total
original, convirtiendo las reservas a facturadas sin duplicar cantidades.

Las ordenes totalmente facturadas o reservadas ya no aparecen disponibles.
Las parcialmente cubiertas permanecen por sus cantidades restantes. Las
ordenes vinculadas quedan protegidas frente a eliminaciones incompatibles.
