export const HELP_ARTICLES = [
  {
    id: "dashboard-overview",
    routeKey: "dashboard",
    title: "Leer el dashboard sin perder foco",
    summary:
      "Usa esta vista para detectar prioridades del dia antes de entrar a los modulos operativos.",
    details: [
      "Revisa primero indicadores con mayor desviacion o alertas activas.",
      "Toma una decision de seguimiento y luego navega al modulo correspondiente.",
      "Evita ejecutar cambios desde aqui: tratala como tablero de lectura.",
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
      "Captura nombre comercial y datos de identificacion de forma consistente.",
      "Asigna responsables y contexto para que el equipo ubique la cuenta rapido.",
      "Guarda y valida que quede en estado activo antes de relacionar oportunidades.",
    ],
    tags: ["cuentas", "crear", "alta"],
  },
  {
    id: "accounts-edit",
    routeKey: "accounts",
    title: "Editar una cuenta existente",
    summary:
      "Abre acciones de la cuenta para actualizar responsables, datos de contacto y contexto comercial.",
    details: [
      "Actualiza responsables cuando cambie cobertura o ownership comercial.",
      "Depura datos de contacto para evitar duplicados en prospectos y oportunidades.",
      "Usa notas y campos de contexto para dejar trazabilidad util al equipo.",
    ],
    tags: ["cuentas", "editar", "actualizar"],
  },
  {
    id: "contacts-create",
    routeKey: "contacts",
    title: "Crear y clasificar contactos",
    summary:
      "Registra contactos con poder de decision y nivel de influencia para mejorar el targeting comercial.",
    details: [
      "Completa correo, telefono y cargo para acelerar seguimiento multicanal.",
      "Asigna poder de decision y relacion con nosotros segun contexto real.",
      "Relaciona cada contacto con su cuenta principal para evitar huella suelta.",
    ],
    tags: ["contactos", "crear", "clasificacion"],
  },
  {
    id: "contacts-hygiene",
    routeKey: "contacts",
    title: "Higiene de base de contactos",
    summary:
      "Mantener la calidad de datos en contactos reduce errores al cotizar y al mapear decisores.",
    details: [
      "Busca duplicados por correo, telefono o nombre dentro de la misma cuenta.",
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
      "Captura cada interaccion relevante para sostener continuidad comercial entre equipos.",
    details: [
      "Registra origen, contexto y siguiente accion inmediatamente despues del contacto.",
      "Vincula evidencia documental cuando aplique para soportar decisiones futuras.",
      "Promueve a oportunidad solo cuando haya claridad de necesidad y potencial real.",
    ],
    tags: ["leads", "interacciones", "seguimiento"],
  },
  {
    id: "opportunities-flow",
    routeKey: "opportunities",
    title: "Gestionar oportunidades sin bloquear el flujo",
    summary:
      "Filtra por estado, abre una oportunidad y avanza etapas registrando evidencias y siguientes pasos.",
    details: [
      "Usa filtros por estado para trabajar primero lo mas cercano a cierre.",
      "Mantem actualizadas respuestas de etapa para no frenar avance por validaciones.",
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
      "Ordena por fecha de cierre y esfuerzo pendiente para decidir en que trabajar hoy.",
      "Combina estado comercial y activacion para separar riesgo real de ruido.",
      "Agenda siguiente paso con responsables explicitos para reducir estancamiento.",
    ],
    tags: ["oportunidades", "prioridad", "pipeline"],
  },
  {
    id: "proposals-edit",
    routeKey: "proposals",
    title: "Editar una propuesta por secciones",
    summary:
      "Abre acciones, entra al editor y guarda componente por componente para evitar perder cambios.",
    details: [
      "Trabaja por componentes y guarda al finalizar cada bloque de contenido.",
      "Usa sugerencias de IA como borrador y valida consistencia comercial antes de aplicar.",
      "Mantem imagenes y activos alineados a la narrativa del cliente objetivo.",
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
      "Valida encabezados, parrafos e imagenes para evitar secciones incompletas.",
      "Revisa pricing heredado y contexto de cotizacion vinculada.",
      "Genera vista de impresion solo cuando el contenido este confirmado.",
    ],
    tags: ["propuestas", "publicacion", "revision"],
  },
  {
    id: "quotations-create",
    routeKey: "quotations",
    title: "Crear cotizacion y generar propuesta",
    summary:
      "Crea una cotizacion desde la oportunidad y usa la accion de propuesta cuando la version este lista.",
    details: [
      "Define datos base de version y captura items por seccion con precision.",
      "Usa workflow de estados para separar borrador operativo de version aprobada.",
      "Genera propuesta solo desde versiones en estado compatible.",
    ],
    tags: ["cotizaciones", "propuestas", "versiones"],
  },
  {
    id: "quotations-governance",
    routeKey: "quotations",
    title: "Controlar calidad de cotizaciones",
    summary:
      "Mantem versionado limpio y evita retrabajo con reglas claras de edicion y aprobacion.",
    details: [
      "Duplica versiones solo cuando exista un cambio sustantivo de oferta.",
      "Documenta notas internas y condiciones comerciales para auditoria posterior.",
      "Antes de aprobar, revisa importes, impuestos y descuentos en conjunto.",
    ],
    tags: ["cotizaciones", "aprobacion", "control"],
  },
  {
    id: "tracking-overview",
    routeKey: "commercial-tracking",
    title: "Leer el cockpit comercial",
    summary:
      "Ajusta filtros de semana/vendedor/linea y usa tabs para revisar resumen, abiertas y forecast.",
    details: [
      "En resumen identifica variaciones semanales y focos de riesgo por etapa.",
      "En abiertas revisa volumen pendiente y oportunidades que requieren accion.",
      "En forecast compara escenario esperado contra ejecucion real para calibrar plan.",
    ],
    tags: ["cockpit", "seguimiento", "forecast"],
  },
  {
    id: "planning-commissions",
    routeKey: "commercial-planning",
    title: "Configurar planeacion y comisiones",
    summary:
      "Define metas y reglas de comision para alinear ejecucion comercial y rentabilidad.",
    details: [
      "Configura cuotas trimestrales por responsable y valida cobertura del periodo.",
      "Revisa umbrales de margen y cumplimiento antes de publicar esquema.",
      "Monitorea desvio entre planeado y ejecutado para ajustar prioridades.",
    ],
    tags: ["planeacion", "comisiones", "metas"],
  },
  {
    id: "development-workspace",
    routeKey: "commercial-development",
    title: "Operar desarrollo comercial",
    summary:
      "Usa este espacio para coordinar acciones, dependencias y avance operativo del pipeline.",
    details: [
      "Registra proximo paso con fechas y responsables claros.",
      "Vincula dependencias para evitar bloqueos entre equipos.",
      "Actualiza evidencias cuando cambie el estado de ejecucion.",
    ],
    tags: ["desarrollo", "ejecucion", "pipeline"],
  },
  {
    id: "enablement-library",
    routeKey: "commercial-enablement",
    title: "Gestionar biblioteca comercial",
    summary:
      "Centraliza activos comerciales y controla su vigencia para ventas y propuestas.",
    details: [
      "Clasifica activos por tipo y uso para encontrarlos con rapidez.",
      "Mantem gobierno de versiones para evitar materiales obsoletos.",
      "Revisa cobertura de activos por etapa del proceso comercial.",
    ],
    tags: ["biblioteca", "activos", "enablement"],
  },
  {
    id: "contact-mapping-network",
    routeKey: "contact-mapping",
    title: "Mapear red de contactos",
    summary:
      "Visualiza relaciones y niveles de influencia para mejorar estrategia de acceso a cuentas.",
    details: [
      "Identifica decisores finales y posibles vetos en cada cuenta.",
      "Ajusta plan de acercamiento por fortaleza de relacion.",
      "Confirma cobertura de contactos por unidad de negocio.",
    ],
    tags: ["mapeo", "influencia", "decisores"],
  },
  {
    id: "providers-catalog",
    routeKey: "providers",
    title: "Administrar proveedores y listas",
    summary:
      "Mantem catalogos de proveedores y precios consistentes para cotizar sin fricciones.",
    details: [
      "Verifica vigencia de listas y codigos antes de cotizar.",
      "Evita duplicados de price code y estandariza descripciones.",
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
      "Crea y mantiene usuarios con datos vigentes para asegurar trazabilidad de acciones.",
    details: [
      "Verifica correo y rol funcional al crear o actualizar usuarios.",
      "Desactiva accesos obsoletos para reducir riesgo operativo.",
      "Confirma que el owner comercial tenga permisos minimos necesarios.",
    ],
    tags: ["usuarios", "accesos", "administracion"],
  },
  {
    id: "roles-governance",
    routeKey: "roles",
    title: "Disenar roles y permisos",
    summary:
      "Define roles por responsabilidad real para equilibrar seguridad y velocidad operativa.",
    details: [
      "Asigna permisos por modulo evitando privilegios excesivos.",
      "Versiona cambios importantes de roles para auditoria.",
      "Prueba rutas criticas con un usuario de cada rol clave.",
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
      "Mantem preguntas obligatorias alineadas al proceso vigente.",
      "Evita cambios abruptos sin validar impacto en oportunidades activas.",
      "Documenta criterios de respuesta para uso uniforme del equipo.",
    ],
    tags: ["proceso", "preguntas", "configuracion"],
  },
  {
    id: "settings-governance",
    routeKey: "settings",
    title: "Administrar configuracion del sistema",
    summary:
      "Centraliza parametros globales y aplica cambios de forma controlada.",
    details: [
      "Revisa impacto antes de modificar catalogos o banderas globales.",
      "Coordina cambios sensibles fuera de horario operativo critico.",
      "Valida permisos y resultados despues de cada ajuste.",
    ],
    tags: ["configuracion", "sistema", "gobierno"],
  },
  {
    id: "tools-operations",
    routeKey: "tools",
    title: "Usar herramientas administrativas",
    summary:
      "Ejecuta utilidades de mantenimiento con criterio operativo y trazabilidad.",
    details: [
      "Confirma entorno y alcance antes de ejecutar una herramienta.",
      "Documenta resultado de acciones que alteren datos o catálogos.",
      "Evita correr procesos destructivos sin respaldo o validacion previa.",
    ],
    tags: ["herramientas", "mantenimiento", "operacion"],
  },
  {
    id: "audit-traceability",
    routeKey: "audit",
    title: "Auditar cambios del sistema",
    summary:
      "Consulta eventos para reconstruir decisiones, cambios y responsables.",
    details: [
      "Filtra por modulo y periodo para enfocar investigacion.",
      "Correlaciona eventos con usuarios y registros afectados.",
      "Exporta evidencia cuando se requiera seguimiento formal.",
    ],
    tags: ["auditoria", "trazabilidad", "control"],
  },
  {
    id: "general-navigation",
    routeKey: "general",
    title: "Navegacion y buenas practicas",
    summary:
      "Si un modulo no tiene ayuda especifica, usa esta guia base para trabajar de forma segura.",
    details: [
      "Confirma permisos y contexto antes de crear o editar registros.",
      "Guarda cambios de forma incremental para reducir perdida de informacion.",
      "Usa filtros y busqueda para operar sobre lotes pequeños y precisos.",
    ],
    tags: ["general", "navegacion", "practicas"],
  },
];

export const HELP_TOURS = [
  {
    id: "tour-proposals-basic",
    routeKey: "proposals",
    title: "Tour rapido de Propuestas",
    steps: [
      {
        id: "proposals-title",
        target: '[data-help-id="proposals.title"]',
        title: "Modulo de propuestas",
        content:
          "Desde aqui gestionas propuestas por cliente y abres el editor estructurado.",
      },
      {
        id: "proposals-actions",
        target: '[data-help-id="proposals.actions"]',
        title: "Acciones",
        content: "Usa este menu para abrir una propuesta en modo edicion.",
      },
      {
        id: "proposals-save",
        target: '[data-help-id="proposals.save-component"]',
        title: "Guardar seccion",
        content:
          "Guarda cada componente despues de editar para confirmar cambios.",
      },
    ],
  },
  {
    id: "tour-quotations-basic",
    routeKey: "quotations",
    title: "Tour rapido de Cotizaciones",
    steps: [
      {
        id: "quotations-title",
        target: '[data-help-id="quotations.title"]',
        title: "Modulo de cotizaciones",
        content:
          "Aqui controlas versiones, estados y estructura de la cotizacion.",
      },
      {
        id: "quotations-create",
        target: '[data-help-id="quotations.create"]',
        title: "Crear cotizacion",
        content:
          "Crea una nueva version para iniciar o iterar el proceso comercial.",
      },
      {
        id: "quotations-actions",
        target: '[data-help-id="quotations.actions"]',
        title: "Menu de acciones",
        content: "Abre opciones de version y acceso rapido a propuesta.",
      },
    ],
  },
  {
    id: "tour-opportunities-basic",
    routeKey: "opportunities",
    title: "Tour rapido de Oportunidades",
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
        content: "Usa filtros y busqueda para enfocarte en lo prioritario.",
      },
    ],
  },
  {
    id: "tour-tracking-basic",
    routeKey: "commercial-tracking",
    title: "Tour rapido de Seguimiento",
    steps: [
      {
        id: "tracking-title",
        target: '[data-help-id="tracking.title"]',
        title: "Cockpit comercial",
        content:
          "Este modulo concentra visibilidad del pipeline y rendimiento semanal.",
      },
      {
        id: "tracking-toolbar",
        target: '[data-help-id="tracking.toolbar"]',
        title: "Filtros principales",
        content:
          "Semana, vendedor y linea ajustan todas las metricas de la vista.",
      },
      {
        id: "tracking-tabs",
        target: '[data-help-id="tracking.tabs"]',
        title: "Tabs de analisis",
        content:
          "Alterna entre resumen, abiertas, periodo y forecast segun la necesidad.",
      },
    ],
  },
];

