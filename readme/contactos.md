# Contactos

## Alcance

Este documento describe el módulo de contactos del CRM, incluyendo:

- listado, filtros, búsqueda y ordenamiento;
- creación y edición en modal;
- normalización visual de datos personales y organizacionales;
- prevención automática de duplicados;
- estados, permisos y restricciones operativas;
- visualización de oportunidades asociadas;
- auditoría en modo edición.

No cubre el flujo interno de oportunidades ni la lógica general de cuentas más allá de su relación obligatoria con los contactos.

## Superficie funcional

### Punto de entrada

- El módulo se abre desde la sección `Contactos` del CRM.
- El encabezado incluye:
  - título `Contactos`,
  - icono del módulo,
  - icono `?` con ayuda contextual,
  - subtítulo operativo,
  - botón `+ Crear contacto` cuando el usuario puede crear o solicitar.

### Archivos involucrados

- Frontend:
  - `apps/web/src/ContactsPage.jsx`
  - `apps/web/src/contacts/useContactsCrud.js`
  - `apps/web/src/contacts/ContactFormModal.jsx`
  - `apps/web/src/contacts/ContactOpportunitiesModal.jsx`
  - `apps/web/src/contacts/useContactOpportunities.js`
- Backend:
  - `apps/api/src/routes.contacts.js`

## Listado del módulo

### Barra superior

- Pills por estado:
  - `Activos`
  - `Pendientes` cuando la temporal está habilitada
  - `Desactivados`
  - `Todas`
- Búsqueda inline por:
  - nombre,
  - cuenta,
  - cargo,
  - e-mail,
  - móvil,
  - estado.

### Tabla

Columnas visibles:

- `ID`
- `Nombre`
- `Cuenta`
- `Cargo`
- `E-mail`
- `Móvil`
- `Estado`
- `Acciones`

Comportamiento:

- La fila completa abre el modal de edición del contacto.
- El menú kebab se conserva como superficie independiente de acciones.
- La celda de acciones y sus botones usan `stopPropagation()` para no disparar la apertura por clic en fila.
- El ordenamiento por columnas está disponible en `ID`, `Nombre`, `Cuenta`, `Cargo`, `E-mail` y `Estado`.

### Acciones por fila

- `Editar`
- `Activar`
- `Marcar pendiente` cuando aplica
- `Desactivar`
- `Oportunidades` si el usuario puede leer oportunidades

### Paginación

- Navegación previo/siguiente.
- Selector de registros por página:
  - `10`
  - `50`
  - `100`

## Modal de contacto

### Modos

- `Crear contacto`
- `Editar contacto`

### Encabezado

- En creación muestra título y subtítulo operativo.
- En edición añade:
  - badge visual de estado,
  - identificador del registro,
  - auditoría al final del formulario.

### Secciones visibles

#### 1. Datos principales

Campos:

- `Nombres` obligatorio.
- `Apellidos` obligatorio.
- `Cuenta` obligatoria.
- `Cargo` opcional.
- `E-mail` opcional.
- `Móvil` opcional.
- `Teléfono fijo` opcional.
- `Extensión` opcional.
- `Departamento` opcional.

#### 2. Relación comercial

Campos:

- `Participación de compra` obligatoria.
- `Relación con nosotros` obligatoria.
- `Situación en empresa` obligatoria.
- `Jefe` opcional.
- `Influye en` opcional.

#### 3. Ubicación

Campos:

- `País`
- `Estado`
- `Ciudad`
- `Dirección`
- `Código postal`

La ubicación puede heredarse desde la cuenta seleccionada para reducir captura manual y mantener consistencia comercial.

#### 4. Auditoría

Solo en edición:

- creado por,
- fecha de creación,
- modificado por,
- fecha de modificación.

## Normalización visual de captura

El formulario normaliza presentación en estos campos:

- `Nombres`
- `Apellidos`
- `Cargo`
- `Departamento`

Comportamiento:

- mientras el usuario escribe, el campo no se corrige agresivamente;
- al salir del campo (`blur`), se aplica capitalización de presentación;
- antes de guardar, la normalización se ejecuta otra vez para no depender del orden de interacción.

Reglas funcionales:

- capitaliza nombres y palabras en formato humano;
- conserva conectores comunes en minúscula salvo al inicio;
- respeta separadores como guiones y apóstrofes;
- mantiene siglas frecuentes en mayúsculas.

