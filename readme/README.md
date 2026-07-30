# Documentacion interna

Este directorio centraliza la documentacion funcional y tecnica por modulo.

## Indice

- [Logica de negocio](./logica-negocio.md)
- [Uso de IA](./ia.md)
- [Usuarios](./usuarios.md)
- [Roles y permisos](./roles.md)
- [Cuentas](./cuentas.md)
- [Crear cuenta](./crear-cuenta.md)
- [Leads](./leads.md)
- [Calculos](./calculos.md)
- [Dashboards](./dashboards.md)
- [Campanas](./campanas.md)
- [Landing](./landing.md)
- [Correos de campana](./correos-campana.md)
- [Tableros de leads v1](./tableros-leads-v1.md)
- [Oportunidades](./oportunidades.md)
- [Configuracion del proceso comercial](./configuracion-proceso-comercial.md)
- [Contactos](./contactos.md)
- [Mapeo de contactos](./mapeo-contactos.md)
- [Cotizaciones](./cotizaciones.md)
- [Cotizaciones - Validacion con IA](./cotizaciones-validacion-ia.md)
- [Aceptar pedido](./aceptar-pedido.md)
- [Aceptar pedido - Especificacion de procesamiento](./aceptar-pedido-procesamiento-especificacion.md)
- [Propuestas](./propuestas.md)
- [Comisiones](./comisiones.md)
- [Planeacion comercial](./planeacion-comercial.md)
- [Seguimiento comercial](./seguimiento-comercial.md)
- [Ritmo comercial](./ritmo-comercial.md)
- [Desarrollo comercial](./desarrollo-comercial.md)
- [Biblioteca comercial](./biblioteca-comercial.md)
- [Proveedores](./proveedores.md)
- [Registros de fabricantes](./registros-fabricantes.md)
- [Auditoria](./auditoria.md)
- [Herramientas](./herramientas.md)
- [Configuracion del sistema](./configuracion-sistema.md)
- [Cuenta de usuario](./cuenta-usuario.md)
- [Chatbot](./chatbot.md)
- [Pruebas](./pruebas.md)
- [Patron comun de listas y edicion](./patron-comun-listas-y-edicion.md)
- [Arquitectura de la aplicacion](./arquitectura-aplicacion.md)
- [Base de datos](./base-de-datos.md)

## Cambios recientes documentados

- Nuevo documento transversal: logica de negocio del CRM con reglas comunes de RBAC, ownership, create/request, activacion y auditoria.
- Cada README de modulo ahora incluye su propia seccion `Logica de negocio` para concentrar reglas operativas, restricciones y efectos esperados sin depender solo del documento transversal.
- Usuarios/Auth: set password migrado a token temporal de un solo uso, vigencia visible en UI, redireccion automatica al dashboard y auditoria con proposito/expiracion.
- Usuarios: alta en modal, edicion con auditoria visible y acciones por fila;
  badge de estado solo lectura en modal de edicion; filtro "Mostrar desactivados";
  paginacion con selector 10 / 50 / 100 registros por pagina.
- Roles: creacion en modal, filtro de roles desactivados y auditoria del rol;
  diseno reorganizado en 3 columnas (roles / permisos por modulo / usuarios del rol)
  con alturas controladas y scroll independiente por columna.
- Cuentas: alta/edicion en modal, auditoria en edicion, acciones por fila,
  estado visual, filtro de desactivadas, busqueda y ordenamiento por columnas;
  badge de estado solo lectura en modal de edicion;
  paginacion con selector 10 / 50 / 100 registros por pagina.
- Oportunidades: alta/edicion en modal, vendedor unico, preventa opcional,
  auditoria en edicion y acciones por fila;
  paginacion con selector 10 / 50 / 100 registros por pagina.
- Calculos: documento nuevo con reglas de conversion, ticket promedio y respaldo desde configuracion de planeacion comercial.
- Contactos: alta/edicion en modal, badge de estado solo lectura en modal de
  edicion, filtro de desactivados, ayuda contextual en encabezado,
  apertura de edicion por clic en fila, bloqueo visual durante guardado y
  prevencion automatica de duplicados;
  paginacion con selector 10 / 50 / 100 registros por pagina.
- Leads: documento nuevo del modulo de interacciones con carga documental,
  analisis manual, resolucion de cuenta/contactos/oportunidad, razon de
  descalificacion y seguimiento comercial del lead.
- Leads: especificacion funcional v1 de tableros con KPIs, permisos, filtros,
  drilldowns y reglas operativas compartidas para gerencia, gestion y operacion.
- Proveedores: modulo documentado con reglas de proveedor, listas de precios,
  moneda y tipo unico por lista, y composicion/reactivacion automatica de
  `Bundle`.
- Cotizaciones: modulo documentado con workflow propio, guardado completo por version,
  bundles de catalogo y manuales, vista previa oficial en PDF generada por backend,
  y separacion entre precio original del proveedor y precio convertido por tipo de cambio.
- Cotizaciones IA: politicas actualizadas para validacion en linea por documentos adjuntos con costo directo por codigo (sin referencia historica), exclusion de items Access Quality y bloqueo de descuadre solo con evidencia de alta confianza.
- IA/Configuracion: documentada la administracion de tarifas por modelo desde
  Credito IA (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- Documentacion por modulo completada: se agregaron README dedicados para dashboards,
  propuestas, biblioteca comercial, desarrollo comercial, seguimiento comercial,
  ritmo comercial, planeacion comercial, mapeo de contactos, herramientas,
  registros de fabricantes, aceptar pedido, configuracion del proceso comercial,
  configuracion del sistema, cuenta de usuario y chatbot.
- Landing: documento nuevo con flujo por evento, versionado/publicacion, submissions, permisos y endpoints clave.
- Campanas: documento nuevo con catalogos, reglas de compatibilidad tipo/subtipo, audiencia por cuenta/contacto, permisos y endpoints del modulo.
- Correos de campana: documento actualizado a V1 operativa, con envio de prueba, corridas backend con worker automatico (50/h y 300/d), controles de pausa/reanudar/cancelar y tablero basico de estado.
- Comisiones: documento nuevo para reglas trimestrales de configuracion y seguimiento en Planeacion Comercial, con umbral de cuota, margen minimo por cotizacion y calculo por item.
- Auditoria: pantalla global con filtros, paginacion y entidad por nombre.
- UI global: encabezado unificado en todos los modulos (titulo con icono SVG,
  subtitulo, boton primario, barra pills + busqueda inline).

## Uso recomendado

1. Inicia en este archivo para ubicar el modulo.
2. Abre el README especifico del tema y revisa primero su seccion `Logica de negocio`.
3. Actualiza el archivo del modulo cuando se hagan cambios relevantes.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
