# Documentacion interna

Este directorio centraliza la documentacion funcional y tecnica por modulo.

## Indice

- [Usuarios](./usuarios.md)
- [Roles y permisos](./roles.md)
- [Cuentas](./cuentas.md)
- [Oportunidades](./oportunidades.md)
- [Contactos](./contactos.md)
- [Auditoria](./auditoria.md)
- [Pruebas](./pruebas.md)
- [Patron comun de listas y edicion](./patron-comun-listas-y-edicion.md)
- [Arquitectura de la aplicacion](./arquitectura-aplicacion.md)
- [Base de datos](./base-de-datos.md)

## Cambios recientes documentados

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
- Contactos: alta/edicion en modal, badge de estado solo lectura en modal de
  edicion, filtro de desactivados;
  paginacion con selector 10 / 50 / 100 registros por pagina.
- Auditoria: pantalla global con filtros, paginacion y entidad por nombre.
- UI global: encabezado unificado en todos los modulos (titulo con icono SVG,
  subtitulo, boton primario, barra pills + busqueda inline).

## Uso recomendado

1. Inicia en este archivo para ubicar el modulo.
2. Abre el README especifico del tema.
3. Actualiza el archivo del modulo cuando se hagan cambios relevantes.
