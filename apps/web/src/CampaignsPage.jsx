import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./campaigns-page.css";

const EMPTY_FORM = {
  name: "",
  description: "",
  tipo_campana: "reconocimiento",
  subtipo_campana: "correo_masivo",
  estado_campana: "borrador",
  etapa_ciclo_vida: "",
  audience_lifecycle_filters: [],
  starts_at: "",
  ends_at: "",
};

const EMPTY_ACCOUNT_FORM = {
  account_id: "",
  estado_interaccion: "no_enviado",
  last_interaction_at: "",
};

const CHATBOT_JOB_POLL_INTERVAL_MS = 1200;
const CHATBOT_JOB_TIMEOUT_MS = 90_000;

const CAMPAIGN_TYPE_DESCRIPTIONS = {
  reconocimiento:
    "Aumenta visibilidad y recordacion de marca en audiencias nuevas.",
  captacion_de_leads:
    "Genera registros de prospectos interesados para el equipo comercial.",
  nutricion: "Educa y acompana leads para elevar su madurez de compra.",
  conversion: "Impulsa acciones de cierre como demo, cotizacion o compra.",
  fidelizacion:
    "Fortalece relacion con clientes actuales para mejorar permanencia.",
  reactivacion:
    "Recupera contactos o clientes inactivos con nuevas propuestas.",
  promocion: "Comunica ofertas puntuales para acelerar respuesta comercial.",
  lanzamiento_de_producto:
    "Presenta una nueva solucion al mercado para lograr adopcion inicial.",
  upsell: "Promueve una version superior o mayor volumen en clientes activos.",
  cross_sell:
    "Ofrece productos o servicios complementarios a clientes actuales.",
  evento: "Convoca audiencia alrededor de un evento presencial o virtual.",
  referidos:
    "Incentiva recomendaciones de clientes o aliados para captar nuevos leads.",
  educacion:
    "Entrega contenido formativo para posicionar expertise y confianza.",
};

const CAMPAIGN_SUBTYPE_DESCRIPTIONS = {
  correo_masivo:
    "Envio puntual a una base amplia para comunicar anuncios o contenidos.",
  correo_automatizado:
    "Secuencias de email por disparadores o etapas del embudo.",
  redes_sociales_organicas:
    "Publicaciones sin pauta para construir comunidad y alcance natural.",
  redes_sociales_pagadas:
    "Campanas de pauta en redes para segmentar y escalar resultados.",
  anuncios_busqueda:
    "Anuncios en buscadores orientados a intencion activa de demanda.",
  anuncios_display: "Banners y formatos graficos para awareness y remarketing.",
  webinar: "Sesion online en vivo para educar, captar y calificar interes.",
  landing_page:
    "Pagina de conversion enfocada en registro, descarga o contacto.",
  sms: "Mensajes de texto de alta apertura para recordatorios o avisos.",
  whatsapp: "Mensajeria directa para seguimiento comercial y conversacion 1:1.",
  evento_presencial:
    "Actividad fisica para relacionamiento, networking y demostracion.",
  evento_virtual: "Evento online para alcance remoto y participacion digital.",
  encuesta: "Levantamiento de feedback para segmentar, aprender y priorizar.",
  programa_de_referidos:
    "Mecanica de referidos con incentivos para atraer nuevos prospectos.",
};

const CAMPAIGN_TYPE_USAGE_GUIDE = {
  reconocimiento: {
    useWhen:
      "la cuenta apenas muestra interes inicial y aun no pide propuesta formal",
    desiredAction: "obtener una primera senal medible de interes",
    simpleExamples: [
      "hubo interaccion ligera con contenido, pero sin solicitud comercial",
      "la audiencia conoce el tema, pero no deja datos completos",
    ],
  },
  captacion_de_leads: {
    useWhen:
      "ya hay interes y falta convertirlo en contacto identificado dentro del CRM",
    desiredAction: "cerrar registro o formulario con datos utiles para venta",
    simpleExamples: [
      "el prospecto llego a la pagina, pero no termino el registro",
      "inicio un formulario y abandono antes de enviar",
    ],
  },
  nutricion: {
    useWhen:
      "el lead ya esta captado y necesita contenido para avanzar sin presion de cierre inmediato",
    desiredAction:
      "subir madurez y preparar una conversacion comercial de mejor calidad",
    simpleExamples: [
      "respondio al primer correo y pide mas contexto",
      "muestra interes, pero aun no esta listo para demo o cotizacion",
    ],
  },
  conversion: {
    useWhen:
      "la cuenta esta comparando opciones y puede tomar decision en el corto plazo",
    desiredAction: "lograr accion de cierre: demo, propuesta o aprobacion",
    simpleExamples: [
      "pidio precios o condiciones comerciales",
      "ya reviso opciones y solicita siguiente paso concreto",
    ],
  },
  fidelizacion: {
    useWhen:
      "el contacto ya es cliente y quieres sostener uso, valor y relacion",
    desiredAction: "aumentar permanencia y evitar desercion",
    simpleExamples: [
      "cliente activo con baja frecuencia de uso",
      "cliente que necesita apoyo para adoptar mejor la solucion",
    ],
  },
  reactivacion: {
    useWhen:
      "la relacion lleva tiempo sin actividad y aun existe potencial comercial",
    desiredAction: "recuperar respuesta con una propuesta simple y concreta",
    simpleExamples: [
      "no abre ni responde desde hace varios ciclos",
      "cliente inactivo que antes mostraba buena afinidad",
    ],
  },
  promocion: {
    useWhen: "hay una oferta puntual con vigencia y necesitas respuesta rapida",
    desiredAction: "generar accion inmediata antes del cierre de la oferta",
    simpleExamples: [
      "descuento activo por tiempo limitado",
      "campana estacional con fecha final definida",
    ],
  },
  lanzamiento_de_producto: {
    useWhen:
      "estas introduciendo una solucion nueva y el mercado aun no entiende su valor",
    desiredAction: "activar interes temprano y primeras pruebas",
    simpleExamples: [
      "presentacion inicial de una nueva linea",
      "mensaje de novedad para audiencias con alta afinidad",
    ],
  },
  upsell: {
    useWhen:
      "el cliente ya usa la solucion y puede crecer a mayor alcance o plan",
    desiredAction: "ampliar ticket y valor de cuenta",
    simpleExamples: [
      "cliente cerca del limite de su plan actual",
      "cuenta estable lista para version superior",
    ],
  },
  cross_sell: {
    useWhen:
      "el cliente ya compra una solucion y hay una necesidad complementaria detectada",
    desiredAction: "sumar una solucion adicional relevante",
    simpleExamples: [
      "cliente con necesidad adyacente al servicio actual",
      "cuenta con problema que otra linea del portafolio resuelve",
    ],
  },
  evento: {
    useWhen:
      "la prioridad es registrar, confirmar y lograr asistencia en una fecha puntual",
    desiredAction: "maximizar asistencia efectiva",
    simpleExamples: [
      "convocatoria a sesion con cupo limitado",
      "recordatorios de acceso antes de iniciar evento",
    ],
  },
  referidos: {
    useWhen:
      "tienes clientes o aliados satisfechos que pueden recomendar nuevos prospectos",
    desiredAction: "activar referidos con proceso claro",
    simpleExamples: [
      "clientes promotores dispuestos a recomendar",
      "aliados con red de contactos compatibles",
    ],
  },
  educacion: {
    useWhen:
      "la audiencia necesita aprender antes de tomar una decision con seguridad",
    desiredAction: "reducir dudas y aumentar confianza tecnica/comercial",
    simpleExamples: [
      "prospectos con preguntas funcionales repetidas",
      "audiencia que requiere guia paso a paso",
    ],
  },
};

const CAMPAIGN_SUBTYPE_USAGE_GUIDE = {
  correo_masivo: {
    channelRole: "difusion amplia con mensaje unico",
    chooseWhen:
      "quieres comunicar rapidamente a una base segmentada con un solo CTA",
    simpleExamples: [
      "anuncio general para toda la base objetivo",
      "comunicado con accion unica y directa",
    ],
  },
  correo_automatizado: {
    channelRole: "secuencia por etapas",
    chooseWhen:
      "necesitas acompanar al contacto con varios toques segun comportamiento",
    simpleExamples: [
      "serie de bienvenida en 3 pasos",
      "flujo automatico segun apertura o clic",
    ],
  },
  redes_sociales_organicas: {
    channelRole: "seguimiento de interes organico",
    chooseWhen: "el origen del interes viene de publicaciones sin pauta",
    simpleExamples: [
      "interaccion organica con post o historia",
      "clic organico desde red social hacia conversion",
    ],
  },
  redes_sociales_pagadas: {
    channelRole: "continuidad de leads de pauta",
    chooseWhen:
      "el lead proviene de anuncios pagados y necesita siguiente paso rapido",
    simpleExamples: [
      "lead de anuncio con formulario enviado",
      "trafico de pauta con interes inicial confirmado",
    ],
  },
  anuncios_busqueda: {
    channelRole: "respuesta a intencion activa",
    chooseWhen: "el prospecto busca solucion activamente en buscadores",
    simpleExamples: [
      "busquedas con palabras de compra o cotizacion",
      "clic en anuncio por problema especifico",
    ],
  },
  anuncios_display: {
    channelRole: "awareness y recordacion visual",
    chooseWhen:
      "quieres mantener presencia y reimpactar antes de pedir conversion",
    simpleExamples: [
      "campana visual para posicionamiento",
      "reimpacto a visitantes sin registro",
    ],
  },
  webinar: {
    channelRole: "registro y asistencia a sesion",
    chooseWhen:
      "la accion principal es que el contacto se registre o asista al webinar",
    simpleExamples: [
      "invitacion con agenda y fecha",
      "recordatorio de acceso una hora antes",
    ],
  },
  landing_page: {
    channelRole: "conversion en pagina dedicada",
    chooseWhen:
      "la accion depende de completar formulario, registro o agenda en landing",
    simpleExamples: [
      "visita sin envio de formulario",
      "registro incompleto que requiere rescate",
    ],
  },
  sms: {
    channelRole: "recordatorio de urgencia",
    chooseWhen:
      "hay poco tiempo y necesitas elevar la probabilidad de lectura inmediata",
    simpleExamples: [
      "aviso de ultimo dia de registro",
      "recordatorio corto antes de iniciar evento",
    ],
  },
  whatsapp: {
    channelRole: "conversacion directa 1:1",
    chooseWhen:
      "quieres resolver dudas rapido y confirmar interes en tiempo real",
    simpleExamples: [
      "seguimiento a prospecto que ya contesto antes",
      "confirmacion rapida de disponibilidad para reunion",
    ],
  },
  evento_presencial: {
    channelRole: "confirmacion logistica fisica",
    chooseWhen: "necesitas confirmar cupo, lugar y asistencia presencial",
    simpleExamples: [
      "confirmacion de sede y horario",
      "recordatorio de ingreso y agenda del dia",
    ],
  },
  evento_virtual: {
    channelRole: "confirmacion de acceso remoto",
    chooseWhen:
      "el contacto debe entrar a evento online con enlace y hora definida",
    simpleExamples: [
      "envio de link de acceso personal",
      "recordatorio con instrucciones de conexion",
    ],
  },
  encuesta: {
    channelRole: "captura de feedback",
    chooseWhen:
      "necesitas aprender rapido para ajustar propuesta o prioridad comercial",
    simpleExamples: [
      "encuesta breve despues de demo",
      "preguntas de prioridad antes de enviar propuesta",
    ],
  },
  programa_de_referidos: {
    channelRole: "activacion de recomendaciones",
    chooseWhen: "ya existe una mecanica clara de beneficio por referido",
    simpleExamples: [
      "invitacion a clientes promotores a recomendar",
      "activacion de aliados con incentivo vigente",
    ],
  },
};

const SUBTYPE_FAMILY_MAP = {
  correo_masivo: "difusion_directa",
  correo_automatizado: "maduracion_por_etapas",
  redes_sociales_organicas: "captura_organica",
  redes_sociales_pagadas: "captura_pagada",
  anuncios_busqueda: "intencion_activa",
  anuncios_display: "recordacion_visual",
  webinar: "convocatoria_contenido",
  landing_page: "conversion_en_pagina",
  sms: "urgencia_corta",
  whatsapp: "conversacion_1a1",
  evento_presencial: "asistencia_fisica",
  evento_virtual: "asistencia_remota",
  encuesta: "aprendizaje_feedback",
  programa_de_referidos: "activacion_referidos",
};

const TYPE_DIFFERENTIATION_LENSES = {
  reconocimiento: {
    objectiveLens:
      "ampliar interes inicial sin forzar cierres tempranos ni pedir demasiada friccion",
    successSignal:
      "aumento de interacciones iniciales de calidad (clics, respuestas, visitas con permanencia)",
    avoidPattern:
      "pedir demo o cotizacion demasiado pronto en audiencias frias",
    byFamily: {
      difusion_directa:
        "prioriza alcance claro del mensaje principal para descubrir quien reacciona",
      maduracion_por_etapas:
        "educa en micro-pasos para transformar curiosidad en interes sostenido",
      default:
        "mantiene una entrada suave para detectar interes sin generar rechazo",
    },
  },
  captacion_de_leads: {
    objectiveLens:
      "convertir interes en datos accionables para que ventas pueda contactar y calificar",
    successSignal:
      "formularios completos, registros validos y leads utilizables por el equipo comercial",
    avoidPattern: "acciones de awareness sin mecanismo real de captura",
    byFamily: {
      conversion_en_pagina:
        "recupera abandonos y cierra registros incompletos en landing",
      intencion_activa:
        "captura demanda con alta probabilidad de conversion inmediata",
      conversacion_1a1:
        "resuelve friccion final para completar registro o agenda",
      default:
        "convierte senales de interes en contacto identificado dentro del CRM",
    },
  },
  nutricion: {
    objectiveLens:
      "subir madurez de decision con contenido util, secuenciado y sin presion de cierre inmediato",
    successSignal:
      "avance de etapa, mayor calidad de respuesta y mejor contexto para oportunidad",
    avoidPattern: "repetir mensajes comerciales sin aportar evidencia nueva",
    byFamily: {
      maduracion_por_etapas:
        "acompana por tramos con contenidos distintos segun comportamiento",
      convocatoria_contenido:
        "usa sesiones educativas para destrabar dudas complejas",
      aprendizaje_feedback:
        "recoge objeciones reales para ajustar siguiente mensaje",
      default:
        "entrega contexto progresivo para mover al lead al siguiente nivel de confianza",
    },
  },
  conversion: {
    objectiveLens:
      "quitar fricciones finales y provocar una accion concreta de cierre",
    successSignal:
      "solicitudes de demo/propuesta, reuniones de cierre y avance a etapa final",
    avoidPattern: "mensajes largos sin llamado claro a una accion unica",
    byFamily: {
      intencion_activa:
        "responde rapido a senales de compra para no perder momentum",
      conversacion_1a1: "cierra objeciones puntuales en intercambio directo",
      urgencia_corta: "refuerza decision cuando existe ventana corta de accion",
      default:
        "conecta beneficio concreto con un siguiente paso comercial inmediato",
    },
  },
  fidelizacion: {
    objectiveLens:
      "sostener adopcion y permanencia con valor continuo post-venta",
    successSignal:
      "mayor uso, continuidad de relacion y menor riesgo de abandono",
    avoidPattern: "tratar al cliente activo como lead nuevo",
    byFamily: {
      aprendizaje_feedback:
        "usa feedback para prevenir desgaste y ajustar acompanamiento",
      conversacion_1a1: "atiende dudas de uso con seguimiento cercano",
      maduracion_por_etapas: "activa recorridos de adopcion por niveles de uso",
      default: "refuerza valor percibido para consolidar la relacion vigente",
    },
  },
  reactivacion: {
    objectiveLens:
      "recuperar contacto dormido con baja friccion y propuesta concreta",
    successSignal:
      "respuesta de retorno, reapertura de conversacion o nueva cita",
    avoidPattern: "retomar con mensajes complejos o demasiados pasos",
    byFamily: {
      difusion_directa: "reactiva volumen con mensaje simple de retorno",
      conversacion_1a1:
        "usa toque personal para recuperar cuentas de alto potencial",
      conversion_en_pagina:
        "dirige a una accion corta para medir reenganche real",
      default: "busca una primera respuesta antes de empujar cierre comercial",
    },
  },
  promocion: {
    objectiveLens:
      "mover respuesta inmediata en una ventana comercial limitada",
    successSignal:
      "acciones dentro de vigencia (registro, compra, solicitud o canje)",
    avoidPattern: "llamados ambiguos sin urgencia ni fecha limite",
    byFamily: {
      urgencia_corta:
        "refuerza el cierre de ventana con recordatorios puntuales",
      difusion_directa: "maximiza alcance rapido de la oferta",
      captura_pagada: "escala respuesta con segmentacion de pauta",
      default: "enfatiza beneficio + fecha limite + CTA unico",
    },
  },
  lanzamiento_de_producto: {
    objectiveLens:
      "explicar novedad y activar primeras pruebas en segmentos de afinidad",
    successSignal:
      "solicitudes de informacion, demos iniciales y primeras adopciones",
    avoidPattern: "hablar de caracteristicas sin aterrizar casos de uso",
    byFamily: {
      difusion_directa: "anuncia lanzamiento con propuesta de valor clara",
      convocatoria_contenido: "demuestra el producto en formato guiado",
      maduracion_por_etapas: "acomoda el mensaje segun nivel de entendimiento",
      default: "vincula novedad con problema real del segmento objetivo",
    },
  },
  upsell: {
    objectiveLens:
      "expandir valor en cliente actual aumentando plan, alcance o volumen",
    successSignal:
      "aceptacion de upgrade, ampliacion de paquete o incremento de ticket",
    avoidPattern: "proponer crecimiento sin evidencia de necesidad o uso",
    byFamily: {
      conversacion_1a1: "negocia expansion sobre contexto puntual de la cuenta",
      aprendizaje_feedback: "identifica brechas de uso que justifican upgrade",
      maduracion_por_etapas: "muestra ruta clara de crecimiento por fases",
      default: "conecta resultado actual con siguiente nivel de valor",
    },
  },
  cross_sell: {
    objectiveLens:
      "introducir una solucion complementaria que amplie impacto en cuenta activa",
    successSignal:
      "interes en linea complementaria y apertura de nueva oportunidad",
    avoidPattern:
      "ofrecer complemento sin relacion con dolor actual del cliente",
    byFamily: {
      conversacion_1a1: "detecta necesidad adyacente en dialogo directo",
      aprendizaje_feedback: "usa hallazgos para proponer complemento preciso",
      difusion_directa:
        "presenta opciones complementarias por segmento de cliente",
      default: "explica como la solucion adicional mejora lo ya implementado",
    },
  },
  evento: {
    objectiveLens:
      "asegurar registro, confirmacion y asistencia efectiva en fecha definida",
    successSignal:
      "confirmaciones firmes, asistencia real y participacion durante el evento",
    avoidPattern: "invitar sin agenda, acceso o instrucciones claras",
    byFamily: {
      convocatoria_contenido: "mueve registro con valor claro del contenido",
      asistencia_fisica:
        "cierra detalles logisticos para reducir no-show presencial",
      asistencia_remota: "asegura acceso y puntualidad en entorno virtual",
      urgencia_corta:
        "refuerza asistencia en ventana inmediata previa al inicio",
      default: "prioriza confirmacion operativa antes del dia del evento",
    },
  },
  referidos: {
    objectiveLens:
      "activar recomendaciones confiables con proceso simple y beneficio claro",
    successSignal: "referidos registrados, contactables y con perfil objetivo",
    avoidPattern: "pedir referidos sin reglas claras ni incentivo comprensible",
    byFamily: {
      activacion_referidos: "ordena el flujo de recomendacion de punta a punta",
      conversacion_1a1: "activa promotores clave con trato directo",
      conversion_en_pagina: "facilita captura estructurada del referido",
      default: "reduce friccion para que recomendar sea rapido y entendible",
    },
  },
  educacion: {
    objectiveLens:
      "aumentar entendimiento para reducir objeciones y preparar mejor decision",
    successSignal:
      "consumo de contenido, preguntas de mayor calidad y avance de comprension",
    avoidPattern: "sobrecargar con teoria sin aterrizar accion siguiente",
    byFamily: {
      convocatoria_contenido:
        "usa sesiones guiadas para explicar temas complejos",
      maduracion_por_etapas: "estructura aprendizaje en secuencia gradual",
      captura_organica:
        "aprovecha interes espontaneo para profundizar conocimiento",
      default: "traduce complejidad en pasos claros y aplicables",
    },
  },
};

