# Patron comun para ventanas de lista y edicion

Este documento define el patron funcional y visual para pantallas tipo catalogo,
como Usuarios y Cuentas, y debe servir como base para nuevas implementaciones.

## Objetivo

Estandarizar experiencia de usuario, estructura de codigo y comportamiento de:

- Vista de lista.
- Alta.
- Edicion.
- Acciones por fila.
- Estados y auditoria.

## Estructura base de pantalla

1. Encabezado del modulo (`.roles-page-header`)

- Titulo del modulo con icono SVG (`.module-title-with-icon`).
- Subtitulo descriptivo (`.roles-subtitle`).
- Boton primario de creacion alineado a la derecha (`.btn-primary`, texto `+ Crear ...`).

2. Barra de filtros (`.roles-pills-bar.accounts-pills-bar-row`)

- Pills de estado para filtrar registros (Todos / Activos / Pendientes / Desactivados).
- Campo de busqueda por texto libre alineado a la derecha (`.accounts-search-inline`).

3. Tabla principal

- Columnas de negocio.
- Columna Estado con badge visual.
- Columna Acciones al extremo derecho.

4. Paginacion (`.users-pagination`)

- Informacion de rango visible (ej. "1–10 de 35").
- Navegacion previo/siguiente.
- Selector de registros por pagina: 10 / 50 / 100.

5. Modal de alta/edicion

- Formulario por secciones.
- Boton secundario Cancelar y boton primario Guardar/Crear.
- Validaciones y mensajes de error claros.

## Patron de lista (tabla)

### Ordenamiento por columnas

- Cada encabezado de columna usa boton con flecha de orden:
  - No activo: ↕
  - Ascendente: ↑
  - Descendente: ↓
- Orden por defecto recomendado: ID ascendente.
- Clic en misma columna: alterna direccion.
- Clic en columna distinta: activa esa columna en ascendente.

### Filtro de texto

- Input unico sobre la tabla.
- Busca sobre los campos mas relevantes del registro.
- Debe combinarse con el ordenamiento sin romperlo.

### Estado visual

- Mostrar estado con badge (no texto plano).
- Usar color verde para activo/activada.
- Usar color rojo para inactivo/desactivada.

### Acciones por fila

- Boton de tres puntos (kebab) a la derecha.
- Acciones minimas esperadas:
  - Editar.
  - Activar.
  - Desactivar.
- Deshabilitar acciones que no aplican por estado actual.

## Patron de modal (alta y edicion)

### Comportamiento general

- Reutilizar un mismo modal para crear y editar cuando sea posible.
- El titulo y el CTA principal cambian por modo:
  - Crear: "Crear ..."
  - Editar: "Editar ..." / "Guardar cambios"
- En modo edicion, mostrar badge de estado de solo lectura alineado al titulo
  (dentro de un div.modal-header con flex + space-between).
- El badge es puramente informativo; los cambios de estado se realizan desde
  el menu de acciones de la fila en la tabla.
- Cerrar con Cancelar y opcionalmente clic fuera (si no esta guardando).

### Layout de formulario

- Dividir en secciones claras por contexto de datos.
- Usar labels consistentes con marca visual para obligatorios (\*).
- Mantener espaciado uniforme y lectura vertical clara.

### Validaciones

- Validar requeridos antes de enviar.
- Mostrar errores de backend en lenguaje claro.
- Si backend devuelve errores por campo, priorizar ese mensaje.

## Patron de auditoria en edicion

- En modo edicion, incluir bloque de auditoria dentro del modal.
- Posicion recomendada: despues de campos de negocio principales y/o asignaciones
  clave (ejemplo: Roles en Usuarios, Propietarios en Cuentas).
- Mostrar en tipografia compacta para no competir con el formulario.
- Campos minimos sugeridos:
  - Creado por.
  - Fecha de creacion.
  - Modificado por.
  - Fecha de modificacion.

## Mensajeria y retroalimentacion

- Usar toasts para exito y error.
- Limpiar mensajes previos antes de una nueva operacion.
- Auto-ocultar mensajes despues de pocos segundos.

## Recomendaciones de implementacion

- Mantener nombres de estado consistentes entre backend y frontend.
- Evitar duplicar logica: usar helpers para
  - resolver etiqueta de estado,
  - resolver clase de badge,
  - ordenar y filtrar.
- Refrescar lista despues de crear/editar/activar/desactivar.

## Checklist para nuevas ventanas

- [ ] Encabezado unificado: titulo con icono SVG, subtitulo, boton `+ Crear ...` a la derecha.
- [ ] Barra de filtros: pills de estado + busqueda inline a la derecha.
- [ ] Tabla con columnas ordenables y flechas.
- [ ] Columna Estado con badge.
- [ ] Columna Acciones con menu kebab.
- [ ] Paginacion con selector 10 / 50 / 100 y navegacion previo/siguiente.
- [ ] Modal de alta/edicion con secciones.
- [ ] Badge de estado (solo lectura) en encabezado del modal de edicion.
- [ ] Validaciones y manejo de errores por campo.
- [ ] Auditoria en modo edicion con tipografia compacta.
- [ ] Toasts de exito y error.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
