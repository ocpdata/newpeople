# NewPeople CRM — Frontend

SPA construida con React + Vite. Consume la API Express de `apps/api`.

## Stack

- React 18
- Vite 6
- React Router
- Axios (cliente HTTP con JWT)

## Estructura relevante

```
src/
  App.jsx       — componente raiz con toda la logica de modulos
  App.css       — estilos de componentes
  index.css     — estilos globales, layout y sistema de diseno
  api.js        — cliente axios con interceptor de Authorization
  main.jsx      — entrada de la aplicacion
```

## Levantar en desarrollo

```bash
npm run dev
```

Web disponible en http://localhost:5173.

## Build de produccion

```bash
npm run build
```

## Pruebas E2E

```bash
npm run test:e2e
```

Requiere Playwright instalado (`npx playwright install`).

## Modulos implementados

- Autenticacion (login, set-password con token temporal)
- Usuarios (lista paginada, alta/edicion en modal, auditoria)
- Roles (diseno 3 columnas: roles / permisos / usuarios del rol)
- Cuentas (lista paginada, alta/edicion en modal, propietarios, auditoria)
- Contactos (lista paginada, alta/edicion en modal, jerarquia, auditoria)
- Oportunidades (lista paginada, alta/edicion en modal, auditoria)
- Auditoria global (filtros, paginacion, entidad por nombre)

## Patron de encabezado unificado

Todos los modulos usan el mismo patron visual:

- Titulo con icono SVG (`.module-title-with-icon`).
- Subtitulo descriptivo (`.roles-subtitle`).
- Boton primario de creacion alineado a la derecha.
- Barra de filtros con pills de estado + campo de busqueda inline.

## Paginacion

Los modulos Usuarios, Cuentas, Contactos y Oportunidades incluyen controles de
paginacion con selector de registros por pagina (10 / 50 / 100) y navegacion
previo/siguiente.