const COMBINATION_USAGE_GUIDE_OVERRIDES = {
  "captacion_de_leads::landing_page": {
    context:
      "Guia rapida para esta combinacion: 1) Que esta pasando: el contacto ya llego a la landing y mostro interes, pero no completo el registro. 2) Cuando elegirla: cuando la prioridad es rescatar conversiones incompletas y convertirlas en lead identificado. 3) Como ejecutarla: usa un mensaje corto, CTA unico y enlace directo al formulario para terminar el paso pendiente. 4) Resultado esperado: lead creado con datos utiles para seguimiento comercial. Si el contacto ya asistio al evento, deja de ser captacion y debe pasar a nutricion o conversion post-evento.",
    examples: [
      "Ejemplo 1: entro a la landing, lleno nombre y correo, pero no dio enviar. Accion: enviar seguimiento para retomar formulario exactamente donde lo dejo.",
      "Ejemplo 2: se preregistro a un evento, pero no confirmo datos finales. Accion: correo con enlace unico para completar confirmacion.",
      "Ejemplo 3: hizo clic desde pauta, reviso la pagina y salio sin registro. Accion: seguimiento con beneficio concreto y CTA de registro inmediato.",
      "Ejemplo 4: ya asistio al evento. Accion correcta: no usar captacion+landing; mover a nutricion o conversion con siguiente propuesta.",
    ],
  },
};

const CAMPAIGN_STATE_DESCRIPTIONS = {
  borrador: "Campana en preparacion interna; aun no se ejecuta.",
  en_ejecucion: "Campana activa y corriendo en sus canales definidos.",
  pausada: "Campana detenida temporalmente con posibilidad de reanudacion.",
  finalizada: "Campana concluida y cerrada operativamente.",
  cancelada: "Campana detenida de forma definitiva antes de su cierre normal.",
};

const CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS = {
  cliente_inactivo:
    "Cuenta sin actividad comercial reciente o sin traccion tras oportunidades previas.",
  cliente_en_riesgo:
    "Cuenta ganada anteriormente con inactividad entre 120 y 270 dias.",
  cliente_nuevo:
    "Cuenta con 1+ oportunidades ganadas en los ultimos 90 dias y sin ganadas anteriores.",
  cliente_activo:
    "Cuenta con oportunidades ganadas y actividad en los ultimos 120 dias, excluyendo cliente nuevo.",
  oportunidad:
    "Cuenta con oportunidades abiertas desde etapa Desarrollo en adelante.",
  oportunidad_temprana:
    "Cuenta con oportunidades abiertas en etapas tempranas antes de Desarrollo.",
  lead_calificado:
    "Cuenta con leads calificados, sin oportunidades abiertas y sin ganadas.",
  lead_nuevo:
    "Cuenta con leads activos creados/asignados, sin leads calificados y sin oportunidades.",
  visitante:
    "Cuenta sin oportunidades y sin señales de lead; etapa de descubrimiento inicial.",
  historial_sin_traccion:
    "Cuenta con historial de oportunidades, sin abiertas y sin ganadas.",
};

function isActiveAccount(account) {
  const statusCode = String(account?.activation_status_code || "")
    .trim()
    .toLowerCase();
  if (statusCode) {
    return statusCode === "activada";
  }

  const statusName = String(account?.activation_status || "")
    .trim()
    .toLowerCase();
  return statusName === "activada";
}

function formatCampaignTypeLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatAudienceStageBadgeLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Sin definir";
  if (normalized === "manual") return "Manual";
  return formatCampaignTypeLabel(normalized);
}

function buildClassificationUsageGuide(tipoCampana, subtipoCampana) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();
  const tipoLabel = formatCampaignTypeLabel(tipo);
  const subtipoLabel = formatCampaignTypeLabel(subtipo);
  const override = COMBINATION_USAGE_GUIDE_OVERRIDES[`${tipo}::${subtipo}`];
  if (override) {
    return {
      context: override.context,
      examples: Array.isArray(override.examples) ? override.examples : [],
    };
  }

  const typeEntry =
    CAMPAIGN_TYPE_USAGE_GUIDE[tipo] || CAMPAIGN_TYPE_USAGE_GUIDE.reconocimiento;
  const subtypeEntry =
    CAMPAIGN_SUBTYPE_USAGE_GUIDE[subtipo] ||
    CAMPAIGN_SUBTYPE_USAGE_GUIDE.correo_masivo;
  const typeLens =
    TYPE_DIFFERENTIATION_LENSES[tipo] ||
    TYPE_DIFFERENTIATION_LENSES.reconocimiento;
  const subtypeFamily =
    SUBTYPE_FAMILY_MAP[subtipo] || SUBTYPE_FAMILY_MAP.correo_masivo;
  const familyFocus =
    typeLens.byFamily?.[subtypeFamily] ||
    typeLens.byFamily?.default ||
    "alinea canal y objetivo comercial con una accion medible";

  const typeExampleA = String(
    typeEntry.simpleExamples?.[0] || "hay una senal inicial valida",
  )
    .trim()
    .replace(/[.\s]+$/, "");
  const typeExampleB = String(
    typeEntry.simpleExamples?.[1] ||
      "la cuenta aun no completa el siguiente paso",
  )
    .trim()
    .replace(/[.\s]+$/, "");
  const subtypeExampleA = String(
    subtypeEntry.simpleExamples?.[0] ||
      "se requiere ejecutar el canal seleccionado",
  )
    .trim()
    .replace(/[.\s]+$/, "");
  const subtypeExampleB = String(
    subtypeEntry.simpleExamples?.[1] ||
      "se necesita un contacto adicional para cerrar la accion",
  )
    .trim()
    .replace(/[.\s]+$/, "");

  return {
    context: `Guia didactica para ${tipoLabel} + ${subtipoLabel}: 1) Momento comercial: ${typeEntry.useWhen}. 2) Diferenciador dentro de ${tipoLabel}: en este subtipo se ${familyFocus}. 3) Forma de ejecucion recomendada: ${subtypeEntry.channelRole}; por eso conviene usar un CTA unico, corto y directo. 4) Resultado buscado: ${typeEntry.desiredAction}. 5) Senal de exito para esta combinacion: ${typeLens.successSignal}. 6) Error comun a evitar: ${typeLens.avoidPattern}.`,
    examples: [
      `Ejemplo 1 (${tipoLabel}): si ${typeExampleA}, usa ${subtipoLabel} para ${familyFocus}.`,
      `Ejemplo 2 (${subtipoLabel}): si ${subtypeExampleA}, manten el foco en ${typeEntry.desiredAction} y evita abrir multiples CTAs.`,
      `Ejemplo 3 (decision operativa): si ${typeExampleB}, ejecuta ${subtipoLabel} y mide si logras ${typeLens.successSignal}.`,
      `Ejemplo 4 (control de calidad): si ${subtypeExampleB}, simplifica mensaje y corrige el error comun de ${typeLens.avoidPattern}.`,
    ],
  };
}

function formatDateTimeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toPayloadDateTime(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toPayloadDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return `${normalized}T00:00:00.000Z`;
}

function toDateInputValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const datePart = normalized.includes("T")
    ? normalized.split("T")[0]
    : normalized.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "";
}

function normalizeSectorValue(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeClassificationValue(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeAudienceContact(rawContact) {
  const contactId = Number(rawContact?.contact_id ?? rawContact?.id ?? 0);
  if (!Number.isInteger(contactId) || contactId <= 0) return null;

  const contactName = String(
    rawContact?.contact_name ||
      rawContact?.full_name ||
      rawContact?.fullName ||
      "",
  ).trim();
  const email = String(rawContact?.email || "").trim();

  return {
    contact_id: contactId,
    contact_name: contactName || email || `Contacto ${contactId}`,
    email,
    position_title: String(rawContact?.position_title || "").trim(),
  };
}

function normalizeCampaignForm(
  form,
  campaignGoalText,
  classificationGuideContext,
  classificationGuideExamples,
  selectedAccountTypeFilters,
  selectedSectorFilters,
) {
  const audienceLifecycleFilters = normalizeLifecycleFilterList(
    form.audience_lifecycle_filters,
  );
  return {
    name: String(form.name || "").trim(),
    description: String(form.description || "").trim() || null,
    campaign_goal_text: String(campaignGoalText || "").trim() || null,
    classification_guide_context:
      String(classificationGuideContext || "").trim() || null,
    classification_guide_examples: Array.isArray(classificationGuideExamples)
      ? classificationGuideExamples
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    audience_lifecycle_filters: audienceLifecycleFilters,
    audience_account_type_filters: Array.isArray(selectedAccountTypeFilters)
      ? selectedAccountTypeFilters
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    audience_sector_filters: Array.isArray(selectedSectorFilters)
      ? selectedSectorFilters
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    tipo_campana: String(form.tipo_campana || "").trim(),
    subtipo_campana: String(form.subtipo_campana || "").trim(),
    estado_campana: String(form.estado_campana || "").trim(),
    etapa_ciclo_vida: audienceLifecycleFilters[0] || null,
    starts_at: toPayloadDate(form.starts_at),
    ends_at: toPayloadDate(form.ends_at),
  };
}

function normalizeSavedFilterList(values) {
  return Array.isArray(values)
    ? values.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function normalizeLifecycleFilterList(values) {
  const allowed = new Set(Object.keys(CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS));
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((item) => String(item || "").trim())
        .filter((item) => allowed.has(item)),
    ),
  );
}

function getClassificationGuideStorageKey(
  campaignId,
  tipoCampana,
  subtipoCampana,
) {
  const campaignKey = String(campaignId || "__draft__").trim() || "__draft__";
  const tipoKey = String(tipoCampana || "__tipo__").trim() || "__tipo__";
  const subtipoKey =
    String(subtipoCampana || "__subtipo__").trim() || "__subtipo__";
  return `campaigns-page-classification-guide:${campaignKey}:${tipoKey}:${subtipoKey}`;
}

function readStoredClassificationGuide(
  campaignId,
  tipoCampana,
  subtipoCampana,
) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(
      getClassificationGuideStorageKey(campaignId, tipoCampana, subtipoCampana),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return isCampaignGuideConsistent(
      parsed.guide || parsed,
      tipoCampana,
      subtipoCampana,
    )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeStoredClassificationGuide(
  campaignId,
  tipoCampana,
  subtipoCampana,
  payload,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getClassificationGuideStorageKey(campaignId, tipoCampana, subtipoCampana),
      JSON.stringify(payload),
    );
  } catch {
    // Ignore persistence failures.
  }
}

function clearStoredClassificationGuide(
  campaignId,
  tipoCampana,
  subtipoCampana,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(
      getClassificationGuideStorageKey(campaignId, tipoCampana, subtipoCampana),
    );
  } catch {
    // Ignore persistence failures.
  }
}

function isCampaignGuideConsistent(guide, tipoCampana, subtipoCampana) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();
  if (!guide || !tipo || !subtipo) return false;

  const guideTipo = String(
    guide.tipoCampana || guide.tipo_campana || "",
  ).trim();
  const guideSubtipo = String(
    guide.subtipoCampana || guide.subtipo_campana || "",
  ).trim();
  if (guideTipo || guideSubtipo) {
    return guideTipo === tipo && guideSubtipo === subtipo;
  }

  return false;
}

function normalizeClassificationGuideAi({
  enriched,
  tipoCampana,
  subtipoCampana,
  campaignGoalText,
}) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();
  const context = String(enriched?.context || enriched?.contexto || "").trim();
  const examples = Array.isArray(enriched?.examples)
    ? enriched.examples
    : Array.isArray(enriched?.ejemplos)
      ? enriched.ejemplos
      : [];

  return {
    source: "ai",
    tipoCampana: tipo,
    tipo_campana: tipo,
    subtipoCampana: subtipo,
    subtipo_campana: subtipo,
    summary: String(enriched?.summary || "").trim(),
    reason: String(enriched?.reason || "").trim(),
    objectiveDetail: {
      context: String(
        enriched?.objectiveDetail?.context || campaignGoalText || "",
      ).trim(),
      expectedResult: String(
        enriched?.objectiveDetail?.expectedResult || "",
      ).trim(),
      successSignal: String(
        enriched?.objectiveDetail?.successSignal || "",
      ).trim(),
      nextStep: String(enriched?.objectiveDetail?.nextStep || "").trim(),
    },
    typeSubtypeContext: {
      interpretation: String(
        enriched?.typeSubtypeContext?.interpretation || "",
      ).trim(),
      useWhen: String(enriched?.typeSubtypeContext?.useWhen || "").trim(),
      avoidWhen: String(enriched?.typeSubtypeContext?.avoidWhen || "").trim(),
    },
    campaignContextDescription: String(
      enriched?.campaignContextDescription || "",
    ).trim(),
    subtypeContextDescription: String(
      enriched?.subtypeContextDescription || "",
    ).trim(),
    deliveryContextDescription: String(
      enriched?.deliveryContextDescription || "",
    ).trim(),
    emailTypeContextDescription: String(
      enriched?.emailTypeContextDescription || "",
    ).trim(),
    context,
    examples: examples
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 5),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeClassificationGuideFromDb(campaign) {
  const tipo = String(campaign?.tipo_campana || "").trim();
  const subtipo = String(campaign?.subtipo_campana || "").trim();
  const context = String(campaign?.classification_guide_context || "").trim();
  const examples = Array.isArray(campaign?.classification_guide_examples)
    ? campaign.classification_guide_examples
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  if (!context && !examples.length) {
    return null;
  }

  return {
    source: "db",
    tipoCampana: tipo,
    tipo_campana: tipo,
    subtipoCampana: subtipo,
    subtipo_campana: subtipo,
    context,
    examples,
    updatedAt: new Date().toISOString(),
  };
}

function DismissibleAlert({ message, variant = "error" }) {
  const normalizedMessage = String(message || "").trim();
  const [dismissedMessage, setDismissedMessage] = useState("");

  if (!normalizedMessage || dismissedMessage === normalizedMessage) {
    return null;
  }

  const variantClass =
    variant === "success" ? "campaigns-alert-success" : "campaigns-alert-error";

  return (
    <div
      className={`campaigns-alert ${variantClass} campaigns-alert-dismissible`}
      role="alert"
    >
      <span>{normalizedMessage}</span>
      <button
        type="button"
        className="campaigns-alert-close"
        aria-label="Cerrar notificacion"
        onClick={() => setDismissedMessage(normalizedMessage)}
      >
        ×
      </button>
    </div>
  );
}

function getSubtypeCompatibilityLevel(
  policyByType,
  tipoCampana,
  subtipoCampana,
) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();
  const policy = policyByType?.[tipo] || null;
  if (!policy || !subtipo) {
    return "bloqueado";
  }

  const allowed = Array.isArray(policy.permitido) ? policy.permitido : [];
  const requiresApproval = Array.isArray(policy.permitido_con_aprobacion)
    ? policy.permitido_con_aprobacion
    : [];

  if (allowed.includes(subtipo)) {
    return "permitido";
  }

  if (requiresApproval.includes(subtipo)) {
    return "permitido_con_aprobacion";
  }

  return "bloqueado";
}

function getCompatibleSubtypeOptions(
  policyByType,
  allSubtypeValues,
  tipoCampana,
) {
  const tipo = String(tipoCampana || "").trim();
  const policy = policyByType?.[tipo] || null;
  const catalogValues = Array.isArray(allSubtypeValues) ? allSubtypeValues : [];

  if (!policy) {
    return catalogValues.map((value) => ({
      value,
      nivel: "permitido",
    }));
  }

  return catalogValues
    .map((value) => ({
      value,
      nivel: getSubtypeCompatibilityLevel(policyByType, tipo, value),
    }))
    .filter((entry) => entry.nivel !== "bloqueado");
}

function normalizeCampaignAccountForm(form, lifecycleStage) {
  return {
    account_id: Number(form.account_id),
    etapa_ciclo_vida: String(lifecycleStage || "").trim() || null,
    estado_interaccion: String(form.estado_interaccion || "").trim(),
    last_interaction_at: toPayloadDateTime(form.last_interaction_at),
  };
}

function resolveCampaignStateValue(value, allowedStates) {
  const normalized = String(value || "").trim();
  if (normalized && allowedStates.includes(normalized)) {
    return normalized;
  }
  return allowedStates[0] || EMPTY_FORM.estado_campana;
}

function extractJsonObjectFromText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const extractBalancedObject = (value) => {
    const source = String(value || "");
    let start = -1;
    let depth = 0;
    let inString = false;
    let quoteChar = "";
    let escaped = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }

      if (inString) {
        if (char === "\\") {
          escaped = true;
        } else if (char === quoteChar) {
          inString = false;
          quoteChar = "";
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        quoteChar = char;
        continue;
      }

      if (char === "{") {
        if (depth === 0) start = index;
        depth += 1;
        continue;
      }

      if (char === "}") {
        if (depth > 0) {
          depth -= 1;
          if (depth === 0 && start >= 0) {
            return source.slice(start, index + 1);
          }
        }
      }
    }

    return "";
  };

  const tryParseCandidate = (candidate) => {
    const base = String(candidate || "").trim();
    if (!base) return null;

    const parseStrict = (value) => {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    };

    const strictParsed = parseStrict(base);
    if (strictParsed) return strictParsed;

    const normalized = base
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/([{,]\s*)'([^'\\]+)'\s*:/g, '$1"$2":')
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value) => {
        const escaped = String(value || "")
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        return `: "${escaped}"`;
      });

    return parseStrict(normalized);
  };

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const fencedCandidate = fencedMatch ? fencedMatch[1].trim() : "";
  const directBalanced = extractBalancedObject(text);
  const fencedBalanced = extractBalancedObject(fencedCandidate);

  const candidates = [
    fencedCandidate,
    fencedBalanced,
    directBalanced,
    text,
  ].filter((value, index, list) => {
    if (!String(value || "").trim()) return false;
    return list.findIndex((item) => item === value) === index;
  });

  for (const candidate of candidates) {
    const parsed = tryParseCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function trimForPrompt(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function toChatbotSafeMessage(value) {
  const text = String(value || "").trim();
  const MAX_SAFE = 3950;
  if (text.length <= MAX_SAFE) return text;
  return `${text.slice(0, MAX_SAFE - 1).trim()}…`;
}

function buildCompatibilityPromptSnippet(policyByType) {
  if (!policyByType || typeof policyByType !== "object") {
    return "compatibilidad no disponible";
  }

  return Object.entries(policyByType)
    .map(([tipo, policy]) => {
      const permitido = Array.isArray(policy?.permitido)
        ? policy.permitido.slice(0, 6)
        : [];
      const aprobacion = Array.isArray(policy?.permitido_con_aprobacion)
        ? policy.permitido_con_aprobacion.slice(0, 4)
        : [];
      return `${tipo}: permitido=[${permitido.join("|")}] aprobacion=[${aprobacion.join("|")}]`;
    })
    .join(" ; ");
}

function normalizeCampaignMatrixRowsForSuggestion(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return null;
      }

      const campaignType = String(row.campaignType || "").trim();
      const campaignSubtype = String(row.campaignSubtype || "").trim();
      const priority = String(row.priority || "").trim();
      const emailType = String(row.emailType || "").trim();
      const operationalRequirement = String(
        row.operationalRequirement || "",
      ).trim();
      const exampleEmail = String(row.exampleEmail || "").trim();

      if (!campaignType || !campaignSubtype) return null;

      return {
        campaignType,
        campaignSubtype,
        priority,
        emailType,
        operationalRequirement,
        exampleEmail,
      };
    })
    .filter(Boolean);
}

