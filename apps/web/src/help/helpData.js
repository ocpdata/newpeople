export const HELP_ARTICLES = [
  {
    id: "dashboard-overview",
    routeKey: "dashboard",
    title: "Leer el dashboard sin perder foco",
    summary:
      "Usa esta vista para detectar prioridades del día antes de entrar a los módulos operativos.",
    details: [
      "Revisa primero indicadores con mayor desviación o alertas activas.",
      "Toma una decisión de seguimiento y luego navega al módulo correspondiente.",
      "Evita ejecutar cambios desde aquí: trátala como tablero de lectura.",
    ],
    tags: ["dashboard", "prioridades", "resumen"],
  },
  {
    id: "accounts-create",
    routeKey: "accounts",
    title: "Crear una cuenta comercial",
    summary:
      "Usa Crear cuenta, completa los datos base y guarda para habilitar su ciclo comercial.",
    details: [
      "Captura nombre comercial y datos de identificación de forma consistente.",
      "Asigna responsables y contexto para que el equipo ubique la cuenta rápido.",
      "Guarda y valida que quede en estado activo antes de relaciónar oportunidades.",
    ],
    tags: ["cuentas", "crear", "alta"],
  },
  {
    id: "accounts-edit",
    routeKey: "accounts",
    title: "Editar una cuenta existente",
    summary:
      "Abre acciónes de la cuenta para actualizar responsables, datos de contacto y contexto comercial.",
    details: [
      "Actualiza responsables cuando cambie cobertura o ownership comercial.",
      "Depura datos de contacto para evitar duplicados en prospectos y oportunidades.",
      "Usa notas y campos de contexto para dejar trazabilidad útil al equipo.",
    ],
    tags: ["cuentas", "editar", "actualizar"],
  },
  {
    id: "contacts-create",
    routeKey: "contacts",
    title: "Crear y clasificar contactos",
    summary:
      "Registra contactos con poder de decisión y nivel de influencia para mejorar el targeting comercial.",
    details: [
      "Completa correo, teléfono y cargo para acelerar seguimiento multicanal.",
      "Asigna poder de decisión y relación con nosotros según contexto real.",
      "Relaciona cada contacto con su cuenta principal para evitar huella suelta.",
    ],
    tags: ["contactos", "crear", "clasificación"],
  },
  {
    id: "contacts-hygiene",
    routeKey: "contacts",
    title: "Higiene de base de contactos",
    summary:
      "Mantener la calidad de datos en contactos reduce errores al cotizar y al mapear decisores.",
    details: [
      "Busca duplicados por correo, teléfono o nombre dentro de la misma cuenta.",
      "Estandariza nomenclatura de cargos para mejorar filtros y reportes.",
      "Desactiva o corrige registros incompletos para no contaminar el pipeline.",
    ],
    tags: ["contactos", "calidad", "duplicados"],
  },
  {
    id: "interactions-capture",
    routeKey: "interactions",
    title: "Registrar leads y seguimiento",
    summary:
      "Captura cada interacción relevante para sostener continuidad comercial entre equipos.",
    details: [
      "Registra origen, contexto y siguiente acción inmedíatamente después del contacto.",
      "Vincula evidencia documental cuando aplique para soportar decisiónes futuras.",
      "Promueve a oportunidad solo cuando haya claridad de necesidad y potencial real.",
    ],
    tags: ["leads", "interacciónes", "seguimiento"],
  },
  {
    id: "opportunities-flow",
    routeKey: "opportunities",
    title: "Gestionar oportunidades sin bloquear el flujo",
    summary:
      "Filtra por estado, abre una oportunidad y avanza etapas registrando evidencias y siguientes pasos.",
    details: [
      "Usa filtros por estado para trabajar primero lo más cercano a cierre.",
      "Mantén actualizadas respuestas de etapa para no frenar avance por validaciones.",
      "Documenta razones cuando una oportunidad no puede avanzar o se desactiva.",
    ],
    tags: ["oportunidades", "etapas", "seguimiento"],
  },
  {
    id: "opportunities-prioritize",
    routeKey: "opportunities",
    title: "Priorizar oportunidades",
    summary:
      "Construye una cola operativa clara con monto, probabilidad y fecha objetivo de cierre.",
    details: [
      "Ordena por fecha de cierre y esfuerzo pendiente para decidir en qué trabajar hoy.",
      "Combina estado comercial y activación para separar riesgo real de ruido.",
      "Agenda siguiente paso con responsables explícitos para reducir estancamiento.",
    ],
    tags: ["oportunidades", "prioridad", "pipeline"],
  },
  {
    id: "proposals-edit",
    routeKey: "proposals",
    title: "Editar una propuesta por secciónes",
    summary:
      "Abre acciónes, entra al editor y guarda componente por componente para evitar perder cambios.",
    details: [
      "Trabaja por componentes y guarda al finalizar cada bloque de contenido.",
      "Usa sugerencias de IA como borrador y valida consistencia comercial antes de aplicar.",
      "Mantén imágenes y activos alíneados a la narrativa del cliente objetivo.",
    ],
    tags: ["propuestas", "edicion", "guardado"],
  },
  {
    id: "proposals-publish",
    routeKey: "proposals",
    title: "Preparar propuesta para salida",
    summary:
      "Antes de compartir, verifica coherencia de mensajes, cifras y evidencias institucionales.",
    details: [
      "Valida encabezados, párrafos e imágenes para evitar secciónes incompletas.",
      "Revisa pricing heredado y contexto de cotización vinculada.",
      "Genera vista de impresión solo cuando el contenido esté confirmado.",
    ],
    tags: ["propuestas", "publicación", "revisión"],
  },
  {
    id: "quotations-create",
    routeKey: "quotations",
    title: "Crear cotización y generar propuesta",
    summary:
      "Crea una cotización desde la oportunidad y usa la acción de propuesta cuando la versión esté lista.",
    details: [
      "Define datos base de versión y captura ítems por sección con precisión.",
      "Usa workflow de estados para separar borrador operativo de versión aprobada.",
      "Genera propuesta solo desde versiónes en estado compatible.",
    ],
    tags: ["cotizaciónes", "propuestas", "versiónes"],
  },
  {
    id: "quotations-governance",
    routeKey: "quotations",
    title: "Controlar calidad de cotizaciónes",
    summary:
      "Mantén versiónado limpio y evita retrabajo con reglas claras de edición y aprobación.",
    details: [
      "Duplica versiónes solo cuando exista un cambio sustantivo de oferta.",
      "Documenta notas internas y condiciones comerciales para auditoría posterior.",
      "Antes de aprobar, revisa importes, impuestos y descuentos en conjunto.",
    ],
    tags: ["cotizaciónes", "aprobacion", "control"],
  },
  {
    id: "tracking-overview",
    routeKey: "commercial-tracking",
    title: "Leer el cockpit comercial",
    summary:
      "Ajusta filtros de semana/vendedor/línea y usa tabs para revisar resumen, abiertas y forecast.",
    details: [
      "En resumen identifica variaciones semanales y focos de riesgo por etapa.",
      "En abiertas revisa volumen pendiente y oportunidades que requieren acción.",
      "En forecast compara escenario esperado contra ejecución real para calibrar plan.",
    ],
    tags: ["cockpit", "seguimiento", "forecast"],
  },
  {
    id: "planning-commissions",
    routeKey: "commercial-planning",
    title: "Configurar planeación y comisiónes",
    summary:
      "Define metas y reglas de comisión para alínear ejecución comercial y rentabilidad.",
    details: [
      "Configura cuotas trimestrales por responsable y valida cobertura del período.",
      "Revisa umbrales de margen y cumplimiento antes de publicar esquema.",
      "Monitorea desvío entre planeado y ejecutado para ajustar prioridades.",
    ],
    tags: ["planeacion", "comisiónes", "metas"],
  },
  {
    id: "development-workspace",
    routeKey: "commercial-development",
    title: "Operar desarrollo comercial",
    summary:
      "Usa este espacio para coordinar acciónes, dependencias y avance operativo del pipeline.",
    details: [
      "Registra proximo paso con fechas y responsables claros.",
      "Vincula dependencias para evitar bloqueos entre equipos.",
      "Actualiza evidencias cuando cambie el estado de ejecución.",
    ],
    tags: ["desarrollo", "ejecución", "pipeline"],
  },
  {
    id: "enablement-library",
    routeKey: "commercial-enablement",
    title: "Gestionar biblioteca comercial",
    summary:
      "Centraliza activos comerciales y controla su vigencia para ventas y propuestas.",
    details: [
      "Clasifica activos por tipo y uso para encontrarlos con rapidez.",
      "Mantén gobierno de versiónes para evitar materiales obsoletos.",
      "Revisa cobertura de activos por etapa del proceso comercial.",
    ],
    tags: ["biblioteca", "activos", "enablement"],
  },
  {
    id: "contact-mapping-network",
    routeKey: "contact-mapping",
    title: "Mapear red de contactos",
    summary:
      "Visualiza relaciónes y niveles de influencia para mejorar estrategia de acceso a cuentas.",
    details: [
      "Identifica decisores finales y posibles vetos en cada cuenta.",
      "Ajusta plan de acercamiento por fortaleza de relación.",
      "Confirma cobertura de contactos por unidad de negocio.",
    ],
    tags: ["mapeo", "influencia", "decisores"],
  },
  {
    id: "providers-catalog",
    routeKey: "providers",
    title: "Administrar proveedores y listas",
    summary:
      "Mantén catálogos de proveedores y precios consistentes para cotizar sin fricciones.",
    details: [
      "Verifica vigencia de listas y códigos antes de cotizar.",
      "Evita duplicados de price code y estandariza descripciónes.",
      "Usa estructura de componentes cuando aplique a bundles o grupos.",
    ],
    tags: ["proveedores", "precios", "catalogo"],
  },
  {
    id: "manufacturer-registrations-control",
    routeKey: "manufacturer-registrations",
    title: "Control de registros de fabricantes",
    summary:
      "Gestiona registro documental y estatus para cumplir requisitos de fabricantes.",
    details: [
      "Confirma que cada registro tenga evidencia y fechas completas.",
      "Monitorea vencimientos para prevenir bloqueos en oportunidades.",
      "Usa filtros por estado para trabajar renovaciones urgentes.",
    ],
    tags: ["fabricantes", "registros", "cumplimiento"],
  },
  {
    id: "users-admin",
    routeKey: "users",
    title: "Administrar usuarios",
    summary:
      "Crea y mantiene usuarios con datos vigentes para asegurar trazabilidad de acciónes.",
    details: [
      "Verifica correo y rol funcional al crear o actualizar usuarios.",
      "Desactiva accesos obsoletos para reducir riesgo operativo.",
      "Confirma que el owner comercial tenga permisos mínimos necesarios.",
    ],
    tags: ["usuarios", "accesos", "administración"],
  },
  {
    id: "roles-governance",
    routeKey: "roles",
    title: "Diseñar roles y permisos",
    summary:
      "Define roles por responsabilidad real para equilibrar seguridad y velocidad operativa.",
    details: [
      "Asigna permisos por módulo evitando privilegios excesivos.",
      "Versiona cambios importantes de roles para auditoría.",
      "Prueba rutas críticas con un usuario de cada rol clave.",
    ],
    tags: ["roles", "permisos", "seguridad"],
  },
  {
    id: "process-config",
    routeKey: "opportunities-questions",
    title: "Configurar proceso comercial",
    summary:
      "Administra preguntas y reglas de etapa para que la validacion operacional sea consistente.",
    details: [
      "Mantén preguntas obligatorias alíneadas al proceso vigente.",
      "Evita cambios abruptos sin validar impacto en oportunidades activas.",
      "Documenta criterios de respuesta para uso uniforme del equipo.",
    ],
    tags: ["proceso", "preguntas", "configuración"],
  },
  {
    id: "settings-governance",
    routeKey: "settings",
    title: "Administrar configuración del sistema",
    summary:
      "Centraliza parametros globales y aplica cambios de forma controlada.",
    details: [
      "Revisa impacto antes de modificar catálogos o banderas globales.",
      "Coordina cambios sensibles fuera de horario operativo crítico.",
      "Valida permisos y resultados después de cada ajuste.",
    ],
    tags: ["configuración", "sistema", "gobierno"],
  },
  {
    id: "tools-operations",
    routeKey: "tools",
    title: "Usar herramientas administrativas",
    summary:
      "Ejecuta útilidades de mantenimiento con criterio operativo y trazabilidad.",
    details: [
      "Confirma entorno y alcance antes de ejecutar una herramienta.",
      "Documenta resultado de acciónes que alteren datos o catálogos.",
      "Evita correr procesos destructivos sin respaldo o validacion previa.",
    ],
    tags: ["herramientas", "mantenimiento", "operacion"],
  },
  {
    id: "audit-traceability",
    routeKey: "audit",
    title: "Auditar cambios del sistema",
    summary:
      "Consulta eventos para reconstruir decisiónes, cambios y responsables.",
    details: [
      "Filtra por módulo y período para enfocar investigación.",
      "Correlacióna eventos con usuarios y registros afectados.",
      "Exporta evidencia cuando se requiera seguimiento formal.",
    ],
    tags: ["auditoría", "trazabilidad", "control"],
  },
  {
    id: "general-navigation",
    routeKey: "general",
    title: "Navegación y buenas practicas",
    summary:
      "Si un módulo no tiene ayuda especifica, usa esta guia base para trabajar de forma segura.",
    details: [
      "Confirma permisos y contexto antes de crear o editar registros.",
      "Guarda cambios de forma incremental para reducir pérdida de información.",
      "Usa filtros y búsqueda para operar sobre lotes pequeños y precisos.",
    ],
    tags: ["general", "navegacion", "practicas"],
  },
];

