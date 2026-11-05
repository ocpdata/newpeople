function formatPermissionModuleName(moduleName) {
  if (moduleName === "mi_coach") {
    return "Coach";
  }
  if (moduleName === "inteligencia_comercial") {
    return "Cliente existente · Inteligencia comercial";
  }
  if (moduleName === "prospeccion") {
    return "Cuenta nueva · Prospección";
  }
  if (moduleName === "interacciones") {
    return "Leads";
  }
  if (moduleName === "comercial") {
    return "Perfil de vendedor";
  }
  if (moduleName === "campanas") {
    return "Campañas";
  }
  if (moduleName === "calendario_comercial") {
    return "Agenda";
  }
  if (moduleName === "audit") {
    return "Auditoría";
  }
  if (moduleName === "aceptar_pedido") {
    return "Aceptación de pedidos";
  }
  if (moduleName === "seguimiento_comercial") {
    return "Embudo de ventas";
  }
  if (moduleName === "ritmo_comercial") {
    return "Ritmo comercial";
  }
  if (moduleName === "registros_fabricantes") {
    return "Registros con fabricantes";
  }
  if (moduleName === "pruebas") {
    return "Pruebas de seguridad";
  }
  if (moduleName === "proceso_comercial_config") {
    return "Preguntas por etapa";
  }
  if (moduleName === "playbooks") {
    return "Playbooks técnicos";
  }
  if (moduleName === "planeacion_comercial") {
    return "Metas y comisiones";
  }
  if (moduleName === "landing") {
    return "Páginas de captación";
  }
  if (moduleName === "ia") {
    return "Crédito y consumo de IA";
  }
  if (moduleName === "herramientas") {
    return "Herramientas del sistema";
  }
  if (moduleName === "enablement_comercial") {
    return "Biblioteca comercial";
  }
  if (moduleName === "documentacion_rag") {
    return "Base de conocimiento IA";
  }
  if (moduleName === "configuracion") {
    return "Configuración general";
  }
  if (moduleName === "proveedores_precios") {
    return "Listas de precios de proveedores";
  }
  return moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
}