function buildCampaignMatrixPromptSnippet(rows, maxRows = 40) {
  const normalizedRows = normalizeCampaignMatrixRowsForSuggestion(rows);
  if (!normalizedRows.length) {
    return "matriz no disponible";
  }

  return normalizedRows
    .slice(0, Math.max(1, Number(maxRows) || 40))
    .map((row) => {
      const requirement = trimForPrompt(row.operationalRequirement, 100);
      return [
        row.campaignType,
        row.campaignSubtype,
        row.priority || "sin_prioridad",
        row.emailType || "sin_tipo_correo",
        requirement || "sin_requisito",
      ].join("|");
    })
    .join(" ; ");
}

function buildTypeDescriptionsPrompt(types) {
  const values = Array.isArray(types) ? types : [];
  return values
    .map((value) => {
      const key = String(value || "").trim();
      return `${key}: ${trimForPrompt(CAMPAIGN_TYPE_DESCRIPTIONS[key] || "sin descripcion", 120)}`;
    })
    .join(" ; ");
}

function buildSubtypeDescriptionsPrompt(subtypes) {
  const values = Array.isArray(subtypes) ? subtypes : [];
  return values
    .map((value) => {
      const key = String(value || "").trim();
      return `${key}: ${trimForPrompt(CAMPAIGN_SUBTYPE_DESCRIPTIONS[key] || "sin descripcion", 120)}`;
    })
    .join(" ; ");
}

async function waitForChatbotJobCompletion({
  jobId,
  failedMessage,
  timeoutMessage,
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CHATBOT_JOB_TIMEOUT_MS) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, CHATBOT_JOB_POLL_INTERVAL_MS),
    );
    const jobRes = await api.get(
      `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
    );
    const status = String(jobRes?.data?.status || "queued").trim();
    if (status === "completed") {
      return;
    }
    if (status === "failed") {
      throw new Error(String(jobRes?.data?.error?.message || failedMessage));
    }
  }

  throw new Error(timeoutMessage);
}

function normalizeCatalogToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("_", " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchCatalogValueFromText(rawText, catalogValues) {
  const text = normalizeCatalogToken(rawText);
  if (!text) return "";

  const values = Array.isArray(catalogValues) ? catalogValues : [];
  let bestMatch = "";
  let bestScore = -1;

  values.forEach((value) => {
    const normalizedValue = normalizeCatalogToken(value);
    if (!normalizedValue) return;
    if (!text.includes(normalizedValue)) return;

    const score = normalizedValue.length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = String(value || "").trim();
    }
  });

  return bestMatch;
}

function extractSuggestionFromPlainText({
  rawText,
  availableTypes,
  availableSubtypes,
  policyByType,
}) {
  const content = String(rawText || "").trim();
  if (!content) return null;

  const typeFromText = matchCatalogValueFromText(content, availableTypes);
  if (!typeFromText) return null;

  const compatibleSubtypeEntries = getCompatibleSubtypeOptions(
    policyByType,
    availableSubtypes,
    typeFromText,
  );
  const compatibleSubtypeValues = compatibleSubtypeEntries.map(
    (entry) => entry.value,
  );
  const subtypeFromText = matchCatalogValueFromText(
    content,
    compatibleSubtypeValues,
  );
  if (!subtypeFromText) return null;

  const reasonMatch = content.match(/raz[oó]n\s*[:\-]\s*([\s\S]+)/i);
  const reason = String(reasonMatch?.[1] || content)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);

  return {
    tipo_campana: typeFromText,
    subtipo_campana: subtypeFromText,
    razon: reason,
  };
}

function extractGuideFromPlainText({ rawText, tipoCampana, subtipoCampana }) {
  const content = String(rawText || "").trim();
  if (!content) return null;

  const lines = content
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  const examples = lines
    .filter((line) => /^[-*•]|^\d+[.)]/.test(line))
    .map((line) => line.replace(/^[-*•]\s*|^\d+[.)]\s*/g, "").trim())
    .filter((line) => line.length >= 12)
    .slice(0, 5);

  let context = "";
  const contextMatch = content.match(
    /contexto\s*[:\-]\s*([\s\S]*?)(?:\n\s*(?:ejemplos?|\d+[.)]|[-*•])|$)/i,
  );
  if (contextMatch?.[1]) {
    context = String(contextMatch[1]).replace(/\s+/g, " ").trim();
  }

  if (!context) {
    context = lines
      .filter((line) => line.length >= 40 && !/^[-*•]|^\d+[.)]/.test(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!context || context.length < 80 || examples.length < 3) {
    return null;
  }

  return {
    tipo_campana: String(tipoCampana || "").trim(),
    subtipo_campana: String(subtipoCampana || "").trim(),
    contexto: context,
    ejemplos: examples,
  };
}

async function fetchLatestAssistantMessageFromSession(sessionId) {
  const historyRes = await api.get(
    `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const messages = Array.isArray(historyRes?.data?.items)
    ? historyRes.data.items
    : [];
  const reversed = [...messages].reverse();
  const assistantMessage = reversed.find(
    (item) => String(item?.role || "").trim() === "assistant",
  );
  const fallbackMessage = reversed.find((item) =>
    String(item?.content || "").trim(),
  );
  const content = String(
    assistantMessage?.content || fallbackMessage?.content || "",
  );

  return {
    content,
    parsed: extractJsonObjectFromText(content),
  };
}

async function fetchLatestAssistantParsedJson(sessionId) {
  const latest = await fetchLatestAssistantMessageFromSession(sessionId);
  return latest.parsed;
}