export const HELP_TOURS = [
  {
    id: "tour-proposals-basic",
    routeKey: "proposals",
    title: "Tour rápido de Propuestas",
    steps: [
      {
        id: "proposals-title",
        target: '[data-help-id="proposals.title"]',
        title: "Módulo de propuestas",
        content:
          "Desde aquí gestionas propuestas por cliente y abres el editor estructurado.",
      },
      {
        id: "proposals-actions",
        target: '[data-help-id="proposals.actions"]',
        title: "Acciones",
        content: "Usa este menú para abrir una propuesta en modo edicion.",
      },
      {
        id: "proposals-save",
        target: '[data-help-id="proposals.save-component"]',
        title: "Guardar sección",
        content:
          "Guarda cada componente después de editar para confirmar cambios.",
      },
    ],
  },
  {
    id: "tour-quotations-basic",
    routeKey: "quotations",
    title: "Tour rápido de Cotizaciones",
    steps: [
      {
        id: "quotations-title",
        target: '[data-help-id="quotations.title"]',
        title: "Módulo de cotizaciónes",
        content:
          "Aquí controlas versiónes, estados y estructura de la cotización.",
      },
      {
        id: "quotations-create",
        target: '[data-help-id="quotations.create"]',
        title: "Crear cotización",
        content:
          "Crea una nueva versión para iniciar o iterar el proceso comercial.",
      },
      {
        id: "quotations-actions",
        target: '[data-help-id="quotations.actions"]',
        title: "Menu de acciónes",
        content: "Abre opciones de versión y acceso rápido a propuesta.",
      },
    ],
  },
  {
    id: "tour-opportunities-basic",
    routeKey: "opportunities",
    title: "Tour rápido de Oportunidades",
    steps: [
      {
        id: "opportunities-title",
        target: '[data-help-id="opportunities.title"]',
        title: "Vista principal",
        content: "Revisa todas tus oportunidades y su estado comercial.",
      },
      {
        id: "opportunities-create",
        target: '[data-help-id="opportunities.create"]',
        title: "Crear oportunidad",
        content:
          "Inicia una oportunidad nueva para arrancar el flujo de trabajo.",
      },
      {
        id: "opportunities-filters",
        target: '[data-help-id="opportunities.filters"]',
        title: "Filtros",
        content: "Usa filtros y búsqueda para enfocarte en lo prioritario.",
      },
    ],
  },
  {
    id: "tour-tracking-basic",
    routeKey: "commercial-tracking",
    title: "Tour rápido de Seguimiento",
    steps: [
      {
        id: "tracking-title",
        target: '[data-help-id="tracking.title"]',
        title: "Cockpit comercial",
        content:
          "Este módulo concentra visibilidad del pipeline y rendimiento semanal.",
      },
      {
        id: "tracking-toolbar",
        target: '[data-help-id="tracking.toolbar"]',
        title: "Filtros principales",
        content:
          "Semana, vendedor y línea ajustan todas las métricas de la vista.",
      },
      {
        id: "tracking-tabs",
        target: '[data-help-id="tracking.tabs"]',
        title: "Tabs de análisis",
        content:
          "Alterna entre resumen, abiertas, período y forecast según la necesidad.",
      },
    ],
  },
];

