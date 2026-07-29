# Mapeo de Contactos

## Objetivo

Visualizar y mantener la jerarquia organizacional de contactos para mejorar navegacion politica y toma de decisiones en cuentas.

## Alcance

- Organigrama de contactos por relacion manager-report.
- Ordenamiento por poder de decision y jerarquia.
- Acceso al modal de edicion de contacto desde el mapa.

## Permisos y acceso

- Requiere permisos de lectura de contactos:
  - `contactos.read` o `contactos.read_all`

## Ruta de UI

- `/contact-mapping`

## Dependencias

- Reutiliza base funcional del modulo de contactos.
- Consume datos de contactos y sus relaciones jerarquicas.

## Reglas operativas

- Si un contacto no tiene manager valido, se trata como raiz.
- Se evita romper el render ante ciclos jerarquicos.
- El layout prioriza legibilidad por niveles y relaciones.

## Estado actual (2026-07-29)

- Vista activa en Gestion Comercial.
- Permite explorar estructura de influencia por cuenta en formato de organigrama.
