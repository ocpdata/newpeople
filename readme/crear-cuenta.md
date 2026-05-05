# Crear cuenta

## Alcance

Este documento describe exclusivamente el flujo de alta de cuentas desde la ventana modal `Crear cuenta`.

Incluye:

- apertura del modal desde el módulo de cuentas,
- captura y validación de datos,
- uso del asistente de IA sobre el borrador,
- prevención de duplicados antes de crear,
- reglas de permisos y estado inicial,
- persistencia final en backend.

No cubre la edición de cuentas ya existentes ni las acciones posteriores de activación, desactivación o marcado pendiente fuera del momento de creación.

## Superficie funcional

### Punto de entrada

- El flujo inicia desde el botón `Crear cuenta` del módulo de cuentas.
- El modal se abre solo para usuarios con alguno de estos permisos:
  - `cuentas.create`
  - `cuentas.request` cuando la temporal `accountsPendingEnabled` está activa.

### Archivos involucrados

- Frontend:
  - `apps/web/src/AccountsPage.jsx`
  - `apps/web/src/accounts/useAccountsCrud.js`
  - `apps/web/src/accounts/AccountFormModal.jsx`
  - `apps/web/src/accounts/AccountDraftAnalysisPanel.jsx`
- Backend:
  - `apps/api/src/routes.accounts.js`
  - `apps/api/src/accounts/draft-analysis/*`

## Estructura del modal

### Encabezado

- Título: `Crear cuenta`.
- Icono `?` con popover explicativo sobre el propósito del modal.
- Subtítulo operativo: primero se capturan los datos principales y luego se asignan propietarios.

### Secciones visibles al crear

#### 1. Datos principales

Campos:

- `Nombre` obligatorio.
- `Tipo de cuenta` obligatorio.
- `Registro` opcional.
- `Sector económico` obligatorio.

Comportamiento especial del nombre:

- colapsa espacios repetidos mientras se escribe,
- puede autocorregir formato en blur para casos obvios,
- muestra formato sugerido,
- puede pedir confirmación antes de guardar si detecta una normalización relevante.

#### 2. Ubicación y contacto

Campos:

- `País` obligatorio.
- `Ciudad` opcional.
- `Estado` opcional.
- `Dirección` opcional.
- `Código postal` opcional.
- `Teléfono` opcional.
- `Página web` opcional.

#### 3. Descripción de la empresa

- Campo de texto libre para describir qué hace la empresa y su contexto comercial.

#### 4. Asistente IA

Solo aparece en modo creación.

Funciones:

- analiza el borrador actual,
- sugiere contenido para campos concretos,
- detecta posibles duplicados,
- puede bloquear temporalmente el modal mientras corre el análisis.

#### 5. Propietarios

- Obligatorio seleccionar al menos un usuario propietario.
- El modal muestra:
  - lista de propietarios seleccionados,
  - lista de usuarios disponibles para seleccionar.
- Si no hay propietarios, la creación se bloquea con error de validación local.

## Reglas funcionales

### Estado inicial de la cuenta

El usuario no selecciona el estado manualmente al crear.

La API resuelve el estado inicial así:

- con `cuentas.create`: la cuenta se crea `activada`,
- con `cuentas.request` y `accountsPendingEnabled = true`: la cuenta se crea en `pendiente_activacion`,
- sin una de esas combinaciones válidas: la API responde `403 No autorizado`.

### Propietarios

- Siempre debe existir al menos un propietario.
- El frontend valida esta condición antes del submit.
- La API también exige `ownerUserIds` con mínimo un elemento.

### Registro

- `registrationCode` no es obligatorio.
- Si se envía, se normaliza con `trim()` antes de persistir.

### Validación de catálogos

La creación depende de catálogos cargados previamente:

- países,
- tipos de cuenta,
- sectores económicos,
- estados de activación,
- usuarios propietarios.

Si falta el estado de activación resoluble en frontend o backend, la creación no continúa.

## Asistente IA del borrador

### Requisitos mínimos para ejecutar el análisis

- `Nombre`
- `País`

