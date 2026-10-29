// Playbooks semilla. Se publican como "borrador_ia": son un punto de partida general, no contenido validado.
// Los playbooks definitivos se generan o ajustan con la documentación del tema RAG de cada solución.

const commonPhases = (extra = {}) => [
  {
    name: "Planeación y levantamiento",
    activities: [
      "Reunión de arranque y confirmación del alcance",
      "Levantamiento de información técnica con el equipo del cliente",
      "Validación de prerrequisitos y accesos",
    ],
    durationHint: extra.planning || "",
  },
  {
    name: "Diseño",
    activities: [
      "Diseño de la arquitectura de la solución",
      "Revisión y aprobación del diseño con el cliente",
    ],
    durationHint: extra.design || "",
  },
  {
    name: "Implementación",
    activities: extra.implementation || [
      "Instalación y configuración de la solución conforme al diseño",
    ],
    durationHint: extra.implementationDuration || "",
  },
  {
    name: "Pruebas y validación",
    activities: [
      "Ejecución de pruebas funcionales acordadas",
      "Corrección de hallazgos dentro del alcance",
    ],
    durationHint: extra.testing || "",
  },
  {
    name: "Transferencia de conocimiento y cierre",
    activities: [
      "Sesión de transferencia de conocimiento al equipo del cliente",
      "Entrega de documentación y acta de cierre",
    ],
    durationHint: extra.handover || "",
  },
];

const commonAssumptions = [
  "El cliente designará un responsable técnico con capacidad de decisión durante el proyecto.",
  "El cliente proporcionará los accesos, ventanas de mantenimiento y la información necesarios en los tiempos acordados.",
  "Los datos no respondidos en el cuestionario técnico se tratan como supuestos y deberán confirmarse antes del inicio.",
];

const commonClientResponsibilities = [
  "Proveer acceso a los sistemas, redes y personal necesarios para la implementación.",
  "Aprobar los cambios requeridos en su infraestructura dentro de sus procesos internos.",
  "Participar en las pruebas de aceptación y firmar el acta de cierre.",
];

const commonExcluded = [
  "Cambios en infraestructura, aplicaciones o redes del cliente que no estén descritos en el alcance.",
  "Licencias, equipos o servicios de terceros no incluidos en la cotización.",
  "Administración continua de la solución después del cierre, salvo que se contrate un servicio administrado.",
];

const commonAcceptance = [
  "Los componentes cotizados están instalados y operando conforme al diseño aprobado.",
  "Las pruebas funcionales acordadas fueron ejecutadas y sus resultados aceptados por el cliente.",
  "La documentación y la transferencia de conocimiento fueron entregadas.",
];

const commonDeliverables = [
  {
    name: "Documento de diseño",
    description: "Arquitectura y decisiones de diseño de la solución.",
  },
  {
    name: "Documentación de configuración",
    description: "Configuración final implementada y parámetros relevantes.",
  },
  {
    name: "Acta de cierre",
    description: "Constancia de la entrega y aceptación del proyecto.",
  },
];