export const HELP_MODAL_CATALOG = {
  "account.create": {
    ariaLabel: "Ayuda sobre el modal de crear cuenta",
    title: "Ayuda sobre crear cuenta",
    purpose:
      "Úsalo para registrar una cuenta nueva con sus datos principales y contexto comercial inicial.",
    usage:
      "Completa nombre, tipo, sector y responsables para dejar la cuenta lista para seguimiento.",
    sections: [
      {
        title: "Datos principales",
        purpose:
          "Define la identidad comercial de la cuenta y su clasificación base.",
        actions: [
          "Captura el nombre oficial/comercial y valida formato antes de guardar.",
          "Selecciona tipo de cuenta, sector y fuente de origen cuando aplique.",
          "Confirma que no exista duplicado (el sistema puede mostrar advertencias).",
        ],
      },
      {
        title: "Ubicación y contacto",
        purpose:
          "Deja ubicacion y canales de contacto listos para operacion y seguimiento.",
        actions: [
          "Completa país, estado, ciudad y direccion con datos verificables.",
          "Agrega teléfono y correo institucional para facilitar contacto temprano.",
          "Asegura consistencia geográfica si la cuenta opera en varias sedes.",
        ],
      },
      {
        title: "Descripción de la empresa",
        purpose:
          "Resume a que se dedica la cuenta y su contexto comercial relevante.",
        actions: [
          "Redacta giro, capacidades y necesidades de negocio observadas.",
          "Usa texto concreto; evita descripciónes ambiguas o vacías.",
          "Si usas sugerencias IA, revisa y corrige antes de guardar.",
        ],
      },
      {
        title: "Propietarios",
        purpose: "Define responsables directos de la cuenta dentro del equipo.",
        actions: [
          "Selecciona al menos un propietario (campo obligatorio).",
          "Verifica que el owner asignado tenga permisos y cobertura comercial.",
          "Evita dejar la cuenta sin responsables para no frenar seguimiento.",
        ],
      },
    ],
    modalActions: [
      "Botón Ayuda: abre esta guia contextual del modal.",
      "Botón Cerrar (X): cierra el modal; si hay procesos en curso puede bloquearse.",
      "Crear cuenta: valida campos obligatorios y registra la cuenta.",
      "Confirmaciones: pueden aparecer para formato de nombre o posibles duplicados.",
    ],
  },
  "account.edit": {
    ariaLabel: "Ayuda sobre el modal de editar cuenta",
    title: "Ayuda sobre editar cuenta",
    purpose:
      "Este modal permite mantener actualizada la cuenta sin romper continuidad operativa.",
    usage:
      "Revisa responsables, estado de activación y datos clave antes de guardar cambios.",
    sections: [
      {
        title: "Datos principales",
        purpose:
          "Mantiene vigente la información central de la cuenta durante su ciclo comercial.",
        actions: [
          "Actualiza nombre y clasificación solo cuando haya cambios reales.",
          "Conserva consistencia con registros ya vinculados (contactos/oportunidades).",
          "Evita cambios innecesarios que compliquen trazabilidad histórica.",
        ],
      },
      {
        title: "Ubicación y contacto",
        purpose:
          "Corrige datos de localizacion y canales para mejorar operacion díaria.",
        actions: [
          "Ajusta direccion, teléfonos y correos obsoletos.",
          "Verifica datos antes de guardar para evitar rebotes de contacto.",
          "Mantén formato uniforme entre cuentas del mismo grupo empresarial.",
        ],
      },
      {
        title: "Descripción de la empresa",
        purpose:
          "Refina el contexto de negocio con información nueva o más precisa.",
        actions: [
          "Incorpora cambios de portafolio, industria o prioridades del cliente.",
          "Retira información desactualizada para no sesgar decisiónes.",
          "Valida coherencia de la narrativa antes de guardar.",
        ],
      },
      {
        title: "Propietarios",
        purpose:
          "Permite reasignar cobertura cuando cambia el equipo o la estrategia.",
        actions: [
          "Agrega/quita propietarios según responsabilidad actual.",
          "No dejes la cuenta sin propietarios activos.",
          "Confirma que los nuevos responsables conozcan el contexto de la cuenta.",
        ],
      },
      {
        title: "Auditoría de la cuenta",
        purpose:
          "Muestra historial basico de creación/actualizacion para trazabilidad.",
        actions: [
          "Revisa fechas y usuario editor cuando necesites validar cambios recientes.",
          "Usa este bloque como referencia, no como campo editable.",
        ],
      },
    ],
    modalActions: [
      "Botón Ayuda: abre esta guia contextual para edicion.",
      "Estado/ID en cabecera: referencia rápida para confirmar que editas el registro correcto.",
      "Guardar cambios: persiste ajustes del formulario actual.",
      "Cerrar (X): sale del modal; verifica cambios pendientes antes de cerrar.",
    ],
  },
  "contact.create": {
    ariaLabel: "Ayuda sobre el modal de crear contacto",
    title: "Ayuda sobre crear contacto",
    purpose:
      "Sirve para registrar un contacto y dejarlo útilizable en oportunidades y cotizaciónes.",
    usage:
      "Captura datos principales, clasificación comercial y valida cuenta asociada antes de guardar.",
    sections: [
      {
        title: "Datos principales",
        purpose: "Identifica al contacto y su vinculacion base con la cuenta.",
        actions: [
          "Captura nombre y apellidos completos.",
          "Selecciona la cuenta correcta para evitar registros huérfanos.",
          "Registra cargo y area para dar contexto al equipo comercial.",
        ],
      },
      {
        title: "Datos comerciales",
        purpose:
          "Clasifica influencia y prioridad del contacto en el proceso de compra.",
        actions: [
          "Define poder de decisión y fortaleza de relación.",
          "Asigna responsable interno cuando aplique.",
          "Ajusta estatus según vigencia real del contacto.",
        ],
      },
      {
        title: "Ubicación y canales",
        purpose: "Deja listos los medios de contacto operativos.",
        actions: [
          "Completa correo y teléfono con formato válido.",
          "Agrega ciudad/país si se usa segmentacion territorial.",
          "Corrige datos incompletos antes de guardar.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual del modal.",
      "Cerrar (X): sale del modal; si estas guardando puede bloquearse.",
      "Guardar contacto: valida campos requeridos y crea el registro.",
      "Revisión de duplicados: si aparece, revisa coincidencias antes de confirmar.",
    ],
  },
  "contact.edit": {
    ariaLabel: "Ayuda sobre el modal de editar contacto",
    title: "Ayuda sobre editar contacto",
    purpose:
      "Este modal se usa para actualizar información del contacto y su relación comercial.",
    usage:
      "Ajusta datos de contacto, cuenta asociada y clasificación sin perder consistencia.",
    sections: [
      {
        title: "Datos principales",
        purpose: "Mantiene vigente la identidad y afiliación del contacto.",
        actions: [
          "Corrige nombre/cargo cuando cambien oficialmente.",
          "Verifica que la cuenta asociada siga siendo correcta.",
          "Evita cambios que rompan historico sin justificacion.",
        ],
      },
      {
        title: "Datos comerciales",
        purpose: "Actualiza el rol del contacto en decisiónes de compra.",
        actions: [
          "Recalibra influencia, relación y prioridad comercial.",
          "Ajusta estatus de activación según uso real.",
          "Confirma consistencia con oportunidades activas.",
        ],
      },
      {
        title: "Auditoría",
        purpose: "Aporta trazabilidad de modificaciones recientes.",
        actions: [
          "Revisa fecha y usuario editor para validar cambios.",
          "Usa el bloque como referencia informativa.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia para edicion.",
      "Cerrar (X): cancela la edicion actual.",
      "Guardar cambios: persiste ajustes del formulario.",
      "Indicadores de cabecera: confirman ID y estado del contacto.",
    ],
  },
  "opportunity.create": {
    ariaLabel: "Ayuda sobre el modal de crear oportunidad",
    title: "Ayuda sobre crear oportunidad",
    purpose:
      "Sirve para registrar una oportunidad nueva con contexto comercial y responsables.",
    usage:
      "Empieza por cuenta, contacto y línea de negocio; agrega evidencia para mejorar el borrador.",
    sections: [
      {
        title: "Datos principales",
        purpose: "Define la oportunidad, su cuenta y contexto inicial.",
        actions: [
          "Selecciona cuenta, contacto y línea de negocio.",
          "Captura nombre de oportunidad y monto estimado inicial.",
          "Establece fecha objetivo de cierre realista.",
        ],
      },
      {
        title: "Contexto comercial",
        purpose: "Fija responsables y clasificación para seguimiento.",
        actions: [
          "Asigna vendedor y pre-venta cuando aplique.",
          "Confirma etapa/estado inicial coherente.",
          "Incluye notas clave para handoff interno.",
        ],
      },
      {
        title: "Documentos y evidencia",
        purpose: "Aporta soporte documental para el análisis y avance.",
        actions: [
          "Sube documentos relevantes del cliente o requerimiento.",
          "Revisa sugerencias automáticas antes de aplicarlas.",
          "No cierres el modal durante cargas activas.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre la guia contextual de creación.",
      "Cerrar (X): cancela el alta de oportunidad.",
      "Guardar/Crear oportunidad: valida obligatorios y registra el borrador.",
      "Validaciones: el sistema puede bloquear avance si falta información crítica.",
    ],
  },
  "opportunity.edit": {
    ariaLabel: "Ayuda sobre el modal de editar oportunidad",
    title: "Ayuda sobre editar oportunidad",
    purpose:
      "Este modal te permite mantener la oportunidad alíneada al avance real del proceso.",
    usage:
      "Actualiza etapa, estado comercial, responsables y evidencia para evitar bloqueos.",
    sections: [
      {
        title: "Cabecera de estado",
        purpose: "Muestra referencia rápida de ID, etapa y estatus actuales.",
        actions: [
          "Verifica que editas la oportunidad correcta.",
          "Usa badges para confirmar estado de activación/comercial.",
        ],
      },
      {
        title: "Datos y contexto",
        purpose: "Ajusta información base conforme evoluciona el caso.",
        actions: [
          "Actualiza monto, fechas y responsables.",
          "Mantén consistencia con la etapa comercial vigente.",
          "Documenta cambios que impacten pronóstico.",
        ],
      },
      {
        title: "Workspace y documentos",
        purpose:
          "Gestiona respuestas de etapa, acciónes y evidencia operativa.",
        actions: [
          "Responde preguntas obligatorias para permitir avances.",
          "Sube o depura evidencia según progreso.",
          "Revisa paneles de fabricante si aplica al caso.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia para edicion.",
      "Cerrar (X): sale del modal; puede bloquearse si hay procesos activos.",
      "Guardar cambios: persiste ajustes de la oportunidad.",
      "Avance de etapa: requiere condiciones y validaciones cumplidas.",
    ],
  },
  "quotation.create": {
    ariaLabel: "Ayuda sobre el modal de crear cotización",
    title: "Ayuda sobre crear cotización",
    purpose:
      "Se usa para crear una cotización nueva desde el contexto comercial correcto.",
    usage:
      "Define cuenta, oportunidad y contacto; luego estructura secciónes e ítems antes de crear.",
    sections: [
      {
        title: "Contexto comercial",
        purpose:
          "Ancla la cotización a cuenta, oportunidad y contacto válidos.",
        actions: [
          "Selecciona cuenta y oportunidad antes de editar detalle.",
          "Confirma contacto principal para salida comercial.",
          "Bloquea el contexto cuando estes seguro de la selección.",
        ],
      },
      {
        title: "Secciones e ítems",
        purpose: "Construye el contenido economico de la cotización.",
        actions: [
          "Agrega secciónes por alcance (productos/servicios).",
          "Carga ítems, cantidades, precios y ajustes de venta.",
          "Usa acciónes de fila para duplicar/mover/ordenar.",
        ],
      },
      {
        title: "Resumen y condiciones",
        purpose: "Consolida descuentos, impuestos y condiciones comerciales.",
        actions: [
          "Define modo de descuento y distribución.",
          "Configura IVA y valida totales finales.",
          "Completa notas internas y condiciones para auditoría.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual.",
      "Cerrar (X): si hay cambios sin guardar, pide confirmación.",
      "Crear cotización: valida estructura y registra versión inicial.",
      "Importar documentos: puede precargar datos comerciales complementarios.",
    ],
  },
  "quotation.edit": {
    ariaLabel: "Ayuda sobre el modal de editar cotización",
    title: "Ayuda sobre editar cotización",
    purpose:
      "Permite ajustar una cotización existente manteniendo coherencia entre versiónes.",
    usage:
      "Revisa estado, secciónes e ítems y guarda cuando el impacto comercial este validado.",
    sections: [
      {
        title: "Cabecera y metadatos",
        purpose: "Muestra cotización, versión y estado para control operativo.",
        actions: [
          "Verifica número de cotización y versión activa.",
          "Confirma si editas versión mayor o histórica.",
          "Usa estado para decidir si procede editar.",
        ],
      },
      {
        title: "Editor de contenido",
        purpose: "Permite modificar secciónes, ítems y condiciones.",
        actions: [
          "Ajusta cantidades, precios y descuentos con criterio comercial.",
          "Mantén notas internas y condiciones actualizadas.",
          "Revisa impacto total antes de guardar.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia de edicion.",
      "Cerrar (X): sale del editor de cotización.",
      "Acciones del editor: guardar cambios por sección/versión.",
      "Estados del workflow: condicionan acciónes disponibles.",
    ],
  },
  "quotation.sections.toolbar": {
    ariaLabel: "Ayuda de iconos en secciónes de la cotización",
    title: "Iconos de secciónes de la cotización",
    purpose:
      "Explica para que sirve cada icono del toolbar de secciónes y filas.",
    usage:
      "Selecciona filas cuando aplique; varios iconos se habilitan solo con filas selecciónadas.",
    sections: [
      {
        title: "Toolbar superior de secciónes",
        purpose: "Controla la estructura general de la cotización.",
        actions: [
          "Icono + (Crear sección nueva): agrega una sección vacia.",
          "Úsalo para separar alcance por bloques (productos, servicios, etc.).",
        ],
      },
      {
        title: "Grupo Fila",
        purpose: "Opera sobre filas de ítems dentro de una sección.",
        actions: [
          "Icono +: agregar fila.",
          "Icono papelera: eliminar filas selecciónadas.",
          "Icono flecha arriba: subir filas selecciónadas.",
          "Icono flecha abajo: bajar filas selecciónadas.",
          "Icono duplicar: clonar filas selecciónadas.",
          "Icono copiar: copiar filas selecciónadas.",
          "Icono pegar: pegar filas copiadas.",
          "Icono resaltar ON: marcar filas selecciónadas.",
          "Icono resaltar OFF: quitar resaltado de filas selecciónadas.",
          "Icono ajuste de venta: recalcular precio de venta de una sola fila selecciónada.",
        ],
      },
      {
        title: "Grupo Sección",
        purpose: "Gestiona la sección completa.",
        actions: [
          "Icono flecha arriba: mover sección hacia arriba.",
          "Icono flecha abajo: mover sección hacia abajo.",
          "Icono duplicar: duplicar sección completa.",
          "Icono papelera: eliminar sección.",
        ],
      },
      {
        title: "Grupo Bundle",
        purpose:
          "Agrupa filas en bundles manuales y administra sus componentes.",
        actions: [
          "Icono crear bundle manual: crea un bundle con las filas selecciónadas.",
          "Icono bundle desde plantilla: crea el bundle usando un padre nuevo basado en plantilla.",
          "Icono adjuntar al bundle: agrega filas selecciónadas a un bundle manual existente.",
          "Icono quitar del bundle: separa componentes selecciónados de su bundle manual.",
          "Regla clave: seleccióna filas compatibles; no se permiten bundles/componentes no editables en operaciones de agrupacion.",
        ],
      },
    ],
    modalActions: [
      "Tip: si un icono aparece deshabilitado, revisa si falta selecciónar filas o si la acción no aplica al contexto.",
      "Para bundle, sigue las validaciones de selección mostradas bajo la tabla cuando una acción no este disponible.",
    ],
  },
  "quotation.documentation.toolbar": {
    ariaLabel: "Ayuda de iconos en documentacion",
    title: "Iconos de documentacion",
    purpose:
      "Describe el toolbar de Documentacion y como usar cada icono/acción.",
    usage:
      "Adjunta documentos primero y luego decide cuales participan en análisis IA.",
    sections: [
      {
        title: "Vista de documentos",
        purpose: "Alterna el alcance de documentos visibles.",
        actions: [
          "Icono documento simple: ver solo adjuntos de la versión actual en borrador.",
          "Icono documentos apilados: ver adjuntos de todas las versiónes de la cotización.",
        ],
      },
      {
        title: "Carga e importacion",
        purpose: "Permite adjuntar evidencia y abrir flujo asistido con IA.",
        actions: [
          "Icono documento con + (dropzone): arrastra/suelta o haz clic para adjuntar archivos.",
          "Botón importacion IA: crea la cotización y abre importacion desde documento con IA (requiere documentos elegibles).",
        ],
      },
      {
        title: "Acciones por documento",
        purpose: "Controla el comportamiento de cada archivo adjunto.",
        actions: [
          "Icono etiqueta/estado IA: excluir o volver a permitir el documento para análisis IA.",
          "Icono descarga: descargar el archivo al equipo local.",
        ],
      },
    ],
    modalActions: [
      "Recomendacion: deja habilitados para IA solo los archivos útiles para sugerencias de contenido y pricing.",
    ],
  },
  "quotation.provider-document-import": {
    ariaLabel: "Ayuda del modal crear ítems desde documento con IA",
    title: "Ayuda sobre crear ítems desde documento con IA",
    purpose:
      "Guia detallada del flujo para analizar un documento, resolver coincidencias y aplicar ítems a la cotización.",
    usage:
      "Sigue el orden: configurar contexto, analizar, resolver pendientes, crear faltantes y aplicar resultados.",
    sections: [
      {
        title: "1) Configuración inicial",
        purpose:
          "Define el contexto minimo para que la IA pueda extraer y proponer ítems de forma útil.",
        actions: [
          "Documento: seleccióna un archivo habilitado para IA; sin documento no se activa Analizar.",
          "Proveedor confirmado: define sobre que proveedor se evaluan coincidencias y creación de faltantes.",
          "Botón Analizar documento (icono IA): inicia la extracción de proveedor sugerido, condiciones e ítems.",
          "Overlay de bloqueo: durante análisis o creación de faltantes el modal se bloquea para evitar acciónes inconsistentes.",
        ],
      },
      {
        title: "2) Estado del análisis",
        purpose:
          "Permite saber si el job IA sigue en progreso, termino o fallo.",
        actions: [
          "Estado del análisis: muestra etiqueta normalizada (pendiente, en ejecución, completado, fallido, etc.).",
          "Porcentaje de avance: referencia visual de progreso del job.",
          "Mensaje de job/error: si falla, revisa el detalle antes de reintentar.",
        ],
      },
      {
        title: "3) Resumen de contexto",
        purpose: "Valida que las sugerencias aplicaran en el lugar correcto.",
        actions: [
          "Proveedor sugerido: referencia detectada por IA para contraste con proveedor confirmado.",
          "Sección destino: bloque donde se agregaran ítems al aplicar.",
          "Lista activa: confirma disponibilidad de lista de precios para crear o vincular ítems.",
          "Advertencia de reútilización: muestra importaciones previas para evitar duplicaciones innecesarias.",
        ],
      },
      {
        title: "4) Tabla de ítems identificados",
        purpose:
          "Es el tablero principal para decidir que se crea, que se vincula y que requiere corrección.",
        actions: [
          "Columna Crear (faltantes): marca checkbox para preparar creación másiva de ítems faltantes.",
          "Botón + por fila (faltante o sugerencia): crea item individual en lista activa.",
          "Estado: distingue existente confirmado, coincidencia sugerida, faltante listo o faltante con bloqueo.",
          "Advertencias: cada warning explica riesgos de calidad de datos (codigo, unidad, descripción, etc.).",
          "Agregar a descripción: en advertencias transferibles, copia el warning a la descripción del item para trazabilidad.",
        ],
      },
      {
        title: "5) Resolver coincidencias sugeridas",
        purpose:
          "Obliga a confirmar ambigüedades antes de aplicar para no crear duplicados.",
        actions: [
          "Selector de candidato (si hay múltiples): elige el item existente correcto en lista activa.",
          "Botón Usar existente (check): vincula la fila al item ya existente.",
          "Botón Crear nuevo (+): crea un item nuevo cuando la sugerencia no corresponde.",
          "Feedback por fila: confirma si quedo reútilizado, creado o con error de resolución.",
          "Regla de workflow: mientras existan coincidencias sugeridas sin resolver, no se habilita aplicar.",
        ],
      },
      {
        title: "6) Condiciones y clausulas",
        purpose:
          "Controla que texto comercial detectado por IA se transfiera a la cotización solo cuando conviene.",
        actions: [
          "Condiciones encontradas (Entrega, Validez, Garantia, Pago, Moneda): marca solo las que quieras aplicar.",
          "Clausulas comerciales detectadas: seleccióna por clausula según categoria y confianza (alta/medía/baja).",
          "Evidencia: revisa source snippet para validar que la clausula realmente corresponde al documento.",
          "Buenas practicas: evita transferir clausulas genericas o contradictorias con politica comercial vigente.",
        ],
      },
      {
        title: "7) Botónes finales y etapas",
        purpose:
          "Completa el flujo en dos pasos cuando hay faltantes y en un paso cuando todo ya esta resuelto.",
        actions: [
          "Cancelar (X): cierra la ventana sin aplicar cambios en la edicion actual.",
          "Botón principal en etapa 'crear faltantes': crea en lista activa los ítems marcados en checkbox.",
          "Botón principal en etapa final: agrega ítems confirmados a la edicion actual (persisten al guardar versión).",
          "Bloqueos del boton principal: proveedor no confirmado, sin lista activa, coincidencias pendientes o selección insuficiente.",
        ],
      },
    ],
    modalActions: [
      "Orden recomendado: Documento + Proveedor -> Analizar -> Resolver sugeridas -> Crear faltantes -> Aplicar.",
      "Si el flujo se bloquea, revisa los mensajes de workflow al pie del modal: indican exactamente que falta para continuar.",
      "Usa creación individual (+ por fila) cuando necesites control fino; usa creación másiva cuando la selección ya este validada.",
    ],
  },
  "proposal.create": {
    ariaLabel: "Ayuda sobre el modal de crear propuesta",
    title: "Ayuda sobre crear propuesta",
    purpose:
      "Este modal ayuda a elegir la plantilla base antes de generar la propuesta.",
    usage:
      "Selecciona una plantilla alíneada al caso del cliente y confirma para crear.",
    sections: [
      {
        title: "Plantillas disponibles",
        purpose: "Permite elegir estilo y narrativa base de la propuesta.",
        actions: [
          "Compara nombre, descripción y estilo de portada.",
          "Selecciona plantilla según audiencia y caso comercial.",
          "Valida que exista una selección antes de continuar.",
        ],
      },
      {
        title: "Resumen de selección",
        purpose: "Confirma la plantilla elegida antes de crear.",
        actions: [
          "Revisa nombre final de plantilla en pie del modal.",
          "Si no coincide con el objetivo, cambia selección.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual.",
      "Cancelar/Cerrar: vuelve al flujo anterior sin crear propuesta.",
      "Continuar: crea la propuesta con la plantilla selecciónada.",
    ],
  },
  "proposal.edit": {
    ariaLabel: "Ayuda sobre el modal de editar propuesta",
    title: "Ayuda sobre editar propuesta",
    purpose:
      "Permite editar la propuesta por secciónes sin perder contexto comercial.",
    usage:
      "Trabaja componente por componente, valida sugerencias y guarda de forma incremental.",
    sections: [
      {
        title: "Cabecera del editor",
        purpose: "Muestra estado, cliente y contexto de cotización vinculada.",
        actions: [
          "Confirma propuesta y versión comercial antes de editar.",
          "Usa chips de estado/plantilla como referencia rápida.",
        ],
      },
      {
        title: "Componentes de contenido",
        purpose: "Permite construir narrativa final por bloques.",
        actions: [
          "Edita headings, párrafos, listas e imágenes por sección.",
          "Aplica sugerencias IA con revisión humana previa.",
          "Guarda cada componente para evitar pérdida de cambios.",
        ],
      },
      {
        title: "Metadatos y salida",
        purpose: "Controla estado editorial y preparación de previsualización.",
        actions: [
          "Ajusta título/estado según avance real.",
          "Abre previsualización solo cuando el contenido este validado.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia de edicion.",
      "Cerrar (X): avisa si hay cambios sin guardar.",
      "Guardar sección: persiste avances por componente.",
      "Previsualizar: revisa salida final antes de compartir.",
    ],
  },
  "lead.create": {
    ariaLabel: "Ayuda sobre el modal de crear lead",
    title: "Ayuda sobre crear lead",
    purpose:
      "Este modal sirve para reunir evidencia inicial y crear un lead analizable.",
    usage:
      "Sube archivos y agrega texto adicional para mejorar sugerencias de cuenta, contacto y oportunidad.",
    sections: [
      {
        title: "Carga de evidencia",
        purpose: "Recopila archivos de entrada para análisis del lead.",
        actions: [
          "Sube documentos relevantes (PDF, Office, correo, imagen, audio).",
          "Verifica cantidad y tipo de archivo antes de crear.",
          "Elimina adjuntos incorrectos desde el listado previo.",
        ],
      },
      {
        title: "Texto adicional",
        purpose: "Permite complementar contexto que no viene en archivos.",
        actions: [
          "Agrega notas o resumen del caso en texto claro.",
          "Incluye datos clave que ayuden al motor de sugerencias.",
        ],
      },
      {
        title: "Vista previa de insumos",
        purpose: "Confirma lo que se enviará al análisis.",
        actions: [
          "Revisa archivos y texto cargado antes de enviar.",
          "Asegura que no falte evidencia minima.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual.",
      "Cerrar: cancela creación del lead.",
      "Crear lead: inicia análisis y genera sugerencias relaciónadas.",
      "Overlay de proceso: espera a que termine antes de cerrar.",
    ],
  },
  "lead.edit": {
    ariaLabel: "Ayuda sobre el modal de editar lead",
    title: "Ayuda sobre editar lead",
    purpose:
      "Se usa para revisar y ajustar el análisis del lead antes de resolverlo.",
    usage:
      "Valida sinopsis y sugerencias de relación comercial antes de guardar cambios.",
    sections: [
      {
        title: "Resumen del lead",
        purpose: "Muestra estado actual y contexto temporal del registro.",
        actions: [
          "Revisa estatus del análisis y fecha de creación.",
          "Usa reanalizar cuando cambie la evidencia disponible.",
        ],
      },
      {
        title: "Sugerencias de vinculacion",
        purpose:
          "Permite confirmar o corregir cuenta, contacto y oportunidad sugeridos.",
        actions: [
          "Valida coincidencias sugeridas contra información real.",
          "Crea o vincula registros según corresponda.",
          "Evita duplicados antes de resolver definitivamente.",
        ],
      },
      {
        title: "Documentos adicionales",
        purpose: "Permite enriquecer el análisis con nueva evidencia.",
        actions: [
          "Adjunta archivos extra si faltaba contexto.",
          "Reanaliza para refrescar sinopsis y recomendaciones.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia para edicion/resolución.",
      "Reanalizar: actualiza sugerencias según evidencia vigente.",
      "Guardar/Resolver: aplica cambios y materializa registros relaciónados.",
      "Cerrar: sale del modal sin resolver si aún falta revisión.",
    ],
  },
};

export function getModalHelp(helpKey) {
  return HELP_MODAL_CATALOG[String(helpKey || "").trim()] || null;
}

export function resolveHelpRouteKey(pathname = "") {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/accounts")) return "accounts";
  if (pathname.startsWith("/contacts")) return "contacts";
  if (pathname.startsWith("/interactions")) return "interactions";
  if (pathname.startsWith("/proposals")) return "proposals";
  if (pathname.startsWith("/quotations")) return "quotations";
  if (pathname.startsWith("/opportunities/questions"))
    return "opportunities-questions";
  if (pathname.startsWith("/opportunities")) return "opportunities";
  if (pathname.startsWith("/commercial-tracking")) return "commercial-tracking";
  if (pathname.startsWith("/commercial-planning")) return "commercial-planning";
  if (pathname.startsWith("/commercial-enablement"))
    return "commercial-enablement";
  if (pathname.startsWith("/commercial-development"))
    return "commercial-development";
  if (pathname.startsWith("/contact-mapping")) return "contact-mapping";
  if (pathname.startsWith("/providers")) return "providers";
  if (pathname.startsWith("/manufacturer-registrations"))
    return "manufacturer-registrations";
  if (pathname.startsWith("/users")) return "users";
  if (pathname.startsWith("/roles")) return "roles";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/tools")) return "tools";
  if (pathname.startsWith("/audit")) return "audit";
  return "general";
}