Sin esos datos, el botón/icono de análisis permanece deshabilitado.

### Qué envía el frontend

El análisis usa `POST /api/accounts/draft-analysis` con:

- borrador capturado en el modal,
- `allowExternalFetch: true`,
- `allowAiSynthesis: true`,
- `allowWebSearchTool: true`.

### Qué puede devolver la IA

- resumen general del borrador,
- advertencias,
- duplicados potenciales,
- sugerencias de:
  - descripción,
  - página web,
  - registro,
  - sector económico,
  - dirección,
  - ciudad,
  - estado,
  - código postal,
  - teléfono.

### Aplicación de sugerencias

- `Descripción`, `Página web`, `Registro` y `Sector económico` se aplican por acción individual.
- Los campos de `Ubicación y contacto` ahora también se aplican de forma independiente; cada icono solo actualiza su propio campo.

## Prevención de duplicados

Antes de persistir, la API ejecuta validación de duplicados.

### Posibles resultados

- `clear`: la creación sigue normalmente.
- `confirmation_required`: el sistema pide confirmación explícita.
- `review_required`: el sistema obliga a revisar antes de continuar.

### Señales usadas por el backend

- mismo registro en el país seleccionado,
- mismo dominio web,
- mismo nombre normalizado en el país,
- nombre casi idéntico,
- nombre similar o parcialmente coincidente,
- revisión adicional asistida por IA.

### Comportamiento en UI

Si la API responde `409` por duplicado:

- se abre una revisión de duplicados en el modal,
- se muestran coincidencias y su severidad,
- puede ejecutarse una revisión adicional con IA,
- el usuario puede:
  - volver a editar,
  - abrir una cuenta sugerida,
  - confirmar la creación si el caso lo permite.

Si el usuario confirma, el frontend reintenta el guardado con `allowDuplicateOverride: true`.

## Guardado final

### Endpoint principal

- `POST /api/accounts`

### Payload relevante

- `name`
- `accountTypeId`
- `registrationCode`
- `phone`
- `economicSectorId`
- `website`
- `city`
- `stateRegion`
- `countryId`
- `companyDescription`
- `addressLine`
- `postalCode`
- `activationStatusId`
- `ownerUserIds`
- `allowDuplicateOverride` cuando aplica

### Respuestas esperadas

- `201 Cuenta creada` cuando el usuario crea directamente.
- `201 Solicitud de cuenta creada en estado pendiente` cuando el usuario solo puede solicitar y la temporal está activa.
- `400 Datos inválidos` si falla validación de schema.
- `403 No autorizado` si no corresponde crear ni solicitar.
- `409` si hay conflicto por duplicado o por registro repetido en el mismo país.
- `500` si ocurre un error no controlado.

## Mensajes y validaciones en frontend

### Validaciones locales

- al menos un propietario,
- disponibilidad de estado de activación resoluble,
- normalización del nombre antes del submit.

### Mensajes relevantes

- éxito de creación o actualización,
- error por falta de propietarios,
- error por campos devueltos por `fieldErrors`,
- error genérico de creación,
- mensajes de sugerencias aplicadas desde IA.

## Secuencia resumida

1. El usuario abre `Crear cuenta`.
2. El frontend construye el formulario por defecto con país, tipo y propietario inicial cuando existen valores disponibles.
3. El usuario captura datos principales y propietarios.
4. Opcionalmente ejecuta el análisis IA sobre el borrador.
5. El usuario aplica sugerencias puntuales si le sirven.
6. Al guardar, el frontend valida propietarios y normaliza el nombre.
7. La API resuelve el estado inicial según permisos y temporales.
8. La API evalúa duplicados.
9. Si no hay bloqueo, la cuenta se inserta y se registran propietarios.
10. El frontend recarga la lista, cierra el modal y muestra mensaje de éxito.

## Notas operativas

- El flujo de creación comparte parte de la infraestructura del modal de edición, pero su comportamiento no es idéntico.
- El asistente IA y la revisión de duplicados solo forman parte del modo creación.
- El cambio manual de estado no es parte de este flujo; ocurre después y depende de permisos adicionales.