export const SEED_PLAYBOOKS = [
  {
    code: "f5_dcs",
    name: "F5 Distributed Cloud Services",
    manufacturer: "F5",
    ragTopicName: "F5 Distributed Cloud Services",
    detectionKeywords: [
      "distributed cloud",
      "f5 xc",
      "f5xc",
      "xc waap",
      "bot defense",
      "customer edge",
      "regional edge",
      "ddos",
    ],
    content: {
      summary:
        "Protección y publicación de aplicaciones y APIs con F5 Distributed Cloud Services: WAAP, Bot Defense, DDoS, DNS y conectividad multinube.",
      modules: [
        {
          code: "waap",
          name: "Web App & API Protection (WAAP)",
          description: "WAF y protección de APIs.",
          detectKeywords: ["waap", "waf", "api protection", "api security", "web app"],
        },
        {
          code: "bot_defense",
          name: "Bot Defense",
          description: "Protección contra tráfico automatizado malicioso.",
          detectKeywords: ["bot"],
        },
        {
          code: "ddos",
          name: "DDoS Mitigation",
          description: "Mitigación de ataques de denegación de servicio.",
          detectKeywords: ["ddos"],
        },
        {
          code: "multicloud_connect",
          name: "Multicloud App Connect / Customer Edge",
          description: "Conectividad y publicación entre sitios y nubes.",
          detectKeywords: ["app connect", "network connect", "multicloud", "customer edge"],
        },
        {
          code: "dns",
          name: "DNS",
          description: "Servicios DNS administrados.",
          detectKeywords: ["dns"],
        },
      ],
      questions: [
        { code: "apps_count", module: "general", section: "Aplicaciones", prompt: "¿Cuántas aplicaciones o dominios (FQDN) se protegerán o publicarán?", type: "number", required: true, unit: "apps" },
        { code: "app_locations", module: "general", section: "Aplicaciones", prompt: "¿Dónde se encuentran los orígenes de las aplicaciones?", type: "multi", options: ["Centro de datos propio", "AWS", "Azure", "Google Cloud", "Otra nube", "Kubernetes", "SaaS"], required: true },
        { code: "peak_traffic", module: "general", section: "Tráfico", prompt: "¿Cuál es el tráfico pico estimado (peticiones por segundo o Mbps)?", type: "text", helpText: "Indica la unidad, por ejemplo 2,000 rps o 500 Mbps." },
        { code: "tls_management", module: "general", section: "Aplicaciones", prompt: "¿Quién administrará los certificados TLS?", type: "choice", options: ["El cliente", "F5 Distributed Cloud (automático)", "Mixto"] },
        { code: "dns_control", module: "general", section: "Red", prompt: "¿El cliente puede cambiar o delegar registros DNS para dirigir el tráfico a F5 Distributed Cloud?", type: "boolean", required: true },
        { code: "current_protection", module: "general", section: "Situación actual", prompt: "¿Qué solución de seguridad, CDN o balanceo se usa hoy?", type: "text" },
        { code: "compliance", module: "general", section: "Cumplimiento", prompt: "¿Qué normativas aplican?", type: "multi", options: ["PCI DSS", "ISO 27001", "HIPAA", "Protección de datos personales (LFPDPPP/GDPR)", "Ninguna"] },
        { code: "siem", module: "general", section: "Integraciones", prompt: "¿Hay un SIEM o herramienta de logs con la que integrar?", type: "text" },
        { code: "waap_mode", module: "waap", section: "WAAP", prompt: "¿En qué modo se desplegarán inicialmente las políticas?", type: "choice", options: ["Monitoreo (sin bloqueo)", "Bloqueo desde el inicio"] },
        { code: "api_spec", module: "waap", section: "WAAP", prompt: "¿Hay APIs que proteger y cuentan con especificación OpenAPI/Swagger?", type: "choice", options: ["Sí, con especificación", "Sí, sin especificación", "No hay APIs"] },
        { code: "known_exceptions", module: "waap", section: "WAAP", prompt: "¿Hay excepciones o falsos positivos conocidos de WAF anteriores?", type: "text" },
        { code: "bot_flows", module: "bot_defense", section: "Bot Defense", prompt: "¿Qué flujos críticos se protegerán contra bots?", type: "multi", options: ["Inicio de sesión", "Registro", "Pago / checkout", "Búsqueda", "API móvil", "Otros"], required: true },
        { code: "mobile_apps", module: "bot_defense", section: "Bot Defense", prompt: "¿Se requiere proteger aplicaciones móviles?", type: "boolean" },
        { code: "ddos_layers", module: "ddos", section: "DDoS", prompt: "¿Qué capas se necesita proteger?", type: "choice", options: ["L3/L4", "L7", "Ambas"] },
        { code: "origin_restriction", module: "ddos", section: "DDoS", prompt: "¿Los orígenes pueden restringir su acceso solo a las IP de F5 Distributed Cloud?", type: "boolean" },
        { code: "ce_sites", module: "multicloud_connect", section: "Customer Edge", prompt: "¿En cuántos sitios se desplegará Customer Edge?", type: "number", unit: "sitios" },
        { code: "ce_platform", module: "multicloud_connect", section: "Customer Edge", prompt: "¿En qué plataforma se desplegará Customer Edge?", type: "multi", options: ["VMware", "KVM", "AWS", "Azure", "Google Cloud", "Kubernetes", "Hardware"] },
        { code: "ce_ha", module: "multicloud_connect", section: "Customer Edge", prompt: "¿Se requiere alta disponibilidad en los sitios Customer Edge?", type: "boolean" },
        { code: "dns_zones", module: "dns", section: "DNS", prompt: "¿Cuántas zonas DNS se administrarán?", type: "number", unit: "zonas" },
      ],
      expectations: [
        {
          code: "ce_sites_need_ce",
          when: { question: "ce_sites", op: "gt", value: 0 },
          expectProduct: "customer edge|\\bce\\b",
          message: "El cuestionario indica sitios Customer Edge, pero la cotización no incluye componentes de Customer Edge.",
          severity: "warning",
        },
        {
          code: "bot_flows_need_bot",
          when: { question: "bot_flows", op: "truthy" },
          expectProduct: "bot",
          message: "Se indicaron flujos a proteger contra bots, pero la cotización no incluye Bot Defense.",
          severity: "warning",
        },
        {
          code: "ddos_need_ddos",
          when: { question: "ddos_layers", op: "truthy" },
          expectProduct: "ddos",
          message: "Se indicó necesidad de protección DDoS, pero la cotización no incluye un componente DDoS.",
          severity: "warning",
        },
      ],
      dependencies: [],
      scope: {
        included: [
          "Levantamiento y validación de requerimientos de las aplicaciones a proteger o publicar.",
          "Diseño de la arquitectura en F5 Distributed Cloud Services.",
          "Configuración del tenant, namespaces y roles de acceso en la consola de F5 Distributed Cloud.",
          "Publicación y configuración de los balanceadores de carga HTTP de las aplicaciones definidas.",
          "Configuración de las políticas de seguridad de los módulos cotizados, inicialmente en modo monitoreo cuando aplique.",
          "Pruebas funcionales y de seguridad acordadas.",
          "Afinación de las políticas durante el periodo de monitoreo acordado.",
          "Transferencia de conocimiento al equipo del cliente.",
        ],
        excluded: [
          ...commonExcluded,
          "Desarrollo o modificación de las aplicaciones del cliente.",
          "Pruebas de carga o de penetración, salvo que estén incluidas en la cotización.",
        ],
        assumptions: [
          ...commonAssumptions,
          "El cliente puede modificar o delegar los registros DNS necesarios para dirigir el tráfico a F5 Distributed Cloud.",
          "Los orígenes de las aplicaciones son accesibles desde F5 Distributed Cloud.",
        ],
        clientResponsibilities: commonClientResponsibilities,
        deliverables: commonDeliverables,
        phases: commonPhases({
          implementation: [
            "Configuración del tenant, balanceadores y políticas de seguridad",
            "Cambio de DNS coordinado con el cliente para la puesta en producción",
          ],
        }),
        acceptanceCriteria: [
          ...commonAcceptance,
          "Las aplicaciones definidas se publican a través de F5 Distributed Cloud y las políticas están activas en el modo acordado.",
        ],
        supportNotes: [],
        risks: [
          "Falsos positivos en las políticas de seguridad durante el periodo inicial de monitoreo.",
          "Dependencia de los cambios DNS y de certificados por parte del cliente.",
        ],
      },
      topologyTemplates: [
        {
          code: "waap_basic",
          name: "Protección de aplicaciones con WAAP",
          description: "Tráfico de usuarios protegido en el borde de F5 Distributed Cloud hacia los orígenes.",
          topology: {
            zones: [
              { id: "xc", label: "F5 Distributed Cloud", kind: "cloud" },
              { id: "origin", label: "Orígenes de las aplicaciones", kind: "datacenter" },
            ],
            nodes: [
              { id: "users", label: "Usuarios", kind: "user" },
              { id: "re", label: "Regional Edge", sublabel: "WAAP / Bot / DDoS", kind: "f5_xc_re", zoneId: "xc" },
              { id: "console", label: "F5 Distributed Cloud Console", kind: "f5_xc_console", zoneId: "xc" },
              { id: "apps", label: "Aplicaciones", kind: "app", zoneId: "origin" },
            ],
            edges: [
              { source: "users", target: "re", label: "HTTPS" },
              { source: "re", target: "apps", label: "Tráfico limpio" },
              { source: "console", target: "re", label: "Políticas", style: "dashed" },
            ],
          },
        },
        {
          code: "customer_edge_site",
          name: "Customer Edge en sitio del cliente",
          description: "Sitio del cliente conectado a F5 Distributed Cloud mediante Customer Edge.",
          topology: {
            zones: [
              { id: "xc", label: "F5 Distributed Cloud", kind: "cloud" },
              { id: "site", label: "Sitio del cliente", kind: "site" },
            ],
            nodes: [
              { id: "users", label: "Usuarios", kind: "user" },
              { id: "re", label: "Regional Edge", kind: "f5_xc_re", zoneId: "xc" },
              { id: "ce", label: "Customer Edge", kind: "f5_xc_ce", zoneId: "site" },
              { id: "apps", label: "Aplicaciones", kind: "app", zoneId: "site" },
            ],
            edges: [
              { source: "users", target: "re", label: "HTTPS" },
              { source: "re", target: "ce", label: "Túnel seguro" },
              { source: "ce", target: "apps" },
            ],
          },
        },
      ],
    },
  },
  {
    code: "f5_nginx",
    name: "F5 NGINX",
    manufacturer: "F5",
    ragTopicName: "F5",
    detectionKeywords: ["nginx", "app protect", "ingress controller", "instance manager"],
    content: {
      summary:
        "Balanceo, proxy inverso, API gateway, seguridad y gestión con F5 NGINX en máquinas virtuales, contenedores y Kubernetes.",
      modules: [
        { code: "plus", name: "NGINX Plus", description: "Balanceo de carga, proxy inverso y API gateway.", detectKeywords: ["nginx plus", "plus"] },
        { code: "app_protect", name: "NGINX App Protect", description: "WAF y protección DoS.", detectKeywords: ["app protect"] },
        { code: "ingress", name: "NGINX Ingress Controller", description: "Ingress para Kubernetes.", detectKeywords: ["ingress"] },
        { code: "management", name: "NGINX One / Instance Manager", description: "Gestión centralizada de instancias.", detectKeywords: ["nginx one", "instance manager"] },
      ],
      questions: [
        { code: "instances_count", module: "general", section: "Entorno", prompt: "¿Cuántas instancias de NGINX se desplegarán (actuales y planeadas)?", type: "number", required: true, unit: "instancias" },
        { code: "platforms", module: "general", section: "Entorno", prompt: "¿En qué plataformas se ejecutarán?", type: "multi", options: ["Máquinas virtuales", "Servidores físicos", "Contenedores", "Kubernetes", "Nube pública"], required: true },
        { code: "ha_mode", module: "general", section: "Disponibilidad", prompt: "¿Qué esquema de alta disponibilidad se requiere?", type: "choice", options: ["Activo/Activo", "Activo/Pasivo", "No requerido"], required: true },
        { code: "peak_rps", module: "general", section: "Tráfico", prompt: "¿Cuál es el tráfico pico estimado (peticiones por segundo)?", type: "number", unit: "rps" },
        { code: "current_stack", module: "general", section: "Situación actual", prompt: "¿Qué se usa hoy como proxy o balanceador?", type: "multi", options: ["NGINX Open Source", "HAProxy", "F5 BIG-IP", "Apache", "Otro"] },
        { code: "automation", module: "general", section: "Operación", prompt: "¿Qué herramientas de automatización o CI/CD se usan?", type: "multi", options: ["Ansible", "Terraform", "Jenkins / GitLab CI", "GitHub Actions", "Otra", "Ninguna"] },
        { code: "observability", module: "general", section: "Operación", prompt: "¿Con qué herramienta de observabilidad o monitoreo debe integrarse?", type: "text" },
        { code: "plus_features", module: "plus", section: "NGINX Plus", prompt: "¿Qué funciones de NGINX Plus se necesitan?", type: "multi", options: ["Balanceo de carga L7", "API gateway", "Caché de contenido", "Persistencia de sesión", "Health checks activos", "Autenticación JWT / OIDC", "Límite de tasa"] },
        { code: "migration_from_oss", module: "plus", section: "NGINX Plus", prompt: "¿Se migrará desde NGINX Open Source u otra plataforma?", type: "boolean" },
        { code: "app_protect_modules", module: "app_protect", section: "App Protect", prompt: "¿Qué capacidades de App Protect se necesitan?", type: "multi", options: ["WAF", "Protección DoS"], required: true },
        { code: "waf_policy_source", module: "app_protect", section: "App Protect", prompt: "¿Cómo se definirá la política de seguridad?", type: "choice", options: ["Política base de F5", "Política personalizada", "Migrar desde otro WAF"] },
        { code: "k8s_clusters", module: "ingress", section: "Kubernetes", prompt: "¿Cuántos clústeres de Kubernetes usarán el Ingress Controller?", type: "number", unit: "clústeres", required: true },
        { code: "k8s_distribution", module: "ingress", section: "Kubernetes", prompt: "¿Qué distribución de Kubernetes se usa?", type: "text" },
        { code: "managed_instances", module: "management", section: "Gestión", prompt: "¿Cuántas instancias se gestionarán de forma centralizada?", type: "number", unit: "instancias" },
      ],
      expectations: [
        {
          code: "k8s_needs_ingress",
          when: { question: "k8s_clusters", op: "gt", value: 0 },
          expectProduct: "ingress",
          message: "Se indicaron clústeres de Kubernetes, pero la cotización no incluye NGINX Ingress Controller.",
          severity: "warning",
        },
        {
          code: "waf_needs_app_protect",
          when: { question: "app_protect_modules", op: "truthy" },
          expectProduct: "app protect",
          message: "Se requiere WAF o protección DoS, pero la cotización no incluye NGINX App Protect.",
          severity: "warning",
        },
      ],
      dependencies: [
        {
          code: "app_protect_requires_plus",
          ifProduct: "app protect",
          requireProduct: "nginx plus|plus",
          message: "NGINX App Protect se integra con NGINX Plus. Verifica que la cotización incluya NGINX Plus o que el cliente ya lo tenga.",
          severity: "warning",
        },
      ],
      scope: {
        included: [
          "Levantamiento del entorno y de los requerimientos de las aplicaciones.",
          "Diseño de la arquitectura de NGINX conforme a las capacidades cotizadas.",
          "Instalación y configuración de las instancias de NGINX definidas.",
          "Configuración de balanceo, proxy inverso y funciones acordadas.",
          "Integración con las herramientas de monitoreo y automatización acordadas.",
          "Pruebas funcionales y de desempeño acordadas.",
          "Transferencia de conocimiento al equipo del cliente.",
        ],
        excluded: [
          ...commonExcluded,
          "Modificación del código de las aplicaciones del cliente.",
          "Migración de configuraciones que no estén identificadas en el levantamiento.",
        ],
        assumptions: [...commonAssumptions, "Las plataformas de ejecución están disponibles y cumplen los requisitos del fabricante."],
        clientResponsibilities: commonClientResponsibilities,
        deliverables: commonDeliverables,
        phases: commonPhases({
          implementation: [
            "Instalación y configuración de las instancias de NGINX",
            "Configuración de funciones de balanceo, seguridad e integraciones acordadas",
          ],
        }),
        acceptanceCriteria: [
          ...commonAcceptance,
          "El tráfico de las aplicaciones definidas es atendido por las instancias de NGINX conforme al diseño.",
        ],
        supportNotes: [],
        risks: [
          "Diferencias entre el entorno descrito y el real que requieran ajustar el diseño.",
          "Dependencia de ventanas de cambio del cliente para pasar a producción.",
        ],
      },
      topologyTemplates: [
        {
          code: "nginx_ha",
          name: "NGINX Plus en alta disponibilidad",
          description: "Par de instancias NGINX balanceando hacia los servicios de aplicación.",
          topology: {
            zones: [
              { id: "dmz", label: "DMZ", kind: "dmz" },
              { id: "apps", label: "Servicios de aplicación", kind: "datacenter" },
            ],
            nodes: [
              { id: "users", label: "Usuarios", kind: "user" },
              { id: "n1", label: "NGINX Plus 1", kind: "nginx", zoneId: "dmz" },
              { id: "n2", label: "NGINX Plus 2", kind: "nginx", zoneId: "dmz" },
              { id: "svc", label: "Servicios backend", kind: "app", zoneId: "apps" },
            ],
            edges: [
              { source: "users", target: "n1", label: "HTTPS" },
              { source: "users", target: "n2", label: "HTTPS", style: "dashed" },
              { source: "n1", target: "svc" },
              { source: "n2", target: "svc" },
            ],
          },
        },
        {
          code: "nginx_ingress",
          name: "NGINX Ingress Controller en Kubernetes",
          description: "Ingress de NGINX publicando servicios del clúster.",
          topology: {
            zones: [{ id: "k8s", label: "Clúster de Kubernetes", kind: "datacenter" }],
            nodes: [
              { id: "users", label: "Usuarios", kind: "user" },
              { id: "ing", label: "NGINX Ingress Controller", kind: "nginx_ingress", zoneId: "k8s" },
              { id: "svc", label: "Servicios y pods", kind: "k8s", zoneId: "k8s" },
            ],
            edges: [
              { source: "users", target: "ing", label: "HTTPS" },
              { source: "ing", target: "svc" },
            ],
          },
        },
      ],
    },
  },
  {
    code: "bluecat_micetro",
    name: "BlueCat Micetro",
    manufacturer: "BlueCat",
    ragTopicName: "BlueCat",
    detectionKeywords: ["micetro"],
    content: {
      summary:
        "Gestión centralizada de DNS, DHCP e IPAM sobre servidores y nubes existentes con BlueCat Micetro.",
      modules: [{ code: "micetro", name: "Micetro", description: "Gestión DDI centralizada.", detectKeywords: ["micetro"] }],
      questions: [
        { code: "dns_platforms", module: "general", section: "Entorno DNS/DHCP", prompt: "¿Qué plataformas DNS se gestionarán?", type: "multi", options: ["Microsoft DNS", "BIND", "AWS Route 53", "Azure DNS", "BlueCat DNS/DHCP Server", "Otra"], required: true },
        { code: "dhcp_platforms", module: "general", section: "Entorno DNS/DHCP", prompt: "¿Qué plataformas DHCP se gestionarán?", type: "multi", options: ["Microsoft DHCP", "ISC DHCP / Kea", "Otra", "Ninguna"] },
        { code: "servers_count", module: "general", section: "Entorno DNS/DHCP", prompt: "¿Cuántos servidores DNS/DHCP se integrarán?", type: "number", required: true, unit: "servidores" },
        { code: "zones_count", module: "general", section: "Volumen", prompt: "¿Cuántas zonas DNS existen?", type: "number", unit: "zonas" },
        { code: "subnets_count", module: "general", section: "Volumen", prompt: "¿Cuántas subredes o rangos IP se administrarán (IPAM)?", type: "number", unit: "subredes" },
        { code: "sites_count", module: "general", section: "Entorno DNS/DHCP", prompt: "¿Cuántos sitios o ubicaciones hay?", type: "number", unit: "sitios" },
        { code: "cloud_integrations", module: "general", section: "Integraciones", prompt: "¿Con qué nubes debe integrarse?", type: "multi", options: ["AWS", "Azure", "Google Cloud", "Ninguna"] },
        { code: "auth_method", module: "general", section: "Seguridad", prompt: "¿Cómo se autenticarán los usuarios?", type: "choice", options: ["Active Directory / LDAP", "SAML / SSO", "Usuarios locales"] },
        { code: "rbac_users", module: "general", section: "Seguridad", prompt: "¿Cuántos usuarios o roles administrarán la plataforma?", type: "number", unit: "usuarios" },
        { code: "automation_api", module: "general", section: "Integraciones", prompt: "¿Se requiere integración por API con herramientas de automatización o ITSM? ¿Cuáles?", type: "text" },
        { code: "current_ipam", module: "general", section: "Situación actual", prompt: "¿Cómo se gestiona hoy el IPAM?", type: "choice", options: ["Hojas de cálculo", "Otra herramienta IPAM", "Manual en los servidores", "Otro"] },
        { code: "data_import", module: "general", section: "Migración", prompt: "¿Se requiere importar datos de IPAM existentes? ¿En qué volumen?", type: "text" },
      ],
      expectations: [],
      dependencies: [],
      scope: {
        included: [
          "Levantamiento de los servidores DNS/DHCP y de la estructura IPAM actuales.",
          "Diseño de la implementación de Micetro conforme al entorno.",
          "Instalación y configuración de Micetro.",
          "Integración de los servidores y las nubes definidas.",
          "Configuración de autenticación, roles y permisos.",
          "Importación inicial de datos IPAM conforme al alcance acordado.",
          "Pruebas funcionales y transferencia de conocimiento.",
        ],
        excluded: [
          ...commonExcluded,
          "Rediseño de la estructura DNS o del direccionamiento IP del cliente.",
          "Limpieza o depuración de datos más allá de la importación acordada.",
        ],
        assumptions: [...commonAssumptions, "Los servidores DNS/DHCP a integrar son alcanzables desde la plataforma Micetro y cuentan con credenciales de integración."],
        clientResponsibilities: commonClientResponsibilities,
        deliverables: commonDeliverables,
        phases: commonPhases({
          implementation: [
            "Instalación de Micetro y configuración de autenticación y roles",
            "Integración de servidores y nubes; importación inicial de datos",
          ],
        }),
        acceptanceCriteria: [
          ...commonAcceptance,
          "Los servidores y nubes definidos son visibles y gestionables desde Micetro.",
        ],
        supportNotes: [],
        risks: [
          "Calidad de los datos IPAM de origen que afecte la importación.",
          "Permisos o conectividad insuficientes hacia los servidores a integrar.",
        ],
      },
      topologyTemplates: [
        {
          code: "micetro_central",
          name: "Micetro gestionando DNS/DHCP y nubes",
          description: "Plataforma central de gestión sobre servidores existentes, directorio y nubes.",
          topology: {
            zones: [
              { id: "dc", label: "Centro de datos", kind: "datacenter" },
              { id: "cloud", label: "Nubes públicas", kind: "cloud" },
            ],
            nodes: [
              { id: "admins", label: "Administradores", kind: "user" },
              { id: "micetro", label: "BlueCat Micetro", kind: "bluecat_micetro", zoneId: "dc" },
              { id: "ad", label: "Active Directory", kind: "directory", zoneId: "dc" },
              { id: "dns", label: "Servidores DNS/DHCP", kind: "dns_server", zoneId: "dc" },
              { id: "cloud", label: "DNS en la nube", kind: "cloud", zoneId: "cloud" },
            ],
            edges: [
              { source: "admins", target: "micetro", label: "Consola web" },
              { source: "micetro", target: "ad", label: "Autenticación", style: "dashed" },
              { source: "micetro", target: "dns", label: "Gestión" },
              { source: "micetro", target: "cloud", label: "API" },
            ],
          },
        },
      ],
    },
  },
  {
    code: "bluecat_edge",
    name: "BlueCat Edge",
    manufacturer: "BlueCat",
    ragTopicName: "BlueCat",
    detectionKeywords: ["bluecat edge", "service point", "edge cloud", "dns edge"],
    content: {
      summary:
        "Seguridad DNS y resolución recursiva con BlueCat Edge: Service Points, políticas de amenazas y visibilidad.",
      modules: [{ code: "edge", name: "Edge", description: "Seguridad y resolución DNS.", detectKeywords: ["edge", "service point"] }],
      questions: [
        { code: "users_count", module: "general", section: "Alcance", prompt: "¿Cuántos usuarios o dispositivos se protegerán?", type: "number", required: true, unit: "usuarios" },
        { code: "sites_count", module: "general", section: "Alcance", prompt: "¿Cuántos sitios o ubicaciones hay?", type: "number", required: true, unit: "sitios" },
        { code: "current_resolvers", module: "general", section: "Situación actual", prompt: "¿Qué resolvedores DNS se usan hoy (servidores internos, ISP, otros)?", type: "text" },
        { code: "split_dns", module: "general", section: "Red", prompt: "¿Hay dominios internos que deban resolverse localmente (split DNS)?", type: "boolean" },
        { code: "sp_form", module: "general", section: "Despliegue", prompt: "¿Dónde se desplegarán los Service Points?", type: "multi", options: ["VMware", "KVM", "Hyper-V", "Contenedor", "Appliance", "Nube pública"] },
        { code: "sp_count", module: "general", section: "Despliegue", prompt: "¿Cuántos Service Points se desplegarán?", type: "number", unit: "Service Points" },
        { code: "sp_ha", module: "general", section: "Despliegue", prompt: "¿Se requiere alta disponibilidad de los Service Points?", type: "boolean" },
        { code: "policies", module: "general", section: "Políticas", prompt: "¿Qué políticas se necesitan?", type: "multi", options: ["Bloqueo de dominios maliciosos", "Filtrado por categorías", "Listas personalizadas", "Detección de túneles DNS / DGA", "DoH / DoT"] },
        { code: "ddi_integration", module: "general", section: "Integraciones", prompt: "¿Con qué DDI debe integrarse?", type: "choice", options: ["BlueCat Address Manager", "BlueCat Micetro", "Otro", "Ninguno"] },
        { code: "remote_users", module: "general", section: "Alcance", prompt: "¿Se debe proteger a usuarios remotos?", type: "boolean" },
        { code: "siem", module: "general", section: "Integraciones", prompt: "¿Hay un SIEM u otra herramienta a la que enviar los eventos?", type: "text" },
      ],
      expectations: [
        {
          code: "sp_count_needs_service_point",
          when: { question: "sp_count", op: "gt", value: 0 },
          expectProduct: "service point|edge",
          message: "Se indicaron Service Points a desplegar, pero la cotización no incluye componentes de BlueCat Edge.",
          severity: "warning",
        },
      ],
      dependencies: [],
      scope: {
        included: [
          "Levantamiento del entorno DNS y de los requerimientos de seguridad.",
          "Diseño de la arquitectura de BlueCat Edge.",
          "Despliegue y configuración de los Service Points definidos.",
          "Configuración de políticas de seguridad DNS acordadas.",
          "Redirección de los clientes hacia los Service Points conforme al diseño.",
          "Pruebas funcionales y transferencia de conocimiento.",
        ],
        excluded: [
          ...commonExcluded,
          "Cambios en la configuración de los clientes o dispositivos finales fuera de lo acordado.",
        ],
        assumptions: [...commonAssumptions, "Los clientes pueden dirigir sus consultas DNS a los Service Points."],
        clientResponsibilities: commonClientResponsibilities,
        deliverables: commonDeliverables,
        phases: commonPhases({
          implementation: [
            "Despliegue de Service Points",
            "Configuración de políticas y redirección gradual de consultas DNS",
          ],
        }),
        acceptanceCriteria: [
          ...commonAcceptance,
          "Los clientes definidos resuelven a través de los Service Points y las políticas acordadas están activas.",
        ],
        supportNotes: [],
        risks: [
          "Impacto en la resolución de dominios internos si no se contemplan correctamente en el diseño.",
          "Dependencia de cambios de configuración DNS/DHCP del cliente para redirigir las consultas.",
        ],
      },
      topologyTemplates: [
        {
          code: "edge_basic",
          name: "BlueCat Edge con Service Points",
          description: "Clientes resolviendo mediante Service Points con políticas administradas en la nube.",
          topology: {
            zones: [
              { id: "site", label: "Sitio del cliente", kind: "site" },
              { id: "cloud", label: "BlueCat Edge Cloud", kind: "cloud" },
            ],
            nodes: [
              { id: "clients", label: "Usuarios y dispositivos", kind: "user", zoneId: "site" },
              { id: "sp", label: "Service Point", kind: "bluecat_edge", zoneId: "site" },
              { id: "edge", label: "Edge Cloud", sublabel: "Políticas y reportes", kind: "bluecat_edge_cloud", zoneId: "cloud" },
              { id: "internet", label: "Internet", kind: "internet" },
            ],
            edges: [
              { source: "clients", target: "sp", label: "Consultas DNS" },
              { source: "sp", target: "edge", label: "Políticas y telemetría", style: "dashed" },
              { source: "sp", target: "internet", label: "Resolución" },
            ],
          },
        },
      ],
    },
  },
  {
    code: "bluecat_integrity",
    name: "BlueCat Integrity",
    manufacturer: "BlueCat",
    ragTopicName: "BlueCat",
    detectionKeywords: ["integrity", "address manager", "bdds", "dns/dhcp server", "dnssec"],
    content: {
      summary:
        "Plataforma DDI de BlueCat (Address Manager y servidores DNS/DHCP) para servicios de red críticos.",
      modules: [{ code: "integrity", name: "Integrity (DDI)", description: "Address Manager y servidores DNS/DHCP.", detectKeywords: ["integrity", "address manager", "bdds"] }],
      questions: [
        { code: "sites_count", module: "general", section: "Entorno", prompt: "¿Cuántos sitios tendrán servidores DNS/DHCP?", type: "number", required: true, unit: "sitios" },
        { code: "platform_form", module: "general", section: "Entorno", prompt: "¿En qué formato se desplegarán los componentes?", type: "multi", options: ["Appliance virtual", "Appliance físico", "Nube pública"], required: true },
        { code: "dns_qps_peak", module: "general", section: "Dimensionamiento", prompt: "¿Cuál es el pico de consultas DNS por segundo?", type: "number", unit: "qps" },
        { code: "dhcp_leases", module: "general", section: "Dimensionamiento", prompt: "¿Cuántas concesiones DHCP activas hay?", type: "number", unit: "leases" },
        { code: "zones_count", module: "general", section: "Dimensionamiento", prompt: "¿Cuántas zonas DNS existen?", type: "number", unit: "zonas" },
        { code: "records_count", module: "general", section: "Dimensionamiento", prompt: "¿Cuántos registros DNS existen aproximadamente?", type: "number", unit: "registros" },
        { code: "ha_dr", module: "general", section: "Disponibilidad", prompt: "¿Qué esquema de alta disponibilidad y recuperación se requiere?", type: "choice", options: ["Alta disponibilidad por sitio", "Recuperación entre sitios", "Ambos", "No requerido"], required: true },
        { code: "dnssec", module: "general", section: "Seguridad", prompt: "¿Se requiere DNSSEC?", type: "boolean" },
        { code: "anycast", module: "general", section: "Red", prompt: "¿Se requiere anycast?", type: "boolean" },
        { code: "migration_source", module: "general", section: "Migración", prompt: "¿Desde qué plataforma se migrará (Microsoft, BIND, Infoblox, otra)?", type: "text" },
        { code: "integrations", module: "general", section: "Integraciones", prompt: "¿Con qué sistemas debe integrarse?", type: "multi", options: ["Active Directory", "ITSM", "Nube pública", "SIEM", "API de automatización", "Ninguno"] },
        { code: "current_version", module: "general", section: "Situación actual", prompt: "Si existe una plataforma BlueCat, ¿qué versión es?", type: "text" },
      ],
      expectations: [],
      dependencies: [],
      scope: {
        included: [
          "Levantamiento del entorno DNS/DHCP/IPAM actual y de los requerimientos de disponibilidad.",
          "Diseño de la arquitectura de Address Manager y servidores DNS/DHCP.",
          "Instalación y configuración de los componentes definidos.",
          "Configuración de zonas, ámbitos y políticas acordadas.",
          "Migración de datos conforme al alcance acordado.",
          "Integraciones acordadas.",
          "Pruebas funcionales, plan de corte y transferencia de conocimiento.",
        ],
        excluded: [
          ...commonExcluded,
          "Rediseño del direccionamiento IP o de la estructura DNS fuera de lo acordado.",
        ],
        assumptions: [...commonAssumptions, "Los datos de origen están disponibles y completos para su migración."],
        clientResponsibilities: commonClientResponsibilities,
        deliverables: commonDeliverables,
        phases: commonPhases({
          implementation: [
            "Instalación de Address Manager y servidores DNS/DHCP",
            "Migración de datos y pruebas previas al corte",
            "Corte coordinado en ventana de mantenimiento",
          ],
        }),
        acceptanceCriteria: [
          ...commonAcceptance,
          "Los servicios DNS/DHCP definidos son atendidos por la plataforma conforme al diseño.",
        ],
        supportNotes: [],
        risks: [
          "Calidad e integridad de los datos de origen durante la migración.",
          "Ventana de corte limitada para cambiar los servicios en producción.",
        ],
      },
      topologyTemplates: [
        {
          code: "integrity_ha",
          name: "Integrity con alta disponibilidad",
          description: "Address Manager gestionando servidores DNS/DHCP en sitios con redundancia.",
          topology: {
            zones: [
              { id: "dc1", label: "Sitio principal", kind: "datacenter" },
              { id: "dc2", label: "Sitio secundario", kind: "datacenter" },
            ],
            nodes: [
              { id: "clients", label: "Clientes y servidores", kind: "user" },
              { id: "am1", label: "Address Manager", kind: "bluecat_address_manager", zoneId: "dc1" },
              { id: "bdds1", label: "DNS/DHCP Server", kind: "bluecat_bdds", zoneId: "dc1" },
              { id: "am2", label: "Address Manager (secundario)", kind: "bluecat_address_manager", zoneId: "dc2" },
              { id: "bdds2", label: "DNS/DHCP Server", kind: "bluecat_bdds", zoneId: "dc2" },
            ],
            edges: [
              { source: "clients", target: "bdds1", label: "DNS / DHCP" },
              { source: "clients", target: "bdds2", label: "DNS / DHCP", style: "dashed" },
              { source: "am1", target: "bdds1", label: "Gestión" },
              { source: "am1", target: "am2", label: "Replicación", style: "dashed" },
              { source: "am2", target: "bdds2", label: "Gestión" },
            ],
          },
        },
      ],
    },
  },
  {
    code: "bluecat_observability",
    name: "BlueCat Observabilidad",
    manufacturer: "BlueCat",
    ragTopicName: "BlueCat",
    detectionKeywords: ["livenx", "livewire", "liveassist", "live assist", "observabilidad"],
    content: {
      summary:
        "Observabilidad de red con BlueCat: LiveNX (flujos y rendimiento), LiveWire (captura y análisis de paquetes) y LiveAssist (inteligencia de red con IA para LiveNX).",
      modules: [
        { code: "livenx", name: "LiveNX", description: "Monitoreo de red y rendimiento de aplicaciones.", detectKeywords: ["livenx"] },
        { code: "livewire", name: "LiveWire", description: "Captura y análisis de paquetes.", detectKeywords: ["livewire"] },
        { code: "liveassist", name: "LiveAssist", description: "Complemento de IA para LiveNX que correlaciona telemetría, alertas y configuración.", detectKeywords: ["liveassist", "live assist"] },
      ],
      questions: [
        { code: "sites_count", module: "general", section: "Alcance", prompt: "¿Cuántos sitios se monitorearán?", type: "number", unit: "sitios" },
        { code: "ops_team_size", module: "general", section: "Alcance", prompt: "¿Cuántos ingenieros de operaciones de red usarán la plataforma?", type: "number", unit: "personas" },
        { code: "devices_count", module: "livenx", section: "LiveNX", prompt: "¿Cuántos dispositivos de red se monitorearán (routers, switches, firewalls, otros)?", type: "number", required: true, unit: "dispositivos" },
        { code: "flow_sources", module: "livenx", section: "LiveNX", prompt: "¿Qué fuentes de telemetría están disponibles?", type: "multi", options: ["NetFlow", "IPFIX", "sFlow", "SNMP", "Otras"], required: true },
        { code: "wan_types", module: "livenx", section: "LiveNX", prompt: "¿Qué tipos de enlace WAN existen?", type: "multi", options: ["MPLS", "SD-WAN", "Internet", "Nube"] },
        { code: "flows_per_second", module: "livenx", section: "LiveNX", prompt: "¿Cuántos flujos por segundo se estiman?", type: "number", unit: "fps", helpText: "Dato clave de dimensionamiento. Si no se conoce, indica un estimado." },
        { code: "flow_retention_days", module: "livenx", section: "LiveNX", prompt: "¿Cuántos días de retención de datos se requieren?", type: "number", unit: "días" },
        { code: "livenx_deployment", module: "livenx", section: "LiveNX", prompt: "¿Cómo se desplegará LiveNX?", type: "choice", options: ["Servidor virtual", "Appliance", "Nube"] },
        { code: "capture_points", module: "livewire", section: "LiveWire", prompt: "¿En cuántos puntos se capturará tráfico?", type: "number", required: true, unit: "puntos" },
        { code: "link_speeds", module: "livewire", section: "LiveWire", prompt: "¿Qué velocidades de enlace se capturarán?", type: "multi", options: ["1G", "10G", "25G", "40G", "100G"], required: true },
        { code: "capture_method", module: "livewire", section: "LiveWire", prompt: "¿Cómo se obtendrá el tráfico?", type: "multi", options: ["TAP", "SPAN / espejo de puerto", "TAP virtual"] },
        { code: "packet_retention", module: "livewire", section: "LiveWire", prompt: "¿Cuánto tiempo de captura se debe conservar?", type: "text", helpText: "Por ejemplo: 24 horas a 10 Gbps." },
        { code: "livewire_use_cases", module: "livewire", section: "LiveWire", prompt: "¿Cuáles son los casos de uso principales?", type: "multi", options: ["Rendimiento de aplicaciones", "Seguridad y forense", "VoIP y video", "Cumplimiento"] },
        { code: "livenx_installed", module: "liveassist", section: "LiveAssist", prompt: "¿El cliente ya tiene LiveNX instalado?", type: "choice", options: ["Sí, ya instalado", "No, se cotiza junto con LiveAssist", "No"], required: true },
        { code: "livenx_version", module: "liveassist", section: "LiveAssist", prompt: "Si ya existe LiveNX, ¿qué versión es?", type: "text" },
        { code: "assist_data_sources", module: "liveassist", section: "LiveAssist", prompt: "¿Qué fuentes de datos debe correlacionar?", type: "multi", options: ["Telemetría de LiveNX", "Alertas", "Configuraciones de dispositivos", "BlueCat DDI (Address Manager / Micetro)", "Otras"] },
        { code: "data_residency", module: "liveassist", section: "LiveAssist", prompt: "¿Hay restricciones de residencia de datos o de uso de IA en la nube?", type: "choice", options: ["Sin restricciones", "Restricciones de nube", "Solo local"] },
        { code: "mcp_integration", module: "liveassist", section: "LiveAssist", prompt: "¿Se requiere integrar con otras herramientas mediante servidores MCP?", type: "boolean" },
      ],
      expectations: [
        {
          code: "capture_points_need_livewire",
          when: { question: "capture_points", op: "gt", value: 0 },
          expectProduct: "livewire",
          message: "Se indicaron puntos de captura de paquetes, pero la cotización no incluye LiveWire.",
          severity: "warning",
        },
        {
          code: "devices_need_livenx",
          when: { question: "devices_count", op: "gt", value: 0 },
          expectProduct: "livenx",
          message: "Se indicaron dispositivos a monitorear, pero la cotización no incluye LiveNX.",
          severity: "warning",
        },
      ],
      dependencies: [
        {
          code: "liveassist_requires_livenx",
          ifProduct: "liveassist|live assist",
          requireProduct: "livenx",
          unless: { question: "livenx_installed", op: "eq", value: "Sí, ya instalado" },
          message: "LiveAssist es un complemento de LiveNX: la cotización debe incluir LiveNX o el cliente debe tenerlo instalado.",
          severity: "blocking",
        },
      ],
      scope: {
        included: [
          "Levantamiento del entorno de red y de los requerimientos de observabilidad.",
          "Diseño de la arquitectura de los componentes cotizados.",
          "Instalación y configuración de los componentes de BlueCat Observabilidad cotizados.",
          "Incorporación de los dispositivos y fuentes de telemetría definidos.",
          "Configuración de tableros, alertas y reportes acordados.",
          "Pruebas funcionales y transferencia de conocimiento.",
        ],
        excluded: [
          ...commonExcluded,
          "Configuración de la exportación de flujos en dispositivos que no estén dentro del alcance acordado.",
          "Instalación de TAPs o cambios de cableado físico, salvo que estén incluidos en la cotización.",
        ],
        assumptions: [...commonAssumptions, "Los dispositivos pueden exportar la telemetría necesaria hacia la plataforma."],
        clientResponsibilities: [
          ...commonClientResponsibilities,
          "Habilitar la exportación de flujos y el acceso SNMP en los dispositivos incluidos en el alcance.",
        ],
        deliverables: commonDeliverables,
        phases: commonPhases({
          implementation: [
            "Instalación de los componentes cotizados",
            "Incorporación de dispositivos y fuentes de telemetría",
            "Configuración de tableros, alertas y reportes",
          ],
        }),
        acceptanceCriteria: [
          ...commonAcceptance,
          "Los dispositivos y fuentes definidos reportan a la plataforma y los tableros acordados están disponibles.",
        ],
        supportNotes: [],
        risks: [
          "Dimensionamiento sujeto a la cantidad real de flujos y a la retención requerida.",
          "Disponibilidad y calidad de la telemetría que exporten los dispositivos del cliente.",
        ],
      },
      topologyTemplates: [
        {
          code: "observability_basic",
          name: "LiveNX, LiveWire y LiveAssist",
          description: "Telemetría de red y captura de paquetes consolidadas en LiveNX, con LiveAssist como capa de análisis.",
          topology: {
            zones: [
              { id: "net", label: "Red del cliente", kind: "site" },
              { id: "obs", label: "Plataforma de observabilidad", kind: "datacenter" },
            ],
            nodes: [
              { id: "devices", label: "Routers, switches y firewalls", kind: "network_device", zoneId: "net" },
              { id: "tap", label: "TAP / SPAN", kind: "tap", zoneId: "net" },
              { id: "livenx", label: "LiveNX", kind: "livenx", zoneId: "obs" },
              { id: "livewire", label: "LiveWire", kind: "livewire", zoneId: "obs" },
              { id: "liveassist", label: "LiveAssist", kind: "liveassist", zoneId: "obs" },
              { id: "ops", label: "Equipo de operaciones", kind: "user" },
            ],
            edges: [
              { source: "devices", target: "livenx", label: "NetFlow / IPFIX / SNMP" },
              { source: "tap", target: "livewire", label: "Tráfico espejo" },
              { source: "livewire", target: "livenx", label: "Datos de paquetes", style: "dashed" },
              { source: "livenx", target: "liveassist", label: "Telemetría y alertas" },
              { source: "ops", target: "liveassist", label: "Consultas" },
            ],
          },
        },
      ],
    },
  },
];
