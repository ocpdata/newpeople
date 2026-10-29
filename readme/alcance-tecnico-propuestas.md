# Alcance técnico de propuestas y SOW

## Objetivo

Que cada propuesta pueda entregar, además del contenido comercial, el **alcance
técnico a la medida del cliente**: requerimientos, situación actual, solución
por partidas cotizadas, arquitectura, topología, alcance incluido y exclusiones,
supuestos, entregables, fases y criterios de aceptación. Además, un **SOW**
(alcance de trabajo) como documento separado.

## Cómo se construye

Tres fuentes de conocimiento, separadas a propósito:

| Capa | Contenido | Dónde vive |
|---|---|---|
| Conocimiento de la empresa y del fabricante | Cuestionarios, manuales, guías de diseño, arquitecturas de referencia, hojas de dimensionamiento | Documentación RAG, un tema por solución (por ejemplo `F5 Distributed Cloud Services`). **Nunca datos de clientes** |
| Playbook | Preguntas, reglas de verificación, esqueleto de alcance, exclusiones, supuestos, fases y plantillas de topología | Tablas `tech_playbooks` y `tech_playbook_versions` (versionado) |
| Datos del cliente | Respuestas del cuestionario, documentos entregados (configuraciones, diagramas) | Oportunidad (`opportunity_technical_answers`, documentos de la oportunidad) |

Temas de RAG usados hoy por los playbooks: `F5 Distributed Cloud Services` (F5 DCS),
`F5` (F5 NGINX) y `BlueCat` (Micetro, Edge, Integrity y Observabilidad). Los temas
compartidos funcionan porque cada consulta incluye el nombre de la solución, pero
un tema por producto da resultados más precisos. El tema de cada playbook se
elige en `/technical-playbooks` con un selector de los temas existentes en
Documentación RAG, y la API rechaza un nombre que no exista.

Versiones: cada guardado crea una versión nueva. La excepción es un playbook en
`borrador_ia` cuya versión actual ninguna propuesta ha usado: ahí el botón
**Guardar cambios en la versión N** la edita en sitio. Las versiones validadas o
ya usadas por una propuesta nunca se modifican.

Soluciones con playbook semilla (estado `borrador_ia`): F5 Distributed Cloud
Services, F5 NGINX, BlueCat Micetro, BlueCat Edge, BlueCat Integrity y BlueCat
Observabilidad (LiveNX, LiveWire y LiveAssist). Los playbooks semilla son un
punto de partida general; se enriquecen con el botón **Generar borrador** de
`/technical-playbooks`, que lee el tema RAG de la solución y señales
generalizadas del CRM (preguntas frecuentes y productos típicos, sin respuestas
ni nombres de clientes) y crea una nueva versión.

El borrador se arma con varias llamadas pequeñas (esquema, alcance, topologías,
preguntas por módulo y reglas) porque el gateway delante del proveedor de IA
corta cada solicitud a ~30 s; por eso todas las capacidades de este módulo usan
el modelo rápido y reintentan ante tiempos de espera. Reglas del borrador:
máximo 8 preguntas por módulo (10 las generales) y 3 obligatorias; las reglas
que propone la IA siempre quedan como advertencia; las reglas y preguntas del
playbook semilla (por ejemplo LiveAssist requiere LiveNX) se conservan al
regenerar.

Tipos de documento del RAG (se infieren del nombre `[Tipo] Título`): cuestionario,
manual, guía de diseño, guía de implementación, arquitectura de referencia,
configuración modelo, hoja de dimensionamiento y otro. El tipo es una preferencia
al consultar: si no hay documentos de ese tipo se busca en todo el tema.

## Dónde se usa

Módulo **Propuestas** (`/proposals-new`, documentos de propuesta). El alcance
técnico y el SOW cuelgan del documento de propuesta (`proposal_documents`), que ya
pertenece a una oportunidad. El módulo anterior (`/proposals`) no los incluye.

Hay dos tipos de propuesta:

- **Básica.** Información general de la solución y de los servicios, a partir de
  la plantilla. No requiere aprobación: se imprime, envía y finaliza como siempre.
