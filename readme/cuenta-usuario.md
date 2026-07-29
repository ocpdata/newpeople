# Cuenta de Usuario

## Objetivo

Permitir que cada usuario administre su perfil de cuenta en el CRM.

## Alcance

- Consulta de perfil actual.
- Actualizacion de datos personales permitidos.
- Actualizacion de avatar y metadatos visibles en la aplicacion.

## Ruta de UI

- `/account-settings`

## Dependencias

- Sesion autenticada del usuario.
- Endpoints de perfil/usuario autenticado.

## Reglas operativas

- El usuario solo modifica su propia cuenta desde este modulo.
- Cambios reflejan componentes globales (topbar/avatar, etc.).

## Estado actual (2026-07-29)

- Pantalla activa y enlazada desde cabecera de aplicacion.