export const HELP_MODAL_CATALOG = {
  "account.create": {
    ariaLabel: "Ayuda sobre el modal de crear cuenta",
    title: "Ayuda sobre crear cuenta",
    purpose:
      "Usalo para registrar una cuenta nueva con sus datos principales y contexto comercial inicial.",
    usage:
      "Completa nombre, tipo, sector y responsables para dejar la cuenta lista para seguimiento.",
    sections: [
      {
        title: "Datos principales",
        purpose:
          "Define la identidad comercial de la cuenta y su clasificacion base.",
        actions: [
          "Captura el nombre oficial/comercial y valida formato antes de guardar.",
          "Selecciona tipo de cuenta, sector y fuente de origen cuando aplique.",
          "Confirma que no exista duplicado (el sistema puede mostrar advertencias).",
        ],
      },
      {
        title: "Ubicacion y contacto",
        purpose:
          "Deja ubicacion y canales de contacto listos para operacion y seguimiento.",
        actions: [
          "Completa pais, estado, ciudad y direccion con datos verificables.",
          "Agrega telefono y correo institucional para facilitar contacto temprano.",
          "Asegura consistencia geografica si la cuenta opera en varias sedes.",
        ],
      },
      {
        title: "Descripcion de la empresa",
        purpose:
          "Resume a que se dedica la cuenta y su contexto comercial relevante.",
        actions: [
          "Redacta giro, capacidades y necesidades de negocio observadas.",
          "Usa texto concreto; evita descripciones ambiguas o vacias.",
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
      "Boton Ayuda: abre esta guia contextual del modal.",
      "Boton Cerrar (X): cierra el modal; si hay procesos en curso puede bloquearse.",
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
      "Revisa responsables, estado de activacion y datos clave antes de guardar cambios.",
    sections: [
      {
        title: "Datos principales",
        purpose:
          "Mantiene vigente la informacion central de la cuenta durante su ciclo comercial.",
        actions: [
          "Actualiza nombre y clasificacion solo cuando haya cambios reales.",
          "Conserva consistencia con registros ya vinculados (contactos/oportunidades).",
          "Evita cambios innecesarios que compliquen trazabilidad historica.",
        ],
      },
      {
        title: "Ubicacion y contacto",
        purpose:
          "Corrige datos de localizacion y canales para mejorar operacion diaria.",
        actions: [
          "Ajusta direccion, telefonos y correos obsoletos.",
          "Verifica datos antes de guardar para evitar rebotes de contacto.",
          "Mantem formato uniforme entre cuentas del mismo grupo empresarial.",
        ],
      },
      {
        title: "Descripcion de la empresa",
        purpose:
          "Refina el contexto de negocio con informacion nueva o mas precisa.",
        actions: [
          "Incorpora cambios de portafolio, industria o prioridades del cliente.",
          "Retira informacion desactualizada para no sesgar decisiones.",
          "Valida coherencia de la narrativa antes de guardar.",
        ],
      },
      {
        title: "Propietarios",
        purpose:
          "Permite reasignar cobertura cuando cambia el equipo o la estrategia.",
        actions: [
          "Agrega/quita propietarios segun responsabilidad actual.",
          "No dejes la cuenta sin propietarios activos.",
          "Confirma que los nuevos responsables conozcan el contexto de la cuenta.",
        ],
      },
      {
        title: "Auditoria de la cuenta",
        purpose:
          "Muestra historial basico de creacion/actualizacion para trazabilidad.",
        actions: [
          "Revisa fechas y usuario editor cuando necesites validar cambios recientes.",
          "Usa este bloque como referencia, no como campo editable.",
        ],
      },
    ],
    modalActions: [
      "Boton Ayuda: abre esta guia contextual para edicion.",
      "Estado/ID en cabecera: referencia rapida para confirmar que editas el registro correcto.",
      "Guardar cambios: persiste ajustes del formulario actual.",
      "Cerrar (X): sale del modal; verifica cambios pendientes antes de cerrar.",
    ],
  },
  "contact.create": {
    ariaLabel: "Ayuda sobre el modal de crear contacto",
    title: "Ayuda sobre crear contacto",
    purpose:
      "Sirve para registrar un contacto y dejarlo utilizable en oportunidades y cotizaciones.",
    usage:
      "Captura datos principales, clasificacion comercial y valida cuenta asociada antes de guardar.",
    sections: [
      {
        title: "Datos principales",
        purpose: "Identifica al contacto y su vinculacion base con la cuenta.",
        actions: [
          "Captura nombre y apellidos completos.",
          "Selecciona la cuenta correcta para evitar registros huerfanos.",
          "Registra cargo y area para dar contexto al equipo comercial.",
        ],
      },
      {
        title: "Datos comerciales",
        purpose:
          "Clasifica influencia y prioridad del contacto en el proceso de compra.",
        actions: [
          "Define poder de decision y fortaleza de relacion.",
          "Asigna responsable interno cuando aplique.",
          "Ajusta estatus segun vigencia real del contacto.",
        ],
      },
      {
        title: "Ubicacion y canales",
        purpose: "Deja listos los medios de contacto operativos.",
        actions: [
          "Completa correo y telefono con formato valido.",
          "Agrega ciudad/pais si se usa segmentacion territorial.",
          "Corrige datos incompletos antes de guardar.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual del modal.",
      "Cerrar (X): sale del modal; si estas guardando puede bloquearse.",
      "Guardar contacto: valida campos requeridos y crea el registro.",
      "Revision de duplicados: si aparece, revisa coincidencias antes de confirmar.",
    ],
  },
  "contact.edit": {
    ariaLabel: "Ayuda sobre el modal de editar contacto",
    title: "Ayuda sobre editar contacto",
    purpose:
      "Este modal se usa para actualizar informacion del contacto y su relacion comercial.",
    usage:
      "Ajusta datos de contacto, cuenta asociada y clasificacion sin perder consistencia.",
    sections: [
      {
        title: "Datos principales",
        purpose: "Mantiene vigente la identidad y afiliacion del contacto.",
        actions: [
          "Corrige nombre/cargo cuando cambien oficialmente.",
          "Verifica que la cuenta asociada siga siendo correcta.",
          "Evita cambios que rompan historico sin justificacion.",
        ],
      },
      {
        title: "Datos comerciales",
        purpose: "Actualiza el rol del contacto en decisiones de compra.",
        actions: [
          "Recalibra influencia, relacion y prioridad comercial.",
          "Ajusta estatus de activacion segun uso real.",
          "Confirma consistencia con oportunidades activas.",
        ],
      },
      {
        title: "Auditoria",
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
      "Empieza por cuenta, contacto y linea de negocio; agrega evidencia para mejorar el borrador.",
    sections: [
      {
        title: "Datos principales",
        purpose: "Define la oportunidad, su cuenta y contexto inicial.",
        actions: [
          "Selecciona cuenta, contacto y linea de negocio.",
          "Captura nombre de oportunidad y monto estimado inicial.",
          "Establece fecha objetivo de cierre realista.",
        ],
      },
      {
        title: "Contexto comercial",
        purpose: "Fija responsables y clasificacion para seguimiento.",
        actions: [
          "Asigna vendedor y pre-venta cuando aplique.",
          "Confirma etapa/estado inicial coherente.",
          "Incluye notas clave para handoff interno.",
        ],
      },
      {
        title: "Documentos y evidencia",
        purpose: "Aporta soporte documental para el analisis y avance.",
        actions: [
          "Sube documentos relevantes del cliente o requerimiento.",
          "Revisa sugerencias automáticas antes de aplicarlas.",
          "No cierres el modal durante cargas activas.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre la guia contextual de creacion.",
      "Cerrar (X): cancela el alta de oportunidad.",
      "Guardar/Crear oportunidad: valida obligatorios y registra el borrador.",
      "Validaciones: el sistema puede bloquear avance si falta informacion critica.",
    ],
  },
  "opportunity.edit": {
    ariaLabel: "Ayuda sobre el modal de editar oportunidad",
    title: "Ayuda sobre editar oportunidad",
    purpose:
      "Este modal te permite mantener la oportunidad alineada al avance real del proceso.",
    usage:
      "Actualiza etapa, estado comercial, responsables y evidencia para evitar bloqueos.",
    sections: [
      {
        title: "Cabecera de estado",
        purpose: "Muestra referencia rapida de ID, etapa y estatus actuales.",
        actions: [
          "Verifica que editas la oportunidad correcta.",
          "Usa badges para confirmar estado de activacion/comercial.",
        ],
      },
      {
        title: "Datos y contexto",
        purpose: "Ajusta informacion base conforme evoluciona el caso.",
        actions: [
          "Actualiza monto, fechas y responsables.",
          "Mantem consistencia con la etapa comercial vigente.",
          "Documenta cambios que impacten pronostico.",
        ],
      },
      {
        title: "Workspace y documentos",
        purpose:
          "Gestiona respuestas de etapa, acciones y evidencia operativa.",
        actions: [
          "Responde preguntas obligatorias para permitir avances.",
          "Sube o depura evidencia segun progreso.",
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
    ariaLabel: "Ayuda sobre el modal de crear cotizacion",
    title: "Ayuda sobre crear cotizacion",
    purpose:
      "Se usa para crear una cotizacion nueva desde el contexto comercial correcto.",
    usage:
      "Define cuenta, oportunidad y contacto; luego estructura secciones e items antes de crear.",
    sections: [
      {
        title: "Contexto comercial",
        purpose:
          "Ancla la cotizacion a cuenta, oportunidad y contacto validos.",
        actions: [
          "Selecciona cuenta y oportunidad antes de editar detalle.",
          "Confirma contacto principal para salida comercial.",
          "Bloquea el contexto cuando estes seguro de la seleccion.",
        ],
      },
      {
        title: "Secciones e items",
        purpose: "Construye el contenido economico de la cotizacion.",
        actions: [
          "Agrega secciones por alcance (productos/servicios).",
          "Carga items, cantidades, precios y ajustes de venta.",
          "Usa acciones de fila para duplicar/mover/ordenar.",
        ],
      },
      {
        title: "Resumen y condiciones",
        purpose: "Consolida descuentos, impuestos y condiciones comerciales.",
        actions: [
          "Define modo de descuento y distribucion.",
          "Configura IVA y valida totales finales.",
          "Completa notas internas y condiciones para auditoria.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual.",
      "Cerrar (X): si hay cambios sin guardar, pide confirmacion.",
      "Crear cotizacion: valida estructura y registra version inicial.",
      "Importar documentos: puede precargar datos comerciales complementarios.",
    ],
  },
  "quotation.edit": {
    ariaLabel: "Ayuda sobre el modal de editar cotizacion",
    title: "Ayuda sobre editar cotizacion",
    purpose:
      "Permite ajustar una cotizacion existente manteniendo coherencia entre versiones.",
    usage:
      "Revisa estado, secciones e items y guarda cuando el impacto comercial este validado.",
    sections: [
      {
        title: "Cabecera y metadatos",
        purpose: "Muestra cotizacion, version y estado para control operativo.",
        actions: [
          "Verifica numero de cotizacion y version activa.",
          "Confirma si editas version mayor o historica.",
          "Usa estado para decidir si procede editar.",
        ],
      },
      {
        title: "Editor de contenido",
        purpose: "Permite modificar secciones, items y condiciones.",
        actions: [
          "Ajusta cantidades, precios y descuentos con criterio comercial.",
          "Mantem notas internas y condiciones actualizadas.",
          "Revisa impacto total antes de guardar.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia de edicion.",
      "Cerrar (X): sale del editor de cotizacion.",
      "Acciones del editor: guardar cambios por seccion/version.",
      "Estados del workflow: condicionan acciones disponibles.",
    ],
  },
  "quotation.sections.toolbar": {
    ariaLabel: "Ayuda de iconos en secciones de la cotizacion",
    title: "Iconos de secciones de la cotizacion",
    purpose:
      "Explica para que sirve cada icono del toolbar de secciones y filas.",
    usage:
      "Selecciona filas cuando aplique; varios iconos se habilitan solo con filas seleccionadas.",
    sections: [
      {
        title: "Toolbar superior de secciones",
        purpose: "Controla la estructura general de la cotizacion.",
        actions: [
          "Icono + (Crear seccion nueva): agrega una seccion vacia.",
          "Usalo para separar alcance por bloques (productos, servicios, etc.).",
        ],
      },
      {
        title: "Grupo Fila",
        purpose: "Opera sobre filas de items dentro de una seccion.",
        actions: [
          "Icono +: agregar fila.",
          "Icono papelera: eliminar filas seleccionadas.",
          "Icono flecha arriba: subir filas seleccionadas.",
          "Icono flecha abajo: bajar filas seleccionadas.",
          "Icono duplicar: clonar filas seleccionadas.",
          "Icono copiar: copiar filas seleccionadas.",
          "Icono pegar: pegar filas copiadas.",
          "Icono resaltar ON: marcar filas seleccionadas.",
          "Icono resaltar OFF: quitar resaltado de filas seleccionadas.",
          "Icono ajuste de venta: recalcular precio de venta de una sola fila seleccionada.",
        ],
      },
      {
        title: "Grupo Seccion",
        purpose: "Gestiona la seccion completa.",
        actions: [
          "Icono flecha arriba: mover seccion hacia arriba.",
          "Icono flecha abajo: mover seccion hacia abajo.",
          "Icono duplicar: duplicar seccion completa.",
          "Icono papelera: eliminar seccion.",
        ],
      },
      {
        title: "Grupo Bundle",
        purpose:
          "Agrupa filas en bundles manuales y administra sus componentes.",
        actions: [
          "Icono crear bundle manual: crea un bundle con las filas seleccionadas.",
          "Icono bundle desde plantilla: crea el bundle usando un padre nuevo basado en plantilla.",
          "Icono adjuntar al bundle: agrega filas seleccionadas a un bundle manual existente.",
          "Icono quitar del bundle: separa componentes seleccionados de su bundle manual.",
          "Regla clave: selecciona filas compatibles; no se permiten bundles/componentes no editables en operaciones de agrupacion.",
        ],
      },
    ],
    modalActions: [
      "Tip: si un icono aparece deshabilitado, revisa si falta seleccionar filas o si la accion no aplica al contexto.",
      "Para bundle, sigue las validaciones de seleccion mostradas bajo la tabla cuando una accion no este disponible.",
    ],
  },
  "quotation.documentation.toolbar": {
    ariaLabel: "Ayuda de iconos en documentacion",
    title: "Iconos de documentacion",
    purpose:
      "Describe el toolbar de Documentacion y como usar cada icono/accion.",
    usage:
      "Adjunta documentos primero y luego decide cuales participan en analisis IA.",
    sections: [
      {
        title: "Vista de documentos",
        purpose: "Alterna el alcance de documentos visibles.",
        actions: [
          "Icono documento simple: ver solo adjuntos de la version actual en borrador.",
          "Icono documentos apilados: ver adjuntos de todas las versiones de la cotizacion.",
        ],
      },
      {
        title: "Carga e importacion",
        purpose: "Permite adjuntar evidencia y abrir flujo asistido con IA.",
        actions: [
          "Icono documento con + (dropzone): arrastra/suelta o haz clic para adjuntar archivos.",
          "Boton importacion IA: crea la cotizacion y abre importacion desde documento con IA (requiere documentos elegibles).",
        ],
      },
      {
        title: "Acciones por documento",
        purpose: "Controla el comportamiento de cada archivo adjunto.",
        actions: [
          "Icono etiqueta/estado IA: excluir o volver a permitir el documento para analisis IA.",
          "Icono descarga: descargar el archivo al equipo local.",
        ],
      },
    ],
    modalActions: [
      "Recomendacion: deja habilitados para IA solo los archivos utiles para sugerencias de contenido y pricing.",
    ],
  },
  "quotation.provider-document-import": {
    ariaLabel: "Ayuda del modal crear items desde documento con IA",
    title: "Ayuda sobre crear items desde documento con IA",
    purpose:
      "Guia detallada del flujo para analizar un documento, resolver coincidencias y aplicar items a la cotizacion.",
    usage:
      "Sigue el orden: configurar contexto, analizar, resolver pendientes, crear faltantes y aplicar resultados.",
    sections: [
      {
        title: "1) Configuracion inicial",
        purpose:
          "Define el contexto minimo para que la IA pueda extraer y proponer items de forma util.",
        actions: [
          "Documento: selecciona un archivo habilitado para IA; sin documento no se activa Analizar.",
          "Proveedor confirmado: define sobre que proveedor se evaluan coincidencias y creacion de faltantes.",
          "Boton Analizar documento (icono IA): inicia la extraccion de proveedor sugerido, condiciones e items.",
          "Overlay de bloqueo: durante analisis o creacion de faltantes el modal se bloquea para evitar acciones inconsistentes.",
        ],
      },
      {
        title: "2) Estado del analisis",
        purpose:
          "Permite saber si el job IA sigue en progreso, termino o fallo.",
        actions: [
          "Estado del analisis: muestra etiqueta normalizada (pendiente, en ejecucion, completado, fallido, etc.).",
          "Porcentaje de avance: referencia visual de progreso del job.",
          "Mensaje de job/error: si falla, revisa el detalle antes de reintentar.",
        ],
      },
      {
        title: "3) Resumen de contexto",
        purpose: "Valida que las sugerencias aplicaran en el lugar correcto.",
        actions: [
          "Proveedor sugerido: referencia detectada por IA para contraste con proveedor confirmado.",
          "Seccion destino: bloque donde se agregaran items al aplicar.",
          "Lista activa: confirma disponibilidad de lista de precios para crear o vincular items.",
          "Advertencia de reutilizacion: muestra importaciones previas para evitar duplicaciones innecesarias.",
        ],
      },
      {
        title: "4) Tabla de items identificados",
        purpose:
          "Es el tablero principal para decidir que se crea, que se vincula y que requiere correccion.",
        actions: [
          "Columna Crear (faltantes): marca checkbox para preparar creacion masiva de items faltantes.",
          "Boton + por fila (faltante o sugerencia): crea item individual en lista activa.",
          "Estado: distingue existente confirmado, coincidencia sugerida, faltante listo o faltante con bloqueo.",
          "Advertencias: cada warning explica riesgos de calidad de datos (codigo, unidad, descripcion, etc.).",
          "Agregar a descripcion: en advertencias transferibles, copia el warning a la descripcion del item para trazabilidad.",
        ],
      },
      {
        title: "5) Resolver coincidencias sugeridas",
        purpose:
          "Obliga a confirmar ambiguedades antes de aplicar para no crear duplicados.",
        actions: [
          "Selector de candidato (si hay multiples): elige el item existente correcto en lista activa.",
          "Boton Usar existente (check): vincula la fila al item ya existente.",
          "Boton Crear nuevo (+): crea un item nuevo cuando la sugerencia no corresponde.",
          "Feedback por fila: confirma si quedo reutilizado, creado o con error de resolucion.",
          "Regla de workflow: mientras existan coincidencias sugeridas sin resolver, no se habilita aplicar.",
        ],
      },
      {
        title: "6) Condiciones y clausulas",
        purpose:
          "Controla que texto comercial detectado por IA se transfiera a la cotizacion solo cuando conviene.",
        actions: [
          "Condiciones encontradas (Entrega, Validez, Garantia, Pago, Moneda): marca solo las que quieras aplicar.",
          "Clausulas comerciales detectadas: selecciona por clausula segun categoria y confianza (alta/media/baja).",
          "Evidencia: revisa source snippet para validar que la clausula realmente corresponde al documento.",
          "Buenas practicas: evita transferir clausulas genericas o contradictorias con politica comercial vigente.",
        ],
      },
      {
        title: "7) Botones finales y etapas",
        purpose:
          "Completa el flujo en dos pasos cuando hay faltantes y en un paso cuando todo ya esta resuelto.",
        actions: [
          "Cancelar (X): cierra la ventana sin aplicar cambios en la edicion actual.",
          "Boton principal en etapa 'crear faltantes': crea en lista activa los items marcados en checkbox.",
          "Boton principal en etapa final: agrega items confirmados a la edicion actual (persisten al guardar version).",
          "Bloqueos del boton principal: proveedor no confirmado, sin lista activa, coincidencias pendientes o seleccion insuficiente.",
        ],
      },
    ],
    modalActions: [
      "Orden recomendado: Documento + Proveedor -> Analizar -> Resolver sugeridas -> Crear faltantes -> Aplicar.",
      "Si el flujo se bloquea, revisa los mensajes de workflow al pie del modal: indican exactamente que falta para continuar.",
      "Usa creacion individual (+ por fila) cuando necesites control fino; usa creacion masiva cuando la seleccion ya este validada.",
    ],
  },
  "proposal.create": {
    ariaLabel: "Ayuda sobre el modal de crear propuesta",
    title: "Ayuda sobre crear propuesta",
    purpose:
      "Este modal ayuda a elegir la plantilla base antes de generar la propuesta.",
    usage:
      "Selecciona una plantilla alineada al caso del cliente y confirma para crear.",
    sections: [
      {
        title: "Plantillas disponibles",
        purpose: "Permite elegir estilo y narrativa base de la propuesta.",
        actions: [
          "Compara nombre, descripcion y estilo de portada.",
          "Selecciona plantilla segun audiencia y caso comercial.",
          "Valida que exista una seleccion antes de continuar.",
        ],
      },
      {
        title: "Resumen de seleccion",
        purpose: "Confirma la plantilla elegida antes de crear.",
        actions: [
          "Revisa nombre final de plantilla en pie del modal.",
          "Si no coincide con el objetivo, cambia seleccion.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual.",
      "Cancelar/Cerrar: vuelve al flujo anterior sin crear propuesta.",
      "Continuar: crea la propuesta con la plantilla seleccionada.",
    ],
  },
  "proposal.edit": {
    ariaLabel: "Ayuda sobre el modal de editar propuesta",
    title: "Ayuda sobre editar propuesta",
    purpose:
      "Permite editar la propuesta por secciones sin perder contexto comercial.",
    usage:
      "Trabaja componente por componente, valida sugerencias y guarda de forma incremental.",
    sections: [
      {
        title: "Cabecera del editor",
        purpose: "Muestra estado, cliente y contexto de cotizacion vinculada.",
        actions: [
          "Confirma propuesta y version comercial antes de editar.",
          "Usa chips de estado/plantilla como referencia rapida.",
        ],
      },
      {
        title: "Componentes de contenido",
        purpose: "Permite construir narrativa final por bloques.",
        actions: [
          "Edita headings, parrafos, listas e imagenes por seccion.",
          "Aplica sugerencias IA con revision humana previa.",
          "Guarda cada componente para evitar perdida de cambios.",
        ],
      },
      {
        title: "Metadatos y salida",
        purpose: "Controla estado editorial y preparación de previsualizacion.",
        actions: [
          "Ajusta titulo/estado segun avance real.",
          "Abre previsualizacion solo cuando el contenido este validado.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia de edicion.",
      "Cerrar (X): avisa si hay cambios sin guardar.",
      "Guardar seccion: persiste avances por componente.",
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
        purpose: "Recopila archivos de entrada para analisis del lead.",
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
        purpose: "Confirma lo que se enviará al analisis.",
        actions: [
          "Revisa archivos y texto cargado antes de enviar.",
          "Asegura que no falte evidencia minima.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia contextual.",
      "Cerrar: cancela creacion del lead.",
      "Crear lead: inicia analisis y genera sugerencias relacionadas.",
      "Overlay de proceso: espera a que termine antes de cerrar.",
    ],
  },
  "lead.edit": {
    ariaLabel: "Ayuda sobre el modal de editar lead",
    title: "Ayuda sobre editar lead",
    purpose:
      "Se usa para revisar y ajustar el analisis del lead antes de resolverlo.",
    usage:
      "Valida sinopsis y sugerencias de relacion comercial antes de guardar cambios.",
    sections: [
      {
        title: "Resumen del lead",
        purpose: "Muestra estado actual y contexto temporal del registro.",
        actions: [
          "Revisa estatus del analisis y fecha de creacion.",
          "Usa reanalizar cuando cambie la evidencia disponible.",
        ],
      },
      {
        title: "Sugerencias de vinculacion",
        purpose:
          "Permite confirmar o corregir cuenta, contacto y oportunidad sugeridos.",
        actions: [
          "Valida coincidencias sugeridas contra informacion real.",
          "Crea o vincula registros segun corresponda.",
          "Evita duplicados antes de resolver definitivamente.",
        ],
      },
      {
        title: "Documentos adicionales",
        purpose: "Permite enriquecer el analisis con nueva evidencia.",
        actions: [
          "Adjunta archivos extra si faltaba contexto.",
          "Reanaliza para refrescar sinopsis y recomendaciones.",
        ],
      },
    ],
    modalActions: [
      "Ayuda: abre esta guia para edicion/resolucion.",
      "Reanalizar: actualiza sugerencias segun evidencia vigente.",
      "Guardar/Resolver: aplica cambios y materializa registros relacionados.",
      "Cerrar: sale del modal sin resolver si aun falta revision.",
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