const PERMISSION_MODULE_DESCRIPTIONS = {
  reportes:
    "Habilita cada reporte de forma independiente, sin permisos de los modulos de origen. Datos propios corresponde al vendedor asignado actual de la oportunidad; todos los usuarios permite consulta global. Cada permiso de reporte incluye acceso al modulo y a todas sus columnas y detalles.",
  roles:
    "Define los perfiles de acceso: consulta roles y sus usuarios, crea roles personalizados y administra sus permisos. Asignar roles a usuarios requiere un permiso aparte.",
  registros_fabricantes:
    "Da seguimiento a los registros de fabricante vinculados a oportunidades: consulta solicitudes, aprobaciones, vencimientos y renovaciones. El acceso a cada oportunidad también depende de los permisos comerciales asignados.",
  pruebas:
    "Permite revisar ejecuciones y reportes de pruebas controladas de seguridad, como validaciones del WAF, límites de solicitudes y defensas de API. Algunas pruebas avanzadas requieren permisos administrativos.",
  proceso_comercial_config:
    "Configura las preguntas que se muestran al registrar información de una oportunidad en cada etapa de venta. Permite consultar el catálogo o, con permiso de edición, crear preguntas, ajustar su contenido y orden, y activarlas o desactivarlas; no cambia las etapas comerciales.",
  playbooks:
    "Centraliza por solución las preguntas técnicas, reglas de validación y dimensionamiento, estructura del alcance y plantillas de topología. El contenido se versiona y sirve como base para las propuestas; el preventa revisa y aprueba el resultado.",
  planeacion_comercial:
    "Define las metas trimestrales por vendedor y las tasas de comisión, y permite consultar el seguimiento de ventas aceptadas y comisiones. La consulta, creación inicial, edición y revisión de cambios se controlan con permisos independientes.",
  landing:
    "Crea y administra páginas de captación para eventos, sus versiones y publicación. También permite consultar los envíos de formularios y gestionar su procesamiento hacia el CRM mediante permisos separados.",
  propuestas:
    "Consulta y prepara propuestas comerciales y sus documentos: revisa propuestas existentes, crea nuevas y actualiza su contenido. Las acciones de cotización y aprobación siguen sujetas a sus permisos específicos.",
  proveedores:
    "Administra el catálogo de proveedores: consulta sus datos y contactos, crea proveedores y actualiza su información o estado. Las listas de precios tienen permisos separados.",
  proveedores_precios:
    "Administra listas de precios y sus productos, servicios o grupos: consulta, crea y actualiza precios y estados. Requiere acceso al proveedor correspondiente.",
  ritmo_comercial:
    "Da seguimiento al desempeño comercial con métricas de cuota, pipeline del trimestre, oportunidades, leads y conversiones. Cada vendedor consulta su propio resultado; el ranking, el detalle del equipo y la vista en pantalla requieren permisos adicionales.",
  seguimiento_comercial:
    "Consulta oportunidades abiertas y ganadas por periodo, y detecta riesgos como bloqueos, falta de actividad o ausencia de un siguiente paso.",
  usuarios:
    "Administra las cuentas de usuario: consulta el directorio, crea usuarios y actualiza sus datos, acceso y estado según los permisos asignados.",
  cuentas:
    "Administra las cuentas comerciales, sus datos fiscales y de contacto, estado de activación y propietarios. La consulta puede limitarse a las cuentas propias o ampliarse a todas; el alta directa, las solicitudes pendientes, la edición y la asignación de propietarios se controlan con permisos distintos.",
  contactos:
    "Administra la información y relación de los contactos vinculados a cuentas, incluidos sus datos de contacto, función, influencia y estado. El acceso sigue el alcance de las cuentas propias o puede ampliarse con un permiso global; alta directa, solicitudes pendientes y edición tienen permisos separados.",
  cotizaciones:
    "Gestiona el ciclo de cotización desde la preparación hasta la aprobación y el resultado comercial. Los permisos distinguen operación de ventas, ingreso de logística, revisión y aprobación humana o con IA; la administración amplia y la consulta de cliente son accesos separados.",
  permissions:
    "Consulta el catálogo de permisos disponibles para configurar el acceso de cada rol.",
  interacciones:
    "Gestiona el ciclo de los leads: consulta la bandeja y los tableros, registra y actualiza leads, analiza su información y convierte los casos resueltos en registros del CRM. El alcance de consulta y la asignación a vendedores dependen de permisos específicos.",
  comercial:
    "Identifica a los usuarios que pueden ser asignados como vendedores al resolver leads. Este perfil solo habilita la elegibilidad; el acceso a leads y los permisos para asignarlos se configuran por separado.",
  campanas:
    "Administra campañas de marketing y su contexto comercial: consulta catálogos, campañas, sugerencias de cuentas y audiencias; crea campañas y actualiza sus datos y la audiencia por cuenta y contacto. La consulta, creación y edición dependen de permisos separados.",
  calendario_comercial:
    "Consulta y organiza actividades comerciales en la agenda, revisa pendientes y alertas, y da seguimiento a compromisos. La visibilidad de la agenda propia o del equipo y la gestión de actividades se controlan con permisos independientes; editar actividades de oportunidades también requiere los permisos correspondientes de oportunidades.",
  audit:
    "Consulta la bitácora transversal de eventos de seguridad y operaciones del sistema, con filtros por fecha, módulo, acción, entidad, estado y usuario. Permite revisar quién realizó cada acción y los cambios registrados; es de solo lectura y no incluye exportación.",
  aceptar_pedido:
    "Da seguimiento al cierre y procesamiento posterior a la aceptación de cotizaciones: consulta etapas y documentos, actualiza el flujo operativo, genera resúmenes con IA y envía convocatorias. La edición, el uso de IA y el envío de convocatorias requieren permisos específicos.",
  ia:
    "Consulta el crédito y el consumo de IA propio o de la organización, revisa reportes agregados y administra límites, asignaciones y tarifas de proveedores. El acceso personal, la consulta global y la administración se controlan por separado.",
  herramientas:
    "Reúne herramientas administrativas para revisar incidencias en datos operativos y aplicar correcciones controladas. Actualmente incluye el diagnóstico y la consolidación auditada de duplicados en listas de precios; cada acción requiere su permiso específico.",
  enablement_comercial:
    "Centraliza materiales comerciales vigentes —archivos y enlaces— para encontrarlos, previsualizarlos y usarlos en oportunidades, leads, propuestas y correos. Incluye carga, edición, publicación y control de catálogos; la visibilidad para clientes y los cambios sobre materiales ajenos dependen del permiso asignado.",
  documentacion_rag:
    "Organiza documentos internos por temas para que la IA los consulte como fuente de conocimiento. La biblioteca permite revisar los temas y documentos, mientras que los permisos de administración controlan su importación, carga, actualización, clasificación y eliminación. El acceso a esta pantalla no es requisito para consultar documentos activos desde el chatbot.",
};
const ROLE_PERMISSION_LABELS = {
  "reportes.access": { label: "Acceder al modulo Reportes" },
  "reportes.oportunidades_cotizaciones.read": { label: "Oportunidades y cotizaciones: datos propios" },
  "reportes.oportunidades_cotizaciones.read_all": { label: "Oportunidades y cotizaciones: todos los usuarios" },
  "reportes.rentabilidad.read": { label: "Rentabilidad: datos propios" },
  "reportes.rentabilidad.read_all": { label: "Rentabilidad: todos los usuarios" },
  "roles.read": {
    label: "Consultar roles",
    description:
      "Ver los roles disponibles, los permisos configurados y los usuarios asignados a cada rol.",
  },
  "roles.create": {
    label: "Crear roles",
    description: "Crear perfiles de acceso personalizados con nombre y descripción.",
  },
  "roles.update": {
    label: "Administrar roles y permisos",
    description:
      "Editar, activar o desactivar roles personalizados y definir los permisos que incluyen. No permite modificar roles del sistema.",
  },
  "roles.assign": {
    label: "Asignar roles a usuarios",
    description:
      "Cambiar los roles asignados a una cuenta de usuario; no concede permiso para editar los roles.",
  },
  "permissions.read": {
    label: "Consultar el catálogo de permisos",
    description:
      "Ver los permisos disponibles para configurar el acceso de cada rol.",
  },
  "pruebas.read": {
    label: "Consultar pruebas de seguridad",
    description:
      "Ver ejecuciones, su estado y los reportes de las pruebas de seguridad.",
  },
  "pruebas.execute": {
    label: "Ejecutar pruebas de seguridad",
    description:
      "Iniciar y cancelar pruebas controladas con perfiles permitidos; las pruebas avanzadas requieren autorización administrativa.",
  },
  "pruebas.admin": {
    label: "Administrar pruebas avanzadas",
    description:
      "Ejecutar pruebas restringidas, como perfiles F5, DDoS L7 y pruebas de API, y eliminar ejecuciones finalizadas.",
  },
  "contactos.create": {
    label: "Crear contactos activos",
    description:
      "Crear contactos activos asociados a una cuenta accesible, sujetos a validaciones y revisión de posibles duplicados. Junto con contactos.update permite cambiar el estado; elegir otra cuenta requiere acceso a ella.",
  },
  "contactos.read": {
    label: "Consultar contactos de cuentas asignadas",
    description:
      "Ver los contactos asociados a cuentas de las que eres propietario. Para ampliar la consulta a contactos de otras cuentas se requiere además contactos.read_all. No permite crear ni editar contactos.",
  },
  "contactos.read_all": {
    label: "Consultar contactos de todas las cuentas",
    description:
      "Ampliar a todas las cuentas el alcance de contactos.read. Requiere también contactos.read; junto con permisos de creación o edición, permite operar contactos de otras cuentas. No concede creación ni edición por sí solo.",
  },
  "contactos.request": {
    label: "Solicitar alta de contactos",
    description:
      "Registrar contactos nuevos como Pendientes de activación para revisión, si el flujo de pendientes está habilitado. No permite activarlos; si también tienes contactos.create, se crean activados.",
  },
  "contactos.update": {
    label: "Editar contactos",
    description:
      "Actualizar los datos y la información relacional de contactos dentro de tu alcance. No permite crearlos; cambiar su estado de activación requiere también contactos.create. contactos.read_all amplía el alcance a contactos de todas las cuentas.",
  },
  "cuentas.assign_owners_any": {
    label: "Asignar propietarios de cuentas",
    description:
      "Elegir propietarios al crear una cuenta (con cuentas.create o cuentas.request) o editarla (con cuentas.update). Sin este permiso, la cuenta nueva se asigna a quien la crea y la edición conserva sus propietarios. No amplía el acceso a otras cuentas.",
  },
  "cuentas.create": {
    label: "Crear cuentas activas",
    description:
      "Crear cuentas directamente activadas, sujetas a la validación de datos y duplicados. Junto con cuentas.update permite cambiar el estado de activación; elegir otros propietarios requiere además cuentas.assign_owners_any.",
  },
  "cuentas.read": {
    label: "Consultar cuentas asignadas",
    description:
      "Consultar el listado y los datos de las cuentas de las que eres propietario. Para ampliar el alcance a todas las cuentas se requiere además cuentas.read_all. No permite crear ni editar cuentas.",
  },
  "cuentas.read_all": {
    label: "Consultar todas las cuentas",
    description:
      "Ampliar a todas las cuentas el alcance de cuentas.read. Para consultar se requiere también cuentas.read; junto con cuentas.update permite editar cuentas ajenas. No concede creación ni asignación de propietarios.",
  },
  "cuentas.request": {
    label: "Solicitar alta de cuentas",
    description:
      "Registrar nuevas cuentas como Pendientes de activación para revisión, si el flujo de pendientes está habilitado. No permite activarlas; si también tienes cuentas.create, se crean activadas.",
  },
  "cuentas.update": {
    label: "Editar cuentas",
    description:
      "Editar los datos de cuentas a las que tienes acceso. No permite crearlas; cambiar su estado requiere también cuentas.create y elegir propietarios requiere cuentas.assign_owners_any. cuentas.read_all amplía el alcance de edición a todas.",
  },
  "herramientas.read": {
    label: "Consultar herramientas del sistema",
    description:
      "Consultar el catálogo, revisar incidencias y ver los grupos duplicados en listas de precios, su detalle y referencias antes de decidir una acción.",
  },
  "herramientas.update": {
    label: "Aplicar correcciones en herramientas",
    description:
      "Consolidar grupos de productos duplicados en listas de precios, archivando duplicados o eliminándolos cuando la validación lo permite. Las acciones quedan auditadas.",
  },
  "herramientas.admin": {
    label: "Administrar herramientas avanzadas",
    description:
      "Permiso previsto para acciones administrativas avanzadas. Actualmente las herramientas disponibles se controlan con herramientas.read y herramientas.update; este permiso no habilita acciones adicionales.",
  },
  "enablement_comercial.use": {
    label: "Buscar y usar materiales comerciales",
    description:
      "Consultar materiales activos, revisar su detalle y usarlos, por ejemplo, descargarlos, marcarlos como favoritos o generar enlaces compartibles cuando el material lo permite. No concede carga ni edición.",
  },
  "documentacion_rag.access": {
    label: "Consultar la base de conocimiento IA",
    description:
      "Entrar al módulo para consultar los temas, documentos y su estado. No permite importar, cargar, reemplazar, clasificar ni eliminar contenido; el chatbot puede consultar documentos activos sin este permiso.",
  },
  "documentacion_rag.manage": {
    label: "Administrar la base de conocimiento IA",
    description:
      "Gestionar temas y documentos: importar desde Pinecone Assistant, cargar o reemplazar archivos, actualizar resúmenes y clasificación, eliminar documentos y habilitar o deshabilitar temas. Incluye acceso de consulta.",
  },
  "enablement_comercial.upload": {
    label: "Cargar y editar materiales propios",
    description:
      "Crear materiales y editar los propios, incluidos sus archivos o enlaces; permite activarlos y desactivarlos. No permite modificar o eliminar materiales ajenos ni administrar catálogos.",
  },
  "enablement_comercial.manage": {
    label: "Gestionar todos los materiales",
    description:
      "Editar, activar o desactivar materiales de cualquier usuario y eliminar materiales. No concede administración de los catálogos de la biblioteca.",
  },
  "enablement_comercial.admin": {
    label: "Administrar catálogos de la biblioteca",
    description:
      "Crear, editar y eliminar valores de catálogos como tipos, fabricantes, tecnologías y soluciones. También permite gestionar materiales de cualquier usuario, incluidos los restringidos.",
  },
  "enablement_comercial.read": {
    label: "Consultar biblioteca (compatibilidad)",
    description:
      "Permiso heredado que conserva acceso de consulta a materiales activos. No permite cargarlos, editarlos ni administrar catálogos.",
  },
  "enablement_comercial.update": {
    label: "Cargar y editar materiales propios (compatibilidad)",
    description:
      "Permiso heredado que conserva las capacidades de carga y edición de materiales propios, incluida su activación o desactivación; no permite administrar materiales ajenos ni catálogos.",
  },
  "enablement_comercial.analytics": {
    label: "Consultar biblioteca (permiso heredado)",
    description:
      "Código heredado que actualmente conserva acceso de consulta a materiales activos. No habilita reportes o analítica de uso ni permite modificar materiales.",
  },
  "interacciones.read": {
    label: "Consultar leads asignados",
    description:
      "Ver la bandeja y el detalle de los leads dentro del alcance asignado. No concede acceso global ni permite crear o modificar leads.",
  },
  "interacciones.read_all": {
    label: "Consultar todos los leads",
    description:
      "Ampliar la consulta de leads más allá del alcance individual, incluida la vista global. No concede permiso para crear, editar, analizar o resolver leads.",
  },
  "interacciones.create": {
    label: "Registrar leads",
    description:
      "Crear un lead y registrar sus datos iniciales, incluidos los documentos asociados al ingreso. No concede permiso para editar o resolver otros leads.",
  },
  "interacciones.update": {
    label: "Actualizar y dar seguimiento a leads",
    description:
      "Editar leads y gestionar su información, documentos y seguimiento, como registrar resultados de llamadas o enviar correos asociados. El acceso sigue limitado al alcance permitido.",
  },
  "interacciones.analyze": {
    label: "Analizar leads",
    description:
      "Ejecutar o consultar el análisis del lead para obtener hallazgos y sugerencias de posibles cuentas, contactos u oportunidades. No aplica por sí solo esos cambios en el CRM.",
  },
  "interacciones.resolve": {
    label: "Resolver leads y vincular registros",
    description:
      "Revisar las sugerencias del lead y vincular o crear los registros correspondientes en el CRM. Para asignarlo a un vendedor se necesita además un permiso de asignación.",
  },
  "interacciones.dashboard.access": {
    label: "Acceder a tableros de leads",
    description:
      "Habilitar la entrada a los tableros de leads. Cada tablero requiere además su permiso de visualización, salvo que se tenga acceso global.",
  },
  "interacciones.dashboard.executive.view": {
    label: "Ver tablero ejecutivo de leads",
    description:
      "Consultar los indicadores ejecutivos del desempeño y avance de los leads.",
  },
  "interacciones.dashboard.management.view": {
    label: "Ver tablero de gestión de leads",
    description:
      "Consultar los indicadores de gestión comercial y seguimiento de los leads.",
  },
  "interacciones.dashboard.operations.view": {
    label: "Ver tablero operativo de leads",
    description:
      "Consultar la situación operativa de la bandeja y el estado de atención de los leads.",
  },
  "interacciones.dashboard.drilldown.view": {
    label: "Abrir detalle de tableros de leads",
    description:
      "Permiso previsto para abrir desde un tablero el detalle de sus indicadores en la bandeja. La consulta de leads sigue sujeta al alcance de lectura.",
  },
  "interacciones.resolve.assign_self": {
    label: "Asignar leads al usuario actual",
    description:
      "Al resolver un lead creado por ti, asignarlo únicamente a tu usuario. Requiere también interacciones.resolve y que seas elegible como vendedor.",
  },
  "campanas.read": {
    label: "Consultar campañas",
    description:
      "Consultar catálogos, campañas, sugerencias de cuentas y la audiencia asociada. No permite crear ni modificar campañas.",
  },
  "campanas.create": {
    label: "Crear campañas",
    description:
      "Crear campañas con su contexto comercial, tipo, subtipo y etapa objetivo, sujeto a las combinaciones permitidas. No concede edición posterior.",
  },
  "campanas.update": {
    label: "Editar campañas y audiencia",
    description:
      "Modificar los datos y el estado de las campañas, y administrar su audiencia por cuenta y los contactos asociados.",
  },
  "calendario_comercial.read": {
    label: "Consultar mi agenda",
    description:
      "Consultar las actividades y alertas de la agenda propia. No permite ver la agenda de otros vendedores ni crear o modificar actividades.",
  },
  "calendario_comercial.read_all": {
    label: "Consultar la agenda del equipo",
    description:
      "Consultar las actividades y alertas de todos los vendedores y seleccionar a quién mostrar en la agenda. No concede permisos para crear o modificar actividades.",
  },
  "calendario_comercial.update": {
    label: "Gestionar actividades de la agenda",
    description:
      "Crear actividades, reprogramarlas y actualizar su estado desde la agenda. Las actividades de oportunidades también requieren los permisos correspondientes para modificar esas oportunidades.",
  },
  "comercial.seller.eligible": {
    label: "Habilitar perfil de vendedor",
    description:
      "Permite que el usuario sea seleccionado o autoasignado como vendedor al resolver leads. No concede acceso a leads ni capacidad para asignarlos; esas acciones requieren permisos independientes.",
  },
  "ia.budget.read_self": {
    label: "Consultar mi crédito y consumo de IA",
    description:
      "Consultar el crédito disponible y el consumo de IA asociados a tu propio usuario; no permite consultar datos de otras personas.",
  },
  "ia.budget.read_all": {
    label: "Consultar crédito y consumo de todos",
    description:
      "Consultar saldos, consumo y detalle de uso de IA de cualquier usuario, además de tarifas y reportes agregados. No permite modificar créditos ni políticas.",
  },
  "ia.budget.manage": {
    label: "Administrar crédito y servicios de IA",
    description:
      "Configurar límites y políticas de consumo, asignaciones de crédito por usuario y tarifas de modelos de IA, incluida su sincronización y vigencia.",
  },
  "ia.usage.read_all": {
    label: "Consultar reportes de uso de IA",
    description:
      "Consultar reportes agregados de consumo de IA por usuario, proveedor u otros criterios disponibles. No permite ver o modificar la configuración de crédito.",
  },
  "interacciones.resolve.assign_any": {
    label: "Asignar leads a cualquier vendedor",
    description:
      "Al resolver un lead, elegir cualquier vendedor elegible para asignárselo. Requiere también interacciones.resolve.",
  },
  "proceso_comercial_config.read": {
    label: "Consultar preguntas por etapa",
    description:
      "Ver las preguntas activas e inactivas y su configuración para cada etapa de venta.",
  },
  "proceso_comercial_config.update": {
    label: "Administrar preguntas por etapa",
    description:
      "Crear y editar preguntas, definir si son obligatorias y su tipo de respuesta, cambiar su orden y activarlas o desactivarlas.",
  },
  "playbooks.manage": {
    label: "Administrar playbooks técnicos",
    description:
      "Editar playbooks por solución y sus metadatos, vincular su tema de Documentación RAG, generar borradores y guardar versiones. No concede por sí solo permiso para aprobar propuestas.",
  },
  "oportunidades.read": {
    label: "Consultar oportunidades y sus notas",
    description:
      "Consultar el listado, los datos y las notas de las oportunidades de cuentas de las que seas propietario. No concede creación ni edición; para consultar oportunidades de todas las cuentas también necesitas oportunidades.read_all.",
  },
  "oportunidades.update": {
    label: "Editar oportunidades y agregar notas",
    description:
      "Editar oportunidades accesibles, agregar notas y operar su flujo comercial, sujeto a las validaciones y reglas de cierre. Cambiar la activación requiere oportunidades.create; editar oportunidades ganadas requiere oportunidades.update_won.",
  },
  "oportunidades.notes.create": {
    label: "Crear nota (temporal)",
    description:
      "Permiso temporal de pruebas; no habilita por sí solo el registro de notas. La creación real requiere oportunidades.update.",
  },
  "oportunidades.notes.read": {
    label: "Consultar notas (temporal)",
    description:
      "Permiso temporal de pruebas; no habilita por sí solo la consulta de notas. La lectura real requiere oportunidades.read.",
  },
  "oportunidades.read_all": {
    label: "Consultar oportunidades de todas las cuentas",
    description:
      "Amplía a todas las cuentas el alcance de las oportunidades y de los registros relacionados. Requiere oportunidades.read y no concede creación ni edición.",
  },
  "oportunidades.request": {
    label: "Solicitar alta de oportunidades",
    description:
      "Registrar solicitudes de alta de oportunidades como Pendientes de activación para su revisión. No las activa; su disponibilidad depende de la configuración del flujo de pendientes.",
  },
  "oportunidades.create": {
    label: "Crear oportunidades",
    description:
      "Crear oportunidades activadas, sujeto a las validaciones del sistema. Junto con oportunidades.update permite los cambios de activación previstos; no concede por sí solo la edición de oportunidades ganadas.",
  },
  "oportunidades.update_won": {
    label: "Editar oportunidades ganadas",
    description:
      "Editar campos de oportunidades ganadas junto con oportunidades.update. No las reabre ni permite cambiar su etapa o estado comercial; solo aplica a oportunidades accesibles.",
  },
  "oportunidades.change_closed_status": {
    label: "Cambiar estado de oportunidades cerradas",
    description:
      "Corregir el cierre o reabrir oportunidades accesibles con motivo y auditoría. Requiere oportunidades.update. No concede edición general de Ganadas ni cambios de etapa.",
  },
  "oportunidades.bypass_stage_validation": {
    label: "Omitir validación al avanzar de etapa",
    description:
      "Avanzar manualmente a la siguiente etapa sin completar la validación habitual, dejando un motivo en auditoría. Solo aplica a oportunidades accesibles y no cerradas; no concede edición general.",
  },
  "oportunidades.bypass_demostracion_validation": {
    label: "Omitir validación en Demostración",
    description:
      "Avanzar manualmente desde Demostración sin completar su validación habitual, dejando un motivo en auditoría. No habilita excepciones en otras etapas ni concede edición general.",
  },
  "landing.read": {
    label: "Consultar páginas de captación",
    description:
      "Ver el listado y el detalle de las páginas de captación y sus versiones. No permite crearlas, editarlas ni publicarlas.",
  },
  "landing.create": {
    label: "Crear páginas de captación",
    description:
      "Crear páginas de captación asociadas a eventos y preparar sus formularios para recibir registros.",
  },
  "landing.update": {
    label: "Editar páginas de captación",
    description:
      "Modificar contenido HTML, versiones, formularios y configuración de confirmación o seguridad; también permite importar contenido y eliminar páginas.",
  },
  "landing.publish": {
    label: "Publicar páginas de captación",
    description:
      "Publicar una versión validada para que la página quede disponible públicamente. No concede permiso para editar su contenido.",
  },
  "landing.submissions.read": {
    label: "Consultar envíos de formularios",
    description:
      "Ver los registros recibidos por los formularios y su estado de procesamiento. No permite modificarlos ni enviarlos al CRM.",
  },
  "landing.submissions.reprocess": {
    label: "Gestionar envíos y procesamiento en CRM",
    description:
      "Asignar vendedor, guardar notas internas, reprocesar un envío hacia el CRM o eliminarlo. No concede por sí solo acceso para consultar páginas o envíos.",
  },
  "planeacion_comercial.read": {
    label: "Consultar metas y comisiones",
    description:
      "Ver las cuotas trimestrales, las tasas de comisión configuradas y el seguimiento de ventas aceptadas y comisiones.",
  },
  "planeacion_comercial.create": {
    label: "Crear planeación anual",
    description:
      "Guardar por primera vez las metas y la configuración de comisiones de un año, incluidos sus cuatro trimestres.",
  },
  "planeacion_comercial.update": {
    label: "Editar metas y comisiones",
    description:
      "Actualizar las cuotas y el margen esperado por vendedor, así como las tasas de comisión por trimestre y categoría en años ya configurados.",
  },
  "planeacion_comercial.audit.read": {
    label: "Consultar auditoría de planeación",
    description:
      "Revisar la trazabilidad de los cambios guardados en la configuración trimestral de planeación y comisiones.",
  },
  "propuestas.read": {
    label: "Consultar propuestas",
    description:
      "Ver propuestas comerciales y consultar los documentos y contenidos asociados.",
  },
  "propuestas.create": {
    label: "Crear propuestas",
    description:
      "Crear propuestas y documentos de propuesta para preparar ofertas comerciales.",
  },
  "propuestas.update": {
    label: "Actualizar propuestas",
    description:
      "Editar propuestas y sus documentos, incluido su contenido. No sustituye los permisos necesarios para operar o aprobar cotizaciones.",
  },
  "proveedores.read": {
    label: "Consultar proveedores",
    description: "Ver el catálogo y los datos de proveedores y sus contactos.",
  },
  "proveedores.create": {
    label: "Crear proveedores",
    description:
      "Registrar proveedores con sus datos de contacto, ubicación y estado inicial.",
  },
  "proveedores.update": {
    label: "Actualizar proveedores",
    description:
      "Editar datos y contactos, y activar o desactivar proveedores. No concede acceso para editar sus listas de precios.",
  },
  "proveedores_precios.read": {
    label: "Consultar listas y precios",
    description:
      "Ver listas de precios, sus productos, servicios o grupos, monedas y estados.",
  },
  "proveedores_precios.create": {
    label: "Crear listas y precios",
    description:
      "Crear listas de precios y agregarles productos, servicios o grupos con su precio y moneda.",
  },
  "proveedores_precios.update": {
    label: "Actualizar listas y precios",
    description:
      "Editar listas, precios, productos y estados, incluida su activación o desactivación.",
  },
  "registros_fabricantes.read": {
    label: "Consultar registros según acceso",
    description:
      "Ver los registros asociados a oportunidades que puedes consultar. También requiere permiso de lectura de oportunidades.",
  },
  "registros_fabricantes.request": {
    label: "Solicitar registros de fabricantes",
    description:
      "Crear un registro de fabricante en una oportunidad abierta. También requiere permiso para actualizar oportunidades.",
  },
  "registros_fabricantes.update": {
    label: "Editar solicitudes de registro",
    description:
      "Cambiar el fabricante, la fecha de solicitud o las notas del registro. También requiere permiso para actualizar oportunidades.",
  },
  "registros_fabricantes.manage": {
    label: "Gestionar aprobaciones y renovaciones",
    description:
      "Aprobar o rechazar registros, reabrir solicitudes y renovar registros aprobados.",
  },
  "registros_fabricantes.read_all": {
    label: "Consultar registros de todas las oportunidades",
    description:
      "Consultar registros de todas las oportunidades incluidas en tu alcance comercial. También requiere permiso de lectura de oportunidades.",
  },
  "ritmo_comercial.read": {
    label: "Consultar ritmo comercial",
    description:
      "Acceder al tablero y consultar las métricas del propio vendedor: cuota, avance, pipeline, oportunidades y conversiones. No permite consultar el detalle de otros vendedores.",
  },
  "ritmo_comercial.read_all": {
    label: "Consultar ritmo de todo el equipo",
    description:
      "Ver el ranking y el detalle comercial de todos los vendedores, incluida la vista de equipo en pantalla.",
  },
  "ritmo_comercial.display": {
    label: "Aparecer en el ritmo comercial",
    description:
      "Incluir al vendedor en el ranking y en las listas visibles para usuarios con acceso al ritmo comercial.",
  },
};
const USER_PERMISSION_LABELS = {
  "aceptar_pedido.procesamiento.read": {
    label: "Consultar procesamiento de pedidos",
    description:
      "Consultar las etapas, el estado y los documentos del procesamiento posterior a la aceptación de una cotización. No permite editar información, generar contenido con IA ni enviar convocatorias.",
  },
  "aceptar_pedido.procesamiento.update": {
    label: "Actualizar procesamiento de pedidos",
    description:
      "Editar la información operativa de las etapas y gestionar sus documentos y evidencias para dar seguimiento al pedido aceptado.",
  },
  "aceptar_pedido.procesamiento.ia": {
    label: "Generar resúmenes con IA",
    description:
      "Generar o volver a generar resúmenes con IA a partir de las evidencias del procesamiento, cuando haya contenido compatible disponible.",
  },
  "aceptar_pedido.procesamiento.convocar": {
    label: "Enviar convocatorias de kick off",
    description:
      "Enviar convocatorias y notificaciones de kick off asociadas al procesamiento del pedido. No concede permisos para editar las etapas ni generar resúmenes con IA.",
  },
  "audit.read": {
    label: "Consultar auditoría del sistema",
    description:
      "Consultar eventos de seguridad, administración y operaciones registrados en la bitácora global, aplicar filtros y revisar sus detalles y cambios. Es un permiso de solo lectura; no permite modificar ni eliminar registros.",
  },
  "usuarios.read": {
    label: "Consultar usuarios",
    description: "Ver el directorio de usuarios y su historial de auditoría.",
  },
  "usuarios.create": {
    label: "Crear usuarios",
    description:
      "Crear cuentas, asignar roles y enviar la invitación para configurar el acceso.",
  },
  "usuarios.update": {
    label: "Actualizar usuarios y accesos",
    description:
      "Editar datos, cambiar roles y estado de las cuentas, y reenviar invitaciones de acceso o restablecimiento.",
  },
};