- **Con alcance técnico.** Se marca **Incluir alcance técnico y SOW** al crearla
  (o se inicia después desde el editor). Requiere la aprobación del preventa
  antes de abrir el PDF, enviarla por correo o finalizarla. El cuestionario se
  captura desde el momento de crearla.

## Flujo en la propuesta

Botón **Alcance técnico y SOW** en el editor de la propuesta (grupo "Alcance
técnico"), que abre un panel lateral separado del editor de texto:

1. **Cuestionario.** Se sugieren las soluciones según la plantilla, el nombre de
   la oportunidad y las partidas cotizadas (si la propuesta tiene cotización;
   una propuesta sin cotización puede llevar alcance, que se basa solo en el
   cuestionario y no se verifica contra partidas).
   Las respuestas se capturan aquí pero viven en la oportunidad (se reutilizan en
   nuevas versiones de propuesta y en el SOW). Las respuestas sugeridas por
   documentos, CRM o IA quedan *pendientes de confirmar*; una respuesta
   confirmada por una persona nunca se sobrescribe automáticamente.
2. **Documentos del cliente.** *Analizar documentos* procesa los archivos de la
   oportunidad: configuraciones (`.conf`, `.cfg`, `.yaml`, `.yml`, `.json`,
   `.xml`, `.tf`), diagramas `.drawio` e imágenes, además de PDF, DOCX, etc. Los
   secretos (contraseñas, comunidades SNMP, llaves, tokens) se enmascaran antes
   de guardarse y de llegar a cualquier modelo de IA. Los conteos (aplicaciones,
   zonas DNS, subredes) los calcula un analizador determinista, no la IA. Un
   diagrama del cliente puede usarse como topología de *situación actual*.
3. **Alcance.** Se genera un borrador desde el playbook, las respuestas
   confirmadas y las partidas cotizadas (sin precios), y la IA lo personaliza por
   sección. Si la IA no está disponible se conserva el borrador del playbook. Las
   secciones editadas a mano se conservan al regenerar todo. Cada sección se
   edita con el mismo editor de texto enriquecido de Propuestas (negrita,
   cursiva, subtítulo, listas y tablas; sin imágenes ni saltos de página) y hay
   una **Vista previa del documento**. El servidor guarda el contenido del editor
   (`content`, saneado: solo texto, subtítulos, listas, tablas, negrita, cursiva
   y enlaces http/mailto) y deriva de él los bloques de texto que usan la IA y
   la verificación. El PDF imprime ese contenido directamente.
4. **Topología.** Editor visual (React Flow) con zonas, componentes, enlaces y
   componentes *bloqueados* que la IA no modifica al volver a proponer. El mismo
   JSON se dibuja en el PDF con un renderizador compartido
   (`shared/topology.js`), así que el PDF coincide con lo editado.
5. **Verificación.** Reglas deterministas: partidas cotizadas sin cubrir,
   referencias a productos inexistentes, información comercial interna,
   expectativas del playbook (por ejemplo sitios Customer Edge sin producto
   cotizado) y dependencias (LiveAssist requiere LiveNX cotizado o instalado).
6. **Aprobación.** `borrador → en revisión → aprobada`.

## Aprobación y bloqueo de impresión

- Aprueba el **preventa asignado a la oportunidad** o un usuario con el permiso
  `propuestas.alcance_tecnico.approve`, incluso sobre su propia propuesta; en ese
  caso queda registrado `self_approved` y un evento de auditoría.
- Requiere lista de verificación y cero hallazgos bloqueantes.
- La aprobación se ata al **hash** del contenido (secciones, topologías, versión
  de cotización y copia congelada de las respuestas). Cualquier edición posterior
  la invalida; también un cambio de versión de cotización.
- Mientras no esté aprobado, el servidor rechaza con `409` `GET
  /api/proposal-documents/v1/proposal-documents/:id/pdf`, `POST .../send-email`
  y `POST .../publish` (`not_approved`, `modified`, `quotation_changed`). El
  contenido lo lee siempre el servidor desde la base, nunca el navegador. Los
  botones Ver PDF, Enviar por correo y Finalizar propuesta se deshabilitan según
  `GET .../technical-scope/gate`.
- Con el alcance aprobado, el PDF **reemplaza la sección "Descripción de la
  solución"** por las secciones técnicas aprobadas. Si el documento no tiene esa
  sección, se colocan antes de "Servicios" o "Siguientes pasos", o al final. El
  editor de texto no se modifica: el reemplazo ocurre solo al generar el PDF.
- La regla solo aplica a propuestas que iniciaron el alcance técnico. Se puede
  descartar el alcance para volver a propuesta básica (queda auditado).
- La cotización de referencia es la que el documento guardó al crearse
  (`metadata.quotation_version_id`); sin cotización se usa `0` en el hash.

## SOW

Documento separado, derivado del alcance técnico (no de texto duplicado). Las
condiciones comerciales (tiempo de entrega, condiciones de pago, vigencia,
garantía) salen de la cotización; la IA solo personaliza el objetivo. Lo aprueba
el preventa con la misma regla de hash, y solo si el alcance técnico está
aprobado y sin cambios (`stale` si el alcance cambió). `POST
.../sow/pdf` devuelve el PDF solo con el SOW aprobado, dibujado con el mismo
formato, portada y logos de la propuesta (etiqueta "Alcance de trabajo (SOW)").
Al enviar la propuesta por correo se puede **adjuntar el SOW** (`attach_sow`),
solo si está aprobado (`sow_not_approved` en caso contrario).

## Permisos

| Permiso | Uso |
|---|---|
| `propuestas.alcance_tecnico.update` | Capturar el cuestionario, generar y editar el alcance y el SOW |
| `propuestas.alcance_tecnico.approve` | Aprobar alcance y SOW (el preventa asignado también puede) |
| `playbooks.manage` | Administrar playbooks (`/technical-playbooks`) |

Administrador los recibe siempre al arrancar la API; `Preventa` los recibe en la inicialización de roles.

## Endpoints

Prefijo `/api/proposal-documents/v1/proposal-documents/:id`:

- Propuesta: `GET|POST|DELETE .../technical-scope`, `GET .../technical-scope/gate`,
  `PUT .../selections`, `PUT .../answers`, `POST .../answers/confirm`, `POST
  .../analyze-documents`, `POST .../generate`, `PUT .../sections/:code`, `PUT
  .../topology`, `POST .../topology/propose`, `GET .../verification`, `POST
  .../submit`, `POST .../approve`, `POST .../return-to-draft`.
- SOW: `GET .../sow`, `POST .../sow/generate`, `PUT .../sow/sections/:code`,
  `POST .../sow/submit|approve|return-to-draft|pdf`.
- Salida: `GET .../pdf`, `POST .../send-email` y `POST .../publish` aplican el
  bloqueo.
- Acceso: administradores de cotizaciones, dueños de la cuenta y el preventa de
  la oportunidad.
- Playbooks: `GET|POST /api/technical-playbooks`, `GET
  /api/technical-playbooks/diagnostic` (conteo de evidencia en el CRM por
  solución), `GET|PUT|PATCH /api/technical-playbooks/:code`, `POST
  .../generate-draft`.
- RAG: `PATCH /api/documentacion-rag/documents/:id/classification`.

## IA

Capacidades registradas bajo el módulo **Propuestas** (`proposals.technical_scope.*`):
`sections`, `topology`, `prefill`, `document_facts`, `diagram`, `playbook_draft`,
`sow`. Usan el presupuesto, el registro de consumo y los modelos configurados en
Configuración > Servicios de IA. La generación del alcance corre ~12 llamadas en
paralelo (≈40–60 s en total); el cliente web usa un tiempo de espera ampliado.
Si hay un proxy delante de la API, su límite debe ser mayor a 2 minutos.

## Pruebas

```bash
cd apps/api
npx vitest run --maxWorkers=1 test/technical-scope.unit.test.js test/technical-scope.integration.test.js
cd ../web
npx playwright test e2e/technical-scope.spec.js
```

## Pendiente / siguientes pasos

- Cargar la documentación de cada solución en su tema de Documentación RAG y
  generar el borrador de playbook; validarlo cuando se decida.
- Importación de diagramas de Visio (`.vsdx`) y analizadores específicos para
  más formatos de configuración (F5, BlueCat).
- Iconografía oficial de fabricantes en el editor de topología (hoy formas con
  color por fabricante).