async function requestStrictJsonRecovery({
  sessionId,
  schemaExample,
  failedMessage,
  timeoutMessage,
  extraInstruction = "",
}) {
  const recoveryPrompt = [
    "Tu respuesta anterior no fue JSON interpretable.",
    "Repite la respuesta únicamente como JSON válido, sin markdown ni texto adicional.",
    String(extraInstruction || "").trim(),
    `Usa exactamente esta estructura: ${schemaExample}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const recoveryRes = await api.post("/api/chatbot/messages", {
    sessionId,
    message: toChatbotSafeMessage(recoveryPrompt),
    useContext: false,
    featureCode: "chatbot.assistant",
  });

  const recoveryJobId = String(recoveryRes?.data?.jobId || "").trim();
  if (!recoveryJobId) {
    throw new Error(failedMessage);
  }

  await waitForChatbotJobCompletion({
    jobId: recoveryJobId,
    failedMessage,
    timeoutMessage,
  });

  return fetchLatestAssistantParsedJson(sessionId);
}

async function ensureParsedJsonFromSession({
  sessionId,
  schemaExample,
  failedMessage,
  timeoutMessage,
  recoveryContext = "",
  plainTextFallbackExtractor = null,
}) {
  let latestAssistant = await fetchLatestAssistantMessageFromSession(sessionId);
  let parsed = latestAssistant.parsed;
  if (parsed && typeof parsed === "object") {
    return parsed;
  }

  const recoveryAttempts = [
    String(recoveryContext || "").trim(),
    [
      String(recoveryContext || "").trim(),
      "IMPORTANTE: devuelve un solo objeto JSON válido en una línea, sin markdown y sin texto extra.",
      `Ejemplo exacto de formato: ${schemaExample}`,
    ]
      .filter(Boolean)
      .join(" "),
  ];

  for (const extraInstruction of recoveryAttempts) {
    parsed = await requestStrictJsonRecovery({
      sessionId,
      schemaExample,
      failedMessage,
      timeoutMessage,
      extraInstruction,
    });
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    latestAssistant = await fetchLatestAssistantMessageFromSession(sessionId);
  }

  if (typeof plainTextFallbackExtractor === "function") {
    const fromText = plainTextFallbackExtractor(latestAssistant?.content || "");
    if (fromText && typeof fromText === "object") {
      return fromText;
    }
  }

  throw new Error(
    `${failedMessage}. La IA respondió en formato no válido tras varios intentos automáticos.`,
  );
}

async function requestLabeledTextRecovery({
  sessionId,
  instruction,
  failedMessage,
  timeoutMessage,
}) {
  const recoveryRes = await api.post("/api/chatbot/messages", {
    sessionId,
    message: toChatbotSafeMessage(instruction),
    useContext: false,
    featureCode: "chatbot.assistant",
  });

  const recoveryJobId = String(recoveryRes?.data?.jobId || "").trim();
  if (!recoveryJobId) {
    throw new Error(failedMessage);
  }

  await waitForChatbotJobCompletion({
    jobId: recoveryJobId,
    failedMessage,
    timeoutMessage,
  });

  const latest = await fetchLatestAssistantMessageFromSession(sessionId);
  return String(latest?.content || "").trim();
}

async function requestMinimalSuggestionFallback({
  intentText,
  availableTypes,
  availableSubtypes,
  policyByType,
}) {
  const types = Array.isArray(availableTypes) ? availableTypes : [];
  const subtypes = Array.isArray(availableSubtypes) ? availableSubtypes : [];
  if (!types.length || !subtypes.length) {
    return null;
  }

  const sessionRes = await api.post("/api/chatbot/sessions", {
    locale: "es",
    userContext: {
      module: "campaigns",
      objective: "suggest_campaign_type_subtype_minimal_fallback",
    },
  });
  const sessionId = String(sessionRes?.data?.sessionId || "").trim();
  if (!sessionId) return null;

  const minimalInstruction = [
    "Responde SOLO una línea en este formato exacto:",
    "TIPO=<valor>;SUBTIPO=<valor>;RAZON=<texto breve>",
    "No uses JSON, markdown, ni texto adicional.",
    `Tipos permitidos: ${types.join(", ")}`,
    `Subtipos permitidos: ${subtypes.join(", ")}`,
    `Compatibilidad por tipo: ${buildCompatibilityPromptSnippet(policyByType)}`,
    `Objetivo: ${trimForPrompt(intentText, 700)}`,
  ].join("\n\n");

  const messageRes = await api.post("/api/chatbot/messages", {
    sessionId,
    message: toChatbotSafeMessage(minimalInstruction),
    useContext: false,
    featureCode: "chatbot.assistant",
  });
  const jobId = String(messageRes?.data?.jobId || "").trim();
  if (!jobId) return null;

  await waitForChatbotJobCompletion({
    jobId,
    failedMessage: "No fue posible obtener fallback IA de sugerencia",
    timeoutMessage: "El fallback IA de sugerencia tardó demasiado",
  });

  const latest = await fetchLatestAssistantMessageFromSession(sessionId);
  return extractSuggestionFromPlainText({
    rawText: latest?.content || "",
    availableTypes: types,
    availableSubtypes: subtypes,
    policyByType,
  });
}

async function requestCampaignCombinationSuggestionWithAi({
  intentText,
  availableTypes,
  availableSubtypes,
  policyByType,
  campaignMatrixRows,
}) {
  const types = Array.isArray(availableTypes) ? availableTypes : [];
  const subtypes = Array.isArray(availableSubtypes) ? availableSubtypes : [];
  const normalizedMatrixRows =
    normalizeCampaignMatrixRowsForSuggestion(campaignMatrixRows);
  const matrixCombinationSet = new Set(
    normalizedMatrixRows.map(
      (row) => `${row.campaignType}::${row.campaignSubtype}`,
    ),
  );

  if (!types.length || !subtypes.length) {
    throw new Error("No hay catálogos de tipo/subtipo disponibles");
  }

  const sessionRes = await api.post("/api/chatbot/sessions", {
    locale: "es",
    userContext: {
      module: "campaigns",
      objective: "suggest_campaign_type_subtype",
    },
  });

  const sessionId = String(sessionRes?.data?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("No fue posible crear sesión IA");
  }

  const aiInstruction = [
    "Eres un asistente experto en clasificación de campañas comerciales.",
    "Tu tarea es sugerir exactamente una combinación de tipo_campana y subtipo_campana y además generar contexto y ejemplos didácticos coherentes con esa combinación.",
    "Responde exclusivamente JSON válido con esta estructura:",
    '{"tipo_campana":"...","subtipo_campana":"...","sub_etapa":"...","razon":"...","contexto":"...","ejemplos":["...","...","..."]}',
    "No agregues markdown ni texto fuera del JSON.",
    "Reglas para contexto y ejemplos:",
    "- contexto entre 300 y 900 caracteres",
    "- ejemplos entre 3 y 5 items",
    "- cada ejemplo debe ser simple, accionable y coherente con tipo/subtipo",
    "Aplica obligatoriamente esta matriz operativa de sub-etapa x mensaje esperado antes de elegir combinación:",
    "1) lanzamiento_inicial: no hay envíos ni tráfico previo suficiente. Mensaje esperado: valor del activo y primer registro.",
    "2) activacion_trafico: ya hubo primera ola, pero falta volumen de visitas calificadas. Mensaje esperado: problema + beneficio + evidencia breve.",
    "3) conversion_en_landing: hay visitas, pero baja conversión a formulario. Mensaje esperado: reducir fricción de registro y clarificar promesa.",
    "4) recuperacion_abandono: hubo inicio de registro sin completar. Mensaje esperado: retomar paso pendiente con CTA único.",
    "5) entrega_confirmacion: registro ya completado. Mensaje esperado: acceso/entrega del recurso y próximos pasos.",
    "6) seguimiento_valor: ya consumió parcialmente el activo. Mensaje esperado: contenido complementario y siguiente interacción.",
    "7) nutricion_temprana: hay interés, pero sin intención de compra clara. Mensaje esperado: educación aplicada y maduración.",
    "8) conversion_comercial: intención explícita o señal de cierre. Mensaje esperado: propuesta concreta y acción de cierre.",
    "Reglas de gating para evitar errores de etapa:",
    "- Si el objetivo no menciona evidencia de envíos/visitas previas, asume lanzamiento_inicial por defecto.",
    "- Solo usar recuperacion_abandono si el texto indica explícitamente abandono, visita sin registro o formulario incompleto.",
    "- Si el objetivo describe captación nueva (ej. ebook/webinar por lanzar), NO asumir abandono ni seguimiento post-evento.",
    "- Si el objetivo describe post-registro, prioriza nutrición o conversión según intención declarada.",
    "Regla de coherencia tipo vs sub_etapa:",
    "- lanzamiento_inicial y activacion_trafico NO deben devolver tipo_campana='conversion' cuando el objetivo principal es captar registros.",
    "- conversion_en_landing significa optimizacion de registro/formulario y normalmente corresponde a captacion_de_leads, no a cierre comercial.",
    "- conversion_comercial si requiere tipo_campana='conversion' porque implica cierre (demo/cotizacion/compra).",
    "Regla semántica: la razón debe explicar por qué la sub_etapa elegida coincide con el objetivo del usuario y por qué el subtipo es el canal correcto en esa sub-etapa.",
    "Regla de seguridad: no inventes estados ni señales no descritas por el usuario.",
    "Regla de configuración: la combinación tipo/subtipo final debe existir en la matriz de campañas configurada.",
    `Tipos permitidos: ${types.join(", ")}`,
    `Subtipos permitidos: ${subtypes.join(", ")}`,
    `Contexto de tipo disponible: ${trimForPrompt(buildTypeDescriptionsPrompt(types), 1200)}`,
    `Contexto de subtipo disponible: ${trimForPrompt(buildSubtypeDescriptionsPrompt(subtypes), 1200)}`,
    `Compatibilidad por tipo (resumen): ${buildCompatibilityPromptSnippet(policyByType)}`,
    `Matriz de configuración vigente (tipo|subtipo|prioridad|tipo_correo|requisito): ${trimForPrompt(buildCampaignMatrixPromptSnippet(normalizedMatrixRows), 3500)}`,
    "Regla: si propones un subtipo no compatible con el tipo, corrige y elige uno compatible.",
    `Objetivo de campaña (usuario): ${trimForPrompt(intentText, 700)}`,
  ].join("\n\n");

  const messageRes = await api.post("/api/chatbot/messages", {
    sessionId,
    message: toChatbotSafeMessage(aiInstruction),
    useContext: false,
    featureCode: "chatbot.assistant",
  });

  const jobId = String(messageRes?.data?.jobId || "").trim();
  if (!jobId) {
    throw new Error("No fue posible iniciar la sugerencia IA");
  }

  await waitForChatbotJobCompletion({
    jobId,
    failedMessage: "No fue posible obtener sugerencia IA",
    timeoutMessage: "La sugerencia IA tardó demasiado en responder",
  });

  let parsed = null;
  try {
    parsed = await ensureParsedJsonFromSession({
      sessionId,
      schemaExample:
        '{"tipo_campana":"...","subtipo_campana":"...","sub_etapa":"...","razon":"...","contexto":"...","ejemplos":["...","...","..."]}',
      failedMessage: "No fue posible procesar la salida de sugerencia IA",
      timeoutMessage: "La recuperación de formato IA tardó demasiado",
      recoveryContext:
        "Corrige formato y respeta coherencia entre sub_etapa, tipo_campana y subtipo_campana. También devuelve contexto y ejemplos.",
      plainTextFallbackExtractor: (rawText) =>
        extractSuggestionFromPlainText({
          rawText,
          availableTypes: types,
          availableSubtypes: subtypes,
          policyByType,
        }),
    });
  } catch {
    const labeledText = await requestLabeledTextRecovery({
      sessionId,
      instruction: [
        "Último intento de formato.",
        "Responde SOLO con estas líneas y nada más:",
        "TIPO: <valor exacto del catálogo>",
        "SUBTIPO: <valor exacto del catálogo>",
        "SUB_ETAPA: <valor>",
        "RAZON: <texto breve>",
      ].join("\n"),
      failedMessage:
        "No fue posible recuperar sugerencia IA en formato etiquetado",
      timeoutMessage: "La recuperación etiquetada IA tardó demasiado",
    });

    parsed = extractSuggestionFromPlainText({
      rawText: labeledText,
      availableTypes: types,
      availableSubtypes: subtypes,
      policyByType,
    });

    if (!parsed || typeof parsed !== "object") {
      parsed = await requestMinimalSuggestionFallback({
        intentText,
        availableTypes: types,
        availableSubtypes: subtypes,
        policyByType,
      });
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("No fue posible recuperar sugerencia IA válida");
    }
  }

  const suggestedType = String(
    parsed?.tipo_campana || parsed?.tipo || parsed?.campaignType || "",
  ).trim();
  const suggestedSubtype = String(
    parsed?.subtipo_campana || parsed?.subtipo || parsed?.campaignSubtype || "",
  ).trim();
  const suggestedSubStage = String(
    parsed?.sub_etapa || parsed?.subEtapa || parsed?.stage || "",
  )
    .trim()
    .toLowerCase();
  const suggestionReason = String(
    parsed?.razon || parsed?.reason || parsed?.justificacion || "",
  ).trim();
  const suggestionContext = String(
    parsed?.contexto || parsed?.context || "",
  ).trim();
  const suggestionExamplesRaw = Array.isArray(parsed?.ejemplos)
    ? parsed.ejemplos
    : Array.isArray(parsed?.examples)
      ? parsed.examples
      : [];
  const suggestionExamples = suggestionExamplesRaw
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!types.includes(suggestedType)) {
    throw new Error("IA devolvió un tipo de campaña inválido");
  }

  const compatibleSubtypeEntries = getCompatibleSubtypeOptions(
    policyByType,
    subtypes,
    suggestedType,
  );
  const allowedSubtypes = compatibleSubtypeEntries.map((entry) => entry.value);
  if (!allowedSubtypes.includes(suggestedSubtype)) {
    throw new Error("IA devolvió un subtipo incompatible con el tipo sugerido");
  }
  if (
    matrixCombinationSet.size > 0 &&
    !matrixCombinationSet.has(`${suggestedType}::${suggestedSubtype}`)
  ) {
    throw new Error(
      "IA devolvió una combinación que no existe en la matriz de configuración",
    );
  }

  const stageTypeConstraints = {
    lanzamiento_inicial: ["reconocimiento", "captacion_de_leads"],
    activacion_trafico: ["reconocimiento", "captacion_de_leads"],
    conversion_en_landing: ["captacion_de_leads"],
    recuperacion_abandono: ["captacion_de_leads", "nutricion"],
    entrega_confirmacion: ["nutricion", "fidelizacion"],
    seguimiento_valor: ["nutricion", "fidelizacion"],
    nutricion_temprana: ["nutricion"],
    conversion_comercial: ["conversion"],
  };

  const allowedTypesByStage = stageTypeConstraints[suggestedSubStage] || null;
  if (allowedTypesByStage && !allowedTypesByStage.includes(suggestedType)) {
    const coherenceRecovery = await requestStrictJsonRecovery({
      sessionId,
      schemaExample:
        '{"tipo_campana":"...","subtipo_campana":"...","sub_etapa":"...","razon":"...","contexto":"...","ejemplos":["...","...","..."]}',
      failedMessage: "No fue posible corregir coherencia en sugerencia IA",
      timeoutMessage: "La corrección de coherencia IA tardó demasiado",
      extraInstruction: `Corrige la coherencia: para sub_etapa='${suggestedSubStage}', tipo_campana='${suggestedType}' no es válido. Devuelve una combinación coherente entre sub_etapa, tipo_campana y subtipo_campana con justificación breve. También regenera contexto y ejemplos coherentes con la combinación corregida.`,
    });

    const coherentType = String(
      coherenceRecovery?.tipo_campana ||
        coherenceRecovery?.tipo ||
        coherenceRecovery?.campaignType ||
        "",
    ).trim();
    const coherentSubtype = String(
      coherenceRecovery?.subtipo_campana ||
        coherenceRecovery?.subtipo ||
        coherenceRecovery?.campaignSubtype ||
        "",
    ).trim();
    const coherentSubStage = String(
      coherenceRecovery?.sub_etapa ||
        coherenceRecovery?.subEtapa ||
        coherenceRecovery?.stage ||
        "",
    )
      .trim()
      .toLowerCase();
    const coherentReason = String(
      coherenceRecovery?.razon ||
        coherenceRecovery?.reason ||
        coherenceRecovery?.justificacion ||
        "",
    ).trim();
    const coherentContext = String(
      coherenceRecovery?.contexto || coherenceRecovery?.context || "",
    ).trim();
    const coherentExamplesRaw = Array.isArray(coherenceRecovery?.ejemplos)
      ? coherenceRecovery.ejemplos
      : Array.isArray(coherenceRecovery?.examples)
        ? coherenceRecovery.examples
        : [];
    const coherentExamples = coherentExamplesRaw
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 5);

    if (!types.includes(coherentType)) {
      throw new Error(
        "IA devolvió un tipo de campaña inválido tras corrección",
      );
    }

    const coherentSubtypeEntries = getCompatibleSubtypeOptions(
      policyByType,
      subtypes,
      coherentType,
    );
    const allowedCoherentSubtypes = coherentSubtypeEntries.map(
      (entry) => entry.value,
    );
    if (!allowedCoherentSubtypes.includes(coherentSubtype)) {
      throw new Error(
        "IA devolvió un subtipo incompatible tras corrección de coherencia",
      );
    }
    if (
      matrixCombinationSet.size > 0 &&
      !matrixCombinationSet.has(`${coherentType}::${coherentSubtype}`)
    ) {
      throw new Error(
        "IA devolvió una combinación fuera de la matriz tras corrección de coherencia",
      );
    }

    const coherentAllowedTypes = stageTypeConstraints[coherentSubStage] || null;
    if (coherentAllowedTypes && !coherentAllowedTypes.includes(coherentType)) {
      throw new Error(
        "La sugerencia IA sigue incoherente entre sub-etapa y tipo de campaña",
      );
    }

    return {
      tipo_campana: coherentType,
      subtipo_campana: coherentSubtype,
      razon: coherentReason || suggestionReason,
      context: coherentContext,
      examples: coherentExamples,
      raw_response: String(
        (await fetchLatestAssistantMessageFromSession(sessionId))?.content ||
          "",
      ).trim(),
    };
  }

  return {
    tipo_campana: suggestedType,
    subtipo_campana: suggestedSubtype,
    razon: suggestionReason,
    context: suggestionContext,
    examples: suggestionExamples,
    raw_response: String(
      (await fetchLatestAssistantMessageFromSession(sessionId))?.content || "",
    ).trim(),
  };
}

async function requestClassificationGuideEnrichmentWithAi({
  tipoCampana,
  subtipoCampana,
  campaignGoalText,
}) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();

  if (!tipo || !subtipo) {
    throw new Error("No hay combinación tipo/subtipo para analizar con IA");
  }

  const sessionRes = await api.post("/api/chatbot/sessions", {
    locale: "es",
    userContext: {
      module: "campaigns",
      objective: "enrich_campaign_context_examples",
      tipoCampana: tipo,
      subtipoCampana: subtipo,
    },
  });

  const sessionId = String(sessionRes?.data?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("No fue posible crear sesión IA para enriquecer guía");
  }

  const aiInstruction = [
    "Eres experto en campañas comerciales B2B y redacción didáctica.",
    "Tu tarea es construir desde cero una guía de contexto y ejemplos SIN contradecir la combinación seleccionada.",
    "Mantén tono claro, específico y accionable; evita generalidades.",
    "Responde exclusivamente JSON válido con esta estructura:",
    '{"tipo_campana":"...","subtipo_campana":"...","contexto":"...","ejemplos":["...","...","..."]}',
    "Reglas obligatorias:",
    "- contexto entre 300 y 900 caracteres",
    "- ejemplos entre 3 y 5 items",
    "- cada ejemplo debe ser simple y fácil de entender",
    "- no inventar códigos ni cambiar tipo/subtipo",
    `Tipo seleccionado: ${tipo}`,
    `Subtipo seleccionado: ${subtipo}`,
    `Objetivo libre del usuario: ${trimForPrompt(campaignGoalText, 700) || "(sin texto adicional)"}`,
    "Construye contexto y ejemplos nuevos, concretos y coherentes con el objetivo.",
  ].join("\n\n");

  const messageRes = await api.post("/api/chatbot/messages", {
    sessionId,
    message: toChatbotSafeMessage(aiInstruction),
    useContext: false,
    featureCode: "chatbot.assistant",
  });

  const jobId = String(messageRes?.data?.jobId || "").trim();
  if (!jobId) {
    throw new Error("No fue posible iniciar enriquecimiento IA");
  }

  await waitForChatbotJobCompletion({
    jobId,
    failedMessage: "No fue posible enriquecer contexto y ejemplos con IA",
    timeoutMessage: "El enriquecimiento IA tardó demasiado en responder",
  });

  let parsed = null;
  try {
    parsed = await ensureParsedJsonFromSession({
      sessionId,
      schemaExample:
        '{"tipo_campana":"...","subtipo_campana":"...","contexto":"...","ejemplos":["...","...","..."]}',
      failedMessage: "No fue posible procesar la salida de enriquecimiento IA",
      timeoutMessage: "La recuperación de formato IA tardó demasiado",
      recoveryContext:
        "Corrige formato y devuelve contexto + ejemplos totalmente útiles y coherentes con la combinación indicada.",
      plainTextFallbackExtractor: (rawText) =>
        extractGuideFromPlainText({
          rawText,
          tipoCampana: tipo,
          subtipoCampana: subtipo,
        }),
    });
  } catch {
    const labeledText = await requestLabeledTextRecovery({
      sessionId,
      instruction: [
        "Último intento de formato.",
        "Responde SOLO con estas líneas y nada más:",
        "TIPO: <valor exacto>",
        "SUBTIPO: <valor exacto>",
        "CONTEXTO: <texto entre 300 y 900 caracteres>",
        "EJEMPLO_1: <texto>",
        "EJEMPLO_2: <texto>",
        "EJEMPLO_3: <texto>",
      ].join("\n"),
      failedMessage:
        "No fue posible recuperar enriquecimiento IA en formato etiquetado",
      timeoutMessage: "La recuperación etiquetada IA tardó demasiado",
    });

    parsed = extractGuideFromPlainText({
      rawText: labeledText,
      tipoCampana: tipo,
      subtipoCampana: subtipo,
    });

    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        "No fue posible recuperar una guía IA válida tras todos los intentos",
      );
    }
  }

  const enrichedContext = String(
    parsed?.contexto || parsed?.context || "",
  ).trim();
  const parsedTipo = String(
    parsed?.tipo_campana || parsed?.tipoCampana || "",
  ).trim();
  const parsedSubtipo = String(
    parsed?.subtipo_campana || parsed?.subtipoCampana || "",
  ).trim();
  const enrichedExamplesRaw = Array.isArray(parsed?.ejemplos)
    ? parsed.ejemplos
    : Array.isArray(parsed?.examples)
      ? parsed.examples
      : [];
  const enrichedExamples = enrichedExamplesRaw
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!enrichedContext || enrichedContext.length < 80) {
    throw new Error("La IA devolvió un contexto demasiado corto");
  }
  if (enrichedExamples.length < 3) {
    throw new Error("La IA devolvió pocos ejemplos útiles");
  }
  if (parsedTipo && parsedTipo !== tipo) {
    throw new Error("La IA devolvió una guía para otro tipo de campaña");
  }
  if (parsedSubtipo && parsedSubtipo !== subtipo) {
    throw new Error("La IA devolvió una guía para otro subtipo de campaña");
  }

  return {
    tipo_campana: tipo,
    subtipo_campana: subtipo,
    context: enrichedContext,
    examples: enrichedExamples,
    raw_response: String(
      (await fetchLatestAssistantMessageFromSession(sessionId))?.content || "",
    ).trim(),
  };
}

export default function CampaignsPage() {
  const [audienceSortMode, setAudienceSortMode] = useState("name_asc");
  const [audienceOwnerFilter, setAudienceOwnerFilter] = useState("");
  const [audienceAccountNameFilter, setAudienceAccountNameFilter] =
    useState("");
  const [audienceAccountTypeFilter, setAudienceAccountTypeFilter] =
    useState("");
  const [catalogs, setCatalogs] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [campaignAccounts, setCampaignAccounts] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignForm, setCampaignForm] = useState(EMPTY_FORM);
  const accountForm = EMPTY_ACCOUNT_FORM;
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isLoadingCampaignAccounts, setIsLoadingCampaignAccounts] =
    useState(false);
  const [isLoadingSuggestedAccounts, setIsLoadingSuggestedAccounts] =
    useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [suggestedAccounts, setSuggestedAccounts] = useState([]);
  const [suggestedAccountsRuleSummary, setSuggestedAccountsRuleSummary] =
    useState("");
  const [suggestedAccountsError, setSuggestedAccountsError] = useState("");
  const [selectedAudienceAccountIds, setSelectedAudienceAccountIds] = useState(
    [],
  );
  const [manuallyAddedAudienceAccountIds, setManuallyAddedAudienceAccountIds] =
    useState([]);
  const [
    removedAudienceContactsByAccount,
    setRemovedAudienceContactsByAccount,
  ] = useState({});
  const [isAddAccountsModalOpen, setIsAddAccountsModalOpen] = useState(false);
  const [addAccountsSearchText, setAddAccountsSearchText] = useState("");
  const [pendingAddAccountIds, setPendingAddAccountIds] = useState([]);
  const [isAddContactsModalOpen, setIsAddContactsModalOpen] = useState(false);
  const [addContactsAccountId, setAddContactsAccountId] = useState(null);
  const [addContactsSearchText, setAddContactsSearchText] = useState("");
  const [pendingAddContactIds, setPendingAddContactIds] = useState([]);
  const [isLoadingAddContacts, setIsLoadingAddContacts] = useState(false);
  const [addContactsError, setAddContactsError] = useState("");
  const [isConfirmRemoveContactModalOpen, setIsConfirmRemoveContactModalOpen] =
    useState(false);
  const [pendingRemoveContact, setPendingRemoveContact] = useState({
    accountId: null,
    contactId: null,
  });
  const [isConfirmRemoveAccountModalOpen, setIsConfirmRemoveAccountModalOpen] =
    useState(false);
  const [pendingRemoveAccountId, setPendingRemoveAccountId] = useState(null);
  const [accountContactsByAccountId, setAccountContactsByAccountId] = useState(
    {},
  );
  const [manuallyAddedContactsByAccount, setManuallyAddedContactsByAccount] =
    useState({});
  const [
    suggestedContactsByManualAccount,
    setSuggestedContactsByManualAccount,
  ] = useState({});
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [campaignGoalText, setCampaignGoalText] = useState("");
  const [aiSuggestionReason, setAiSuggestionReason] = useState("");
  const [isSuggestingCombination, setIsSuggestingCombination] = useState(false);
  const [classificationGuideAi, setClassificationGuideAi] = useState(null);
  const [classificationGuideAiSource, setClassificationGuideAiSource] =
    useState(null);
  const [isEnrichingClassificationGuide, setIsEnrichingClassificationGuide] =
    useState(false);
  const [classificationGuideFallbackNote, setClassificationGuideFallbackNote] =
    useState("");
  const [executionTab, setExecutionTab] = useState("landing");
  const [selectedAccountTypeFilters, setSelectedAccountTypeFilters] = useState(
    [],
  );
  const [accountTypeFiltersInitialized, setAccountTypeFiltersInitialized] =
    useState(false);
  const [selectedSectorFilters, setSelectedSectorFilters] = useState([]);
  const [sectorFiltersInitialized, setSectorFiltersInitialized] =
    useState(false);
  const [preferSavedAudienceSelection, setPreferSavedAudienceSelection] =
    useState(true);

  const selectedCampaign = useMemo(() => {
    return (
      campaigns.find((campaign) => campaign.id === selectedCampaignId) || null
    );
  }, [campaigns, selectedCampaignId]);

  useEffect(() => {
    if (selectedCampaignId) {
      setCampaignGoalText(
        String(
          selectedCampaign?.campaign_goal_text ||
            selectedCampaign?.description ||
            "",
        ).trim(),
      );
      return;
    }

    setCampaignGoalText("");
  }, [
    selectedCampaign?.campaign_goal_text,
    selectedCampaign?.description,
    selectedCampaignId,
  ]);

  useEffect(() => {
    if (!selectedCampaignId) {
      // For new unsaved campaigns, keep the in-memory IA guide generated in this session.
      return;
    }

    const persistedGuide = normalizeClassificationGuideFromDb(selectedCampaign);
    const currentType = String(campaignForm.tipo_campana || "").trim();
    const currentSubtype = String(campaignForm.subtipo_campana || "").trim();

    if (
      isCampaignGuideConsistent(persistedGuide, currentType, currentSubtype)
    ) {
      setClassificationGuideAi(persistedGuide);
      setClassificationGuideAiSource(persistedGuide);
      setClassificationGuideFallbackNote("");
      return;
    }

    if (
      !isCampaignGuideConsistent(
        classificationGuideAi,
        currentType,
        currentSubtype,
      )
    ) {
      setClassificationGuideAi(null);
      setClassificationGuideAiSource(null);
      setClassificationGuideFallbackNote("");
    }
  }, [
    classificationGuideAi,
    campaignForm.subtipo_campana,
    campaignForm.tipo_campana,
    selectedCampaign,
    selectedCampaignId,
  ]);

  const selectedTypeDescription =
    CAMPAIGN_TYPE_DESCRIPTIONS[campaignForm.tipo_campana] ||
    "Selecciona el objetivo principal de la campana.";
  const selectedSubtypeDescription =
    CAMPAIGN_SUBTYPE_DESCRIPTIONS[campaignForm.subtipo_campana] ||
    "Selecciona el canal o formato principal de ejecucion de la campana.";
  const selectedClassificationUsageGuide = useMemo(
    () => ({
      context: String(classificationGuideAi?.context || "").trim(),
      examples: Array.isArray(classificationGuideAi?.examples)
        ? classificationGuideAi.examples
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : [],
    }),
    [classificationGuideAi],
  );
  const compatibilityPolicyByType =
    catalogs?.compatibilidad_tipo_subtipo?.por_tipo || {};
  const campaignMatrixRows = Array.isArray(catalogs?.campaign_matrix_rows)
    ? catalogs.campaign_matrix_rows
    : [];
  const compatibleSubtypeOptions = useMemo(
    () =>
      getCompatibleSubtypeOptions(
        compatibilityPolicyByType,
        catalogs?.subtipo_campana,
        campaignForm.tipo_campana,
      ),
    [
      catalogs?.subtipo_campana,
      campaignForm.tipo_campana,
      compatibilityPolicyByType,
    ],
  );
  const visibleCampaignStates = catalogs?.estado_campana || [];
  const savedCampaignAccountIds = useMemo(() => {
    return campaignAccounts
      .map((item) => Number(item.account_id || 0))
      .filter((accountId) => Number.isInteger(accountId) && accountId > 0);
  }, [campaignAccounts]);
  const selectedLifecycleFilters = useMemo(
    () => normalizeLifecycleFilterList(campaignForm.audience_lifecycle_filters),
    [campaignForm.audience_lifecycle_filters],
  );
  const selectedStateDescription =
    CAMPAIGN_STATE_DESCRIPTIONS[campaignForm.estado_campana] ||
    "Selecciona el estado operativo actual de la campana.";
  const selectedLifecycleDescription = selectedLifecycleFilters.length
    ? `${selectedLifecycleFilters.length} etapas seleccionadas para definir la audiencia objetivo.`
    : "Selecciona una o varias etapas objetivo que quieres mover con esta campana.";
  const selectedAudienceLifecycleDescription = selectedLifecycleFilters.length
    ? selectedLifecycleFilters
        .map(
          (stage) =>
            CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS[stage] ||
            "Filtra cuentas segun la regla de etapa seleccionada.",
        )
        .join(" | ")
    : "Sin filtros de audiencia no se muestran cuentas ni contactos sugeridos.";
  const selectedAudienceLifecycleLabel = selectedLifecycleFilters.length
    ? selectedLifecycleFilters.map((stage) => formatCampaignTypeLabel(stage)).join(", ")
    : "Sin definir";
  const accountTypeOptions = useMemo(() => {
    const catalogTypes = Array.isArray(catalogs?.account_types)
      ? catalogs.account_types
      : [];
    const accountTypesInAccounts = accounts
      .map((account) => String(account?.account_type || "").trim())
      .filter(Boolean);
    const unique = Array.from(
      new Set([...catalogTypes, ...accountTypesInAccounts]),
    );
    return unique.sort((first, second) =>
      first.localeCompare(second, "es", {
        sensitivity: "base",
      }),
    );
  }, [accounts, catalogs?.account_types]);
  const selectedAccountTypeFilterSet = useMemo(() => {
    return new Set(
      selectedAccountTypeFilters
        .map((accountType) => String(accountType || "").trim())
        .filter(Boolean),
    );
  }, [selectedAccountTypeFilters]);
  useEffect(() => {
    if (accountTypeFiltersInitialized) return;
    if (!accountTypeOptions.length) return;

    const preferredTypes = new Set([
      "potencial",
      "principal",
      "prospecto",
      "puntual",
      "otro",
    ]);

    const defaultSelection = accountTypeOptions.filter((accountType) =>
      preferredTypes.has(normalizeClassificationValue(accountType)),
    );

    setSelectedAccountTypeFilters(
      defaultSelection.length ? defaultSelection : accountTypeOptions,
    );
    setAccountTypeFiltersInitialized(true);
  }, [accountTypeFiltersInitialized, accountTypeOptions]);
  const sectorOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        accounts
          .map((account) => String(account?.economic_sector || "").trim())
          .filter(Boolean),
      ),
    );
    return unique.sort((first, second) =>
      first.localeCompare(second, "es", {
        sensitivity: "base",
      }),
    );
  }, [accounts]);
  const selectedSectorFilterSet = useMemo(() => {
    return new Set(
      selectedSectorFilters
        .map((sector) => String(sector || "").trim())
        .filter(Boolean),
    );
  }, [selectedSectorFilters]);
  useEffect(() => {
    if (sectorFiltersInitialized) return;
    if (!sectorOptions.length) return;

    setSelectedSectorFilters(sectorOptions);
    setSectorFiltersInitialized(true);
  }, [sectorFiltersInitialized, sectorOptions]);
  const accountSectorById = useMemo(() => {
    const map = new Map();
    accounts.forEach((account) => {
      const accountId = Number(account?.id || 0);
      if (!Number.isInteger(accountId) || accountId <= 0) return;
      map.set(accountId, String(account?.economic_sector || "").trim());
    });
    return map;
  }, [accounts]);
  const accountTypeById = useMemo(() => {
    const map = new Map();
    accounts.forEach((account) => {
      const accountId = Number(account?.id || 0);
      if (!Number.isInteger(accountId) || accountId <= 0) return;
      map.set(accountId, String(account?.account_type || "").trim());
    });
    return map;
  }, [accounts]);
  const filteredAudienceAccounts = useMemo(() => {
    if (!selectedLifecycleFilters.length) {
      return [];
    }

    // Cuando hay etapa seleccionada, incluir sugeridas + cuentas agregadas manualmente
    const suggestedAccountIds = new Set(
      suggestedAccounts
        .map((acc) => Number(acc.account_id || 0))
        .filter((id) => Number.isInteger(id) && id > 0),
    );

    // Agregar cuentas manualmente seleccionadas que no fueron sugeridas
    const manuallyAddedIds = manuallyAddedAudienceAccountIds
      .map((id) => Number(id || 0))
      .filter(
        (id) => Number.isInteger(id) && id > 0 && !suggestedAccountIds.has(id),
      );

    const manuallyAddedAccounts = manuallyAddedIds
      .map((accountId) => {
        const account = accounts.find((acc) => Number(acc.id) === accountId);
        if (!account) return null;
        return {
          account_id: accountId,
          account_name: String(account.name || "").trim(),
          owners_display: account.owners_display || "",
          economic_sector: String(account.economic_sector || "").trim(),
          total_opportunities: null,
          open_opportunities: null,
          won_opportunities: null,
          audience_stage_codes: ["manual"],
          contacts: suggestedContactsByManualAccount[accountId] || [],
        };
      })
      .filter(Boolean);

    return [...suggestedAccounts, ...manuallyAddedAccounts];
  }, [
    selectedLifecycleFilters,
    accounts,
    suggestedAccounts,
    manuallyAddedAudienceAccountIds,
    suggestedContactsByManualAccount,
  ]);
  const filteredAudienceAccountsBySector = useMemo(() => {
    if (!selectedSectorFilterSet.size) {
      return filteredAudienceAccounts;
    }

    return filteredAudienceAccounts.filter((item) => {
      const accountId = Number(item?.account_id || 0);
      const sector = String(
        item?.economic_sector || accountSectorById.get(accountId) || "",
      ).trim();
      return selectedSectorFilterSet.has(sector);
    });
  }, [accountSectorById, filteredAudienceAccounts, selectedSectorFilterSet]);
  const filteredAudienceAccountsByClassification = useMemo(() => {
    if (!selectedAccountTypeFilterSet.size) {
      return filteredAudienceAccountsBySector;
    }

    return filteredAudienceAccountsBySector.filter((item) => {
      const accountId = Number(item?.account_id || 0);
      const accountType = String(
        item?.account_type || accountTypeById.get(accountId) || "",
      ).trim();
      return selectedAccountTypeFilterSet.has(accountType);
    });
  }, [
    accountTypeById,
    filteredAudienceAccountsBySector,
    selectedAccountTypeFilterSet,
  ]);
  const suggestedContactsCount = useMemo(() => {
    return filteredAudienceAccountsByClassification.reduce((total, item) => {
      const accountId = Number(item.account_id || 0);
      const removedContactIds =
        removedAudienceContactsByAccount[accountId] || [];
      const mergedById = new Map();

      (Array.isArray(item.contacts) ? item.contacts : []).forEach((contact) => {
        const normalized = normalizeAudienceContact(contact);
        if (!normalized) return;
        mergedById.set(Number(normalized.contact_id), normalized);
      });

      (Array.isArray(manuallyAddedContactsByAccount[accountId])
        ? manuallyAddedContactsByAccount[accountId]
        : []
      ).forEach((contact) => {
        const normalized = normalizeAudienceContact(contact);
        if (!normalized) return;
        mergedById.set(Number(normalized.contact_id), normalized);
      });

      const visibleContacts = Array.from(mergedById.values()).filter(
        (contact) => !removedContactIds.includes(Number(contact.contact_id || 0)),
      );

      return total + visibleContacts.length;
    }, 0);
  }, [
    filteredAudienceAccountsByClassification,
    manuallyAddedContactsByAccount,
    removedAudienceContactsByAccount,
  ]);
  const filteredAudienceAccountsById = useMemo(() => {
    const map = new Map();
    filteredAudienceAccountsByClassification.forEach((item) => {
      const accountId = Number(item.account_id || 0);
      if (Number.isInteger(accountId) && accountId > 0) {
        map.set(accountId, item);
      }
    });
    return map;
  }, [filteredAudienceAccountsByClassification]);
  const accountsById = useMemo(() => {
    const map = new Map();
    accounts.forEach((account) => {
      const accountId = Number(account.id || 0);
      if (Number.isInteger(accountId) && accountId > 0) {
        map.set(accountId, {
          account_id: accountId,
          account_name: String(account.name || "").trim(),
          economic_sector: String(account.economic_sector || "").trim(),
          total_opportunities: null,
          open_opportunities: null,
          won_opportunities: null,
          contacts: [],
        });
      }
    });
    return map;
  }, [accounts]);
  const campaignAccountsById = useMemo(() => {
    const map = new Map();
    campaignAccounts.forEach((item) => {
      const accountId = Number(item.account_id || 0);
      if (Number.isInteger(accountId) && accountId > 0) {
        map.set(accountId, item);
      }
    });
    return map;
  }, [campaignAccounts]);
  const visibleAudienceAccounts = useMemo(() => {
    const selectedUniqueIds = Array.from(
      new Set(
        selectedAudienceAccountIds
          .map((accountId) => Number(accountId || 0))
          .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
      ),
    );

    const filteredSelectedIds = selectedUniqueIds.filter((accountId) =>
      filteredAudienceAccountsById.has(accountId),
    );

    return filteredSelectedIds
      .map((accountId) => {
        const savedAccount = campaignAccountsById.get(accountId);
        const suggestedAccount = filteredAudienceAccountsById.get(accountId);
        const accountCatalog = accountsById.get(accountId);
        if (savedAccount || suggestedAccount || accountCatalog) {
          const mergedContactsById = new Map();
          [
            ...(Array.isArray(suggestedAccount?.contacts)
              ? suggestedAccount.contacts
              : []),
            ...(Array.isArray(savedAccount?.contacts)
              ? savedAccount.contacts
              : []),
            ...(Array.isArray(accountCatalog?.contacts)
              ? accountCatalog.contacts
              : []),
          ].forEach((contact) => {
            const normalizedContact = normalizeAudienceContact(contact);
            if (!normalizedContact) return;
            mergedContactsById.set(
              Number(normalizedContact.contact_id),
              normalizedContact,
            );
          });

          return {
            ...(accountCatalog || {}),
            ...(suggestedAccount || {}),
            ...(savedAccount || {}),
            economic_sector: String(
              savedAccount?.economic_sector ||
                suggestedAccount?.economic_sector ||
                accountCatalog?.economic_sector ||
                "",
            ).trim(),
            contacts: Array.from(mergedContactsById.values()),
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [
    selectedAudienceAccountIds,
    campaignAccountsById,
    filteredAudienceAccountsById,
    accountsById,
  ]);
  const availableAccountsBase = useMemo(() => {
    const selectedSet = new Set(
      selectedAudienceAccountIds
        .map((accountId) => Number(accountId || 0))
        .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
    );

    return accounts
      .filter((account) => isActiveAccount(account))
      .map((account) => ({
        account_id: Number(account.id || 0),
        account_name: String(account.name || "").trim(),
        account_type: String(account.account_type || "").trim(),
        owners_display: String(account.owners_display || "").trim(),
      }))
      .filter(
        (account) =>
          Number.isInteger(account.account_id) &&
          account.account_id > 0 &&
          account.account_name &&
          !selectedSet.has(account.account_id),
      )
      .filter((account) => {
        if (!selectedSectorFilterSet.size) return true;
        const accountId = account.account_id;
        const sector = String(accountSectorById.get(accountId) || "").trim();
        return selectedSectorFilterSet.has(sector);
      })
      .filter((account) => {
        if (!selectedAccountTypeFilterSet.size) return true;
        const accountId = account.account_id;
        const accountType = String(accountTypeById.get(accountId) || "").trim();
        return selectedAccountTypeFilterSet.has(accountType);
      })
      .sort((first, second) =>
        first.account_name.localeCompare(second.account_name, "es", {
          sensitivity: "base",
        }),
      );
  }, [
    accounts,
    selectedAudienceAccountIds,
    accountSectorById,
    accountTypeById,
    selectedSectorFilterSet,
    selectedAccountTypeFilterSet,
  ]);
  const availableAccountsToAdd = useMemo(() => {
    const query = String(addAccountsSearchText || "")
      .trim()
      .toLowerCase();
    if (!query) return availableAccountsBase;

    return availableAccountsBase.filter((item) =>
      String(item.account_name || "")
        .trim()
        .toLowerCase()
        .includes(query),
    );
  }, [addAccountsSearchText, availableAccountsBase]);
  const visibleContactsByAccountId = useMemo(() => {
    const map = new Map();

    visibleAudienceAccounts.forEach((item) => {
      const accountId = Number(item.account_id || 0);
      if (!Number.isInteger(accountId) || accountId <= 0) return;

      const baseContacts = Array.isArray(item.contacts)
        ? item.contacts.map((contact) => normalizeAudienceContact(contact))
        : [];
      const manualContacts = Array.isArray(
        manuallyAddedContactsByAccount[accountId],
      )
        ? manuallyAddedContactsByAccount[accountId].map((contact) =>
            normalizeAudienceContact(contact),
          )
        : [];
      const merged = [...baseContacts, ...manualContacts].filter(Boolean);
      const byId = new Map();
      merged.forEach((contact) => {
        byId.set(Number(contact.contact_id), contact);
      });

      const removedSet = new Set(
        (removedAudienceContactsByAccount[accountId] || []).map((contactId) =>
          Number(contactId || 0),
        ),
      );
      const visible = Array.from(byId.values()).filter(
        (contact) => !removedSet.has(Number(contact.contact_id || 0)),
      );
      map.set(accountId, visible);
    });

    return map;
  }, [
    manuallyAddedContactsByAccount,
    removedAudienceContactsByAccount,
    visibleAudienceAccounts,
  ]);
  const visibleAudienceAccountsWithContacts = useMemo(() => {
    return visibleAudienceAccounts.filter((item) => {
      const accountId = Number(item.account_id || 0);
      if (!Number.isInteger(accountId) || accountId <= 0) return false;
      return (visibleContactsByAccountId.get(accountId) || []).length > 0;
    });
  }, [visibleAudienceAccounts, visibleContactsByAccountId]);
  const uniqueOwnersInAudience = useMemo(() => {
    const owners = new Set();
    visibleAudienceAccounts.forEach((account) => {
      const ownerNames = String(account.owners_display || "").trim();
      if (ownerNames) {
        owners.add(ownerNames);
      }
    });
    return Array.from(owners).sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" }),
    );
  }, [visibleAudienceAccounts]);
  const uniqueAccountTypesInAudience = useMemo(() => {
    const accountTypes = new Set();

    visibleAudienceAccounts.forEach((account) => {
      const accountId = Number(account.account_id || 0);
      const accountType = String(
        account.account_type || accountTypeById.get(accountId) || "",
      ).trim();
      if (accountType) {
        accountTypes.add(accountType);
      }
    });

    return Array.from(accountTypes).sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" }),
    );
  }, [accountTypeById, visibleAudienceAccounts]);
  const filteredByOwnerAudienceAccounts = useMemo(() => {
    if (!audienceOwnerFilter) return visibleAudienceAccounts;
    return visibleAudienceAccounts.filter((account) => {
      const ownerNames = String(account.owners_display || "").trim();
      return ownerNames === audienceOwnerFilter;
    });
  }, [visibleAudienceAccounts, audienceOwnerFilter]);
  const filteredByNameAudienceAccounts = useMemo(() => {
    const query = String(audienceAccountNameFilter || "")
      .trim()
      .toLowerCase();
    if (!query) return filteredByOwnerAudienceAccounts;

    return filteredByOwnerAudienceAccounts.filter((account) =>
      String(account.account_name || "")
        .trim()
        .toLowerCase()
        .includes(query),
    );
  }, [audienceAccountNameFilter, filteredByOwnerAudienceAccounts]);
  const filteredByTypeAudienceAccounts = useMemo(() => {
    if (!audienceAccountTypeFilter) return filteredByNameAudienceAccounts;

    return filteredByNameAudienceAccounts.filter((account) => {
      const accountId = Number(account.account_id || 0);
      const accountType = String(
        account.account_type || accountTypeById.get(accountId) || "",
      ).trim();
      return accountType === audienceAccountTypeFilter;
    });
  }, [
    accountTypeById,
    audienceAccountTypeFilter,
    filteredByNameAudienceAccounts,
  ]);
  const sortedVisibleAudienceAccounts = useMemo(() => {
    const items = [...filteredByTypeAudienceAccounts];

    items.sort((first, second) => {
      if (audienceSortMode === "name_desc") {
        return String(second.account_name || "").localeCompare(
          String(first.account_name || ""),
          "es",
          { sensitivity: "base" },
        );
      }

      if (audienceSortMode === "sector_asc") {
        const sectorCompare = String(first.economic_sector || "").localeCompare(
          String(second.economic_sector || ""),
          "es",
          { sensitivity: "base" },
        );
        if (sectorCompare !== 0) return sectorCompare;
      }

      if (audienceSortMode === "sector_desc") {
        const sectorCompare = String(
          second.economic_sector || "",
        ).localeCompare(String(first.economic_sector || ""), "es", {
          sensitivity: "base",
        });
        if (sectorCompare !== 0) return sectorCompare;
      }

      return String(first.account_name || "").localeCompare(
        String(second.account_name || ""),
        "es",
        { sensitivity: "base" },
      );
    });

    return items;
  }, [audienceSortMode, filteredByTypeAudienceAccounts]);
  const addContactsAccount = useMemo(() => {
    const targetId = Number(addContactsAccountId || 0);
    if (!targetId) return null;
    return (
      visibleAudienceAccounts.find(
        (item) => Number(item.account_id || 0) === targetId,
      ) || null
    );
  }, [addContactsAccountId, visibleAudienceAccounts]);
  const addContactsAllById = useMemo(() => {
    if (!addContactsAccount) return new Map();

    const accountId = Number(addContactsAccount.account_id || 0);
    const fromSuggested = Array.isArray(addContactsAccount.contacts)
      ? addContactsAccount.contacts
      : [];
    const fromApi = Array.isArray(accountContactsByAccountId[accountId])
      ? accountContactsByAccountId[accountId]
      : [];
    const fromManual = Array.isArray(manuallyAddedContactsByAccount[accountId])
      ? manuallyAddedContactsByAccount[accountId]
      : [];
    const map = new Map();

    [...fromApi, ...fromSuggested, ...fromManual].forEach((contact) => {
      const normalized = normalizeAudienceContact(contact);
      if (!normalized) return;
      map.set(Number(normalized.contact_id), normalized);
    });

    return map;
  }, [
    addContactsAccount,
    accountContactsByAccountId,
    manuallyAddedContactsByAccount,
  ]);
  const availableContactsToAdd = useMemo(() => {
    if (!addContactsAccount) return [];

    const accountId = Number(addContactsAccount.account_id || 0);
    const visibleSet = new Set(
      (visibleContactsByAccountId.get(accountId) || []).map((contact) =>
        Number(contact?.contact_id || 0),
      ),
    );
    const query = String(addContactsSearchText || "")
      .trim()
      .toLowerCase();

    return Array.from(addContactsAllById.values())
      .filter((contact) => !visibleSet.has(Number(contact?.contact_id || 0)))
      .filter((contact) => {
        if (!query) return true;
        const label = String(contact?.contact_name || "").toLowerCase();
        const email = String(contact?.email || "").toLowerCase();
        return label.includes(query) || email.includes(query);
      })
      .sort((first, second) =>
        String(first?.contact_name || "").localeCompare(
          String(second?.contact_name || ""),
          "es",
          { sensitivity: "base" },
        ),
      );
  }, [
    addContactsAllById,
    addContactsAccount,
    addContactsSearchText,
    visibleContactsByAccountId,
  ]);

  useEffect(() => {
    let mounted = true;

    async function loadInitialData() {
      setIsLoadingData(true);
      setError("");

      try {
        const [catalogsResponse, campaignsResponse, accountsResponse] =
          await Promise.all([
            api.get("/api/campaigns/catalogs"),
            api.get("/api/campaigns"),
            api.get("/api/accounts", {
              params: { activeOnly: true },
            }),
          ]);

        if (!mounted) return;

        const catalogsData = catalogsResponse.data || {};
        const campaignsData = Array.isArray(campaignsResponse.data?.items)
          ? campaignsResponse.data.items
          : [];
        const accountsData = Array.isArray(accountsResponse.data)
          ? accountsResponse.data
          : [];

        setCatalogs(catalogsData);
        setCampaigns(campaignsData);
        setAccounts(accountsData.filter((account) => isActiveAccount(account)));

        if (campaignsData.length > 0) {
          const visibleStates = catalogsData.estado_campana || [];
          setSelectedCampaignId(campaignsData[0].id);
          setCampaignForm({
            name: campaignsData[0].name || "",
            description: campaignsData[0].description || "",
            tipo_campana: campaignsData[0].tipo_campana || "",
            subtipo_campana: campaignsData[0].subtipo_campana || "",
            estado_campana: resolveCampaignStateValue(
              campaignsData[0].estado_campana,
              visibleStates,
            ),
            etapa_ciclo_vida: campaignsData[0].etapa_ciclo_vida || "",
            audience_lifecycle_filters: normalizeLifecycleFilterList(
              campaignsData[0].audience_lifecycle_filters?.length
                ? campaignsData[0].audience_lifecycle_filters
                : campaignsData[0].etapa_ciclo_vida
                  ? [campaignsData[0].etapa_ciclo_vida]
                  : [],
            ),
            starts_at: toDateInputValue(campaignsData[0].starts_at),
            ends_at: toDateInputValue(campaignsData[0].ends_at),
          });
          setSelectedAccountTypeFilters(
            normalizeSavedFilterList(
              campaignsData[0].audience_account_type_filters,
            ),
          );
          setSelectedSectorFilters(
            normalizeSavedFilterList(campaignsData[0].audience_sector_filters),
          );
          setAccountTypeFiltersInitialized(true);
          setSectorFiltersInitialized(true);
          const persistedGuide = normalizeClassificationGuideFromDb(
            campaignsData[0],
          );
          setClassificationGuideAi(persistedGuide);
          setClassificationGuideAiSource(persistedGuide);
        }
      } catch (requestError) {
        if (mounted) {
          setError(
            getApiErrorMessage(requestError, "No fue posible cargar campañas"),
          );
        }
      } finally {
        if (mounted) {
          setIsLoadingData(false);
        }
      }
    }

    loadInitialData();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCampaignAccounts() {
      if (!selectedCampaignId) {
        setCampaignAccounts([]);
        return;
      }

      setIsLoadingCampaignAccounts(true);
      setError("");

      try {
        const { data } = await api.get(
          `/api/campaigns/${selectedCampaignId}/accounts`,
        );
        if (!mounted) return;

        setCampaignAccounts(Array.isArray(data?.items) ? data.items : []);
      } catch (requestError) {
        if (mounted) {
          setError(
            getApiErrorMessage(
              requestError,
              "No fue posible cargar la audiencia por cuenta",
            ),
          );
        }
      } finally {
        if (mounted) {
          setIsLoadingCampaignAccounts(false);
        }
      }
    }

    loadCampaignAccounts();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    if (preferSavedAudienceSelection && savedCampaignAccountIds.length > 0) {
      setSelectedAudienceAccountIds(savedCampaignAccountIds);
      return;
    }

    setSelectedAudienceAccountIds(
      filteredAudienceAccountsByClassification
        .map((item) => Number(item.account_id || 0))
        .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
    );
  }, [
    filteredAudienceAccountsByClassification,
    preferSavedAudienceSelection,
    savedCampaignAccountIds,
  ]);

  useEffect(() => {
    setRemovedAudienceContactsByAccount({});
    setManuallyAddedContactsByAccount({});
    setAudienceOwnerFilter("");
    setAudienceAccountNameFilter("");
    setAudienceAccountTypeFilter("");
  }, [campaignForm.audience_lifecycle_filters]);

  useEffect(() => {
    if (isAddAccountsModalOpen) return;
    setAddAccountsSearchText("");
    setPendingAddAccountIds([]);
  }, [isAddAccountsModalOpen]);

  useEffect(() => {
    if (isAddContactsModalOpen) return;
    setAddContactsSearchText("");
    setPendingAddContactIds([]);
    setAddContactsError("");
    setAddContactsAccountId(null);
  }, [isAddContactsModalOpen]);

  useEffect(() => {
    if (!isAddContactsModalOpen) return;
    if (!addContactsAccount) {
      setIsAddContactsModalOpen(false);
    }
  }, [addContactsAccount, isAddContactsModalOpen]);

  useEffect(() => {
    if (!isAddContactsModalOpen) return;
    const accountId = Number(addContactsAccountId || 0);
    if (!Number.isInteger(accountId) || accountId <= 0) return;

    let mounted = true;

    async function loadContactsForAccount() {
      setIsLoadingAddContacts(true);
      setAddContactsError("");

      try {
        const { data } = await api.get("/api/contacts", {
          params: { accountId, activeOnly: true },
        });
        if (!mounted) return;

        const items = Array.isArray(data) ? data : [];
        const normalized = items
          .map((contact) => normalizeAudienceContact(contact))
          .filter(Boolean);

        setAccountContactsByAccountId((previous) => ({
          ...previous,
          [accountId]: normalized,
        }));
      } catch (requestError) {
        if (!mounted) return;
        setAddContactsError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar los contactos de la cuenta",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingAddContacts(false);
        }
      }
    }

    loadContactsForAccount();

    return () => {
      mounted = false;
    };
  }, [addContactsAccountId, isAddContactsModalOpen]);

  useEffect(() => {
    let mounted = true;

    async function loadSuggestedAccountsByLifecycle() {
      const lifecycleStages = normalizeLifecycleFilterList(
        campaignForm.audience_lifecycle_filters,
      );

      if (!lifecycleStages.length) {
        if (mounted) {
          setSuggestedAccounts([]);
          setSuggestedAccountsRuleSummary("");
          setSuggestedAccountsError("");
          setIsLoadingSuggestedAccounts(false);
        }
        return;
      }

      setIsLoadingSuggestedAccounts(true);
      setSuggestedAccountsError("");

      try {
        const responses = await Promise.all(
          lifecycleStages.map((stage) =>
            api.get("/api/campaigns/accounts/suggestions", {
              params: { etapa_ciclo_vida: stage },
            }),
          ),
        );

        if (!mounted) return;

        const mergedByAccountId = new Map();
        const ruleSummaries = [];

        responses.forEach((response) => {
          const data = response?.data || {};
          const items = Array.isArray(data?.items) ? data.items : [];
          const summary = String(data?.ruleSummary || "").trim();
          const stageCode = String(data?.etapa_ciclo_vida || "").trim();
          if (summary) {
            ruleSummaries.push(summary);
          }

          items.forEach((item) => {
            const accountId = Number(item?.account_id || 0);
            if (!Number.isInteger(accountId) || accountId <= 0) {
              return;
            }

            const existing = mergedByAccountId.get(accountId);
            const incomingContacts = Array.isArray(item?.contacts)
              ? item.contacts
              : [];

            if (!existing) {
              const contactMap = new Map();
              incomingContacts.forEach((contact) => {
                const contactId = Number(contact?.contact_id || 0);
                if (!Number.isInteger(contactId) || contactId <= 0) return;
                contactMap.set(contactId, contact);
              });

              mergedByAccountId.set(accountId, {
                ...item,
                contacts: Array.from(contactMap.values()),
                audience_stage_codes: stageCode ? [stageCode] : [],
                _contactMap: contactMap,
              });
              return;
            }

            incomingContacts.forEach((contact) => {
              const contactId = Number(contact?.contact_id || 0);
              if (!Number.isInteger(contactId) || contactId <= 0) return;
              existing._contactMap.set(contactId, contact);
            });

            if (stageCode) {
              const currentStageCodes = Array.isArray(
                existing.audience_stage_codes,
              )
                ? existing.audience_stage_codes
                : [];
              existing.audience_stage_codes = Array.from(
                new Set([...currentStageCodes, stageCode]),
              );
            }

            existing.contacts = Array.from(existing._contactMap.values());
          });
        });

        const mergedItems = Array.from(mergedByAccountId.values()).map(
          (item) => {
            const { _contactMap, ...rest } = item;
            return rest;
          },
        );

        setSuggestedAccounts(mergedItems);
        setSuggestedAccountsRuleSummary(
          Array.from(new Set(ruleSummaries)).join(" | "),
        );
      } catch (requestError) {
        if (!mounted) return;
        setSuggestedAccounts([]);
        setSuggestedAccountsRuleSummary("");
        setSuggestedAccountsError(
          getApiErrorMessage(
            requestError,
            "No fue posible calcular cuentas sugeridas por etapa",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingSuggestedAccounts(false);
        }
      }
    }

    loadSuggestedAccountsByLifecycle();

    return () => {
      mounted = false;
    };
  }, [campaignForm.audience_lifecycle_filters]);

  useEffect(() => {
    const lifecycleStages = normalizeLifecycleFilterList(
      campaignForm.audience_lifecycle_filters,
    );

    if (!lifecycleStages.length) {
      setSuggestedContactsByManualAccount({});
      return;
    }

    let mounted = true;

    async function loadSuggestedContactsForManualAccounts() {
      const suggestedAccountIds = new Set(
        suggestedAccounts
          .map((acc) => Number(acc.account_id || 0))
          .filter((id) => Number.isInteger(id) && id > 0),
      );

      const manuallyAddedIds = selectedAudienceAccountIds
        .map((id) => Number(id || 0))
        .filter(
          (id) =>
            Number.isInteger(id) && id > 0 && !suggestedAccountIds.has(id),
        );

      if (manuallyAddedIds.length === 0) {
        if (mounted) {
          setSuggestedContactsByManualAccount({});
        }
        return;
      }

      try {
        const accountIdsParam = manuallyAddedIds.join(",");
        const responses = await Promise.all(
          lifecycleStages.map((stage) =>
            api.get("/api/campaigns/accounts/suggested-contacts", {
              params: {
                etapa_ciclo_vida: stage,
                account_ids: accountIdsParam,
              },
            }),
          ),
        );

        if (!mounted) return;

        const contactsMap = {};
        manuallyAddedIds.forEach((accountId) => {
          const mergedContacts = new Map();
          responses.forEach((response) => {
            const data = response?.data || {};
            const contacts = Array.isArray(data[accountId])
              ? data[accountId]
              : [];
            contacts.forEach((contact) => {
              const contactId = Number(contact?.contact_id || 0);
              if (!Number.isInteger(contactId) || contactId <= 0) return;
              mergedContacts.set(contactId, contact);
            });
          });
          contactsMap[accountId] = Array.from(mergedContacts.values());
        });

        if (mounted) {
          setSuggestedContactsByManualAccount(contactsMap);
        }
      } catch (requestError) {
        if (mounted) {
          console.error(
            "Error loading suggested contacts for manual accounts:",
            requestError,
          );
          setSuggestedContactsByManualAccount({});
        }
      }
    }

    loadSuggestedContactsForManualAccounts();

    return () => {
      mounted = false;
    };
  }, [
    campaignForm.audience_lifecycle_filters,
    selectedAudienceAccountIds,
    suggestedAccounts,
  ]);

  useEffect(() => {
    if (!compatibleSubtypeOptions.length) return;

    const currentSubtype = String(campaignForm.subtipo_campana || "").trim();
    if (
      compatibleSubtypeOptions.some((entry) => entry.value === currentSubtype)
    ) {
      return;
    }

    setCampaignForm((previous) => ({
      ...previous,
      subtipo_campana: compatibleSubtypeOptions[0].value,
    }));
  }, [campaignForm.subtipo_campana, compatibleSubtypeOptions]);

  function startNewCampaign() {
    const preferredTypes = new Set([
      "potencial",
      "principal",
      "prospecto",
      "puntual",
      "otro",
    ]);
    const defaultAccountTypeFilters = accountTypeOptions.filter((accountType) =>
      preferredTypes.has(normalizeClassificationValue(accountType)),
    );

    setSelectedCampaignId(null);
    setPreferSavedAudienceSelection(true);
    setManuallyAddedAudienceAccountIds([]);
    setCampaignForm({
      ...EMPTY_FORM,
      tipo_campana: catalogs?.tipo_campana?.[0] || EMPTY_FORM.tipo_campana,
      subtipo_campana:
        catalogs?.subtipo_campana?.[0] || EMPTY_FORM.subtipo_campana,
      estado_campana: resolveCampaignStateValue(
        EMPTY_FORM.estado_campana,
        visibleCampaignStates,
      ),
      audience_lifecycle_filters: [],
    });
    setSelectedAccountTypeFilters(
      defaultAccountTypeFilters.length
        ? defaultAccountTypeFilters
        : accountTypeOptions,
    );
    setAccountTypeFiltersInitialized(accountTypeOptions.length > 0);
    setSelectedSectorFilters(sectorOptions);
    setSectorFiltersInitialized(sectorOptions.length > 0);
    setFeedback("");
    setError("");
    setCampaignGoalText("");
    setAiSuggestionReason("");
    setClassificationGuideAi(null);
    setClassificationGuideAiSource(null);
    setClassificationGuideFallbackNote("");
  }

  function selectCampaign(campaign) {
    setPreferSavedAudienceSelection(true);
    setManuallyAddedAudienceAccountIds([]);
    setSelectedCampaignId(campaign.id);
    setCampaignForm({
      name: campaign.name || "",
      description: campaign.description || "",
      tipo_campana: campaign.tipo_campana || "",
      subtipo_campana: campaign.subtipo_campana || "",
      estado_campana: resolveCampaignStateValue(
        campaign.estado_campana,
        visibleCampaignStates,
      ),
      etapa_ciclo_vida: campaign.etapa_ciclo_vida || "",
      audience_lifecycle_filters: normalizeLifecycleFilterList(
        campaign.audience_lifecycle_filters?.length
          ? campaign.audience_lifecycle_filters
          : campaign.etapa_ciclo_vida
            ? [campaign.etapa_ciclo_vida]
            : [],
      ),
      starts_at: toDateInputValue(campaign.starts_at),
      ends_at: toDateInputValue(campaign.ends_at),
    });
    setSelectedAccountTypeFilters(
      normalizeSavedFilterList(campaign.audience_account_type_filters),
    );
    setSelectedSectorFilters(
      normalizeSavedFilterList(campaign.audience_sector_filters),
    );
    setAccountTypeFiltersInitialized(true);
    setSectorFiltersInitialized(true);
    setFeedback("");
    setError("");
    setCampaignGoalText(
      String(
        campaign?.campaign_goal_text || campaign?.description || "",
      ).trim(),
    );
    setAiSuggestionReason("");
    const persistedGuide = normalizeClassificationGuideFromDb(campaign);
    setClassificationGuideAi(persistedGuide);
    setClassificationGuideAiSource(persistedGuide);
    setClassificationGuideFallbackNote("");
  }

  async function handleSuggestCombinationWithAi() {
    const intent = String(campaignGoalText || "").trim();
    if (!intent) {
      setError(
        "Escribe primero qué quieres lograr con la campaña para sugerir combinación",
      );
      setFeedback("");
      return;
    }

    if (
      !Array.isArray(catalogs?.tipo_campana) ||
      !catalogs.tipo_campana.length
    ) {
      setError("No hay catálogo de tipos disponible para sugerir combinación");
      setFeedback("");
      return;
    }

    if (
      !Array.isArray(catalogs?.subtipo_campana) ||
      !catalogs.subtipo_campana.length
    ) {
      setError(
        "No hay catálogo de subtipos disponible para sugerir combinación",
      );
      setFeedback("");
      return;
    }

    setIsSuggestingCombination(true);
    let suggestion = null;
    try {
      suggestion = await requestCampaignCombinationSuggestionWithAi({
        intentText: intent,
        availableTypes: catalogs?.tipo_campana,
        availableSubtypes: catalogs?.subtipo_campana,
        policyByType: compatibilityPolicyByType,
        campaignMatrixRows,
      });

      setCampaignForm((previous) => ({
        ...previous,
        tipo_campana: suggestion.tipo_campana,
        subtipo_campana: suggestion.subtipo_campana,
      }));

      setFeedback(
        `IA sugiere: ${formatCampaignTypeLabel(suggestion.tipo_campana)} + ${formatCampaignTypeLabel(suggestion.subtipo_campana)}.`,
      );
      setAiSuggestionReason(String(suggestion?.razon || "").trim());
      const suggestionContext = String(suggestion?.context || "").trim();
      const suggestionExamples = Array.isArray(suggestion?.examples)
        ? suggestion.examples
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 5)
        : [];
      if (suggestionContext && suggestionExamples.length >= 3) {
        const normalizedGuide = normalizeClassificationGuideAi({
          enriched: {
            tipo_campana: suggestion.tipo_campana,
            subtipo_campana: suggestion.subtipo_campana,
            context: suggestionContext,
            examples: suggestionExamples,
            reason: String(suggestion?.razon || "").trim(),
          },
          tipoCampana: suggestion.tipo_campana,
          subtipoCampana: suggestion.subtipo_campana,
          campaignGoalText,
        });

        if (
          isCampaignGuideConsistent(
            normalizedGuide,
            suggestion.tipo_campana,
            suggestion.subtipo_campana,
          )
        ) {
          setClassificationGuideAi(normalizedGuide);
          setClassificationGuideAiSource(normalizedGuide);
          setClassificationGuideFallbackNote("");
          if (selectedCampaignId) {
            writeStoredClassificationGuide(
              selectedCampaignId,
              suggestion.tipo_campana,
              suggestion.subtipo_campana,
              {
                tipoCampana: suggestion.tipo_campana,
                subtipoCampana: suggestion.subtipo_campana,
                guide: normalizedGuide,
              },
            );
          }
        }
      }
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible obtener una sugerencia de combinación con IA",
        ),
      );
      setFeedback("");
      setAiSuggestionReason("");
      return null;
    } finally {
      setIsSuggestingCombination(false);
    }

    return suggestion;
  }

  async function handleEnrichClassificationGuideWithAi(
    tipoCampana = campaignForm.tipo_campana,
    subtipoCampana = campaignForm.subtipo_campana,
  ) {
    const tipo = String(tipoCampana || "").trim();
    const subtipo = String(subtipoCampana || "").trim();
    if (!tipo || !subtipo) {
      setClassificationGuideFallbackNote("");
      return;
    }

    if (!selectedCampaignId) {
      setClassificationGuideFallbackNote(
        "Selecciona o guarda la campaña antes de enriquecer la guía con IA.",
      );
      return;
    }

    setIsEnrichingClassificationGuide(true);
    setClassificationGuideFallbackNote("");

    try {
      const enriched = await requestClassificationGuideEnrichmentWithAi({
        tipoCampana: tipo,
        subtipoCampana: subtipo,
        campaignGoalText,
      });
      const normalizedGuide = normalizeClassificationGuideAi({
        enriched,
        tipoCampana: tipo,
        subtipoCampana: subtipo,
        campaignGoalText,
      });

      if (!isCampaignGuideConsistent(normalizedGuide, tipo, subtipo)) {
        throw new Error(
          "La guía IA no coincide con la combinación seleccionada",
        );
      }

      setClassificationGuideAi(normalizedGuide);
      setClassificationGuideAiSource(normalizedGuide);
      writeStoredClassificationGuide(selectedCampaignId, tipo, subtipo, {
        tipoCampana: tipo,
        subtipoCampana: subtipo,
        guide: normalizedGuide,
      });
    } catch (requestError) {
      setClassificationGuideAi(null);
      setClassificationGuideAiSource(null);
      clearStoredClassificationGuide(selectedCampaignId, tipo, subtipo);
      setClassificationGuideFallbackNote(
        getApiErrorMessage(
          requestError,
          "No fue posible generar la guía con IA. Reintenta con un objetivo más específico.",
        ),
      );
    } finally {
      setIsEnrichingClassificationGuide(false);
    }
  }

  function handleLifecycleStageChange(nextValues) {
    const nextFilters = normalizeLifecycleFilterList(nextValues);
    const currentFilters = normalizeLifecycleFilterList(
      campaignForm.audience_lifecycle_filters,
    );
    const unchanged =
      nextFilters.length === currentFilters.length &&
      nextFilters.every((value, index) => value === currentFilters[index]);

    if (unchanged) return;

    const hasSavedAudience =
      preferSavedAudienceSelection && savedCampaignAccountIds.length > 0;

    if (hasSavedAudience) {
      const confirmed = window.confirm(
        "Esta campana ya tiene una audiencia guardada. Si cambias la etapa de ciclo de vida objetivo, la lista de cuentas cambiara segun la nueva seleccion sugerida. ¿Deseas continuar?",
      );
      if (!confirmed) {
        return;
      }

      setPreferSavedAudienceSelection(false);
      setCampaignAccounts([]);
      setSelectedAudienceAccountIds([]);
      setRemovedAudienceContactsByAccount({});
      setManuallyAddedContactsByAccount({});
      setFeedback(
        "Se cambio la etapa de ciclo de vida. Revisa y guarda la nueva audiencia sugerida.",
      );
      setError("");
    }

    setCampaignForm((previous) => ({
      ...previous,
      audience_lifecycle_filters: nextFilters,
      etapa_ciclo_vida: nextFilters[0] || "",
    }));
  }

  async function handleSaveCampaign(event) {
    event.preventDefault();

    setIsSavingCampaign(true);
    setError("");
    setFeedback("");

    try {
      const payload = normalizeCampaignForm(
        campaignForm,
        campaignGoalText,
        selectedClassificationUsageGuide.context,
        selectedClassificationUsageGuide.examples,
        selectedAccountTypeFilters,
        selectedSectorFilters,
      );
      let savedCampaign = null;

      if (selectedCampaignId) {
        const response = await api.patch(
          `/api/campaigns/${selectedCampaignId}`,
          payload,
        );
        savedCampaign = response.data?.campaign || null;
      } else {
        const response = await api.post("/api/campaigns", payload);
        savedCampaign = response.data?.campaign || null;
      }

      if (!savedCampaign) {
        throw new Error("No se recibio la campana guardada");
      }

      setCampaigns((previous) => {
        const withoutCurrent = previous.filter(
          (item) => item.id !== savedCampaign.id,
        );
        return [savedCampaign, ...withoutCurrent];
      });
      setSelectedCampaignId(savedCampaign.id);
      setCampaignForm({
        name: savedCampaign.name || "",
        description: savedCampaign.description || "",
        tipo_campana: savedCampaign.tipo_campana || "",
        subtipo_campana: savedCampaign.subtipo_campana || "",
        estado_campana: resolveCampaignStateValue(
          savedCampaign.estado_campana,
          visibleCampaignStates,
        ),
        etapa_ciclo_vida: savedCampaign.etapa_ciclo_vida || "",
        audience_lifecycle_filters: normalizeLifecycleFilterList(
          savedCampaign.audience_lifecycle_filters?.length
            ? savedCampaign.audience_lifecycle_filters
            : savedCampaign.etapa_ciclo_vida
              ? [savedCampaign.etapa_ciclo_vida]
              : [],
        ),
        starts_at: toDateInputValue(savedCampaign.starts_at),
        ends_at: toDateInputValue(savedCampaign.ends_at),
      });
      setSelectedAccountTypeFilters(
        normalizeSavedFilterList(savedCampaign.audience_account_type_filters),
      );
      setSelectedSectorFilters(
        normalizeSavedFilterList(savedCampaign.audience_sector_filters),
      );
      setAccountTypeFiltersInitialized(true);
      setSectorFiltersInitialized(true);
      const persistedGuide = normalizeClassificationGuideFromDb(savedCampaign);
      setClassificationGuideAi(persistedGuide);
      setClassificationGuideAiSource(persistedGuide);
      setFeedback(
        selectedCampaignId ? "Campaña actualizada" : "Campaña creada",
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible guardar la campaña"),
      );
    } finally {
      setIsSavingCampaign(false);
    }
  }

  async function handleSaveCampaignAccount(event) {
    event.preventDefault();

    if (!selectedCampaignId) {
      setError("Primero crea o selecciona una campaña");
      return;
    }

    setIsSavingAccount(true);
    setError("");
    setFeedback("");

    try {
      const payloadItems = visibleAudienceAccounts
        .map((item) => {
          const accountId = Number(item?.account_id || 0);
          if (!Number.isInteger(accountId) || accountId <= 0) return null;

          const contactIds = Array.from(
            new Set(
              (visibleContactsByAccountId.get(accountId) || [])
                .map((contact) => Number(contact?.contact_id || 0))
                .filter(
                  (contactId) => Number.isInteger(contactId) && contactId > 0,
                ),
            ),
          );

          if (!contactIds.length) return null;

          return {
            account_id: accountId,
            contact_ids: contactIds,
          };
        })
        .filter(Boolean);

      if (!payloadItems.length) {
        throw new Error(
          "Selecciona al menos una cuenta que tenga por lo menos un contacto",
        );
      }

      const payload = normalizeCampaignAccountForm(
        accountForm,
        normalizeLifecycleFilterList(campaignForm.audience_lifecycle_filters)[0] ||
          campaignForm.etapa_ciclo_vida,
      );

      await api.put(`/api/campaigns/${selectedCampaignId}/accounts`, {
        items: payloadItems.map((item) => ({
          account_id: item.account_id,
          etapa_ciclo_vida: payload.etapa_ciclo_vida,
          estado_interaccion: payload.estado_interaccion,
          contact_ids: item.contact_ids,
          last_interaction_at: payload.last_interaction_at,
        })),
      });

      const { data } = await api.get(
        `/api/campaigns/${selectedCampaignId}/accounts`,
      );
      const savedItems = Array.isArray(data?.items) ? data.items : [];
      setCampaignAccounts(savedItems);
      setPreferSavedAudienceSelection(true);
      setSelectedAudienceAccountIds(
        savedItems
          .map((item) => Number(item.account_id || 0))
          .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
      );
      setManuallyAddedAudienceAccountIds([]);
      setFeedback(
        `${savedItems.length} cuentas incluidas/actualizadas en la campaña`,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar la cuenta en la campaña",
        ),
      );
    } finally {
      setIsSavingAccount(false);
    }
  }

  if (isLoadingData) {
    return (
      <section className="campaigns-page">
        <p>Cargando campañas...</p>
      </section>
    );
  }

  return (
    <section className="campaigns-page">
      <header className="campaigns-header">
        <div>
          <h2>Campañas</h2>
          <p>
            Gestiona la taxonomía de campañas y su avance por cuenta para
            conectar marketing con el ciclo de vida comercial.
          </p>
        </div>
        <div className="campaigns-header-actions">
          <span className="campaigns-counter">{campaigns.length} campañas</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={startNewCampaign}
          >
            Nueva campaña
          </button>
        </div>
      </header>

      <DismissibleAlert message={error} variant="error" />
      <DismissibleAlert message={feedback} variant="success" />
      <div className="campaigns-layout">
        <aside className="campaigns-sidebar">
          <div className="campaigns-sidebar-head">
            <h3>Listado</h3>
            <small>{campaigns.length} registros</small>
          </div>
          <ul>
            {campaigns.map((campaign) => {
              const isSelected = campaign.id === selectedCampaignId;
              return (
                <li key={campaign.id}>
                  <button
                    type="button"
                    className={isSelected ? "is-selected" : ""}
                    onClick={() => selectCampaign(campaign)}
                  >
                    <strong>{campaign.name}</strong>
                    <span>
                      {formatCampaignTypeLabel(campaign.subtipo_campana)}
                    </span>
                    <div className="campaigns-sidebar-meta">
                      <small className="campaigns-chip">
                        {formatCampaignTypeLabel(campaign.tipo_campana)}
                      </small>
                      <small className="campaigns-chip campaigns-chip-state">
                        {formatCampaignTypeLabel(campaign.estado_campana)}
                      </small>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="campaigns-main">
          <form className="card" onSubmit={handleSaveCampaign}>
            <h3>{selectedCampaign ? "Editar campaña" : "Crear campaña"}</h3>
            <div className="campaigns-form-sections">
              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Identidad</div>
                <div className="campaigns-grid campaigns-grid-single">
                  <label>
                    Nombre
                    <input
                      value={campaignForm.name}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          name: event.target.value,
                        }))
                      }
                      required
                      placeholder="Ej. Campaña de webinar Q3"
                    />
                  </label>
                </div>
              </div>

              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Clasificación</div>
                <div className="campaigns-grid">
                  <div className="campaigns-grid-wide campaigns-ai-goal-helper">
                    <div className="campaigns-subsection-title">
                      Qué Quieres Lograr Con La Campaña
                    </div>
                    <div className="campaigns-ai-goal-row">
                      <textarea
                        rows={2}
                        value={campaignGoalText}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setCampaignGoalText(nextValue);
                        }}
                        placeholder="Ej. Quiero avisar de un webinar y lograr que se registren esta semana"
                      />
                      <button
                        type="button"
                        className="campaigns-ai-goal-button"
                        onClick={async () => {
                          const suggestion =
                            await handleSuggestCombinationWithAi();
                          const hasGuideFromSuggestion =
                            suggestion &&
                            String(suggestion?.context || "").trim().length >=
                              80 &&
                            Array.isArray(suggestion?.examples) &&
                            suggestion.examples.filter((item) =>
                              String(item || "").trim(),
                            ).length >= 3;
                          if (suggestion && !hasGuideFromSuggestion) {
                            await handleEnrichClassificationGuideWithAi(
                              suggestion.tipo_campana,
                              suggestion.subtipo_campana,
                            );
                          }
                        }}
                        disabled={isSuggestingCombination}
                      >
                        {isSuggestingCombination
                          ? "Analizando..."
                          : "Sugerir Con IA"}
                      </button>
                    </div>
                    <small className="campaigns-field-help">
                      Describe el resultado esperado y la IA seleccionará la
                      mejor combinación de tipo y subtipo.
                    </small>
                    {aiSuggestionReason ? (
                      <small className="campaigns-ai-goal-reason">
                        Razón de la sugerencia IA: {aiSuggestionReason}
                      </small>
                    ) : null}
                  </div>
                  <label>
                    Tipo
                    <select
                      value={campaignForm.tipo_campana}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          tipo_campana: event.target.value,
                        }))
                      }
                    >
                      {(catalogs?.tipo_campana || []).map((value) => (
                        <option key={value} value={value}>
                          {`${formatCampaignTypeLabel(value)} - ${CAMPAIGN_TYPE_DESCRIPTIONS[value] || "Sin descripcion"}`}
                        </option>
                      ))}
                    </select>
                    <small className="campaigns-field-help">
                      {selectedTypeDescription}
                    </small>
                  </label>
                  <label>
                    Subtipo
                    <div className="campaigns-subtype-options">
                      {compatibleSubtypeOptions.map((entry) => {
                        const value = entry.value;
                        const levelClass =
                          entry.nivel === "permitido"
                            ? "is-priority"
                            : "is-secondary";
                        const isSelected =
                          String(campaignForm.subtipo_campana || "") === value;

                        return (
                          <button
                            key={value}
                            type="button"
                            className={`campaigns-subtype-option ${levelClass} ${
                              isSelected ? "is-selected" : ""
                            }`}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setCampaignForm((previous) => ({
                                ...previous,
                                subtipo_campana: value,
                              }))
                            }
                          >
                            <span>{formatCampaignTypeLabel(value)}</span>
                            {isSelected ? (
                              <small className="campaigns-subtype-selected-tag">
                                Seleccionado
                              </small>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <div className="campaigns-subtype-legend">
                      <span className="campaigns-subtype-legend-item is-priority">
                        Prioritaria
                      </span>
                      <span className="campaigns-subtype-legend-item is-secondary">
                        Secundaria
                      </span>
                    </div>
                    <small className="campaigns-field-help">
                      {selectedSubtypeDescription}
                    </small>
                  </label>
                  <div className="campaigns-grid-wide campaigns-classification-usage-guide">
                    <div className="campaigns-subsection-title">
                      Contexto y ejemplos
                    </div>
                    {isEnrichingClassificationGuide ? (
                      <small className="campaigns-guide-ai-status">
                        Enriqueciendo contexto y ejemplos con IA...
                      </small>
                    ) : (
                      <>
                        {classificationGuideFallbackNote ? (
                          <small className="campaigns-guide-fallback-note">
                            {classificationGuideFallbackNote}
                          </small>
                        ) : null}
                        {selectedClassificationUsageGuide.context ? (
                          <p>{selectedClassificationUsageGuide.context}</p>
                        ) : (
                          <small className="campaigns-field-help">
                            La guía de contexto y ejemplos se genera solo con
                            IA. Usa "Sugerir Con IA" para obtenerla.
                          </small>
                        )}
                        {selectedClassificationUsageGuide.examples.length >
                        0 ? (
                          <ul>
                            {selectedClassificationUsageGuide.examples.map(
                              (example) => (
                                <li key={example}>{example}</li>
                              ),
                            )}
                          </ul>
                        ) : null}
                      </>
                    )}
                  </div>
                  <label>
                    Estado
                    <select
                      value={campaignForm.estado_campana}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          estado_campana: event.target.value,
                        }))
                      }
                    >
                      {visibleCampaignStates.map((value) => (
                        <option key={value} value={value}>
                          {`${formatCampaignTypeLabel(value)} - ${CAMPAIGN_STATE_DESCRIPTIONS[value] || "Sin descripcion"}`}
                        </option>
                      ))}
                    </select>
                    <small className="campaigns-field-help">
                      {selectedStateDescription}
                    </small>
                  </label>
                  <div className="campaigns-grid-wide campaigns-subsection-block">
                    <div className="campaigns-subsection-title">Audiencia</div>
                    <div className="campaigns-sector-filter campaigns-lifecycle-filter">
                      {(catalogs?.etapa_ciclo_vida || []).map((value) => {
                        const isSelected = selectedLifecycleFilters.includes(value);
                        return (
                          <label
                            key={value}
                            className={`campaigns-sector-filter-item campaigns-lifecycle-filter-item ${
                              isSelected ? "is-selected" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                const nextValues = isSelected
                                  ? selectedLifecycleFilters.filter(
                                      (current) => current !== value,
                                    )
                                  : [...selectedLifecycleFilters, value];
                                handleLifecycleStageChange(nextValues);
                              }}
                            />
                            <span className="campaigns-lifecycle-filter-text">
                              <span className="campaigns-lifecycle-filter-title">
                                {formatCampaignTypeLabel(value)}
                              </span>
                              <span className="campaigns-lifecycle-filter-description">
                                {CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS[value] ||
                                  "Sin descripcion"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <small className="campaigns-field-help">
                      {selectedLifecycleDescription}
                    </small>
                  </div>
                  <div className="campaigns-grid-wide campaigns-subsection-block">
                    <div className="campaigns-subsection-title">
                      Filtro por tipo de cuenta
                    </div>
                    <div className="campaigns-sector-filter">
                      {accountTypeOptions.length === 0 ? (
                        <small className="campaigns-field-help">
                          Sin tipos de cuenta disponibles.
                        </small>
                      ) : (
                        accountTypeOptions.map((accountType) => {
                          const isSelected = selectedAccountTypeFilterSet.has(
                            String(accountType || "").trim(),
                          );
                          return (
                            <label
                              key={accountType}
                              className={`campaigns-sector-filter-item ${
                                isSelected ? "is-selected" : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedAccountTypeFilters((previous) => {
                                    const normalized = String(
                                      accountType || "",
                                    ).trim();
                                    if (isSelected) {
                                      return previous.filter(
                                        (value) =>
                                          String(value || "").trim() !==
                                          normalized,
                                      );
                                    }
                                    return [...previous, normalized];
                                  });
                                }}
                              />
                              <span>{accountType}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    <small className="campaigns-field-help">
                      Puedes elegir uno o varios tipos de cuenta para filtrar
                      las cuentas en Audiencia. Por defecto se seleccionan
                      todos.
                    </small>
                  </div>
                  <div className="campaigns-grid-wide campaigns-subsection-block">
                    <div className="campaigns-subsection-title">
                      Filtro por sector de cuenta
                    </div>
                    <div className="campaigns-sector-filter">
                      {sectorOptions.length === 0 ? (
                        <small className="campaigns-field-help">
                          Sin sectores disponibles.
                        </small>
                      ) : (
                        sectorOptions.map((sector) => {
                          const isSelected = selectedSectorFilterSet.has(
                            String(sector || "").trim(),
                          );
                          return (
                            <label
                              key={sector}
                              className={`campaigns-sector-filter-item ${
                                isSelected ? "is-selected" : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedSectorFilters((previous) => {
                                    const normalized = String(
                                      sector || "",
                                    ).trim();
                                    if (isSelected) {
                                      return previous.filter(
                                        (value) =>
                                          String(value || "").trim() !==
                                          normalized,
                                      );
                                    }
                                    return [...previous, normalized];
                                  });
                                }}
                              />
                              <span>{sector}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    <small className="campaigns-field-help">
                      Puedes elegir una o varias opciones de sector para filtrar
                      las cuentas en Audiencia. Por defecto se seleccionan todos
                      excepto Proveedor e Integrador.
                    </small>
                  </div>
                </div>
              </div>

              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Calendario</div>
                <div className="campaigns-grid">
                  <label>
                    Inicio
                    <input
                      type="date"
                      value={campaignForm.starts_at}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          starts_at: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Fin
                    <input
                      type="date"
                      value={campaignForm.ends_at}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          ends_at: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Narrativa</div>
                <div className="campaigns-grid campaigns-grid-single">
                  <label className="campaigns-grid-wide">
                    Descripción
                    <textarea
                      rows={3}
                      value={campaignForm.description}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Resume objetivo, mensaje y publico esperado"
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="campaigns-actions campaigns-actions-sticky">
              <button
                type="submit"
                className="btn-primary"
                disabled={isSavingCampaign}
              >
                {isSavingCampaign
                  ? "Guardando campaña..."
                  : "Guardar datos de campaña"}
              </button>
            </div>
          </form>

          <section className="card">
            <h3>Audiencia</h3>
            <form
              className="campaigns-grid"
              onSubmit={handleSaveCampaignAccount}
            >
              <div className="campaigns-grid-wide">
                <small className="campaigns-field-help">
                  Etapa seleccionada: {selectedAudienceLifecycleLabel}
                </small>
                <small className="campaigns-field-help">
                  {selectedAudienceLifecycleDescription}
                </small>
                <div className="campaigns-audience-list-wrap">
                  <div className="campaigns-audience-list-head">
                    <div className="campaigns-audience-title-row">
                      <strong>
                        Cuentas sugeridas:{" "}
                        {filteredAudienceAccountsByClassification.length} ·
                        Contactos sugeridos: {suggestedContactsCount}
                      </strong>
                      <button
                        type="button"
                        className="campaigns-audience-add-icon"
                        title="Abrir modal para anadir cuentas"
                        aria-label="Abrir modal para anadir cuentas"
                        onClick={() => {
                          setIsAddAccountsModalOpen(true);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M12 5v14M5 12h14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="campaigns-audience-tools">
                      <label className="campaigns-audience-search">
                        <span>Nombre de cuenta</span>
                        <input
                          type="search"
                          value={audienceAccountNameFilter}
                          onChange={(event) =>
                            setAudienceAccountNameFilter(event.target.value)
                          }
                          placeholder="Buscar cuenta..."
                        />
                      </label>
                      <label className="campaigns-audience-sort">
                        <span>Filtrar por vendedor</span>
                        <select
                          value={audienceOwnerFilter}
                          onChange={(event) =>
                            setAudienceOwnerFilter(event.target.value)
                          }
                        >
                          <option value="">Todos los vendedores</option>
                          {uniqueOwnersInAudience.map((owner) => (
                            <option key={owner} value={owner}>
                              {owner}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="campaigns-audience-sort">
                        <span>Tipo de cuenta</span>
                        <select
                          value={audienceAccountTypeFilter}
                          onChange={(event) =>
                            setAudienceAccountTypeFilter(event.target.value)
                          }
                        >
                          <option value="">Todos los tipos</option>
                          {uniqueAccountTypesInAudience.map((accountType) => (
                            <option key={accountType} value={accountType}>
                              {accountType}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="campaigns-audience-sort">
                        <span>Ordenar</span>
                        <select
                          value={audienceSortMode}
                          onChange={(event) =>
                            setAudienceSortMode(event.target.value)
                          }
                        >
                          <option value="name_asc">Nombre A-Z</option>
                          <option value="name_desc">Nombre Z-A</option>
                          <option value="sector_asc">Sector A-Z</option>
                          <option value="sector_desc">Sector Z-A</option>
                        </select>
                      </label>
                      <small>
                        Seleccionadas con contacto:{" "}
                        {visibleAudienceAccountsWithContacts.length}
                      </small>
                    </div>
                  </div>

                  {selectedLifecycleFilters.length > 0 &&
                  suggestedAccountsRuleSummary ? (
                    <p className="campaigns-field-help campaigns-audience-rule">
                      {suggestedAccountsRuleSummary}
                    </p>
                  ) : null}

                  {isLoadingSuggestedAccounts ? (
                    <p className="campaigns-empty">Calculando sugerencias...</p>
                  ) : null}

                  {!isLoadingSuggestedAccounts ? (
                    <DismissibleAlert
                      message={suggestedAccountsError}
                      variant="error"
                    />
                  ) : null}

                  {!isLoadingSuggestedAccounts &&
                  !suggestedAccountsError &&
                  sortedVisibleAudienceAccounts.length === 0 ? (
                    <p className="campaigns-empty">
                      No hay cuentas seleccionadas con contactos. Usa el icono
                      de anadir para recuperar cuentas y contactos.
                    </p>
                  ) : null}

                  {!isLoadingSuggestedAccounts &&
                  !suggestedAccountsError &&
                  sortedVisibleAudienceAccounts.length > 0 ? (
                    <div className="campaigns-account-checklist">
                      {sortedVisibleAudienceAccounts.map((item) => {
                        const accountId = Number(item.account_id);
                        const accountTypeLabel = String(
                          item.account_type || accountTypeById.get(accountId) || "",
                        ).trim();
                        const visibleContacts =
                          visibleContactsByAccountId.get(accountId) || [];
                        const audienceStageCodes = Array.from(
                          new Set(
                            (Array.isArray(item.audience_stage_codes)
                              ? item.audience_stage_codes
                              : []
                            )
                              .map((value) => String(value || "").trim())
                              .filter(Boolean),
                          ),
                        );
                        return (
                          <div
                            key={accountId}
                            className="campaigns-account-check-item"
                          >
                            <div className="campaigns-account-check-main">
                              <div className="campaigns-account-check-head">
                                <div className="campaigns-account-title-wrap">
                                  <strong>{item.account_name}</strong>
                                  {String(item.owners_display || "").trim() ? (
                                    <span className="campaigns-mini-badge campaigns-mini-badge-owner">
                                      {String(item.owners_display || "").trim()}
                                    </span>
                                  ) : null}
                                  {accountTypeLabel ? (
                                    <span className="campaigns-mini-badge campaigns-mini-badge-account-type">
                                      {`Tipo: ${accountTypeLabel}`}
                                    </span>
                                  ) : null}
                                  {String(item.economic_sector || "").trim() ? (
                                    <span className="campaigns-mini-badge campaigns-mini-badge-sector">
                                      {String(
                                        item.economic_sector || "",
                                      ).trim()}
                                    </span>
                                  ) : null}
                                  {audienceStageCodes.map((stageCode) => (
                                    <span
                                      key={`${accountId}-${stageCode}`}
                                      className={`campaigns-mini-badge ${
                                        stageCode === "manual"
                                          ? "campaigns-mini-badge-manual"
                                          : "campaigns-mini-badge-audience"
                                      }`}
                                    >
                                      {formatAudienceStageBadgeLabel(stageCode)}
                                    </span>
                                  ))}
                                </div>
                                <div className="campaigns-account-check-actions">
                                  <button
                                    type="button"
                                    className="campaigns-add-contact-icon"
                                    title="Adicionar contactos"
                                    aria-label="Adicionar contactos"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setAddContactsAccountId(accountId);
                                      setIsAddContactsModalOpen(true);
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="16"
                                      height="16"
                                      fill="none"
                                      aria-hidden="true"
                                      focusable="false"
                                      style={{ display: "block" }}
                                    >
                                      <path
                                        d="M12 5v14M5 12h14"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="campaigns-remove-icon"
                                    title="Eliminar cuenta de la lista"
                                    aria-label="Eliminar cuenta de la lista"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setPendingRemoveAccountId(accountId);
                                      setIsConfirmRemoveAccountModalOpen(true);
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="16"
                                      height="16"
                                      fill="currentColor"
                                      aria-hidden="true"
                                      focusable="false"
                                      style={{ display: "block" }}
                                    >
                                      <path
                                        d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4V5h4V4a1 1 0 0 1 1-1zm1 2v0h4V5h-4zm-3 2v12h10V7H7zm3 2h2v8h-2V9zm4 0h2v8h-2V9z"
                                        fill="#ffffff"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                              {item.total_opportunities !== null ? (
                                <small>
                                  Oportunidades: {item.total_opportunities} · En
                                  proceso: {item.open_opportunities} · Ganadas:{" "}
                                  {item.won_opportunities}
                                </small>
                              ) : null}
                              <div className="campaigns-account-contacts">
                                {visibleContacts.length > 0 ? (
                                  <div className="campaigns-contact-list">
                                    {visibleContacts.map((contact, index) => {
                                      const contactId = Number(
                                        contact?.contact_id || 0,
                                      );
                                      const contactName = String(
                                        contact?.contact_name ||
                                          contact?.email ||
                                          `Contacto ${index + 1}`,
                                      ).trim();
                                      return (
                                        <div
                                          key={`${accountId}-${contactId || index}`}
                                          className="campaigns-contact-row"
                                        >
                                          <span>
                                            {contactName}
                                            {String(
                                              contact?.position_title || "",
                                            ).trim() ? (
                                              <span className="campaigns-mini-badge campaigns-mini-badge-contact-role">
                                                {String(
                                                  contact?.position_title || "",
                                                ).trim()}
                                              </span>
                                            ) : null}
                                          </span>
                                          <button
                                            type="button"
                                            className="campaigns-contact-remove-icon"
                                            title="Eliminar contacto de la lista"
                                            aria-label="Eliminar contacto de la lista"
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              setPendingRemoveContact({
                                                accountId,
                                                contactId,
                                              });
                                              setIsConfirmRemoveContactModalOpen(
                                                true,
                                              );
                                            }}
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              width="16"
                                              height="16"
                                              fill="currentColor"
                                              aria-hidden="true"
                                              focusable="false"
                                              style={{ display: "block" }}
                                            >
                                              <path
                                                d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4V5h4V4a1 1 0 0 1 1-1zm1 2v0h4V5h-4zm-3 2v12h10V7H7zm3 2h2v8h-2V9zm4 0h2v8h-2V9z"
                                                fill="#ffffff"
                                              />
                                            </svg>
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p>Sin contactos para esta regla.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="campaigns-actions campaigns-grid-wide">
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={isSavingAccount || !selectedCampaignId}
                >
                  {isSavingAccount
                    ? "Guardando audiencia..."
                    : "Guardar audiencia seleccionada"}
                </button>
              </div>
            </form>
          </section>

          <section className="card">
            <h3>Ejecucion</h3>
            <div
              className="campaigns-execution-tabs"
              role="tablist"
              aria-label="Tabs de ejecucion"
            >
              <button
                type="button"
                role="tab"
                aria-selected={executionTab === "landing"}
                className={executionTab === "landing" ? "is-active" : ""}
                onClick={() => setExecutionTab("landing")}
              >
                Landing
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={executionTab === "correo"}
                className={executionTab === "correo" ? "is-active" : ""}
                onClick={() => setExecutionTab("correo")}
              >
                Correo
              </button>
            </div>

            <div className="campaigns-execution-panel" role="tabpanel">
              <small className="campaigns-field-help">
                Esta seccion consolida el estado operativo de la campana para
                dar seguimiento a la salida y avances de ejecucion.
              </small>

              <div className="campaigns-sidebar-meta">
                <small className="campaigns-chip">
                  Cuentas objetivo: {sortedVisibleAudienceAccounts.length}
                </small>
                <small className="campaigns-chip">
                  Estado: {formatCampaignTypeLabel(campaignForm.estado_campana)}
                </small>
                <small className="campaigns-chip">
                  Inicio: {campaignForm.starts_at || "Sin definir"}
                </small>
                <small className="campaigns-chip">
                  Fin: {campaignForm.ends_at || "Sin definir"}
                </small>
              </div>

              {executionTab === "landing" ? (
                <div className="campaigns-execution-content">
                  <strong>Plan de ejecucion Landing</strong>
                  <p>
                    Usa esta vista para controlar publicacion, trafico y
                    conversion de la landing de la campana.
                  </p>
                  <ul>
                    <li>Validar slug, contenido y llamada a la accion.</li>
                    <li>
                      Confirmar fecha/hora de salida y canal de promocion.
                    </li>
                    <li>Monitorear registros entrantes y calidad del lead.</li>
                  </ul>
                </div>
              ) : (
                <div className="campaigns-execution-content">
                  <strong>Plan de ejecucion Correo</strong>
                  <p>
                    Usa esta vista para controlar envios, seguimiento y
                    respuesta comercial por correo.
                  </p>
                  <ul>
                    <li>Revisar segmentacion y asunto del correo.</li>
                    <li>
                      Definir lote inicial, horario y frecuencia de envio.
                    </li>
                    <li>Monitorear apertura, clic y contactos efectivos.</li>
                  </ul>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {isAddAccountsModalOpen ? (
        <div
          className="campaigns-modal-backdrop"
          role="presentation"
          onClick={() => setIsAddAccountsModalOpen(false)}
        >
          <div
            className="campaigns-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Anadir cuentas"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="campaigns-modal-head">
              <strong>Anadir cuentas</strong>
              <button
                type="button"
                className="campaigns-modal-close"
                onClick={() => setIsAddAccountsModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <label className="campaigns-modal-search">
              Buscar cuenta
              <input
                value={addAccountsSearchText}
                onChange={(event) =>
                  setAddAccountsSearchText(event.target.value)
                }
                placeholder="Escribe nombre de cuenta"
              />
            </label>

            <div className="campaigns-modal-list">
              {availableAccountsToAdd.length === 0 ? (
                <p className="campaigns-empty">
                  No hay cuentas disponibles para anadir con el filtro actual.
                </p>
              ) : (
                availableAccountsToAdd.map((item) => {
                  const accountId = Number(item.account_id || 0);
                  const accountTypeLabel = String(item.account_type || "").trim();
                  const isChecked = pendingAddAccountIds.includes(accountId);
                  return (
                    <label
                      key={accountId}
                      className="campaigns-modal-list-item"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setPendingAddAccountIds((previous) => {
                            if (isChecked) {
                              return previous.filter(
                                (existingId) =>
                                  Number(existingId) !== accountId,
                              );
                            }
                            return [...previous, accountId];
                          });
                        }}
                      />
                      <span>{item.account_name}</span>
                      {String(item.owners_display || "").trim() ? (
                        <span className="campaigns-mini-badge campaigns-mini-badge-owner">
                          {String(item.owners_display || "").trim()}
                        </span>
                      ) : null}
                      {accountTypeLabel ? (
                        <span className="campaigns-mini-badge campaigns-mini-badge-account-type">
                          {`Tipo: ${accountTypeLabel}`}
                        </span>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>

            <div className="campaigns-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsAddAccountsModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={pendingAddAccountIds.length === 0}
                onClick={async () => {
                  setPreferSavedAudienceSelection(false);

                  const normalizedPendingIds = pendingAddAccountIds
                    .map((accountId) => Number(accountId || 0))
                    .filter(
                      (accountId) =>
                        Number.isInteger(accountId) && accountId > 0,
                    );

                  setSelectedAudienceAccountIds((previous) => {
                    const merged = new Set(
                      previous
                        .map((accountId) => Number(accountId || 0))
                        .filter(
                          (accountId) =>
                            Number.isInteger(accountId) && accountId > 0,
                        ),
                    );
                    normalizedPendingIds.forEach((accountId) => {
                      merged.add(accountId);
                    });
                    return Array.from(merged.values());
                  });
                  setManuallyAddedAudienceAccountIds((previous) => {
                    const merged = new Set(
                      previous
                        .map((accountId) => Number(accountId || 0))
                        .filter(
                          (accountId) =>
                            Number.isInteger(accountId) && accountId > 0,
                        ),
                    );
                    normalizedPendingIds.forEach((accountId) => {
                      merged.add(accountId);
                    });
                    return Array.from(merged.values());
                  });

                  if (normalizedPendingIds.length) {
                    try {
                      const responses = await Promise.all(
                        normalizedPendingIds.map((accountId) =>
                          api.get("/api/contacts", {
                            params: { accountId, activeOnly: true },
                          }),
                        ),
                      );

                      setAccountContactsByAccountId((previous) => {
                        const next = { ...previous };
                        normalizedPendingIds.forEach((accountId, index) => {
                          const contacts = Array.isArray(
                            responses[index]?.data,
                          )
                            ? responses[index].data
                                .map((contact) =>
                                  normalizeAudienceContact(contact),
                                )
                                .filter(Boolean)
                            : [];
                          next[accountId] = contacts;
                        });
                        return next;
                      });

                      setManuallyAddedContactsByAccount((previous) => {
                        const next = { ...previous };
                        normalizedPendingIds.forEach((accountId, index) => {
                          const contacts = Array.isArray(
                            responses[index]?.data,
                          )
                            ? responses[index].data
                                .map((contact) =>
                                  normalizeAudienceContact(contact),
                                )
                                .filter(Boolean)
                            : [];
                          next[accountId] = contacts;
                        });
                        return next;
                      });

                      setSuggestedContactsByManualAccount((previous) => {
                        const next = { ...previous };
                        normalizedPendingIds.forEach((accountId, index) => {
                          const contacts = Array.isArray(
                            responses[index]?.data,
                          )
                            ? responses[index].data
                                .map((contact) =>
                                  normalizeAudienceContact(contact),
                                )
                                .filter(Boolean)
                            : [];
                          next[accountId] = contacts;
                        });
                        return next;
                      });
                    } catch (requestError) {
                      setError(
                        getApiErrorMessage(
                          requestError,
                          "Se añadieron las cuentas, pero no fue posible cargar sus contactos activos.",
                        ),
                      );
                    }
                  }

                  setIsAddAccountsModalOpen(false);
                }}
              >
                Anadir seleccionadas
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddContactsModalOpen && addContactsAccount ? (
        <div
          className="campaigns-modal-backdrop"
          role="presentation"
          onClick={() => setIsAddContactsModalOpen(false)}
        >
          <div
            className="campaigns-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar contactos"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="campaigns-modal-head">
              <strong>{`Adicionar contactos · ${addContactsAccount.account_name}`}</strong>
              <button
                type="button"
                className="campaigns-modal-close"
                onClick={() => setIsAddContactsModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <label className="campaigns-modal-search">
              Buscar contacto
              <input
                value={addContactsSearchText}
                onChange={(event) =>
                  setAddContactsSearchText(event.target.value)
                }
                placeholder="Escribe nombre o correo"
              />
            </label>

            <div className="campaigns-modal-list">
              {isLoadingAddContacts ? (
                <p className="campaigns-empty">Cargando contactos...</p>
              ) : null}

              {!isLoadingAddContacts ? (
                <DismissibleAlert message={addContactsError} variant="error" />
              ) : null}

              {!isLoadingAddContacts &&
              !addContactsError &&
              availableContactsToAdd.length === 0 ? (
                <p className="campaigns-empty">
                  No hay contactos adicionales disponibles para adicionar.
                </p>
              ) : null}

              {!isLoadingAddContacts &&
              !addContactsError &&
              availableContactsToAdd.length > 0
                ? availableContactsToAdd.map((contact, index) => {
                    const contactId = Number(contact?.contact_id || 0);
                    const isChecked = pendingAddContactIds.includes(contactId);
                    const contactLabel = String(
                      contact?.contact_name ||
                        contact?.email ||
                        `Contacto ${index + 1}`,
                    ).trim();
                    return (
                      <label
                        key={`${addContactsAccount.account_id}-${contactId || index}`}
                        className="campaigns-modal-list-item"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (!contactId) return;
                            setPendingAddContactIds((previous) => {
                              if (isChecked) {
                                return previous.filter(
                                  (existingId) => existingId !== contactId,
                                );
                              }
                              return [...previous, contactId];
                            });
                          }}
                        />
                        <span>
                          {contactLabel}
                          {contact?.email ? ` · ${contact.email}` : ""}
                        </span>
                      </label>
                    );
                  })
                : null}
            </div>

            <div className="campaigns-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsAddContactsModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={pendingAddContactIds.length === 0}
                onClick={() => {
                  const accountId = Number(addContactsAccount.account_id || 0);
                  if (!accountId) {
                    setIsAddContactsModalOpen(false);
                    return;
                  }
                  const selectedContacts = pendingAddContactIds
                    .map(
                      (contactId) =>
                        addContactsAllById.get(Number(contactId || 0)) || null,
                    )
                    .filter(Boolean);

                  setRemovedAudienceContactsByAccount((previous) => {
                    const existingRemoved = (previous[accountId] || []).map(
                      (contactId) => Number(contactId || 0),
                    );
                    const pendingSet = new Set(
                      pendingAddContactIds.map((contactId) =>
                        Number(contactId || 0),
                      ),
                    );
                    const nextRemoved = existingRemoved.filter(
                      (contactId) => !pendingSet.has(contactId),
                    );

                    if (nextRemoved.length === 0) {
                      const nextState = { ...previous };
                      delete nextState[accountId];
                      return nextState;
                    }

                    return {
                      ...previous,
                      [accountId]: nextRemoved,
                    };
                  });

                  setManuallyAddedContactsByAccount((previous) => {
                    const suggestedSet = new Set(
                      (Array.isArray(addContactsAccount.contacts)
                        ? addContactsAccount.contacts
                        : []
                      )
                        .map((contact) => Number(contact?.contact_id || 0))
                        .filter(
                          (contactId) =>
                            Number.isInteger(contactId) && contactId > 0,
                        ),
                    );

                    const existingManual = Array.isArray(previous[accountId])
                      ? previous[accountId]
                      : [];
                    const mergedManual = new Map(
                      existingManual.map((contact) => [
                        Number(contact?.contact_id || 0),
                        contact,
                      ]),
                    );

                    selectedContacts.forEach((contact) => {
                      const contactId = Number(contact?.contact_id || 0);
                      if (!Number.isInteger(contactId) || contactId <= 0) {
                        return;
                      }
                      if (suggestedSet.has(contactId)) {
                        return;
                      }
                      mergedManual.set(contactId, contact);
                    });

                    if (mergedManual.size === 0) {
                      const nextState = { ...previous };
                      delete nextState[accountId];
                      return nextState;
                    }

                    return {
                      ...previous,
                      [accountId]: Array.from(mergedManual.values()),
                    };
                  });
                  setIsAddContactsModalOpen(false);
                }}
              >
                Adicionar seleccionados
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isConfirmRemoveContactModalOpen ? (
        <div
          className="campaigns-modal-backdrop"
          role="presentation"
          onClick={() => setIsConfirmRemoveContactModalOpen(false)}
        >
          <div
            className="campaigns-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar eliminacion de contacto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="campaigns-modal-head">
              <strong>Confirmar eliminación</strong>
              <button
                type="button"
                className="campaigns-modal-close"
                onClick={() => setIsConfirmRemoveContactModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <div className="campaigns-modal-body">
              <p>
                ¿Estás seguro de que deseas eliminar este contacto de la lista?
              </p>
            </div>

            <div className="campaigns-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsConfirmRemoveContactModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary btn-danger"
                onClick={() => {
                  setRemovedAudienceContactsByAccount((previous) => {
                    const accountId = pendingRemoveContact.accountId;
                    const contactId = pendingRemoveContact.contactId;
                    const existing = previous[accountId] || [];
                    if (!contactId || existing.includes(contactId)) {
                      return previous;
                    }
                    return {
                      ...previous,
                      [accountId]: [...existing, contactId],
                    };
                  });
                  setIsConfirmRemoveContactModalOpen(false);
                  setPendingRemoveContact({
                    accountId: null,
                    contactId: null,
                  });
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isConfirmRemoveAccountModalOpen ? (
        <div
          className="campaigns-modal-backdrop"
          role="presentation"
          onClick={() => setIsConfirmRemoveAccountModalOpen(false)}
        >
          <div
            className="campaigns-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar eliminacion de cuenta"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="campaigns-modal-head">
              <strong>Confirmar eliminación</strong>
              <button
                type="button"
                className="campaigns-modal-close"
                onClick={() => setIsConfirmRemoveAccountModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <div className="campaigns-modal-body">
              <p>
                ¿Estás seguro de que deseas eliminar esta cuenta de la
                audiencia?
              </p>
            </div>

            <div className="campaigns-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsConfirmRemoveAccountModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary btn-danger"
                onClick={() => {
                  setSelectedAudienceAccountIds((previous) =>
                    previous.filter(
                      (existingId) =>
                        Number(existingId) !== pendingRemoveAccountId,
                    ),
                  );
                  setManuallyAddedAudienceAccountIds((previous) =>
                    previous.filter(
                      (existingId) =>
                        Number(existingId) !== Number(pendingRemoveAccountId),
                    ),
                  );
                  setIsConfirmRemoveAccountModalOpen(false);
                  setPendingRemoveAccountId(null);
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