const SHARED_COACH_PERMISSION_CODES = new Set([
  "mi_coach.access",
  "mi_coach.execute",
  "mi_coach.admin",
  "mi_coach.chat_diagnostics",
  "fuentes_externas.execute",
]);
const QUOTATION_PERMISSION_LABELS = {
  "cotizaciones.administracion": {
    label: "Administrar cotizaciones",
    description:
      "Acceder a todas las acciones y al historial de versiones; crear o editar versiones incluso en estados avanzados. Es un permiso amplio, sujeto a las validaciones del flujo.",
  },
  "cotizaciones.aprobacion_humana": {
    label: "Aprobar cotizaciones sin IA",
    description:
      "Aprobar manualmente cotizaciones en estados habilitados. La acción sigue sujeta a las reglas de transición y validaciones comerciales.",
  },
  "cotizaciones.aprobacion_ia": {
    label: "Aprobar cotizaciones con IA",
    description:
      "Ejecutar la aprobación asistida por IA en los estados habilitados. La acción depende de las reglas de transición, las validaciones y el resultado del análisis.",
  },
  "cotizaciones.externo": {
    label: "Consultar cotizaciones como cliente",
    description:
      "Consultar, sin modificarlas, las cotizaciones disponibles para el cliente en estados aprobada, enviada, ganada o aceptada.",
  },
  "cotizaciones.ingreso": {
    label: "Gestionar cotizaciones en logística",
    description:
      "Gestionar el ingreso de cotizaciones: editar borradores, solicitar aprobación, registrar como ganada una cotización aprobada o devolver una ganada a borrador, según las reglas del flujo.",
  },
  "cotizaciones.operacion": {
    label: "Gestionar cotizaciones como vendedor",
    description:
      "Crear y preparar cotizaciones, solicitar su aprobación, enviarlas y registrar su resultado comercial según el estado. Aprobarlas requiere además autorización para aprobar sin IA o con IA.",
  },
  "cotizaciones.revision": {
    label: "Revisar cotizaciones para aprobación",
    description:
      "Revisar, corregir y rechazar cotizaciones en el flujo de aprobación. Este permiso no aprueba por sí solo: se requiere además autorización para aprobar sin IA o con IA.",
  },
};
const COMMERCIAL_TRACKING_PERMISSION_LABELS = {
  "seguimiento_comercial.read": {
    label: "Consultar el embudo de ventas",
    description:
      "Permite abrir el embudo de ventas y consultar oportunidades abiertas, ganadas y por periodo. También requiere lectura de oportunidades.",
  },
};
const SHARED_COACH_PERMISSION_LABELS = {
  "mi_coach.access": {
    label: "Entrar al módulo Mi Coach",
    description: "No habilita ningún canal por sí solo.",
  },
  "mi_coach.use": {
    label: "Acceder a Coach",
    description: "Ver el resumen y abrir la pestaña Coach.",
  },
  "mi_coach.execute": {
    label: "Confirmar propuestas del Coach",
    description:
      "También necesitas permiso para cambiar el registro involucrado.",
  },
  "mi_coach.admin": {
    label: "Administrar Mi Coach",
    description: "Cambiar la configuración y las reglas de Mi Coach.",
  },
  "mi_coach.chat_diagnostics": {
    label: "Revisar conversaciones para soporte",
    description:
      "Permite ver conversaciones de otros usuarios. Solo para soporte autorizado.",
  },
  "fuentes_externas.execute": {
    label: "Consultar fuentes públicas",
    description:
      "Buscar información pública cuando Administración lo permita.",
  },
  "inteligencia_comercial.access": {
    label: "Acceder a Cliente existente",
    description: "Ver la pestaña de clientes existentes.",
  },
  "inteligencia_comercial.read": {
    label: "Ver datos de clientes",
    description:
      "Consultar cuentas y hallazgos permitidos por tus otros permisos.",
  },
  "inteligencia_comercial.update": {
    label: "Actualizar hallazgos de clientes",
    description: "Confirmar, rechazar o corregir hallazgos.",
  },
  "prospeccion.access": {
    label: "Acceder a Cuenta nueva",
    description: "Ver la pestaña de investigación de cuentas nuevas.",
  },
  "prospeccion.read": {
    label: "Ver investigaciones de Cuenta nueva",
    description: "Abrir fichas y consultar sus hallazgos.",
  },
  "prospeccion.create": {
    label: "Crear investigaciones",
    description: "Iniciar la investigación de una empresa nueva.",
  },
  "prospeccion.update": {
    label: "Actualizar investigaciones",
    description: "Confirmar, rechazar o corregir sus hallazgos.",
  },
};