## Bloqueo durante guardado

Cuando el usuario crea o guarda un contacto:

- el modal se bloquea visualmente;
- se deshabilita el cierre por clic fuera;
- el botón `Cancelar` queda deshabilitado;
- se muestra un overlay comercial mientras termina la operación.

Objetivo:

- evitar doble envío,
- evitar cierre accidental,
- comunicar que el registro sigue en proceso.

## Prevención de duplicados

La creación de contactos ya no depende de confirmación manual para continuar cuando hay coincidencias relevantes.

### Regla actual

- si la validación determina `clear`, el contacto se crea;
- si detecta coincidencia relevante, el sistema bloquea automáticamente la creación.

### Señales evaluadas

- mismo `e-mail`;
- mismo nombre dentro de la misma cuenta;
- mismo móvil dentro de la misma cuenta;
- nombre casi idéntico dentro de la misma cuenta;
- nombre muy parecido o parcialmente coincidente dentro de la misma cuenta;
- revisión adicional con IA cuando está disponible.

### Política operativa

- `same_email`: bloqueo fuerte;
- `same_name_same_account`: bloqueo fuerte;
- `same_mobile_same_account`: bloqueo fuerte;
- coincidencias medias o bajas: bloqueo salvo que la revisión IA clasifique el caso como `likely_distinct`.

### Comportamiento en UI

Si la API responde conflicto por duplicado:

- el modal muestra una revisión de duplicados;
- el usuario puede volver al formulario;
- el usuario puede abrir un contacto sugerido;
- el sistema no ofrece crear “de todos modos”.

La revisión muestra:

- coincidencia principal,
- severidad,
- motivo,
- e-mail,
- móvil,
- cargo,
- resumen IA cuando exista.

## Oportunidades asociadas

Desde la lista se puede abrir el modal de oportunidades del contacto.

Ese modal permite:

- ver oportunidades asociadas al contacto;
- filtrar por estado;
- filtrar por año;
- abrir la oportunidad seleccionada en su módulo.

## Reglas funcionales

### Dependencia con cuentas

- Todo contacto pertenece obligatoriamente a una cuenta.
- No existe contacto válido fuera de una cuenta.
- Las relaciones `jefe` e `influye en` deben mantenerse dentro del universo coherente de la cuenta activa.

### Estado inicial

- `contactos.create` crea el contacto como `activado`.
- `contactos.request` crea el contacto como `pendiente_activacion` cuando `contactsPendingEnabled` está activa.
- Sin una combinación válida de permisos y temporal, la API responde `403`.

### Cambios de estado

- Solo `contactos.create` permite cambiar estado posteriormente.
- El cambio de estado se ejecuta desde el menú kebab de la tabla, no desde el formulario.
- El badge del encabezado del modal es informativo; no es un control de edición.

### Restricciones de estado

- Un contacto no puede desactivarse si tiene oportunidades activas.
- Un contacto no puede marcarse como pendiente si tiene oportunidades activas o desactivadas.

### Alcance de acceso

- `contactos.read_all` extiende visibilidad y operación a todos los contactos.
- Sin `contactos.read_all`, el usuario solo opera contactos de cuentas que le pertenecen.
- Ese mismo alcance condiciona catálogos relacionados como cuentas disponibles para asignación.

## API relacionada

### Endpoints principales

- `GET /api/contacts`
- `GET /api/contacts/:id`
- `POST /api/contacts`
- `PUT /api/contacts/:id`
- `PATCH /api/contacts/:id/status`

### Permisos involucrados

- `contactos.read`
- `contactos.read_all`
- `contactos.create`
- `contactos.request`
- `contactos.update`

## Catálogos del módulo

- `contact_relationship_types`
- `contact_purchase_participations`
- `contact_employment_statuses`
- `contact_activation_statuses`

## Consideraciones operativas

- El botón `+ Crear contacto` aparece cuando el usuario puede crear o solicitar.
- La tabla usa badges de estado consistentes con el resto del CRM.
- El módulo hereda el patrón común de lista + modal de edición.
- El encabezado incluye ayuda contextual con cierre por clic fuera y `Esc`.
- La auditoría solo aparece en edición.
- Los contactos pendientes dependen de la temporal `contactsPendingEnabled`.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