export default function RolesWorkspaceSection({
  canUpdateRoles,
  roleStatusFilter,
  setRoleStatusFilter,
  roleStatusCounts,
  filteredRoles,
  selectedRoleId,
  selectedRole,
  openRoleMenuId,
  toggleRoleMenu,
  setOpenRoleMenuId,
  openEditRoleModal,
  runRoleAction,
  updateRoleStatus,
  formatDateTime,
  permissions,
  selectedPerms,
  permissionsByModule,
  togglePermission,
  savePerms,
  roleUsers,
  selectRole,
}) {
  const coachModules = new Set([
    "mi_coach",
    "inteligencia_comercial",
    "prospeccion",
    "fuentes_externas",
  ]);
  const sharedCoachPermissions = permissions.filter((permission) =>
    SHARED_COACH_PERMISSION_CODES.has(permission.code),
  );
  const coachPermissionGroups = permissionsByModule
    .filter(([moduleName]) => coachModules.has(moduleName))
    .map(([moduleName, modulePermissions]) => [
      moduleName,
      modulePermissions.filter(
        (permission) => !SHARED_COACH_PERMISSION_CODES.has(permission.code),
      ),
    ])
    .filter(([, modulePermissions]) => modulePermissions.length > 0);
  const otherPermissionGroups = permissionsByModule.filter(
    ([moduleName]) =>
      !coachModules.has(moduleName) &&
      moduleName !== "roles" &&
      moduleName !== "permissions" &&
      moduleName !== "oportunidades" &&
      moduleName !== "oportunidades.notes" &&
      moduleName !== "configuracion" &&
      moduleName !== "proceso_comercial_config" &&
      moduleName !== "ia",
  );
  const configurationGroupLabels = new Map([
    ["configuracion", "Configuración general"],
    ["proceso_comercial_config", "Preguntas por etapa"],
    ["ia", "Crédito y consumo de IA"],
  ]);
  const configurationGroups = Array.from(
    configurationGroupLabels,
    ([moduleName, label]) => {
      const group = permissionsByModule.find(
        ([groupModuleName]) => groupModuleName === moduleName,
      );
      return group ? [group, true, label] : null;
    },
  ).filter(Boolean);
  const accessManagementGroups = permissionsByModule.filter(
    ([moduleName]) => moduleName === "roles" || moduleName === "permissions",
  );
  const opportunityGroups = permissionsByModule.filter(
    ([moduleName]) =>
      moduleName === "oportunidades" || moduleName === "oportunidades.notes",
  );
  const renderPermissionGroup = (
    [moduleName, modulePermissions],
    isSubgroup = false,
    label = "",
  ) => (
    <div
      key={`${moduleName}-${label || "module"}`}
      className={`permission-module-group${isSubgroup ? " permission-module-subgroup" : ""}`}
    >
      <div className="permission-module-header">
        <span>{label || formatPermissionModuleName(moduleName)}</span>
        {PERMISSION_MODULE_DESCRIPTIONS[moduleName] ? (
          <span className="permission-module-description">
            {PERMISSION_MODULE_DESCRIPTIONS[moduleName]}
          </span>
        ) : null}
      </div>
      <div className="checkbox-grid">
        {modulePermissions.map((permission) => (
          <label key={permission.id}>
            <input
              type="checkbox"
              checked={selectedPerms.includes(Number(permission.id))}
              onChange={(event) =>
                togglePermission(permission.id, event.target.checked)
              }
            />
            <span className="permission-label">
              <span className="permission-code">
                {SHARED_COACH_PERMISSION_LABELS[permission.code]?.label ||
                  ROLE_PERMISSION_LABELS[permission.code]?.label ||
                  USER_PERMISSION_LABELS[permission.code]?.label ||
                  COMMERCIAL_TRACKING_PERMISSION_LABELS[permission.code]?.label ||
                QUOTATION_PERMISSION_LABELS[permission.code]?.label ||
                  permission.action}
              </span>
              {(SHARED_COACH_PERMISSION_LABELS[permission.code]?.description ||
                ROLE_PERMISSION_LABELS[permission.code]?.description ||
                USER_PERMISSION_LABELS[permission.code]?.description ||
                COMMERCIAL_TRACKING_PERMISSION_LABELS[permission.code]?.description ||
                QUOTATION_PERMISSION_LABELS[permission.code]?.description ||
                permission.description) && (
                <span className="permission-description">
                  {SHARED_COACH_PERMISSION_LABELS[permission.code]?.description ||
                    ROLE_PERMISSION_LABELS[permission.code]?.description ||
                    USER_PERMISSION_LABELS[permission.code]?.description ||
                    COMMERCIAL_TRACKING_PERMISSION_LABELS[permission.code]?.description ||
                    QUOTATION_PERMISSION_LABELS[permission.code]?.description ||
                    permission.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="roles-pills-bar">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar roles por estado"
        >
          <button
            type="button"
            className={
              roleStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={roleStatusFilter === "active"}
            onClick={() => setRoleStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">
              {roleStatusCounts.active}
            </span>
          </button>
          <button
            type="button"
            className={
              roleStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={roleStatusFilter === "inactive"}
            onClick={() => setRoleStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">
              {roleStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              roleStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={roleStatusFilter === "all"}
            onClick={() => setRoleStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todos</span>
            <span className="status-filter-pill-count">
              {roleStatusCounts.all}
            </span>
          </button>
        </div>
      </div>

      <div className="roles-workspace">
        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Roles</span>
              <span className="roles-col-count">{filteredRoles.length}</span>
            </div>
          </div>
          <ul className="roles-card-list">
            {filteredRoles.map((role) => (
              <li
                key={role.id}
                className={[
                  "roles-card",
                  selectedRoleId === role.id ? "is-selected" : "",
                  Number(role.is_active) === 0 ? "is-inactive" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button
                  className="roles-card-btn"
                  onClick={() => selectRole(role.id)}
                >
                  <div className="roles-card-top">
                    <span className="roles-card-name">{role.name}</span>
                    <span
                      className={
                        Number(role.is_active) === 1
                          ? "role-status-badge active"
                          : "role-status-badge inactive"
                      }
                    >
                      {Number(role.is_active) === 1 ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <div className="roles-card-meta">
                    <span className="roles-card-desc">
                      {role.description || "Sin descripción"}
                    </span>
                    <span className="roles-card-perm-count">
                      {role.permissions_count} permisos
                    </span>
                  </div>
                </button>
                {canUpdateRoles && Number(role.is_system) !== 1 && (
                  <div className="user-kebab-wrap role-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleRoleMenu(role.id)}
                      aria-label="Abrir acciones del rol"
                      title="Acciones"
                    >
                      ⋮
                    </button>
                    {openRoleMenuId === role.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenRoleMenuId(null);
                            openEditRoleModal(role);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={Number(role.is_active) === 1}
                          onClick={() =>
                            runRoleAction(() => updateRoleStatus(role, true))
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={Number(role.is_active) !== 1}
                          onClick={() =>
                            runRoleAction(() => updateRoleStatus(role, false))
                          }
                        >
                          Desactivar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {selectedRole && (
            <div className="role-audit-compact">
              <div className="role-audit-compact-title">Auditoría</div>
              <div className="audit-item">
                <span className="audit-label">Creado por</span>
                <span className="audit-value">
                  {selectedRole.created_by_user_name || "—"}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Fecha creación</span>
                <span className="audit-value">
                  {formatDateTime(selectedRole.created_at)}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Modificado por</span>
                <span className="audit-value">
                  {selectedRole.updated_by_user_name || "—"}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Última modificación</span>
                <span className="audit-value">
                  {formatDateTime(selectedRole.updated_at)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Permisos</span>
              <span className="roles-col-count">{permissions.length}</span>
              {canUpdateRoles && selectedRoleId && (
                <button
                  className="btn-icon-save-perms"
                  onClick={savePerms}
                  title="Guardar permisos"
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Guardar
                </button>
              )}
            </div>
          </div>
          {selectedRoleId ? (
            <div className="permissions-by-module">
              {configurationGroups.length > 0 && (
                <section className="permission-family-group">
                  <div className="permission-family-header">
                    <span>Configuración</span>
                    <span className="permission-family-description">
                      Ajustes generales y configuración de módulos especializados.
                    </span>
                  </div>
                  <div className="permission-family-subgroups">
                    {configurationGroups.map(([group, isSubgroup, label]) =>
                      renderPermissionGroup(group, isSubgroup, label),
                    )}
                  </div>
                </section>
              )}
              {coachPermissionGroups.length > 0 && (
                <section className="permission-family-group">
                  <div className="permission-family-header">
                    <span>Mi Coach</span>
                    <span className="permission-family-description">
                      Acceso común, chats y capacidades compartidas
                    </span>
                  </div>
                  <div className="permission-family-subgroups">
                    {sharedCoachPermissions.length > 0
                      ? renderPermissionGroup(
                          ["mi_coach", sharedCoachPermissions],
                          true,
                          "Acceso y capacidades comunes",
                        )
                      : null}
                    {coachPermissionGroups.map((group) =>
                      renderPermissionGroup(group, true),
                    )}
                  </div>
                </section>
              )}
              {accessManagementGroups.length > 0 && (
                <section className="permission-family-group">
                  <div className="permission-family-header">
                    <span>Roles y permisos</span>
                    <span className="permission-family-description">
                      Administra perfiles de acceso y consulta el catálogo para
                      definir qué puede hacer cada rol.
                    </span>
                  </div>
                  <div className="permission-family-subgroups">
                    {accessManagementGroups.map((group) =>
                      renderPermissionGroup(
                        group,
                        true,
                        group[0] === "permissions"
                          ? "Catálogo de permisos"
                          : "Roles",
                      ),
                    )}
                  </div>
                </section>
              )}
              {opportunityGroups.length > 0 && (
                <section className="permission-family-group">
                  <div className="permission-family-header">
                    <span>Oportunidades</span>
                    <span className="permission-family-description">
                      Gestiona las oportunidades y consulta o registra sus
                      notas. Los permisos temporales de notas se identifican
                      por separado.
                    </span>
                  </div>
                  <div className="permission-family-subgroups">
                    {opportunityGroups.map((group) =>
                      renderPermissionGroup(
                        group,
                        true,
                        group[0] === "oportunidades.notes"
                          ? "Permisos temporales de notas"
                          : "Gestión de oportunidades",
                      ),
                    )}
                  </div>
                </section>
              )}
              {otherPermissionGroups.map((group) =>
                renderPermissionGroup(group),
              )}
            </div>
          ) : (
            <div className="roles-empty-state">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c0cfe0"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <p>Selecciona un rol para gestionar sus permisos</p>
            </div>
          )}
        </div>

        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Usuarios asignados</span>
              {selectedRoleId && (
                <span className="roles-col-count">{roleUsers.length}</span>
              )}
            </div>
          </div>
          {selectedRoleId ? (
            <div className="users-list">
              {roleUsers.length > 0 ? (
                <ul className="list">
                  {roleUsers.map((user) => (
                    <li key={user.id} className="roles-user-item">
                      <div className="roles-user-avatar">
                        {user.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="roles-user-info">
                        <div className="roles-user-name">{user.full_name}</div>
                        <div className="roles-user-email">{user.email}</div>
                      </div>
                      <span
                        className={
                          user.status === "active"
                            ? "role-status-badge active"
                            : "role-status-badge inactive"
                        }
                      >
                        {user.status === "active" ? "Activo" : "Inactivo"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="roles-empty-state">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#c0cfe0"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <p>No hay usuarios con este rol</p>
                </div>
              )}
            </div>
          ) : (
            <div className="roles-empty-state">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c0cfe0"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p>Selecciona un rol para ver sus usuarios</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
