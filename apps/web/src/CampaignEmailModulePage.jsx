import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, getApiErrorMessage, normalizeUiMessage } from "./api";
import "./campaign-email-module.css";

const MODULE_TABS = [
  { key: "overview", label: "Campana / Correo" },
  { key: "editor", label: "Editor" },
  { key: "schedule", label: "Programacion" },
  { key: "results", label: "Resultados" },
];

const CTA_SUGGESTIONS = [
  "Registrarme",
  "Solicitar demo",
  "Ver más",
  "Descargar guía",
  "Confirmar asistencia",
  "Agendar reunión",
  "Conocer solución",
  "Hablar con un asesor",
];

const DEFAULT_HTML = `<!doctype html>
<html>
  <body style="margin:0;font-family:Segoe UI,Tahoma,sans-serif;background:#eef4fb;color:#17324d;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #d9e6f5;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1f5fb0;">Correo de campana</div>
                <h1 style="margin:10px 0 12px;font-size:28px;line-height:1.2;color:#173d72;">Asunto principal del correo</h1>
                <p style="margin:0 0 18px;color:#466381;font-size:15px;line-height:1.6;">Resume aqui la propuesta de valor principal, el contexto de la campana y la accion esperada para la audiencia.</p>
                <a href="https://example.com" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1f5fb0;color:#ffffff;text-decoration:none;font-weight:700;">Ir a la accion</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const DEFAULT_DRAFT = {
  send_type: "correo_masivo",
  status: "draft",
  subject: "",
  preheader: "",
  cta_label: "",
  cta_url: "",
  html_content: DEFAULT_HTML,
  scheduled_at: "",
  batch_size: "50",
  max_sends_per_hour: "50",
  max_sends_per_day: "300",
  test_recipients: "",
  shared_document: {
    sourceMode: "library_file",
    title: "",
    description: "",
    linkMode: "per_recipient",
    expiresDays: "30",
    useAsPrimaryCta: true,
    linkLabel: "Descargar documento",
    previewUrl: "",
    previewExpiresAt: null,
    document: null,
  },
};

const EMAIL_SEND_TYPE_VALUES = [
  "correo_masivo",
  "secuencia",
  "recordatorio",
  "seguimiento",
];

const EMAIL_TYPE_DESCRIPTIONS = {
  correo_masivo:
    "Envio puntual a una audiencia amplia para comunicar una accion concreta.",
  secuencia:
    "Serie de correos programados para nutrir o acompañar el seguimiento.",
  recordatorio:
    "Correo breve para reforzar una fecha, evento o accion pendiente.",
  seguimiento:
    "Correo posterior al primer impacto para reactivar interes o avanzar la conversacion.",
};

const EMAIL_TYPE_SUGGESTION_MATRIX = {
  reconocimiento: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  captacion_de_leads: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "seguimiento",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  nutricion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "secuencia",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  conversion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "seguimiento",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  fidelizacion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "secuencia",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  reactivacion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  promocion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  lanzamiento_de_producto: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  upsell: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  cross_sell: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  evento: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "recordatorio",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  referidos: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  educacion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
};

const CAMPAIGN_PRIORITY_MATRIX = {
  reconocimiento: {
    prioritaria: [
      "correo_masivo",
      "redes_sociales_organicas",
      "redes_sociales_pagadas",
      "anuncios_display",
    ],
    secundaria: ["landing_page", "evento_virtual"],
  },
  captacion_de_leads: {
    prioritaria: [
      "landing_page",
      "anuncios_busqueda",
      "redes_sociales_pagadas",
      "correo_automatizado",
    ],
    secundaria: ["webinar", "whatsapp"],
  },
  nutricion: {
    prioritaria: [
      "correo_automatizado",
      "redes_sociales_organicas",
      "landing_page",
      "whatsapp",
    ],
    secundaria: ["webinar", "encuesta"],
  },
  conversion: {
    prioritaria: [
      "anuncios_busqueda",
      "landing_page",
      "redes_sociales_pagadas",
      "whatsapp",
    ],
    secundaria: ["correo_automatizado", "webinar"],
  },
  fidelizacion: {
    prioritaria: [
      "correo_automatizado",
      "redes_sociales_organicas",
      "whatsapp",
      "encuesta",
    ],
    secundaria: ["programa_de_referidos", "webinar"],
  },
  reactivacion: {
    prioritaria: [
      "correo_masivo",
      "redes_sociales_pagadas",
      "landing_page",
      "whatsapp",
    ],
    secundaria: ["correo_automatizado", "webinar"],
  },
  promocion: {
    prioritaria: [
      "correo_masivo",
      "anuncios_display",
      "redes_sociales_organicas",
      "redes_sociales_pagadas",
    ],
    secundaria: ["landing_page", "whatsapp"],
  },
  lanzamiento_de_producto: {
    prioritaria: [
      "correo_masivo",
      "anuncios_display",
      "redes_sociales_organicas",
      "correo_automatizado",
    ],
    secundaria: ["webinar", "landing_page"],
  },
  upsell: {
    prioritaria: [
      "whatsapp",
      "landing_page",
      "correo_automatizado",
      "encuesta",
    ],
    secundaria: ["webinar", "correo_masivo"],
  },
  cross_sell: {
    prioritaria: [
      "whatsapp",
      "landing_page",
      "correo_automatizado",
      "encuesta",
    ],
    secundaria: ["webinar", "programa_de_referidos"],
  },
  evento: {
    prioritaria: ["webinar", "evento_virtual", "evento_presencial", "sms"],
    secundaria: ["correo_masivo", "landing_page"],
  },
  referidos: {
    prioritaria: [
      "programa_de_referidos",
      "correo_masivo",
      "whatsapp",
      "landing_page",
    ],
    secundaria: ["encuesta", "webinar"],
  },
  educacion: {
    prioritaria: [
      "webinar",
      "correo_automatizado",
      "evento_virtual",
      "correo_masivo",
    ],
    secundaria: ["landing_page", "whatsapp"],
  },
};

const CAMPAIGN_CONTEXT_DETAILS = {
  reconocimiento:
    "Etapa temprana del ciclo comercial: la cuenta reconoce el problema, valida relevancia y evalua si vale la pena profundizar.",
  captacion_de_leads:
    "Etapa de adquisicion: buscamos convertir interes en leads calificables para activacion comercial.",
  nutricion:
    "Etapa de maduracion: el contacto ya conoce la propuesta y necesita evidencia para avanzar de forma informada.",
  conversion:
    "Etapa de decision: la cuenta compara alternativas y requiere claridad en valor, riesgo y tiempo.",
  fidelizacion:
    "Etapa post-compra: se trabaja continuidad de valor, adopcion y expansion sostenible.",
  reactivacion:
    "Etapa de reenganche: se retoma una relacion enfriada con una propuesta concreta y baja friccion.",
  promocion:
    "Etapa tactica de impulso: se busca acelerar respuesta a una oferta o iniciativa puntual.",
  lanzamiento_de_producto:
    "Etapa de introduccion de oferta: se comunica alcance, casos de uso y condiciones de adopcion inicial.",
  upsell:
    "Etapa de crecimiento en cuenta activa: se propone ampliar valor sobre una base ya implementada.",
  cross_sell:
    "Etapa de expansion complementaria: se identifican necesidades relacionadas para aumentar impacto integral.",
  evento:
    "Etapa de convocatoria y asistencia: la prioridad es confirmar participacion y preparacion oportuna.",
  referidos:
    "Etapa de recomendacion: se activa prueba social para generar nuevas oportunidades calificadas.",
  educacion:
    "Etapa de formacion: se fortalece entendimiento para reducir friccion de adopcion y mejorar decisiones.",
};

const SUBTYPE_CONTEXT_DETAILS = {
  correo_masivo:
    "Se usa para amplificar mensaje inicial y validar interes amplio con una accion simple.",
  correo_automatizado:
    "Se usa cuando el contacto necesita acompanamiento por etapas para madurar la decision.",
  redes_sociales_organicas:
    "Se usa para convertir interacciones organicas en evaluacion activa de la solucion.",
  redes_sociales_pagadas:
    "Se usa para capitalizar trafico de pauta y conducirlo a un siguiente paso medible.",
  anuncios_busqueda:
    "Se usa para responder intencion alta de compra y acelerar comparacion de alternativas.",
  anuncios_display:
    "Se usa para reforzar recordacion y mantener presencia de marca en etapas tempranas.",
  webinar:
    "Se usa para convocatoria, confirmacion y asistencia a contenido de valor en fecha definida.",
  landing_page:
    "Se usa para seguimiento de visitantes y conversion en formularios o registros clave.",
  sms: "Se usa como refuerzo tactico de urgencia previo a hitos o ventanas de accion.",
  whatsapp:
    "Se usa para seguimiento directo y resolucion de dudas con menor friccion de respuesta.",
  evento_presencial:
    "Se usa para confirmacion logistica y asistencia efectiva a encuentros presenciales.",
  evento_virtual:
    "Se usa para asegurar acceso, puntualidad y participacion en eventos virtuales.",
  encuesta:
    "Se usa para capturar feedback accionable y ajustar propuesta o priorizacion comercial.",
  programa_de_referidos:
    "Se usa para activar recomendacion de contactos con mayor confianza y afinidad.",
};

const SUBTYPE_DELIVERY_CONTEXT = {
  correo_masivo:
    "Flujo de entrega: envio directo a contactos ya identificados y con consentimiento en base de datos.",
  correo_automatizado:
    "Flujo de entrega: secuencia a contactos ya capturados, segmentados por etapa y consentimiento activo.",
  redes_sociales_organicas:
    "Flujo de entrega: primero se atrae trafico organico a landing o formulario; despues de capturar datos y consentimiento, se activa correo.",
  redes_sociales_pagadas:
    "Flujo de entrega: primero la pauta dirige a landing o registro; cuando el prospecto deja datos y consentimiento, entra al envio por correo.",
  anuncios_busqueda:
    "Flujo de entrega: primero se capta intencion desde busqueda en landing/formulario; luego se envia correo al contacto identificado.",
  anuncios_display:
    "Flujo de entrega: display aporta alcance visual y clics; el correo se envia solo despues de convertir el trafico en lead identificado.",
  webinar:
    "Flujo de entrega: correo a registrados confirmados o prospectos que completaron inscripcion al webinar.",
  landing_page:
    "Flujo de entrega: correo a visitantes que ya dejaron datos o iniciaron registro en la landing.",
  sms: "Flujo de entrega: mensaje corto a contactos ya identificados para reforzar un hito, seguido por correo cuando aplica.",
  whatsapp:
    "Flujo de entrega: seguimiento a contactos identificados que ya abrieron conversacion o autorizaron contacto.",
  evento_presencial:
    "Flujo de entrega: correo a asistentes registrados o invitados identificados para confirmar logistica.",
  evento_virtual:
    "Flujo de entrega: correo a inscritos con acceso habilitado para asegurar asistencia virtual.",
  encuesta:
    "Flujo de entrega: correo a contactos identificados que ya tuvieron una interaccion previa y pueden responder feedback.",
  programa_de_referidos:
    "Flujo de entrega: correo a contactos identificados elegibles para referir, con formulario y reglas del programa.",
};

const CAMPAIGN_TYPE_CONTEXT_PLAYBOOK = {
  reconocimiento: {
    buyerMoment:
      "la cuenta reconoce el problema y esta validando si conviene profundizar",
    primaryGoal: "activar interes calificado inicial",
    expectedSignal: "interacciones y clics de calidad",
  },
  captacion_de_leads: {
    buyerMoment: "la cuenta esta en etapa de captacion y descubrimiento activo",
    primaryGoal: "convertir trafico en leads identificados",
    expectedSignal: "registros y formularios completados",
  },
  nutricion: {
    buyerMoment: "el prospecto ya conoce la propuesta y necesita mas evidencia",
    primaryGoal: "madurar la decision por etapas",
    expectedSignal: "avance en secuencia y respuestas cualificadas",
  },
  conversion: {
    buyerMoment: "la cuenta compara alternativas para decidir",
    primaryGoal: "acelerar decision comercial",
    expectedSignal: "reuniones, respuestas y avance a cierre",
  },
  fidelizacion: {
    buyerMoment: "cliente activo en etapa de continuidad",
    primaryGoal: "aumentar adopcion y permanencia",
    expectedSignal: "engagement recurrente y expansion de uso",
  },
  reactivacion: {
    buyerMoment: "relacion enfriada que requiere reenganche",
    primaryGoal: "reactivar conversacion comercial",
    expectedSignal: "respuesta de retorno y nueva interaccion",
  },
  promocion: {
    buyerMoment: "ventana tactica de impulso",
    primaryGoal: "acelerar respuesta a oferta",
    expectedSignal: "clics de oferta y conversion puntual",
  },
  lanzamiento_de_producto: {
    buyerMoment: "introduccion de una nueva oferta",
    primaryGoal: "explicar valor y activar interes de adopcion",
    expectedSignal: "solicitudes de info/demo del nuevo producto",
  },
  upsell: {
    buyerMoment: "cliente activo con potencial de crecimiento",
    primaryGoal: "ampliar valor en cuenta existente",
    expectedSignal: "aceptacion de propuesta de expansion",
  },
  cross_sell: {
    buyerMoment: "cliente con necesidades complementarias",
    primaryGoal: "activar soluciones relacionadas",
    expectedSignal: "interes en portafolio complementario",
  },
  evento: {
    buyerMoment: "convocatoria en ventana de fecha definida",
    primaryGoal: "maximizar asistencia efectiva",
    expectedSignal: "confirmaciones y asistencia real",
  },
  referidos: {
    buyerMoment: "fase de recomendacion por confianza",
    primaryGoal: "activar nuevas oportunidades referidas",
    expectedSignal: "referidos registrados y validados",
  },
  educacion: {
    buyerMoment: "fase de formacion para reducir friccion",
    primaryGoal: "elevar entendimiento y preparacion",
    expectedSignal: "participacion en contenidos educativos",
  },
};

const SUBTYPE_EXECUTION_PLAYBOOK = {
  correo_masivo: {
    channelRole: "difusion directa por base de correos",
    useWhen: "ya existe audiencia identificada y segmentada",
    avoidWhen: "la base no tiene consentimiento o segmentacion",
  },
  correo_automatizado: {
    channelRole: "acompanamiento por secuencia",
    useWhen: "hay ruta de maduracion por etapas",
    avoidWhen: "no existe secuencia ni criterio de salida",
  },
  redes_sociales_organicas: {
    channelRole: "captura desde contenido organico",
    useWhen: "el origen es interaccion organica verificable",
    avoidWhen: "el origen real fue pauta o display",
  },
  redes_sociales_pagadas: {
    channelRole: "captura desde pauta social",
    useWhen: "el lead proviene de anuncios pagados en redes",
    avoidWhen: "no existe trazabilidad de origen pagado",
  },
  anuncios_busqueda: {
    channelRole: "captura por intencion en buscadores",
    useWhen: "hay senal de busqueda activa del problema",
    avoidWhen: "no existe landing de conversion",
  },
  anuncios_display: {
    channelRole: "recordacion visual y captacion",
    useWhen: "se busca awareness con ruta de registro",
    avoidWhen: "no hay mecanismo para capturar lead",
  },
  webinar: {
    channelRole: "registro y recordatorio de asistencia",
    useWhen: "hay evento con fecha y enlace claros",
    avoidWhen: "no existe registro o agenda definida",
  },
  landing_page: {
    channelRole: "seguimiento de trafico a conversion",
    useWhen: "se quiere convertir visitas en acciones",
    avoidWhen: "la landing no tiene CTA medible",
  },
  sms: {
    channelRole: "recordatorio de urgencia",
    useWhen: "hay ventana corta de accion",
    avoidWhen: "no hay opt-in para mensajeria",
  },
  whatsapp: {
    channelRole: "seguimiento conversacional",
    useWhen: "hay canal directo habilitado",
    avoidWhen: "no existe consentimiento de contacto",
  },
  evento_presencial: {
    channelRole: "confirmacion logistica presencial",
    useWhen: "hay cupo, lugar y agenda definidos",
    avoidWhen: "no existe detalle logistico",
  },
  evento_virtual: {
    channelRole: "confirmacion de acceso virtual",
    useWhen: "hay enlace y horario confirmados",
    avoidWhen: "el acceso aun no esta configurado",
  },
  encuesta: {
    channelRole: "captura de feedback",
    useWhen: "se necesita aprendizaje estructurado",
    avoidWhen: "no hay plan de accion post-encuesta",
  },
  programa_de_referidos: {
    channelRole: "activacion de referidos",
    useWhen: "hay reglas y beneficio definidos",
    avoidWhen: "no existe formulario de referido",
  },
};

const GUIDE_COMBINATION_OVERRIDES = {
  "captacion_de_leads::landing_page": {
    campaignContextDescription:
      "Contexto especifico: en Captacion De Leads con Landing Page, el foco es convertir trafico o interesados en registros nuevos y calificados.",
    subtypeContextDescription:
      "Objetivo operativo de esta combinacion: recuperar conversiones pendientes (visita sin registro o registro incompleto) y llevar al contacto a completar formulario o agenda.",
    deliveryContextDescription:
      "Flujo de entrega: aplicar a contactos que visitaron la landing, iniciaron registro o dejaron datos parciales. No es el flujo principal para seguimiento de asistentes confirmados al evento.",
    emailTypeContextDescription:
      "Tipo sugerido (Seguimiento): se usa para retomar una accion inconclusa en landing (registro, agenda o solicitud) y cerrar la conversion con un CTA directo.",
    typeSubtypeContext: {
      interpretation:
        "Lectura combinada: Captacion De Leads + Landing Page se usa para convertir interes digital en lead identificado; no para gestionar la etapa post-asistencia de un evento.",
      useWhen:
        "Usar esta combinacion cuando hubo visita a landing, abandono de formulario o registro sin completar, incluyendo no-show de registro cuando la accion esperada sigue siendo completar datos o reagendar.",
      avoidWhen:
        "Evitar esta combinacion cuando el contacto ya asistio al evento o ya quedo plenamente captado; en ese caso usar seguimiento post-evento (nutricion/conversion) con subtipo webinar, evento_virtual o evento_presencial segun corresponda.",
    },
  },
};

function buildGuideContextTable() {
  const table = {};

  for (const [tipoCampana, subtipos] of Object.entries(
    EMAIL_TYPE_SUGGESTION_MATRIX,
  )) {
    const typeEntry =
      CAMPAIGN_TYPE_CONTEXT_PLAYBOOK[tipoCampana] ||
      CAMPAIGN_TYPE_CONTEXT_PLAYBOOK.reconocimiento;

    for (const [subtipoCampana, suggestedEmailType] of Object.entries(
      subtipos,
    )) {
      const subtypeEntry =
        SUBTYPE_EXECUTION_PLAYBOOK[subtipoCampana] ||
        SUBTYPE_EXECUTION_PLAYBOOK.correo_masivo;
      const key = `${tipoCampana}::${subtipoCampana}`;

      table[key] = {
        campaignContextDescription: `Contexto especifico: en ${formatLabel(tipoCampana)}, ${typeEntry.buyerMoment}; para ${formatLabel(subtipoCampana)} se prioriza ${subtypeEntry.channelRole}.`,
        subtypeContextDescription: `Objetivo operativo de esta combinacion: ${typeEntry.primaryGoal}, usando ${formatLabel(subtipoCampana)} para ejecutar el canal correcto en esta etapa.`,
        deliveryContextDescription: `Flujo de entrega: ${SUBTYPE_DELIVERY_CONTEXT[subtipoCampana] || "primero identificar contacto y consentimiento; despues activar correo."}`,
        emailTypeContextDescription: `Tipo sugerido (${formatLabel(suggestedEmailType)}): ${EMAIL_TYPE_CONTEXT_DETAILS[suggestedEmailType] || "se define segun etapa, canal y accion esperada."}`,
        typeSubtypeContext: {
          interpretation: `Lectura combinada: ${formatLabel(tipoCampana)} + ${formatLabel(subtipoCampana)} requiere foco en ${typeEntry.primaryGoal} y se mide por ${typeEntry.expectedSignal}.`,
          useWhen: `Usar esta combinacion cuando ${subtypeEntry.useWhen}.`,
          avoidWhen: `Evitar esta combinacion cuando ${subtypeEntry.avoidWhen}.`,
        },
      };

      const combinationOverride = GUIDE_COMBINATION_OVERRIDES[key];
      if (combinationOverride) {
        table[key] = {
          ...table[key],
          ...combinationOverride,
          typeSubtypeContext: {
            ...table[key].typeSubtypeContext,
            ...(combinationOverride.typeSubtypeContext || {}),
          },
        };
      }
    }
  }

  return table;
}

const EMAIL_TYPE_CONTEXT_DETAILS = {
  correo_masivo:
    "Se recomienda para cobertura amplia cuando la prioridad es alcance inicial y recordacion del mensaje principal.",
  secuencia:
    "Se recomienda cuando el contexto exige acompanamiento por etapas para madurar decision y objeciones.",
  recordatorio:
    "Se recomienda cuando existe un hito temporal claro (evento, registro, fecha limite) y se debe reforzar asistencia o accion.",
  seguimiento:
    "Se recomienda cuando ya hubo una senal previa de interes y necesitamos mover al contacto al siguiente paso comercial.",
};

const GUIDE_CONTEXT_TABLE = buildGuideContextTable();

const CAMPAIGN_STAGE_CLARITY = {
  reconocimiento: {
    definition:
      "Definicion operativa: se usa para prospectos no clientes que ya mostraron senales de interes y estan en etapa temprana de evaluacion.",
    validSignals: [
      "Visita de landing o pagina de solucion.",
      "Interaccion con anuncios o contenido en redes.",
      "Registro/asistencia a webinar o evento.",
      "Respuesta por formulario, correo o WhatsApp.",
    ],
    boundaries: [
      "No aplica para clientes activos (usar fidelizacion, upsell o cross sell).",
      "No aplica para frio puro sin senales previas.",
      "Si no hay senales recientes, conviene tratarlo como prospeccion fria.",
    ],
    rules: [
      "Regla 1: incluir solo no clientes con al menos 1 senal de interes.",
      "Regla 2: priorizar senales recientes (ventana recomendada de 60 a 90 dias).",
      "Regla 3: si no cumple estas condiciones, mover a otro tipo de campaña.",
    ],
  },
};

const SUBTYPE_STAGE_CLARITY = {
  landing_page: {
    definition:
      "Definicion operativa (landing page): se usa cuando la conversion principal aun no se completa (registro, formulario o agenda) despues de una visita a landing.",
    validSignals: [
      "Visita a landing sin registro completado.",
      "Formulario iniciado pero abandonado.",
      "Registro a evento incompleto o sin confirmacion final.",
      "No-show tras preregistro cuando la accion siguiente sigue siendo completar datos o reagendar.",
    ],
    boundaries: [
      "No usar como flujo principal para quienes ya asistieron al evento.",
      "No usar cuando el lead ya esta captado y calificado en CRM.",
      "No usar si no hay CTA/formulario medible en la landing.",
    ],
    rules: [
      "Regla 1: priorizar recuperacion de conversion inconclusa con CTA unico y directo.",
      "Regla 2: si el contacto ya asistio, migrar a seguimiento post-evento (nutricion o conversion).",
      "Regla 3: mantener trazabilidad de origen y estado del registro para evitar duplicidad.",
    ],
  },
  redes_sociales_organicas: {
    definition:
      "Definicion operativa (redes sociales organicas): se usa para prospectos no clientes que interactuaron de forma organica con contenido de la marca y mostraron interes inicial.",
    validSignals: [
      "Interaccion organica con publicaciones (reacciones, comentarios o compartidos).",
      "Clic organico a enlace de bio, post o historia hacia landing.",
      "Mensaje directo iniciado desde redes sociales.",
      "Registro en formulario proveniente de contenido organico.",
    ],
    boundaries: [
      "No usar para trafico de pauta pagada (eso corresponde a redes_sociales_pagadas).",
      "No usar para trafico de banners o display.",
      "No usar para contactos sin ninguna senal organica verificable.",
    ],
    rules: [
      "Regla 1: confirmar que el origen del interes sea organico en redes.",
      "Regla 2: enviar correo solo cuando el contacto ya este identificado y con consentimiento.",
      "Regla 3: si el origen es pagado, reclasificar el subtipo antes de ejecutar.",
    ],
  },
};

const SUBTYPE_RESOURCE_EXAMPLES = {
  correo_masivo: [
    "One-pager comercial en PDF.",
    "Ficha ejecutiva de solucion.",
    "Landing de resumen ejecutivo.",
  ],
  correo_automatizado: [
    "Secuencia de 3 piezas por etapa (diagnostico, comparativo, plan).",
    "Guia de implementacion inicial.",
    "Landing por etapa de secuencia.",
  ],
  redes_sociales_organicas: [
    "Guia ampliada descargable.",
    "Playbook tematico.",
    "Landing de contenido extendido.",
  ],
  redes_sociales_pagadas: [
    "Landing de detalle de oferta.",
    "Landing de solicitud de demo.",
    "Comparativo de alternativas en PDF.",
  ],
  anuncios_busqueda: [
    "Landing de intencion alta (demo o cotizacion).",
    "Comparativo costo-tiempo-impacto.",
    "Caso de uso tecnico en PDF.",
  ],
  anuncios_display: [
    "Ficha ejecutiva visual.",
    "Caso breve de exito.",
    "Landing de awareness con CTA.",
  ],
  webinar: [
    "Formulario de inscripcion.",
    "Enlace de acceso al webinar.",
    "Agenda de sesion y recordatorio.",
  ],
  landing_page: [
    "Landing con formulario corto.",
    "Landing de diagnostico.",
    "Caso de exito descargable.",
  ],
  sms: [
    "Enlace corto de confirmacion.",
    "Acceso rapido a evento.",
    "Mini-landing de accion inmediata.",
  ],
  whatsapp: [
    "Enlace a propuesta breve.",
    "Link de agenda para llamada.",
    "Resumen comercial en PDF.",
  ],
  evento_presencial: [
    "Formulario de asistencia.",
    "Mapa o ubicacion del evento.",
    "Agenda y logistica en PDF.",
  ],
  evento_virtual: [
    "Enlace unico de acceso.",
    "Landing de recordatorio.",
    "Agenda con speakers.",
  ],
  encuesta: [
    "Formulario de feedback de 2-5 preguntas.",
    "Encuesta de satisfaccion post-interaccion.",
    "Landing de continuidad tras encuesta.",
  ],
  programa_de_referidos: [
    "Formulario para registrar referido.",
    "Reglas del programa de referidos.",
    "Documento de beneficios e incentivos.",
  ],
};

const SUBTYPE_PLAYBOOK = {
  correo_masivo: {
    objective:
      "Instalar el mensaje principal de campaña con alcance amplio y una llamada a la accion clara.",
    audience: {
      primary: "Decisores y evaluadores iniciales de cuentas objetivo.",
      secondary: "Influenciadores internos con interes en el problema.",
      exclusions:
        "Excluir contactos sin consentimiento o sin relacion comercial activa.",
    },
    example: {
      subject: "Una ruta practica para mejorar [objetivo] en [Empresa]",
      preheader:
        "Resumen ejecutivo y siguiente paso recomendado en menos de 3 minutos.",
      body: "Hola [Nombre], compartimos una propuesta concreta para abordar [problema] con bajo esfuerzo inicial y resultados medibles. Te dejamos una vista ejecutiva para validar encaje y definir si conviene avanzar esta semana.",
      cta: "Ver resumen",
    },
    resources: [
      { key: "document", label: "Documento de apoyo", required: true },
    ],
  },
  correo_automatizado: {
    objective:
      "Nutrir la decision por etapas con contenido progresivo orientado a madurez comercial.",
    audience: {
      primary: "Leads en evaluacion activa o cuentas en descubrimiento.",
      secondary: "Stakeholders tecnicos que validan factibilidad.",
      exclusions: "Evitar contactos no segmentados o fuera de ICP.",
    },
    example: {
      subject: "Ruta guiada para evaluar [solucion] sin friccion",
      preheader:
        "Serie de 3 correos con diagnostico, comparativo y plan de adopcion.",
      body: "Hola [Nombre], para ayudarte a evaluar con criterio, prepararmos una secuencia breve con recomendaciones por etapa. Cada correo incluye una decision puntual para facilitar el avance con tu equipo.",
      cta: "Iniciar ruta",
    },
    resources: [],
  },
  redes_sociales_organicas: {
    objective:
      "Convertir la interaccion organica en interes calificado con continuidad por correo.",
    audience: {
      primary: "Contactos que interactuaron con contenido organico reciente.",
      secondary: "Seguidores con engagement alto en temas similares.",
      exclusions: "Excluir usuarios sin señal de interes reciente.",
    },
    example: {
      subject: "Gracias por seguir nuestro contenido: guia ampliada",
      preheader:
        "Te compartimos la version practica con recomendaciones aplicables.",
      body: "Hola [Nombre], vimos tu interes en [tema] y te enviamos una guia ampliada con pasos concretos para llevarlo a la practica. Incluye errores comunes y acciones recomendadas para las primeras semanas.",
      cta: "Descargar guia",
    },
    resources: [{ key: "document", label: "Guia o playbook", required: true }],
  },
  redes_sociales_pagadas: {
    objective:
      "Reactivar el interes captado por pauta y moverlo a una accion medible.",
    audience: {
      primary: "Leads provenientes de anuncios con clic o visita reciente.",
      secondary: "Audiencias lookalike con interaccion equivalente.",
      exclusions:
        "Excluir leads ya convertidos o fuera de cobertura geografica.",
    },
    example: {
      subject: "Damos seguimiento a tu interes en [tema]",
      preheader: "Te dejamos un resumen en 3 puntos para decidir rapido.",
      body: "Hola [Nombre], como seguimiento a tu interes en [tema], te compartimos una propuesta breve con alcance, tiempos estimados y proximo paso sugerido para validar encaje con tu contexto.",
      cta: "Ver propuesta",
    },
    resources: [
      { key: "landing", label: "Landing de detalle", required: true },
    ],
  },
  anuncios_busqueda: {
    objective:
      "Aprovechar la alta intencion de busqueda para acelerar evaluacion y conversion.",
    audience: {
      primary: "Leads con intencion activa asociada a terminos clave.",
      secondary: "Cuentas que comparan alternativas actualmente.",
      exclusions: "Excluir consultas irrelevantes o trafico accidental.",
    },
    example: {
      subject: "Comparativo directo para decidir [tema]",
      preheader: "Costo, tiempo e impacto en una sola vista.",
      body: "Hola [Nombre], sabemos que estas evaluando opciones para [tema]. Te compartimos un comparativo practico con criterios de negocio para ayudarte a decidir con mayor certeza y menor riesgo.",
      cta: "Ver comparativo",
    },
    resources: [
      { key: "landing", label: "Landing o comparativo", required: true },
    ],
  },
  anuncios_display: {
    objective:
      "Mantener recordacion de marca y reforzar propuesta de valor inicial.",
    audience: {
      primary: "Audiencias impactadas por piezas de awareness visual.",
      secondary: "Cuentas en fase temprana de descubrimiento.",
      exclusions: "Excluir segmentos con saturacion de frecuencia.",
    },
    example: {
      subject: "Una forma clara de resolver [problema]",
      preheader: "Conoce el enfoque de [Marca] en menos de 2 minutos.",
      body: "Hola [Nombre], compartimos una alternativa directa para abordar [problema] con una implementacion simple y resultados observables. Este resumen te ayuda a validar si conviene profundizar.",
      cta: "Conocer enfoque",
    },
    resources: [{ key: "document", label: "Ficha ejecutiva", required: true }],
  },
  webinar: {
    objective:
      "Maximizar asistencia y asegurar preparacion previa a la sesion.",
    audience: {
      primary: "Registrados confirmados y participantes potenciales.",
      secondary: "Prospectos calificados con interes en el tema.",
      exclusions:
        "Excluir contactos no relacionados con el contenido del evento.",
    },
    example: {
      subject: "Recordatorio: tu cupo para [Webinar]",
      preheader: "Iniciamos a las [hora]. Acceso y agenda aqui.",
      body: "Hola [Nombre], te recordamos que hoy realizamos [Webinar]. Compartiremos casos reales, recomendaciones aplicables y un espacio final para preguntas. Te dejamos enlace de acceso y agenda.",
      cta: "Entrar al webinar",
    },
    resources: [
      { key: "registro", label: "Registro o acceso", required: true },
    ],
  },
  landing_page: {
    objective:
      "Convertir la visita en accion concreta con seguimiento de siguiente paso.",
    audience: {
      primary: "Usuarios que visitaron la landing y no completaron accion.",
      secondary: "Nuevos leads con interes contextual.",
      exclusions: "Excluir conversiones ya completadas para evitar friccion.",
    },
    example: {
      subject: "Vimos tu interes en [tema], aqui sigue el proceso",
      preheader: "Caso real y checklist para avanzar en minutos.",
      body: "Hola [Nombre], gracias por revisar nuestra propuesta en [tema]. Te compartimos un caso aplicable y un checklist corto para que decidas el siguiente paso con claridad.",
      cta: "Ir a la landing",
    },
    resources: [{ key: "landing", label: "Landing activa", required: true }],
  },
  sms: {
    objective:
      "Refuerzo de urgencia para fechas, ventanas de registro o hitos inminentes.",
    audience: {
      primary: "Contactos con alta probabilidad de respuesta inmediata.",
      secondary: "Participantes ya confirmados pendientes de asistencia.",
      exclusions: "Excluir contactos sin opt-in de mensajes cortos.",
    },
    example: {
      subject: "Recordatorio rapido para [evento]",
      preheader: "Inicio en breve. Confirmacion y acceso en un clic.",
      body: "Hola [Nombre], recordatorio rapido: [evento] inicia en breve. Te compartimos acceso directo para confirmar y conectarte a tiempo.",
      cta: "Confirmar ahora",
    },
    resources: [
      {
        key: "registro",
        label: "Enlace corto de confirmacion",
        required: true,
      },
    ],
  },
  whatsapp: {
    objective:
      "Sostener conversacion uno a uno para resolver dudas y acelerar decision.",
    audience: {
      primary: "Leads con dialogo activo en canales directos.",
      secondary: "Cuentas en seguimiento comercial con objeciones abiertas.",
      exclusions: "Excluir contactos sin consentimiento de mensajeria directa.",
    },
    example: {
      subject: "Seguimiento personalizado para [tema]",
      preheader: "Te compartimos el material prometido y siguiente paso.",
      body: "Hola [Nombre], te envio seguimiento de [tema] con un resumen corto para facilitar decision interna. Si te parece, coordinamos 15 minutos para resolver dudas clave.",
      cta: "Responder por WhatsApp",
    },
    resources: [],
  },
  evento_presencial: {
    objective:
      "Asegurar asistencia presencial con informacion logistica completa.",
    audience: {
      primary: "Invitados confirmados al evento presencial.",
      secondary: "Asistentes potenciales de ultima etapa.",
      exclusions: "Excluir registros cancelados o no elegibles por cupo.",
    },
    example: {
      subject: "Recordatorio de asistencia a [Evento]",
      preheader: "Ubicacion, agenda y recomendaciones de llegada.",
      body: "Hola [Nombre], te recordamos tu participacion en [Evento]. Aqui tienes ubicacion, agenda y recomendaciones para que aproveches al maximo la sesion.",
      cta: "Ver agenda",
    },
    resources: [
      { key: "registro", label: "Registro y logistica", required: true },
    ],
  },
  evento_virtual: {
    objective:
      "Asegurar asistencia virtual con acceso simple y contexto de valor.",
    audience: {
      primary: "Registrados al evento virtual.",
      secondary: "Leads con interes en el tema del evento.",
      exclusions: "Excluir contactos sin relevancia tematica.",
    },
    example: {
      subject: "Tu acceso al evento virtual [Nombre]",
      preheader: "Conectate 10 minutos antes para iniciar puntual.",
      body: "Hola [Nombre], compartimos recordatorio del evento virtual [Nombre]. Incluimos acceso, agenda y recomendaciones para que tu participacion sea efectiva.",
      cta: "Acceder al evento",
    },
    resources: [
      { key: "registro", label: "Registro o enlace de acceso", required: true },
    ],
  },
  encuesta: {
    objective:
      "Capturar feedback accionable para ajustar mensaje, oferta y prioridad comercial.",
    audience: {
      primary: "Contactos expuestos a la propuesta recientemente.",
      secondary: "Clientes o prospectos en fase de evaluacion.",
      exclusions: "Excluir respuestas recientes para evitar fatiga.",
    },
    example: {
      subject: "Tu opinion en 2 minutos nos ayuda a mejorar",
      preheader: "Encuesta breve para priorizar lo que mas valor te aporta.",
      body: "Hola [Nombre], queremos mejorar la experiencia en [tema]. Te pedimos una encuesta breve para priorizar acciones que realmente te aporten valor.",
      cta: "Responder encuesta",
    },
    resources: [
      { key: "encuesta", label: "Formulario de encuesta", required: true },
    ],
  },
  programa_de_referidos: {
    objective:
      "Activar referidos calificados con propuesta clara de beneficio mutuo.",
    audience: {
      primary: "Clientes satisfechos y aliados con buena experiencia.",
      secondary: "Contactos de confianza con red relevante.",
      exclusions: "Excluir cuentas con incidencias abiertas de servicio.",
    },
    example: {
      subject: "Activa tu beneficio por referir un colega",
      preheader: "Te explicamos el proceso en 3 pasos simples.",
      body: "Hola [Nombre], si conoces a alguien que pueda beneficiarse de [solucion], puedes referirlo y acceder al beneficio del programa. Te compartimos reglas y pasos para iniciar.",
      cta: "Registrar referido",
    },
    resources: [
      { key: "referidos", label: "Formulario de referidos", required: true },
    ],
  },
};

const FALLBACK_PLAYBOOK = {
  objective:
    "Alinear mensaje y siguiente accion con el objetivo principal de la campaña seleccionada.",
  audience: {
    primary: "Contactos con mayor afinidad al objetivo de la campaña.",
    secondary: "Influenciadores internos que faciliten evaluacion.",
    exclusions: "Excluir contactos no activos o fuera del segmento objetivo.",
  },
  example: {
    subject: "Siguiente paso recomendado para [Campana]",
    preheader: "Contexto, beneficio esperado y accion sugerida.",
    body: "Hola [Nombre], compartimos una recomendacion concreta para avanzar con [campana] segun el momento comercial actual. Puedes revisar el contexto y definir el siguiente paso.",
    cta: "Ver recomendacion",
  },
  resources: [],
};

function getSuggestedEmailType(campaign) {
  const tipoCampana = String(campaign?.tipo_campana || "").trim();
  const subtipoCampana = String(campaign?.subtipo_campana || "").trim();

  return (
    EMAIL_TYPE_SUGGESTION_MATRIX[tipoCampana]?.[subtipoCampana] ||
    DEFAULT_DRAFT.send_type
  );
}

function getSubtypePriority(tipoCampana, subtipoCampana) {
  const rule =
    CAMPAIGN_PRIORITY_MATRIX[String(tipoCampana || "").trim()] || null;
  if (!rule) return "informativa";
  if (
    Array.isArray(rule.prioritaria) &&
    rule.prioritaria.includes(subtipoCampana)
  ) {
    return "prioritaria";
  }
  if (
    Array.isArray(rule.secundaria) &&
    rule.secundaria.includes(subtipoCampana)
  ) {
    return "secundaria";
  }
  return "informativa";
}

function buildObjectiveDetail(guidance) {
  const tipoCampana = formatLabel(guidance?.tipoCampana || "");
  const subtipoCampana = formatLabel(guidance?.subtipoCampana || "");
  const suggestedEmailType = formatLabel(guidance?.suggestedEmailType || "");
  const priorityLabel =
    guidance?.priority === "prioritaria"
      ? "prioridad alta"
      : guidance?.priority === "secundaria"
        ? "prioridad de apoyo"
        : "prioridad informativa";
  const campaignGoalText = String(guidance?.campaignGoalText || "").trim();
  const objectiveSource = campaignGoalText || String(guidance?.objective || "");
  const objectiveText = String(objectiveSource || "")
    .trim()
    .replace(/[.\s]+$/, "");

  const resources = Array.isArray(guidance?.resources)
    ? guidance.resources
    : [];
  const pendingResources = resources.filter(
    (resource) => String(resource?.status || "").trim() === "pendiente",
  );
  const availableResources = resources.filter(
    (resource) => String(resource?.status || "").trim() === "disponible",
  );

  const successSignalsByEmailType = {
    correo_masivo:
      "incremento de apertura y clic en cuentas objetivo durante los primeros envios",
    secuencia:
      "avance progresivo entre pasos de la secuencia y mayor respuesta cualificada",
    recordatorio:
      "confirmaciones de asistencia o accion en la ventana previa al hito",
    seguimiento:
      "respuestas, reuniones o reactivacion de conversaciones ya iniciadas",
  };

  const successSignal =
    successSignalsByEmailType[
      String(guidance?.suggestedEmailType || "").trim()
    ] || "mejor claridad en la siguiente accion del contacto";

  const resourceMessage =
    resources.length === 0
      ? "No depende de recursos adicionales para salir a ejecucion."
      : pendingResources.length > 0
        ? `Antes de enviar conviene completar: ${pendingResources
            .map((resource) => resource.label)
            .join(", ")}.`
        : `Recursos listos para ejecucion: ${availableResources
            .map((resource) => resource.label)
            .join(", ")}.`;

  return {
    context: `En ${tipoCampana} (${subtipoCampana}), este correo se trabaja como ${priorityLabel}. Su objetivo especifico es ${objectiveText.toLowerCase()}.`,
    expectedResult: `Resultado esperado: ${objectiveText}. Se recomienda ejecutarlo como ${suggestedEmailType} para mantener coherencia con la etapa comercial y la senal del contacto.`,
    successSignal: `Senal de exito: ${successSignal}.`,
    nextStep: `Siguiente paso recomendado: ${resourceMessage}`,
  };
}

function buildExampleDetail(guidance) {
  const example = guidance?.example || FALLBACK_PLAYBOOK.example;
  const audience = guidance?.audience || FALLBACK_PLAYBOOK.audience;
  const objectiveText = String(guidance?.objective || "")
    .trim()
    .replace(/[.\s]+$/, "");
  const resources = Array.isArray(guidance?.resources)
    ? guidance.resources
    : [];
  const availableResources = resources
    .filter(
      (resource) => String(resource?.status || "").trim() === "disponible",
    )
    .map((resource) => resource.label);

  const resourceSupport =
    availableResources.length > 0
      ? `Para reforzar el mensaje, adjunta o enlaza: ${availableResources.join(", ")}.`
      : "Si aplica, complementa el correo con un recurso de apoyo para facilitar la decision.";

  return {
    opening: `Apertura sugerida: gracias por tu interes en ${objectiveText ? objectiveText.toLowerCase() : "esta iniciativa"}. Te compartimos una recomendacion pensada para ${audience.primary.toLowerCase()}.`,
    value: `Propuesta de valor: ${String(example.body || "").trim()} Enfatiza el beneficio concreto para la cuenta y evita mensajes demasiado generales.`,
    proof:
      "Elemento de confianza: agrega una referencia breve de resultado esperado, caso similar o indicador de impacto para reducir friccion en la evaluacion.",
    nextStep: `Cierre orientado a accion: conecta el mensaje con un siguiente paso claro y de bajo esfuerzo. ${resourceSupport}`,
    closing:
      "Despedida sugerida: Quedo atento para ayudarte a validar encaje y definir el mejor momento de ejecucion.",
  };
}

function buildTypeSubtypeContext(guidance) {
  const tipoCampana = formatLabel(guidance?.tipoCampana || "");
  const subtipoCampana = String(guidance?.subtipoCampana || "").trim();
  const subtipoLabel = formatLabel(subtipoCampana);
  const suggestedEmailType = formatLabel(guidance?.suggestedEmailType || "");
  const priority =
    guidance?.priority === "prioritaria"
      ? "prioritaria"
      : guidance?.priority === "secundaria"
        ? "secundaria"
        : "informativa";

  const useWhenBySubtype = {
    correo_masivo:
      "cuando ya tienes base de contactos identificados y buscas alcance rapido con mensaje unificado",
    correo_automatizado:
      "cuando el prospecto requiere acompanamiento por etapas y puntos de decision progresivos",
    redes_sociales_organicas:
      "cuando el interes proviene de interaccion organica en redes y se capturo el lead sin pauta",
    redes_sociales_pagadas:
      "cuando el origen del interes viene de pauta social y necesitas seguimiento inmediato",
    anuncios_busqueda:
      "cuando hay intencion explicita de busqueda y comparacion activa de soluciones",
    anuncios_display:
      "cuando necesitas reforzar recordacion visual y convertir trafico en registros",
    webinar:
      "cuando el objetivo es convocatoria, confirmacion y asistencia a contenido en fecha definida",
    landing_page:
      "cuando tienes trafico a landing y necesitas convertir visita en registro o accion",
    sms: "cuando necesitas recordatorio de alta urgencia en una ventana de tiempo corta",
    whatsapp:
      "cuando necesitas conversacion directa para resolver dudas y mover siguiente paso",
    evento_presencial:
      "cuando debes confirmar asistencia presencial y compartir logistica",
    evento_virtual: "cuando debes asegurar acceso puntual y asistencia remota",
    encuesta:
      "cuando necesitas feedback estructurado para ajustar propuesta comercial",
    programa_de_referidos:
      "cuando buscas activar recomendacion de contactos con confianza previa",
  };

  const avoidWhenBySubtype = {
    correo_masivo:
      "si la base no esta segmentada o no existe consentimiento actualizado",
    correo_automatizado:
      "si no hay secuencia definida por etapa y criterio de salida",
    redes_sociales_organicas:
      "si el origen real del trafico fue pagado o display",
    redes_sociales_pagadas:
      "si no se puede atribuir origen de pauta ni capturar consentimiento",
    anuncios_busqueda:
      "si no hay landing de conversion ni criterio de calificacion",
    anuncios_display:
      "si no existe ruta de captura para convertir trafico anonimo en lead",
    webinar: "si no hay registro/agenda y enlace de acceso claros",
    landing_page:
      "si la landing no tiene formulario o CTA de conversion medible",
    sms: "si el contacto no tiene consentimiento para mensajeria corta",
    whatsapp: "si no existe consentimiento o conversacion previa habilitada",
    evento_presencial: "si no hay confirmacion de cupo, lugar y agenda",
    evento_virtual: "si no hay enlace de acceso y soporte de ingreso",
    encuesta:
      "si no existe objetivo de aprendizaje ni plan de accion post-encuesta",
    programa_de_referidos:
      "si no hay reglas claras del programa y formulario de referido",
  };

  return {
    interpretation: `Lectura combinada: para ${tipoCampana} con subtipo ${subtipoLabel}, la ejecucion recomendada es ${suggestedEmailType} con prioridad ${priority}.`,
    useWhen: `Usar este subtipo ${useWhenBySubtype[subtipoCampana] || "cuando el canal de origen y el objetivo comercial coinciden con la etapa actual"}.`,
    avoidWhen: `Evitar este subtipo ${avoidWhenBySubtype[subtipoCampana] || "si no hay trazabilidad del origen del lead o no existe consentimiento"}.`,
  };
}

function formatLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toDateInputValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const datePart = normalized.includes("T")
    ? normalized.split("T")[0]
    : normalized.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "";
}

function createDefaultSharedDocumentDraft() {
  return {
    ...DEFAULT_DRAFT.shared_document,
    document: null,
  };
}

function buildHtmlWithPrimaryCta(htmlContent, ctaUrl, ctaLabel) {
  const normalizedHtml = String(htmlContent || "").trim();
  if (!normalizedHtml) return normalizedHtml;

  const safeUrl = String(ctaUrl || "").trim();
  const safeLabel = String(ctaLabel || "").trim();
  if (!safeUrl && !safeLabel) {
    return normalizedHtml;
  }

  return normalizedHtml.replace(
    /<a\b([^>]*)href=["'][^"']*["']([^>]*)>([\s\S]*?)<\/a>/i,
    (_match, beforeHref, afterHref, innerHtml) => {
      const nextHref = safeUrl || "#";
      const nextLabel =
        safeLabel || String(innerHtml || "").trim() || "Ir a la accion";
      return `<a${beforeHref}href="${nextHref.replace(/"/g, "&quot;")}"${afterHref}>${nextLabel}</a>`;
    },
  );
}

function createDefaultDraft(campaign) {
  const campaignName = String(campaign?.name || "").trim();
  return {
    ...DEFAULT_DRAFT,
    send_type: getSuggestedEmailType(campaign),
    subject: campaignName
      ? `${campaignName}: propuesta principal`
      : "Asunto del correo",
    preheader: campaignName
      ? `Resumen breve de ${campaignName}`
      : "Resumen breve del correo",
    cta_label: "Ver mas",
    cta_url: "https://example.com",
    scheduled_at: toDateInputValue(campaign?.starts_at),
    shared_document: createDefaultSharedDocumentDraft(),
  };
}

function normalizeCampaignEmailDraftFromDb(rawDraft, campaign) {
  if (!rawDraft || typeof rawDraft !== "object" || Array.isArray(rawDraft)) {
    return null;
  }

  const base = createDefaultDraft(campaign);
  const sharedDocumentRaw =
    rawDraft.shared_document && typeof rawDraft.shared_document === "object"
      ? rawDraft.shared_document
      : {};

  return {
    ...base,
    send_type:
      String(rawDraft.send_type || base.send_type).trim() || base.send_type,
    status: String(rawDraft.status || base.status).trim() || base.status,
    subject: String(rawDraft.subject || base.subject).trim(),
    preheader: "",
    cta_label: String(rawDraft.cta_label || base.cta_label).trim(),
    cta_url: String(rawDraft.cta_url || base.cta_url).trim(),
    html_content:
      String(rawDraft.html_content || base.html_content).trim() ||
      base.html_content,
    scheduled_at: toDateInputValue(rawDraft.scheduled_at || base.scheduled_at),
    batch_size:
      String(rawDraft.batch_size || base.batch_size).trim() || base.batch_size,
    max_sends_per_hour:
      String(rawDraft.max_sends_per_hour || base.max_sends_per_hour).trim() ||
      base.max_sends_per_hour,
    max_sends_per_day:
      String(rawDraft.max_sends_per_day || base.max_sends_per_day).trim() ||
      base.max_sends_per_day,
    test_recipients: String(
      rawDraft.test_recipients || base.test_recipients,
    ).trim(),
    shared_document: {
      ...createDefaultSharedDocumentDraft(),
      ...(sharedDocumentRaw && typeof sharedDocumentRaw === "object"
        ? sharedDocumentRaw
        : {}),
    },
  };
}

function normalizeAssetSearchQuery(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDispatchStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "running") return "En ejecución";
  if (normalized === "paused") return "Pausado";
  if (normalized === "completed") return "Completado";
  if (normalized === "canceled") return "Cancelado";
  if (normalized === "failed") return "Con error";
  return "Sin corrida";
}

function promptRequestsAssetSearch(prompt) {
  const normalized = String(prompt || "").toLowerCase();
  return /(grafico|gráfico|chart|graph|imagen|image|infografia|infografía|infographic)/i.test(
    normalized,
  );
}

function readStoredDrafts() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("campaign-email-module-drafts");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return {};

    const migrated = {};
    for (const [key, draft] of Object.entries(parsed)) {
      const normalizedDraft =
        draft && typeof draft === "object" ? { ...draft } : {};

      if (String(normalizedDraft.batch_size || "").trim() === "250") {
        normalizedDraft.batch_size = DEFAULT_DRAFT.batch_size;
      }
      if (String(normalizedDraft.max_sends_per_hour || "").trim() === "1000") {
        normalizedDraft.max_sends_per_hour = DEFAULT_DRAFT.max_sends_per_hour;
      }
      if (String(normalizedDraft.max_sends_per_day || "").trim() === "10000") {
        normalizedDraft.max_sends_per_day = DEFAULT_DRAFT.max_sends_per_day;
      }

      normalizedDraft.shared_document = {
        ...createDefaultSharedDocumentDraft(),
        ...(normalizedDraft.shared_document &&
        typeof normalizedDraft.shared_document === "object"
          ? normalizedDraft.shared_document
          : {}),
      };

      migrated[key] = normalizedDraft;
    }

    return migrated;
  } catch {
    return {};
  }
}

function readStoredGuideAnalyses() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("campaign-email-module-guides");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return {};

    const normalized = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!String(key || "").trim()) continue;
      normalized[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
    }
    return normalized;
  } catch {
    return {};
  }
}

function readStoredAiPromptText() {
  if (typeof window === "undefined") return "";
  try {
    return String(
      window.localStorage.getItem("campaign-email-module-ai-prompt") || "",
    ).trim();
  } catch {
    return "";
  }
}

function extractHtmlFromAssistantText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const fencedMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;
  if (!candidate) return "";
  if (!/<html[\s>]|<body[\s>]|<table[\s>]|<!doctype html>/i.test(candidate)) {
    return "";
  }
  return candidate;
}

function extractEmailAiPayload(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const fencedJsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fencedJsonMatch ? fencedJsonMatch[1].trim() : text;

  const pickString = (source, keys) => {
    for (const key of keys) {
      const candidate = String(source?.[key] || "").trim();
      if (candidate) return candidate;
    }
    return "";
  };

  const readLabeledField = (labelPattern) => {
    const match = text.match(labelPattern);
    return match ? String(match[1] || "").trim() : "";
  };

  try {
    const parsed = JSON.parse(jsonCandidate);
    const html = extractHtmlFromAssistantText(
      pickString(parsed, ["html", "body_html", "email_html", "content_html"]),
    );
    if (html) {
      return {
        subject: pickString(parsed, ["subject", "title", "email_subject"]),
        preheader: pickString(parsed, [
          "preheader",
          "preview_text",
          "pre_header",
          "subtitle",
        ]),
        html,
      };
    }
  } catch {
    // Ignore and fallback to raw HTML extraction.
  }

  const html = extractHtmlFromAssistantText(text);
  if (!html) return null;
  return {
    subject: readLabeledField(/(?:^|\n)\s*(?:asunto|subject)\s*:\s*(.+)/i),
    preheader: readLabeledField(
      /(?:^|\n)\s*(?:preheader|preview text|preview_text|pre header)\s*:\s*(.+)/i,
    ),
    html,
  };
}

function insertAssetIntoEmailHtml(html, asset) {
  const sourceHtml = String(html || "").trim() || DEFAULT_HTML;
  const assetUrl = String(asset?.sourceUrl || "").trim();
  if (!assetUrl) return sourceHtml;

  const altText = String(asset?.title || "Grafico aprobado").trim();
  const imageBlock = [
    '<div style="margin:18px 0;text-align:center;">',
    `<img src="${assetUrl}" alt="${altText.replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;border:0;border-radius:12px;display:block;margin:0 auto;" />`,
    "</div>",
  ].join("");

  if (sourceHtml.includes("<a ")) {
    return sourceHtml.replace("<a ", `${imageBlock}<a `);
  }

  if (sourceHtml.includes("</td>")) {
    return sourceHtml.replace("</td>", `${imageBlock}</td>`);
  }

  if (sourceHtml.includes("</body>")) {
    return sourceHtml.replace("</body>", `${imageBlock}</body>`);
  }

  return `${sourceHtml}${imageBlock}`;
}

function extractExternalImageUrlsFromHtml(html) {
  const content = String(html || "");
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  const urls = new Set();
  let match = regex.exec(content);

  while (match) {
    const src = String(match[1] || "").trim();
    if (/^https?:\/\//i.test(src)) {
      urls.add(src);
    }
    match = regex.exec(content);
  }

  return Array.from(urls);
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No fue posible convertir imagen"));
    reader.readAsDataURL(blob);
  });
}

async function localizeExternalImagesInHtml(html) {
  const source = String(html || "");
  const urls = extractExternalImageUrlsFromHtml(source);
  if (!urls.length) {
    return { html: source, converted: 0, failed: 0 };
  }

  let outputHtml = source;
  let converted = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        failed += 1;
        continue;
      }
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      if (!dataUrl) {
        failed += 1;
        continue;
      }
      outputHtml = outputHtml.split(url).join(dataUrl);
      converted += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    html: outputHtml,
    converted,
    failed,
  };
}

function extractSearchQueriesFromAssistantText(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  const fencedJsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fencedJsonMatch ? fencedJsonMatch[1].trim() : text;

  try {
    const parsed = JSON.parse(jsonCandidate);
    const queries = Array.isArray(parsed?.queries)
      ? parsed.queries
      : Array.isArray(parsed?.search_queries)
        ? parsed.search_queries
        : Array.isArray(parsed?.suggestions)
          ? parsed.suggestions
          : Array.isArray(parsed)
            ? parsed
            : String(parsed?.query || parsed?.search || "").trim()
              ? [String(parsed?.query || parsed?.search || "").trim()]
              : [];
    return queries
      .map((entry) => normalizeAssetSearchQuery(entry))
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    // Continue to text parsing.
  }

  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .map((line) => line.replace(/^query\s*:\s*/i, "").trim())
    .map((line) => line.replace(/^búsqueda\s*:\s*/i, "").trim())
    .map((line) => normalizeAssetSearchQuery(line))
    .filter((line) => line.length >= 3)
    .filter(Boolean)
    .slice(0, 5);
}

function extractJsonObjectFromText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const extractBalancedObjects = (value, limit = 12) => {
    const source = String(value || "");
    const objects = [];
    let startStack = [];
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
        if (depth === 0) {
          startStack = [index];
        }
        depth += 1;
        continue;
      }

      if (char === "}") {
        if (depth > 0) {
          depth -= 1;
          if (depth === 0 && startStack.length) {
            objects.push(source.slice(startStack[0], index + 1));
            if (objects.length >= limit) {
              break;
            }
            startStack = [];
          }
        }
      }
    }

    return objects;
  };

  const tryParseCandidate = (candidate) => {
    const base = String(candidate || "").trim();
    if (!base) return null;

    const parseStrict = (value) => {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          const firstObject = parsed.find(
            (entry) =>
              entry && typeof entry === "object" && !Array.isArray(entry),
          );
          return firstObject || null;
        }
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
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value) => {
        const escaped = String(value || "")
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        return `: "${escaped}"`;
      });

    return parseStrict(normalized);
  };

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const fencedCandidate = fencedMatch ? fencedMatch[1].trim() : "";
  const directBalanced = extractBalancedObjects(text);
  const fencedBalanced = extractBalancedObjects(fencedCandidate);

  const candidates = [
    fencedCandidate,
    ...fencedBalanced,
    ...directBalanced,
    text,
  ].filter((value, index, list) => {
    if (!String(value || "").trim()) return false;
    return list.findIndex((item) => item === value) === index;
  });

  const scoreGuideShape = (parsed) => {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return -1;
    }
    const has = (key) => Object.prototype.hasOwnProperty.call(parsed, key);
    let score = 0;
    if (has("tipo_campana") || has("campaignType")) score += 2;
    if (has("subtipo_campana") || has("campaignSubtype")) score += 2;
    if (has("resumen_didactico") || has("summary")) score += 2;
    if (has("contexto") || has("context")) score += 2;
    if (has("objetivo") || has("objective")) score += 2;
    if (has("audiencia") || has("audience")) score += 2;
    if (has("ejemplo") || has("example")) score += 2;
    if (has("tips_didacticos") || has("teachingTips")) score += 1;
    if (has("recursos_sugeridos") || has("recommendedResources")) score += 1;
    if (has("tipo_correo_recomendado") || has("recommendedEmailType")) {
      score += 1;
    }
    return score;
  };

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const parsed = tryParseCandidate(candidate);
    if (!parsed) continue;
    const score = scoreGuideShape(parsed);
    if (score > bestScore) {
      best = parsed;
      bestScore = score;
    }
    if (score >= 8) {
      break;
    }
  }

  return best;
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

function buildCampaignAudienceSummary(campaignAudience) {
  const items = Array.isArray(campaignAudience) ? campaignAudience : [];
  const preview = items.slice(0, 5).map((accountItem) => {
    const accountName = String(accountItem?.account_name || "").trim();
    const contacts = Array.isArray(accountItem?.contacts)
      ? accountItem.contacts
      : [];
    const contactNames = contacts
      .map((contact) => String(contact?.contact_name || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    return `${accountName || "Cuenta sin nombre"} (${contacts.length} contacto(s)${
      contactNames.length ? `: ${contactNames.join(", ")}` : ""
    })`;
  });

  return {
    preview,
    totalAccounts: items.length,
    totalContacts: items.reduce(
      (total, accountItem) =>
        total +
        (Array.isArray(accountItem?.contacts)
          ? accountItem.contacts.length
          : 0),
      0,
    ),
  };
}

function buildCampaignDispatchSummary(campaignDispatch) {
  if (!campaignDispatch || typeof campaignDispatch !== "object") {
    return null;
  }

  return {
    status: String(campaignDispatch.status || "").trim(),
    total: Number(campaignDispatch?.summary?.total || 0),
    sent: Number(campaignDispatch?.summary?.sent || 0),
    pending: Number(campaignDispatch?.summary?.pending || 0),
    failed: Number(campaignDispatch?.summary?.failed || 0),
    skipped: Number(campaignDispatch?.summary?.skipped || 0),
    startedAt: String(campaignDispatch.startedAt || "").trim(),
    finishedAt: String(campaignDispatch.finishedAt || "").trim(),
    lastErrorMessage: String(campaignDispatch.lastErrorMessage || "").trim(),
  };
}

function normalizeCampaignGuideAnalysis(raw) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const read = (...keys) => {
    for (const key of keys) {
      const candidate = String(parsed?.[key] || "").trim();
      if (candidate) return candidate;
    }
    return "";
  };
  const readArray = (...keys) => {
    for (const key of keys) {
      const candidate = parsed?.[key];
      if (Array.isArray(candidate)) {
        return candidate
          .map((item) => String(item || "").trim())
          .filter(Boolean);
      }
    }
    return [];
  };
  const readObject = (...keys) => {
    for (const key of keys) {
      const candidate = parsed?.[key];
      if (
        candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate)
      ) {
        return candidate;
      }
    }
    return null;
  };

  const context = readObject("contexto", "context", "guia_contexto") || {};
  const objective = readObject("objetivo", "goal", "objective") || {};
  const audience =
    readObject(
      "a_quien_debe_ir_dirigido",
      "a_quien",
      "audiencia",
      "audience",
    ) || {};
  const example = readObject("ejemplo_sugerido", "ejemplo", "example") || {};

  const normalizeDistinctList = (items, maxItems = 6) => {
    const seen = new Set();
    const list = Array.isArray(items) ? items : [];
    const output = [];
    for (const rawItem of list) {
      const value = String(rawItem || "").trim();
      if (!value) continue;
      const normalized = normalizeComparableText(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(value);
      if (output.length >= maxItems) break;
    }
    return output;
  };

  return {
    campaignTypeEcho: read("tipo_campana", "campaignType", "campaign_type"),
    campaignSubtypeEcho: read(
      "subtipo_campana",
      "campaignSubtype",
      "campaign_subtype",
    ),
    summary:
      read("resumen_didactico", "summary", "resumen") ||
      String(
        context.campana || context.campaign || context.contexto || "",
      ).trim(),
    reason:
      read("razon", "reason", "justificacion") ||
      String(
        objective.que_busca ||
          objective.primary ||
          objective.resultado_esperado ||
          "",
      ).trim(),
    recommendedEmailType: read(
      "tipo_correo_recomendado",
      "recommendedEmailType",
      "emailType",
    ),
    recommendedEmailReason: read(
      "tipo_correo_razon",
      "recommendedEmailReason",
      "emailTypeReason",
    ),
    context: {
      campaign: String(
        context.campana || context.campaign || context.contexto || context,
      ).trim(),
      objective: String(
        context.objetivo_operativo || context.objective || context,
      ).trim(),
      delivery: String(context.entrega || context.delivery || "").trim(),
      interpretation: String(
        context.lectura_combinada || context.interpretation || "",
      ).trim(),
    },
    objective: {
      primary: String(
        objective.que_busca || objective.primary || objective,
      ).trim(),
      expectedResult: String(
        objective.resultado_esperado || objective.expectedResult || objective,
      ).trim(),
      successSignal: String(
        objective.senal_de_exito || objective.successSignal || "",
      ).trim(),
      nextStep: String(
        objective.siguiente_paso || objective.nextStep || "",
      ).trim(),
    },
    audience: {
      primary: String(
        audience.primaria || audience.primary || audience.ideal || audience,
      ).trim(),
      secondary: String(audience.secundaria || audience.secondary || "").trim(),
      exclusions: String(
        audience.exclusion || audience.exclusions || "",
      ).trim(),
    },
    example: {
      subject: String(example.subject || example.asunto || "").trim(),
      preheader: String(
        example.preheader || example.preview || example.pre_encabezado || "",
      ).trim(),
      opening: String(example.apertura || example.opening || "").trim(),
      value: String(example.mensaje_central || example.value || "").trim(),
      proof: String(example.prueba_confianza || example.proof || "").trim(),
      nextStep: String(example.siguiente_paso || example.nextStep || "").trim(),
      closing: String(example.cierre || example.closing || "").trim(),
      cta: String(example.cta || example.callToAction || "").trim(),
    },
    teachingTips: normalizeDistinctList(
      readArray("tips_didacticos", "teachingTips", "tips"),
      6,
    ),
    recommendedResources: normalizeDistinctList(
      readArray(
        "recursos_necesarios",
        "recursos_sugeridos",
        "recommendedResources",
        "resources",
      ),
      6,
    ),
  };
}

function hasCampaignGuideContent(guide) {
  if (!guide || typeof guide !== "object") return false;
  const analysis = normalizeCampaignGuideAnalysis(guide);
  return Boolean(
    String(analysis.summary || "").trim() ||
    String(analysis.reason || "").trim() ||
    String(analysis.context?.campaign || "").trim() ||
    String(analysis.context?.objective || "").trim() ||
    String(analysis.audience?.primary || "").trim() ||
    String(analysis.example?.subject || "").trim() ||
    (Array.isArray(analysis.recommendedResources) &&
      analysis.recommendedResources.length > 0),
  );
}

function evaluateCampaignGuideAnalysisQuality(
  aiGuide,
  baseGuide,
  campaignName,
  campaignGoalText,
) {
  if (!aiGuide || typeof aiGuide !== "object") {
    return {
      ok: false,
      reason: "La IA no devolvio una estructura de guia valida.",
    };
  }

  const summary = String(aiGuide.summary || "").trim();
  const reason = String(aiGuide.reason || "").trim();
  const contextCampaign = String(aiGuide.context?.campaign || "").trim();
  const contextObjective = String(aiGuide.context?.objective || "").trim();
  const contextInterpretation = String(
    aiGuide.context?.interpretation || "",
  ).trim();
  const objectivePrimary = String(aiGuide.objective?.primary || "").trim();
  const objectiveResult = String(
    aiGuide.objective?.expectedResult || "",
  ).trim();
  const exampleSubject = String(aiGuide.example?.subject || "").trim();
  const exampleCta = String(aiGuide.example?.cta || "").trim();
  const exampleOpening = String(aiGuide.example?.opening || "").trim();
  const exampleValue = String(aiGuide.example?.value || "").trim();
  const tips = Array.isArray(aiGuide.teachingTips) ? aiGuide.teachingTips : [];

  const corpus = [
    summary,
    reason,
    contextCampaign,
    contextObjective,
    contextInterpretation,
    objectivePrimary,
    objectiveResult,
    String(aiGuide.objective?.successSignal || "").trim(),
    String(aiGuide.objective?.nextStep || "").trim(),
    String(aiGuide.audience?.primary || "").trim(),
    String(aiGuide.audience?.secondary || "").trim(),
    String(aiGuide.audience?.exclusions || "").trim(),
    String(aiGuide.example?.opening || "").trim(),
    String(aiGuide.example?.value || "").trim(),
    String(aiGuide.example?.proof || "").trim(),
    String(aiGuide.example?.nextStep || "").trim(),
    String(aiGuide.example?.closing || "").trim(),
    ...tips,
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedCorpus = normalizeComparableText(corpus);

  if (/\[[^\]]+\]/.test(corpus)) {
    return {
      ok: false,
      reason:
        "La IA devolvio placeholders genericos (por ejemplo [Nombre]) en lugar de recomendaciones concretas.",
    };
  }

  const genericPatterns = [
    "en esta etapa",
    "en este contexto",
    "segun el contexto",
    "es importante",
    "puede ayudar",
    "se recomienda",
    "debe ser claro",
    "debe ser relevante",
    "mensaje claro y directo",
    "audiencia objetivo",
    "accion esperada",
  ];
  const genericHits = genericPatterns.filter((pattern) =>
    normalizedCorpus.includes(normalizeComparableText(pattern)),
  );
  if (genericHits.length >= 4) {
    return {
      ok: false,
      reason:
        "La IA devolvio texto demasiado generico y repetitivo; falta mayor aterrizaje operativo.",
    };
  }

  const expectedType = normalizeComparableText(baseGuide?.tipoCampana || "");
  const expectedSubtype = normalizeComparableText(
    baseGuide?.subtipoCampana || "",
  );
  const expectedTypeLabel = normalizeComparableText(
    formatLabel(baseGuide?.tipoCampana || ""),
  );
  const expectedSubtypeLabel = normalizeComparableText(
    formatLabel(baseGuide?.subtipoCampana || ""),
  );
  const mentionsTypeOrSubtype =
    (expectedType && normalizedCorpus.includes(expectedType)) ||
    (expectedSubtype && normalizedCorpus.includes(expectedSubtype)) ||
    (expectedTypeLabel && normalizedCorpus.includes(expectedTypeLabel)) ||
    (expectedSubtypeLabel && normalizedCorpus.includes(expectedSubtypeLabel));
  if (!mentionsTypeOrSubtype) {
    return {
      ok: false,
      reason:
        "La IA no menciona de forma explicita el tipo/subtipo de la campaña.",
    };
  }

  const normalizedCampaignName = normalizeComparableText(campaignName || "");
  const campaignNameTokens = normalizedCampaignName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5)
    .slice(0, 4);
  if (campaignNameTokens.length > 0) {
    const mentionsCampaignToken = campaignNameTokens.some((token) =>
      normalizedCorpus.includes(token),
    );
    if (!mentionsCampaignToken) {
      return {
        ok: false,
        reason:
          "La IA no aterriza la guia con referencias especificas al nombre de la campaña.",
      };
    }
  }

  const normalizedGoalText = normalizeComparableText(campaignGoalText || "");
  const goalStopwords = new Set([
    "que",
    "quieres",
    "quiero",
    "lograr",
    "con",
    "la",
    "el",
    "los",
    "las",
    "de",
    "del",
    "para",
    "por",
    "una",
    "uno",
    "unos",
    "unas",
    "esta",
    "este",
    "estos",
    "estas",
    "campana",
    "campanas",
    "objetivo",
    "objetivos",
  ]);
  const goalKeywords = normalizedGoalText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !goalStopwords.has(token))
    .slice(0, 8);
  if (goalKeywords.length > 0) {
    const matchedGoalKeywords = goalKeywords.filter((token) =>
      normalizedCorpus.includes(token),
    );
    const requiredGoalMatches = goalKeywords.length >= 3 ? 2 : 1;
    if (matchedGoalKeywords.length < requiredGoalMatches) {
      return {
        ok: false,
        reason:
          "La IA no aterriza de forma suficiente el objetivo escrito en 'Qué quieres lograr con la campaña'.",
      };
    }

    const exampleCorpus = normalizeComparableText(
      [exampleSubject, exampleOpening, exampleValue, exampleCta]
        .filter(Boolean)
        .join(" "),
    );
    const matchedExampleGoalKeywords = goalKeywords.filter((token) =>
      exampleCorpus.includes(token),
    );
    if (matchedExampleGoalKeywords.length < 1) {
      return {
        ok: false,
        reason:
          "El bloque 'Ejemplo sugerido' no refleja de forma explicita el objetivo escrito en la campaña.",
      };
    }
  }

  const summaryReference = summary || contextCampaign;
  if (summaryReference.length < 80) {
    return {
      ok: false,
      reason: "La IA devolvio contexto demasiado corto o superficial.",
    };
  }

  const reasonReference =
    reason || objectivePrimary || objectiveResult || contextInterpretation;
  if (reasonReference.length < 50) {
    return {
      ok: false,
      reason: "La IA devolvio objetivo insuficiente para sustentar la guia.",
    };
  }

  if (contextCampaign.length < 80 || contextObjective.length < 60) {
    return {
      ok: false,
      reason:
        "La IA devolvio contexto incompleto; falta aterrizar campaña u objetivo operativo.",
    };
  }

  if (contextInterpretation.length < 60) {
    return {
      ok: false,
      reason: "La IA no explico con suficiente detalle la lectura combinada.",
    };
  }

  if (objectivePrimary.length < 50 || objectiveResult.length < 50) {
    return {
      ok: false,
      reason: "La IA no aterrizo bien el objetivo ni el resultado esperado.",
    };
  }

  if (
    exampleSubject.length < 15 ||
    exampleOpening.length < 40 ||
    exampleValue.length < 80 ||
    exampleCta.length < 4
  ) {
    return {
      ok: false,
      reason:
        "La IA devolvio un ejemplo sugerido incompleto o demasiado superficial.",
    };
  }

  return { ok: true, reason: "" };
}

function isGuideAnalysisAlignedWithBase(baseGuide, aiGuide) {
  if (!baseGuide || !aiGuide) {
    return { ok: true, reason: "" };
  }

  const expectedType = normalizeComparableText(baseGuide.tipoCampana || "");
  const expectedSubtype = normalizeComparableText(
    baseGuide.subtipoCampana || "",
  );

  const echoedType = normalizeComparableText(aiGuide.campaignTypeEcho || "");
  const echoedSubtype = normalizeComparableText(
    aiGuide.campaignSubtypeEcho || "",
  );

  if (echoedType && expectedType && echoedType !== expectedType) {
    return {
      ok: false,
      reason: "La IA devolvio un tipo de campaña distinto al seleccionado.",
    };
  }

  if (echoedSubtype && expectedSubtype && echoedSubtype !== expectedSubtype) {
    return {
      ok: false,
      reason: "La IA devolvio un subtipo de campaña distinto al seleccionado.",
    };
  }

  const expectedEmailType = normalizeComparableText(
    baseGuide.suggestedEmailType || "",
  );
  const suggestedByAi = normalizeComparableText(
    aiGuide.recommendedEmailType || "",
  );
  if (
    suggestedByAi &&
    expectedEmailType &&
    suggestedByAi !== expectedEmailType
  ) {
    return {
      ok: false,
      reason:
        "La IA sugirio un tipo de correo que no coincide con la guia base.",
    };
  }

  const textCorpus = [
    aiGuide.summary,
    aiGuide.reason,
    aiGuide.context?.campaign,
    aiGuide.context?.objective,
    aiGuide.context?.delivery,
    aiGuide.context?.interpretation,
    aiGuide.objective?.primary,
    aiGuide.objective?.expectedResult,
    aiGuide.objective?.successSignal,
    aiGuide.objective?.nextStep,
    aiGuide.example?.opening,
    aiGuide.example?.value,
    aiGuide.example?.proof,
    aiGuide.example?.nextStep,
    aiGuide.example?.closing,
    aiGuide.audience?.primary,
    aiGuide.audience?.secondary,
    aiGuide.audience?.exclusions,
    ...(Array.isArray(aiGuide.teachingTips) ? aiGuide.teachingTips : []),
    ...(Array.isArray(aiGuide.recommendedResources)
      ? aiGuide.recommendedResources
      : []),
  ]
    .filter(Boolean)
    .join(" ");

  const normalizedCorpus = normalizeComparableText(textCorpus);

  const subtypeCandidates = Object.keys(SUBTYPE_EXECUTION_PLAYBOOK || {});
  for (const subtypeKey of subtypeCandidates) {
    const normalizedKey = normalizeComparableText(subtypeKey);
    if (!normalizedKey || normalizedKey === expectedSubtype) continue;
    const normalizedLabel = normalizeComparableText(formatLabel(subtypeKey));
    if (
      (normalizedKey && normalizedCorpus.includes(normalizedKey)) ||
      (normalizedLabel && normalizedCorpus.includes(normalizedLabel))
    ) {
      return {
        ok: false,
        reason:
          "La IA incluyo senales semanticas de un subtipo diferente al seleccionado.",
      };
    }
  }

  const campaignTypeCandidates = Object.keys(
    CAMPAIGN_TYPE_CONTEXT_PLAYBOOK || {},
  );
  for (const campaignTypeKey of campaignTypeCandidates) {
    const normalizedKey = normalizeComparableText(campaignTypeKey);
    if (!normalizedKey || normalizedKey === expectedType) continue;
    const normalizedLabel = normalizeComparableText(
      formatLabel(campaignTypeKey),
    );
    if (
      (normalizedKey && normalizedCorpus.includes(normalizedKey)) ||
      (normalizedLabel && normalizedCorpus.includes(normalizedLabel))
    ) {
      return {
        ok: false,
        reason: "La IA incluyo senales semanticas de otro tipo de campaña.",
      };
    }
  }

  return { ok: true, reason: "" };
}
function mergeCampaignGuideAnalysis(baseGuide, analysis) {
  if (!baseGuide) return null;
  if (!analysis || typeof analysis !== "object") return null;
  const ai = normalizeCampaignGuideAnalysis(analysis);
  const campaignGoalAnchor = String(baseGuide.campaignGoalText || "").trim();

  const anchorTextToCampaignGoal = (text) => {
    const source = String(text || "").trim();
    if (!campaignGoalAnchor) return source;
    if (!source) return `Objetivo de campaña: ${campaignGoalAnchor}.`;

    const normalizedSource = normalizeComparableText(source);
    const goalTokens = normalizeComparableText(campaignGoalAnchor)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
      .slice(0, 8);
    const matches = goalTokens.filter((token) =>
      normalizedSource.includes(token),
    );
    if (matches.length > 0) return source;
    return `${source} Objetivo de campaña: ${campaignGoalAnchor}.`;
  };

  const objectiveAnchor = String(
    ai.objective?.primary ||
      ai.objective?.expectedResult ||
      ai.context?.objective ||
      campaignGoalAnchor ||
      "",
  ).trim();

  const sanitizeGuideText = (value) => {
    const source = String(value || "").trim();
    if (!source) return "";
    return source
      .replace(/\[\s*Nombre\s*\]/gi, "el contacto")
      .replace(/\[\s*Empresa\s*\]/gi, "la cuenta")
      .replace(
        /\[\s*tema\s*\]/gi,
        objectiveAnchor
          ? objectiveAnchor.toLowerCase()
          : "el objetivo de la campaña",
      )
      .replace(/\[\s*problema\s*\]/gi, "la necesidad prioritaria")
      .replace(
        /\[\s*objetivo\s*\]/gi,
        objectiveAnchor
          ? objectiveAnchor.toLowerCase()
          : "el objetivo definido",
      )
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  const hasAiGuidePayload =
    Boolean(ai.summary) ||
    Boolean(ai.reason) ||
    Boolean(ai.context?.campaign) ||
    Boolean(ai.context?.objective) ||
    Boolean(ai.context?.delivery) ||
    Boolean(ai.context?.interpretation) ||
    Boolean(ai.objective?.primary) ||
    Boolean(ai.audience?.primary) ||
    Boolean(ai.example?.opening) ||
    (Array.isArray(ai.recommendedResources) &&
      ai.recommendedResources.length > 0);

  if (!hasAiGuidePayload) {
    return null;
  }

  const baseResources = Array.isArray(baseGuide.resources)
    ? baseGuide.resources
    : [];
  const baseResourcesByLabel = new Map(
    baseResources.map((resource) => [
      normalizeComparableText(resource?.label || ""),
      resource,
    ]),
  );

  const aiResources = (
    Array.isArray(ai.recommendedResources) ? ai.recommendedResources : []
  )
    .map((label, index) => {
      const normalizedLabel = normalizeComparableText(label);
      const matchingBase = baseResourcesByLabel.get(normalizedLabel) || null;
      return {
        key:
          String(matchingBase?.key || "").trim() ||
          `ai_resource_${String(index + 1)}`,
        label: label,
        required:
          matchingBase && typeof matchingBase.required === "boolean"
            ? matchingBase.required
            : true,
        status:
          String(matchingBase?.status || "").trim() === "disponible"
            ? "disponible"
            : "pendiente",
      };
    })
    .filter((resource) => String(resource.label || "").trim());

  return {
    ...baseGuide,
    summary: ai.summary,
    reason: ai.reason,
    suggestedEmailType: ai.recommendedEmailType || "",
    recommendedEmailType: ai.recommendedEmailType || "",
    recommendedEmailReason:
      ai.recommendedEmailReason || ai.context?.interpretation || "",
    campaignContextDescription: ai.context?.campaign || "",
    subtypeContextDescription: ai.context?.objective || "",
    deliveryContextDescription: ai.context?.delivery || "",
    emailTypeContextDescription:
      ai.recommendedEmailReason || ai.context?.interpretation || "",
    typeSubtypeContext: {
      interpretation: ai.context?.interpretation || "",
      useWhen: ai.context?.objective || "",
      avoidWhen: ai.reason || "",
    },
    stageClarity: null,
    objectiveDetail: {
      context: anchorTextToCampaignGoal(ai.objective?.primary || ""),
      expectedResult: anchorTextToCampaignGoal(
        ai.objective?.expectedResult || "",
      ),
      successSignal: ai.objective?.successSignal || "",
      nextStep: ai.objective?.nextStep || "",
    },
    audience: {
      primary: ai.audience?.primary || "",
      secondary: ai.audience?.secondary || "",
      exclusions: ai.audience?.exclusions || "",
    },
    example: {
      subject: sanitizeGuideText(ai.example?.subject || ""),
      preheader: sanitizeGuideText(ai.example?.preheader || ""),
      cta: sanitizeGuideText(ai.example?.cta || ""),
    },
    exampleDetail: {
      opening: sanitizeGuideText(ai.example?.opening || ""),
      value: sanitizeGuideText(ai.example?.value || ""),
      proof: sanitizeGuideText(ai.example?.proof || ""),
      nextStep: sanitizeGuideText(ai.example?.nextStep || ""),
      closing: sanitizeGuideText(ai.example?.closing || ""),
    },
    resources: aiResources,
    resourceExamples: aiResources.map((resource) => resource.label),
    aiTeachingTips: ai.teachingTips,
    aiRecommendedResources: ai.recommendedResources,
  };
}

function createEmptyCampaignGuidance(baseGuide) {
  if (!baseGuide || typeof baseGuide !== "object") return null;
  return {
    ...baseGuide,
    tipoCampana: "",
    subtipoCampana: "",
    summary: "",
    reason: "",
    suggestedEmailType: "",
    recommendedEmailType: "",
    recommendedEmailReason: "",
    campaignContextDescription: "",
    subtypeContextDescription: "",
    deliveryContextDescription: "",
    emailTypeContextDescription: "",
    typeSubtypeContext: {
      interpretation: "",
      useWhen: "",
      avoidWhen: "",
    },
    stageClarity: null,
    objectiveDetail: {
      context: "",
      expectedResult: "",
      successSignal: "",
      nextStep: "",
    },
    audience: {
      primary: "",
      secondary: "",
      exclusions: "",
    },
    example: {
      subject: "",
      preheader: "",
      cta: "",
    },
    exampleDetail: {
      opening: "",
      value: "",
      proof: "",
      nextStep: "",
      closing: "",
    },
    resources: [],
    resourceExamples: [],
    aiTeachingTips: [],
    aiRecommendedResources: [],
  };
}

export default function CampaignEmailModulePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignAudience, setCampaignAudience] = useState([]);
  const [draftsByCampaignId, setDraftsByCampaignId] = useState(() =>
    readStoredDrafts(),
  );
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [isLoadingAudience, setIsLoadingAudience] = useState(false);
  const [isAiPromptModalOpen, setIsAiPromptModalOpen] = useState(false);
  const [aiActionMode, setAiActionMode] = useState("generate");
  const [aiPromptText, setAiPromptText] = useState(() =>
    readStoredAiPromptText(),
  );
  const [isGeneratingWithAi, setIsGeneratingWithAi] = useState(false);
  const [aiProgressText, setAiProgressText] = useState("");
  const [isLocalizingImages, setIsLocalizingImages] = useState(false);
  const [isAssetSearchModalOpen, setIsAssetSearchModalOpen] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [assetSearchResults, setAssetSearchResults] = useState([]);
  const [assetSearchSuggestedQueries, setAssetSearchSuggestedQueries] =
    useState([]);
  const [isSearchingAssets, setIsSearchingAssets] = useState(false);
  const [pendingAiRequest, setPendingAiRequest] = useState(null);
  const [landingUrlSuggestions, setLandingUrlSuggestions] = useState([]);
  const [sharedLibraryQuery, setSharedLibraryQuery] = useState("");
  const [sharedLibraryResults, setSharedLibraryResults] = useState([]);
  const [isLoadingSharedLibrary, setIsLoadingSharedLibrary] = useState(false);
  const [isUploadingSharedDocument, setIsUploadingSharedDocument] =
    useState(false);
  const [isGeneratingSharedPreview, setIsGeneratingSharedPreview] =
    useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [isStartingSend, setIsStartingSend] = useState(false);
  const [testSendSummary, setTestSendSummary] = useState(null);
  const [testSendResults, setTestSendResults] = useState([]);
  const [testSendNotice, setTestSendNotice] = useState(null);
  const [campaignDispatch, setCampaignDispatch] = useState(null);
  const [campaignDispatchResults, setCampaignDispatchResults] = useState([]);
  const [resultsSellerFilter, setResultsSellerFilter] = useState("");
  const [isLoadingDispatch, setIsLoadingDispatch] = useState(false);
  const [isUpdatingDispatch, setIsUpdatingDispatch] = useState(false);
  const [campaignGuideAnalysis, setCampaignGuideAnalysis] = useState(null);
  const [guideAnalysesByCampaignId, setGuideAnalysesByCampaignId] = useState(
    () => readStoredGuideAnalyses(),
  );
  const [campaignGuideAnalysisNote, setCampaignGuideAnalysisNote] =
    useState("");
  const [isAnalyzingCampaignGuide, setIsAnalyzingCampaignGuide] =
    useState(false);
  const [isSavingCampaignGuide, setIsSavingCampaignGuide] = useState(false);
  const [isSavingCampaignEmailDraft, setIsSavingCampaignEmailDraft] =
    useState(false);
  const campaignGuideAnalysisRequestRef = useRef(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [ctaDestinationMode, setCtaDestinationMode] = useState("landing");
  const showCampaignSidebar = activeTab === "overview";

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "campaign-email-module-ai-prompt",
        aiPromptText,
      );
    } catch {
      // Ignore persistence failures.
    }
  }, [aiPromptText]);

  const selectedCampaign = useMemo(() => {
    return (
      campaigns.find((campaign) => campaign.id === selectedCampaignId) || null
    );
  }, [campaigns, selectedCampaignId]);

  const persistedCampaignGuideAnalysis = useMemo(() => {
    if (!selectedCampaign) return null;
    if (!hasCampaignGuideContent(selectedCampaign.campaign_email_guide)) {
      return null;
    }
    return normalizeCampaignGuideAnalysis(selectedCampaign.campaign_email_guide);
  }, [selectedCampaign]);
  const resultSellerOptions = useMemo(() => {
    return Array.from(
      new Set(
        campaignDispatchResults
          .map((item) => String(item?.sellerName || "").trim())
          .filter(Boolean),
      ),
    ).sort((first, second) =>
      first.localeCompare(second, "es", { sensitivity: "base" }),
    );
  }, [campaignDispatchResults]);
  const filteredCampaignDispatchResults = useMemo(() => {
    const seller = String(resultsSellerFilter || "").trim();
    if (!seller) return campaignDispatchResults;
    return campaignDispatchResults.filter(
      (item) => String(item?.sellerName || "").trim() === seller,
    );
  }, [campaignDispatchResults, resultsSellerFilter]);

  useEffect(() => {
    setResultsSellerFilter("");
  }, [selectedCampaignId]);

  const normalizedCurrentCampaignGuideAnalysis = useMemo(() => {
    if (!hasCampaignGuideContent(campaignGuideAnalysis)) {
      return null;
    }
    return normalizeCampaignGuideAnalysis(campaignGuideAnalysis);
  }, [campaignGuideAnalysis]);

  const isCampaignGuideDirty = useMemo(() => {
    const currentSerialized = JSON.stringify(
      normalizedCurrentCampaignGuideAnalysis || null,
    );
    const persistedSerialized = JSON.stringify(
      persistedCampaignGuideAnalysis || null,
    );
    return currentSerialized !== persistedSerialized;
  }, [normalizedCurrentCampaignGuideAnalysis, persistedCampaignGuideAnalysis]);

  const currentDraft = useMemo(() => {
    const key = String(selectedCampaignId || "");
    if (!key) return DEFAULT_DRAFT;
    const draft =
      draftsByCampaignId[key] || createDefaultDraft(selectedCampaign);
    return {
      ...draft,
      shared_document: {
        ...createDefaultSharedDocumentDraft(),
        ...(draft?.shared_document && typeof draft.shared_document === "object"
          ? draft.shared_document
          : {}),
      },
    };
  }, [draftsByCampaignId, selectedCampaign, selectedCampaignId]);

  const currentSharedDocument =
    currentDraft.shared_document || createDefaultSharedDocumentDraft();

  useEffect(() => {
    const nextMode =
      currentSharedDocument?.useAsPrimaryCta === false ? "landing" : "download";
    setCtaDestinationMode(nextMode);
  }, [currentSharedDocument?.useAsPrimaryCta, selectedCampaignId]);

  const selectedCtaSuggestionValue = useMemo(() => {
    const cta = String(currentDraft?.cta_label || "").trim();
    return CTA_SUGGESTIONS.includes(cta) ? cta : "";
  }, [currentDraft?.cta_label]);

  const audienceAccountsCount = campaignAudience.length;
  const audienceContactsCount = useMemo(() => {
    return campaignAudience.reduce((total, item) => {
      return total + (Array.isArray(item.contacts) ? item.contacts.length : 0);
    }, 0);
  }, [campaignAudience]);

  const visibleLandingUrlSuggestions = useMemo(() => {
    const campaignName = normalizeComparableText(selectedCampaign?.name || "");
    if (!campaignName) return [];

    return landingUrlSuggestions
      .filter((entry) => {
        const eventName = normalizeComparableText(entry?.eventName || "");
        return (
          eventName.includes(campaignName) || campaignName.includes(eventName)
        );
      })
      .slice(0, 20);
  }, [landingUrlSuggestions, selectedCampaign?.name]);

  const campaignGuidanceBase = useMemo(() => {
    if (!selectedCampaign) return null;

    const tipoCampana = String(selectedCampaign.tipo_campana || "").trim();
    const subtipoCampana = String(
      selectedCampaign.subtipo_campana || "",
    ).trim();
    const priority = getSubtypePriority(tipoCampana, subtipoCampana);
    const playbook = SUBTYPE_PLAYBOOK[subtipoCampana] || FALLBACK_PLAYBOOK;
    const suggestedEmailType =
      EMAIL_TYPE_SUGGESTION_MATRIX[tipoCampana]?.[subtipoCampana] ||
      DEFAULT_DRAFT.send_type;
    const guideRow =
      GUIDE_CONTEXT_TABLE[`${tipoCampana}::${subtipoCampana}`] || null;
    const campaignContextDescription =
      guideRow?.campaignContextDescription ||
      CAMPAIGN_CONTEXT_DETAILS[tipoCampana] ||
      "Contexto general de avance comercial segun objetivo y madurez de la cuenta.";
    const subtypeContextDescription =
      guideRow?.subtypeContextDescription ||
      SUBTYPE_CONTEXT_DETAILS[subtipoCampana] ||
      "Contexto especifico segun comportamiento esperado para este subtipo.";
    const deliveryContextDescription =
      guideRow?.deliveryContextDescription ||
      SUBTYPE_DELIVERY_CONTEXT[subtipoCampana] ||
      "Regla base: el correo se envia cuando el prospecto ya esta identificado y con consentimiento; si es trafico anonimo, primero se captura en landing o formulario.";
    const emailTypeContextDescription =
      guideRow?.emailTypeContextDescription ||
      EMAIL_TYPE_CONTEXT_DETAILS[suggestedEmailType] ||
      "Tipo sugerido segun senal de interes, momento de compra y accion esperada.";
    const stageClarity =
      SUBTYPE_STAGE_CLARITY[subtipoCampana] ||
      CAMPAIGN_STAGE_CLARITY[tipoCampana] ||
      null;
    const campaignGoalTextForGuide = String(
      selectedCampaign?.campaign_goal_text || "",
    ).trim();
    const objectiveForGuide = campaignGoalTextForGuide || playbook.objective;

    const hasCtaUrl = Boolean(String(currentDraft.cta_url || "").trim());
    const hasSharedDocument = Boolean(
      String(currentSharedDocument?.previewUrl || "").trim() ||
      currentSharedDocument?.document?.id ||
      currentSharedDocument?.document?.storageKey,
    );

    const resources = Array.isArray(playbook.resources)
      ? playbook.resources.map((resource) => {
          const key = String(resource.key || "").trim();
          let available = false;
          if (key === "document") available = hasSharedDocument;
          if (key === "landing") available = hasCtaUrl;
          if (key === "registro") available = hasCtaUrl;
          if (key === "encuesta") available = hasCtaUrl;
          if (key === "referidos") available = hasCtaUrl;

          return {
            ...resource,
            status: available ? "disponible" : "pendiente",
          };
        })
      : [];
    const resourceExamples = SUBTYPE_RESOURCE_EXAMPLES[subtipoCampana] || [];

    return {
      tipoCampana,
      subtipoCampana,
      priority,
      suggestedEmailType,
      campaignContextDescription,
      subtypeContextDescription,
      deliveryContextDescription,
      emailTypeContextDescription,
      stageClarity,
      objective: objectiveForGuide,
      campaignGoalText: campaignGoalTextForGuide,
      campaignDescription: String(selectedCampaign?.description || "").trim(),
      objectiveDetail: buildObjectiveDetail({
        tipoCampana,
        subtipoCampana,
        priority,
        suggestedEmailType,
        objective: objectiveForGuide,
        campaignGoalText: campaignGoalTextForGuide,
        resources,
      }),
      audience: playbook.audience || FALLBACK_PLAYBOOK.audience,
      example: playbook.example || FALLBACK_PLAYBOOK.example,
      exampleDetail: buildExampleDetail({
        audience: playbook.audience || FALLBACK_PLAYBOOK.audience,
        example: playbook.example || FALLBACK_PLAYBOOK.example,
        resources,
      }),
      typeSubtypeContext:
        guideRow?.typeSubtypeContext ||
        buildTypeSubtypeContext({
          tipoCampana,
          subtipoCampana,
          suggestedEmailType,
          priority,
        }),
      resources,
      resourceExamples,
    };
  }, [currentDraft.cta_url, currentSharedDocument, selectedCampaign]);

  const campaignGuidance = useMemo(() => {
    if (!campaignGuidanceBase) return null;
    const merged = mergeCampaignGuideAnalysis(
      campaignGuidanceBase,
      campaignGuideAnalysis,
    );
    return merged || createEmptyCampaignGuidance(campaignGuidanceBase);
  }, [campaignGuideAnalysis, campaignGuidanceBase]);

  const hasCampaignContextInGuide = useMemo(() => {
    if (!campaignGuidance) return false;
    return Boolean(
      String(campaignGuidance.tipoCampana || "").trim() ||
      String(campaignGuidance.subtipoCampana || "").trim() ||
      String(campaignGuidance.campaignContextDescription || "").trim() ||
      String(campaignGuidance.subtypeContextDescription || "").trim() ||
      String(campaignGuidance.deliveryContextDescription || "").trim() ||
      String(
        campaignGuidance.typeSubtypeContext?.interpretation || "",
      ).trim() ||
      String(campaignGuidance.typeSubtypeContext?.useWhen || "").trim() ||
      String(campaignGuidance.typeSubtypeContext?.avoidWhen || "").trim() ||
      String(campaignGuidance.emailTypeContextDescription || "").trim() ||
      campaignGuidance.stageClarity,
    );
  }, [campaignGuidance]);

  async function handleAnalyzeCampaignGuide({ force = false } = {}) {
    if (!selectedCampaign || !campaignGuidanceBase) {
      return;
    }

    if (isAnalyzingCampaignGuide && !force) {
      return;
    }

    const requestId = campaignGuideAnalysisRequestRef.current + 1;
    campaignGuideAnalysisRequestRef.current = requestId;

    try {
      setIsAnalyzingCampaignGuide(true);
      setCampaignGuideAnalysisNote("Analizando la guia con IA...");

      const campaignGoalText = String(
        selectedCampaign.campaign_goal_text || "",
      ).trim();
      const campaignDescriptionText = String(
        selectedCampaign.description || "",
      ).trim();
      const campaignClassificationContextText = String(
        selectedCampaign.classification_guide_context || "",
      ).trim();
      const campaignClassificationExamples = Array.isArray(
        selectedCampaign.classification_guide_examples,
      )
        ? selectedCampaign.classification_guide_examples
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];
      const campaignContextExamplesText = [
        campaignClassificationContextText
          ? `Contexto: ${campaignClassificationContextText}`
          : "",
        campaignClassificationExamples.length
          ? `Ejemplos: ${campaignClassificationExamples.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
        .trim();

      const campaignSnapshot = {
        name: String(selectedCampaign.name || "").trim(),
        type: String(selectedCampaign.tipo_campana || "").trim(),
        subtype: String(selectedCampaign.subtipo_campana || "").trim(),
        goalText: campaignGoalText,
        descriptionText: campaignDescriptionText,
      };

      let campaignMatrixRows = [];
      try {
        const catalogsRes = await api.get("/api/campaigns/catalogs");
        campaignMatrixRows = Array.isArray(
          catalogsRes?.data?.campaign_matrix_rows,
        )
          ? catalogsRes.data.campaign_matrix_rows
          : [];
      } catch {
        campaignMatrixRows = [];
      }

      const configuredMatrixRow = campaignMatrixRows.find(
        (row) =>
          String(row?.campaignType || "").trim() === campaignSnapshot.type &&
          String(row?.campaignSubtype || "").trim() ===
            campaignSnapshot.subtype,
      );
      const configuredEmailType = String(
        configuredMatrixRow?.emailType || "",
      ).trim();
      const configuredPriority = String(
        configuredMatrixRow?.priority || "",
      ).trim();
      const configuredOperationalRequirement = String(
        configuredMatrixRow?.operationalRequirement || "",
      ).trim();
      const configuredExampleEmail = String(
        configuredMatrixRow?.exampleEmail || "",
      ).trim();

      const sessionRes = await api.post("/api/chatbot/sessions", {
        locale: "es",
        userContext: {
          module: "campaign_email",
          objective: "analyze_campaign_guide",
          campaignName: String(selectedCampaign.name || "").trim(),
          campaignType: String(selectedCampaign.tipo_campana || "").trim(),
          campaignSubtype: String(
            selectedCampaign.subtipo_campana || "",
          ).trim(),
        },
      });

      const sessionId = String(sessionRes?.data?.sessionId || "").trim();
      if (!sessionId) {
        throw new Error("No fue posible crear sesion IA para la guia");
      }

      const guideSchemaExample =
        '{"tipo_campana":"...","subtipo_campana":"...","tipo_correo_recomendado":"...","tipo_correo_razon":"...","contexto":{"campana":"...","objetivo_operativo":"...","entrega":"...","lectura_combinada":"..."},"objetivo":{"que_busca":"...","resultado_esperado":"...","senal_de_exito":"...","siguiente_paso":"..."},"a_quien_debe_ir_dirigido":{"primaria":"...","secundaria":"...","exclusion":"..."},"ejemplo_sugerido":{"subject":"...","apertura":"...","mensaje_central":"...","prueba_confianza":"...","siguiente_paso":"...","cierre":"...","cta":"..."},"recursos_necesarios":["..."]}';

      const waitForJobCompletion = async ({
        targetJobId,
        failedMessage,
        timeoutMessage,
        maxAttempts = 25,
      }) => {
        let completed = false;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          const jobRes = await api.get(
            `/api/chatbot/jobs/${encodeURIComponent(targetJobId)}`,
          );
          const status = String(jobRes?.data?.status || "queued").trim();
          if (status === "completed") {
            completed = true;
            break;
          }
          if (status === "failed") {
            throw new Error(
              String(jobRes?.data?.error?.message || failedMessage),
            );
          }
        }

        if (!completed) {
          throw new Error(timeoutMessage);
        }
      };

      const fetchLatestAssistantContent = async () => {
        const historyRes = await api.get(
          `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
        );
        const messages = Array.isArray(historyRes?.data?.items)
          ? historyRes.data.items
          : [];
        const reversed = [...messages].reverse();
        const assistantMessage = reversed.find(
          (item) =>
            String(item?.role || "").trim() === "assistant" &&
            String(item?.content || "").trim(),
        );
        const fallbackMessage = reversed.find((item) =>
          String(item?.content || "").trim(),
        );
        const content = String(
          assistantMessage?.content || fallbackMessage?.content || "",
        ).trim();
        return content;
      };

      const requestStrictGuideJsonRecovery = async (reasonLabel) => {
        const recoveryInstruction = [
          "Tu respuesta anterior no fue JSON interpretable.",
          "Repite la respuesta SOLO como JSON valido.",
          "No incluyas markdown, explicaciones ni texto adicional.",
          "No hagas preguntas, no pidas confirmaciones y no solicites mas contexto.",
          "Si falta informacion, infierela de forma prudente y completa todos los campos del JSON.",
          `Contexto y ejemplos de la campaña (obligatorio usar): ${trimForPrompt(campaignContextExamplesText, 1800) || "(sin contexto y ejemplos registrados)"}`,
          `Fila de matriz vigente (si aplica): tipo=${campaignSnapshot.type} | subtipo=${campaignSnapshot.subtype} | prioridad=${configuredPriority || "(no definida)"} | tipo_correo=${configuredEmailType || "(no definido)"} | requisito_operativo=${trimForPrompt(configuredOperationalRequirement, 280) || "(no definido)"}`,
          `Ejemplo de correo de la matriz (si aplica): ${trimForPrompt(configuredExampleEmail, 420) || "(no definido)"}`,
          configuredEmailType
            ? `Debes usar obligatoriamente tipo_correo_recomendado="${configuredEmailType}" y justificarlo en tipo_correo_razon.`
            : "Si no existe tipo de correo configurado en matriz para esta combinación, infiere uno prudente y justificalo.",
          `Usa EXACTAMENTE estos valores en el JSON: tipo_campana=\"${String(campaignSnapshot.type || "").trim()}\" y subtipo_campana=\"${String(campaignSnapshot.subtype || "").trim()}\".`,
          "No reemplaces subtipo_campana por tipo de correo ni por etiquetas alternativas.",
          "Debes devolver SI o SI estas secciones con estos nombres exactos: tipo_campana, subtipo_campana, tipo_correo_recomendado, tipo_correo_razon, contexto, objetivo, a_quien_debe_ir_dirigido, ejemplo_sugerido, recursos_necesarios.",
          `Motivo de recuperacion: ${String(reasonLabel || "sin detalle")}`,
          `Usa exactamente esta estructura: ${guideSchemaExample}`,
        ].join("\n\n");

        const recoveryRes = await api.post("/api/chatbot/messages", {
          sessionId,
          message: toChatbotSafeMessage(recoveryInstruction),
          useContext: false,
          featureCode: "chatbot.assistant",
        });

        const recoveryJobId = String(recoveryRes?.data?.jobId || "").trim();
        if (!recoveryJobId) {
          throw new Error(
            "No fue posible solicitar recuperacion JSON de la guia IA",
          );
        }

        await waitForJobCompletion({
          targetJobId: recoveryJobId,
          failedMessage:
            "No fue posible completar la recuperacion JSON de la guia IA",
          timeoutMessage:
            "La recuperacion JSON de la guia IA tardo demasiado en responder",
          maxAttempts: 20,
        });

        const recoveredContent = await fetchLatestAssistantContent();
        return extractJsonObjectFromText(recoveredContent);
      };

      const parseGuideJsonWithRecovery = async (reasonLabel) => {
        const assistantContent = await fetchLatestAssistantContent();
        let parsed = extractJsonObjectFromText(assistantContent);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }

        const recoveryReasons = [
          reasonLabel,
          `${reasonLabel} (reintento estricto 1)`,
          `${reasonLabel} (reintento estricto 2)`,
        ];

        for (const retryReason of recoveryReasons) {
          parsed = await requestStrictGuideJsonRecovery(retryReason);
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        }

        throw new Error("No fue posible interpretar la respuesta IA");
      };

      const aiInstruction = [
        "Eres un asistente didactico experto en campañas y correos comerciales.",
        "Tu tarea es enriquecer una guia de campaña con explicaciones claras, pedagogicas y accionables.",
        `Campaña: ${trimForPrompt(campaignSnapshot.name, 250)}`,
        `Tipo/Subtipo: ${formatLabel(campaignSnapshot.type)} / ${formatLabel(campaignSnapshot.subtype)}`,
        `Qué quieres lograr con la campaña: ${trimForPrompt(campaignSnapshot.goalText, 700) || "(sin texto registrado)"}`,
        `Descripción de la campaña: ${trimForPrompt(campaignSnapshot.descriptionText, 700) || "(sin descripcion registrada)"}`,
        `Contexto y ejemplos de la campaña (obligatorio usar): ${trimForPrompt(campaignContextExamplesText, 1800) || "(sin contexto y ejemplos registrados)"}`,
        `Fila de matriz vigente (si aplica): tipo=${campaignSnapshot.type} | subtipo=${campaignSnapshot.subtype} | prioridad=${configuredPriority || "(no definida)"} | tipo_correo=${configuredEmailType || "(no definido)"} | requisito_operativo=${trimForPrompt(configuredOperationalRequirement, 280) || "(no definido)"}`,
        `Ejemplo de correo de la matriz (si aplica): ${trimForPrompt(configuredExampleEmail, 420) || "(no definido)"}`,
        configuredEmailType
          ? `Debes usar obligatoriamente tipo_correo_recomendado="${configuredEmailType}" y justificarlo en tipo_correo_razon.`
          : "Si no existe tipo de correo configurado en matriz para esta combinación, infiere uno prudente y justificalo.",
        "Debes reflejar explicitamente ese objetivo en contexto, objetivo y ejemplo_sugerido.",
        "Usa SOLO el nombre de campaña y la combinacion tipo/subtipo recibida.",
        "NO uses contexto de la guia del correo ni textos base de guia para razonar o completar contenido.",
        "No uses datos del borrador actual (asunto, CTA, html), ni audiencia/dispatch reales del sistema como fuente de verdad.",
        "Debes devolver obligatoriamente SOLO estas secciones con estos nombres exactos: tipo_campana, subtipo_campana, tipo_correo_recomendado, tipo_correo_razon, contexto, objetivo, a_quien_debe_ir_dirigido, ejemplo_sugerido, recursos_necesarios.",
        "No uses claves alternativas para esas secciones.",
        "En ejemplo_sugerido debes incluir: subject, apertura, mensaje_central, prueba_confianza, siguiente_paso, cierre, cta.",
        "No hagas preguntas ni pidas confirmaciones; entrega directamente la guia en JSON.",
        `Valores exactos obligatorios en el JSON: tipo_campana=\"${String(campaignSnapshot.type || "").trim()}\" y subtipo_campana=\"${String(campaignSnapshot.subtype || "").trim()}\".`,
        "No reemplaces subtipo_campana por tipo de correo (por ejemplo: 'Correo Masivo').",
        "Prohibido usar placeholders o plantillas vacias (ej. [Nombre], [Empresa], [tema]).",
        "La respuesta debe mencionar explicitamente el nombre de la campaña y su tipo/subtipo en el contenido textual.",
        "Calidad minima obligatoria: contexto.campana >= 80, contexto.objetivo_operativo >= 60, contexto.lectura_combinada >= 60.",
        "Calidad minima obligatoria: objetivo.que_busca >= 50 y objetivo.resultado_esperado >= 50.",
        "Responde solo JSON valido con esta estructura:",
        guideSchemaExample,
        "Hazlo bastante didactico: explica primero el contexto y luego traduce eso a objetivo, a_quien_debe_ir_dirigido y ejemplo_sugerido.",
        "Evita respuestas genericas; usa la combinacion tipo/subtipo para concretar la guia.",
        "tipo_campana y subtipo_campana deben coincidir exactamente con la campaña recibida.",
        "Si algo no esta claro, infierelo solo cuando sea seguro; de lo contrario, dilo de forma prudente.",
      ].join("\n\n");

      const messageRes = await api.post("/api/chatbot/messages", {
        sessionId,
        message: toChatbotSafeMessage(aiInstruction),
        useContext: false,
        featureCode: "chatbot.assistant",
      });

      const jobId = String(messageRes?.data?.jobId || "").trim();
      if (!jobId) {
        throw new Error("No fue posible iniciar el analisis IA");
      }

      await waitForJobCompletion({
        targetJobId: jobId,
        failedMessage: "No fue posible completar el analisis IA de la guia",
        timeoutMessage: "La IA tardo demasiado en responder",
        maxAttempts: 25,
      });

      const parsed = await parseGuideJsonWithRecovery("analisis inicial");

      if (campaignGuideAnalysisRequestRef.current !== requestId) {
        return;
      }

      const normalizedGuideAnalysis = normalizeCampaignGuideAnalysis(parsed);
      if (configuredEmailType) {
        const normalizedExpectedType =
          normalizeComparableText(configuredEmailType);
        const normalizedRecommendedType = normalizeComparableText(
          normalizedGuideAnalysis?.recommendedEmailType || "",
        );

        if (!normalizedRecommendedType) {
          throw new Error(
            "La IA no devolvio tipo_correo_recomendado pese a existir configuracion en matriz",
          );
        }

        if (normalizedRecommendedType !== normalizedExpectedType) {
          throw new Error(
            "La IA devolvio un tipo de correo distinto al configurado en la matriz",
          );
        }
      }
      setCampaignGuideAnalysis(normalizedGuideAnalysis);
      setCampaignGuideAnalysisNote(
        "Guia generada con la respuesta directa de la IA.",
      );
    } catch (requestError) {
      if (campaignGuideAnalysisRequestRef.current !== requestId) {
        return;
      }
      setCampaignGuideAnalysis(null);
      const fallbackMessage =
        "No fue posible completar el analisis IA; la guia no se mostrará hasta obtener una respuesta valida.";
      const resolvedMessage = getApiErrorMessage(requestError, fallbackMessage);
      setCampaignGuideAnalysisNote(resolvedMessage);
      setError(resolvedMessage);
      setSuccess("");
    } finally {
      if (campaignGuideAnalysisRequestRef.current === requestId) {
        setIsAnalyzingCampaignGuide(false);
      }
    }
  }

  useEffect(() => {
    campaignGuideAnalysisRequestRef.current += 1;
    const key = String(selectedCampaign?.id || "").trim();
    const persistedDbGuide =
      selectedCampaign &&
      hasCampaignGuideContent(selectedCampaign.campaign_email_guide)
        ? normalizeCampaignGuideAnalysis(selectedCampaign.campaign_email_guide)
        : null;
    const storedLocalGuide = key
      ? guideAnalysesByCampaignId[key] || null
      : null;
    const nextGuide = persistedDbGuide || storedLocalGuide || null;

    setCampaignGuideAnalysis(nextGuide);
    setCampaignGuideAnalysisNote(
      persistedDbGuide
        ? "Guia cargada desde base de datos."
        : storedLocalGuide
          ? "Guia cargada desde guardado local."
          : "La guia se mostrara en blanco hasta analizar o guardar.",
    );
    setIsAnalyzingCampaignGuide(false);
  }, [
    selectedCampaign?.campaign_email_guide,
    selectedCampaign?.id,
    guideAnalysesByCampaignId,
  ]);

  useEffect(() => {
    let mounted = true;

    async function loadCampaigns() {
      setIsLoadingCampaigns(true);
      setError("");
      try {
        const { data } = await api.get("/api/campaigns");
        if (!mounted) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setCampaigns(items);
        setDraftsByCampaignId((previous) => {
          let changed = false;
          const next = { ...previous };

          for (const campaign of items) {
            const key = String(campaign?.id || "").trim();
            if (!key || next[key]) continue;

            const normalized = normalizeCampaignEmailDraftFromDb(
              campaign?.campaign_email_draft,
              campaign,
            );
            if (!normalized) continue;

            next[key] = normalized;
            changed = true;
          }

          return changed ? next : previous;
        });
        if (!selectedCampaignId && items[0]?.id) {
          setSelectedCampaignId(Number(items[0].id));
        }
      } catch (requestError) {
        if (!mounted) return;
        setError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar las campanas",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingCampaigns(false);
        }
      }
    }

    loadCampaigns();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    let mounted = true;

    async function loadLatestDispatch() {
      if (!selectedCampaignId) {
        setCampaignDispatch(null);
        setCampaignDispatchResults([]);
        return;
      }

      setIsLoadingDispatch(true);
      try {
        const { data } = await api.get(
          `/api/campaign-emails/campaign/${selectedCampaignId}/latest`,
        );
        if (!mounted) return;
        setCampaignDispatch(data?.dispatch || null);
        setCampaignDispatchResults(
          Array.isArray(data?.results) ? data.results : [],
        );
      } catch {
        if (!mounted) return;
        setCampaignDispatch(null);
        setCampaignDispatchResults([]);
      } finally {
        if (mounted) {
          setIsLoadingDispatch(false);
        }
      }
    }

    loadLatestDispatch();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!campaignDispatch?.id) return undefined;
    if (campaignDispatch.status !== "running") return undefined;

    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get(
          `/api/campaign-emails/runs/${campaignDispatch.id}`,
        );
        setCampaignDispatch(data?.dispatch || null);
        setCampaignDispatchResults(
          Array.isArray(data?.results) ? data.results : [],
        );
      } catch {
        // Ignore periodic refresh failures to avoid noisy UX.
      }
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [campaignDispatch?.id, campaignDispatch?.status]);

  async function refreshDispatchStatus() {
    if (!campaignDispatch?.id) return;
    try {
      setIsLoadingDispatch(true);
      const { data } = await api.get(
        `/api/campaign-emails/runs/${campaignDispatch.id}`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setCampaignDispatchResults(
        Array.isArray(data?.results) ? data.results : [],
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar el estado del envío",
        ),
      );
      setSuccess("");
    } finally {
      setIsLoadingDispatch(false);
    }
  }

  async function handlePauseDispatch() {
    if (!campaignDispatch?.id || isUpdatingDispatch) return;
    try {
      setIsUpdatingDispatch(true);
      const { data } = await api.post(
        `/api/campaign-emails/runs/${campaignDispatch.id}/pause`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setSuccess("Envío pausado. Puedes reanudar cuando desees.");
      setError("");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible pausar el envío"),
      );
      setSuccess("");
    } finally {
      setIsUpdatingDispatch(false);
    }
  }

  async function handleResumeDispatch() {
    if (!campaignDispatch?.id || isUpdatingDispatch) return;
    try {
      setIsUpdatingDispatch(true);
      const { data } = await api.post(
        `/api/campaign-emails/runs/${campaignDispatch.id}/resume`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setSuccess("Envío reanudado.");
      setError("");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible reanudar el envío"),
      );
      setSuccess("");
    } finally {
      setIsUpdatingDispatch(false);
    }
  }

  async function handleCancelDispatch() {
    if (!campaignDispatch?.id || isUpdatingDispatch) return;
    const accepted = window.confirm(
      "¿Deseas cancelar esta corrida de envío? Los pendientes se marcarán como omitidos.",
    );
    if (!accepted) return;

    try {
      setIsUpdatingDispatch(true);
      const { data } = await api.post(
        `/api/campaign-emails/runs/${campaignDispatch.id}/cancel`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setSuccess("Corrida cancelada.");
      setError("");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible cancelar el envío"),
      );
      setSuccess("");
    } finally {
      setIsUpdatingDispatch(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadLandingUrlSuggestions() {
      try {
        const { data } = await api.get("/api/landing/v1/landing-pages", {
          params: {
            page: 1,
            page_size: 200,
          },
        });

        if (!mounted) return;

        const items = Array.isArray(data?.items) ? data.items : [];
        const apiBaseUrl = String(
          api.defaults.baseURL || window.location.origin,
        )
          .trim()
          .replace(/\/+$/, "");

        const mapped = items
          .map((item) => {
            const slug = String(item?.slug || "").trim();
            if (!slug) return null;
            return {
              url: `${apiBaseUrl}/api/public/landing/v1/${encodeURIComponent(slug)}/html`,
              eventName: String(item?.event_name || "").trim(),
              slug,
            };
          })
          .filter(Boolean);

        const unique = Array.from(
          new Map(mapped.map((entry) => [entry.url, entry])).values(),
        );
        setLandingUrlSuggestions(unique);
      } catch {
        if (mounted) {
          setLandingUrlSuggestions([]);
        }
      }
    }

    loadLandingUrlSuggestions();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadAudience() {
      if (!selectedCampaignId) {
        setCampaignAudience([]);
        return;
      }

      setIsLoadingAudience(true);
      try {
        const { data } = await api.get(
          `/api/campaigns/${selectedCampaignId}/accounts`,
        );
        if (!mounted) return;
        setCampaignAudience(Array.isArray(data?.items) ? data.items : []);
      } catch (requestError) {
        if (!mounted) return;
        setError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar la audiencia de la campana",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingAudience(false);
        }
      }
    }

    loadAudience();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "campaign-email-module-drafts",
      JSON.stringify(draftsByCampaignId),
    );
  }, [draftsByCampaignId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "campaign-email-module-guides",
      JSON.stringify(guideAnalysesByCampaignId),
    );
  }, [guideAnalysesByCampaignId]);

  function updateDraft(patch) {
    const key = String(selectedCampaignId || "");
    if (!key) return;
    setDraftsByCampaignId((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] || createDefaultDraft(selectedCampaign)),
        ...patch,
      },
    }));
  }

  function updateSharedDocumentDraft(patch) {
    updateDraft({
      shared_document: {
        ...createDefaultSharedDocumentDraft(),
        ...currentSharedDocument,
        ...patch,
      },
    });
  }

  async function handleSaveLocalDraft() {
    const campaignKey = String(selectedCampaignId || "").trim();
    if (!campaignKey) {
      setError("Selecciona una campana antes de guardar el borrador");
      setSuccess("");
      return;
    }

    const payload = {
      ...currentDraft,
      preheader: "",
      shared_document: {
        ...createDefaultSharedDocumentDraft(),
        ...currentSharedDocument,
      },
    };

    try {
      setIsSavingCampaignEmailDraft(true);
      setError("");
      const { data } = await api.patch(
        `/api/campaigns/${encodeURIComponent(campaignKey)}/email-draft`,
        {
          campaign_email_draft: payload,
        },
      );

      const savedCampaign = data?.campaign || null;
      if (savedCampaign?.id) {
        setCampaigns((previous) =>
          previous.map((item) =>
            Number(item.id) === Number(savedCampaign.id) ? savedCampaign : item,
          ),
        );

        const normalized = normalizeCampaignEmailDraftFromDb(
          savedCampaign.campaign_email_draft,
          savedCampaign,
        );
        if (normalized) {
          setDraftsByCampaignId((previous) => ({
            ...previous,
            [campaignKey]: normalized,
          }));
        }
      }

      setSuccess("Borrador guardado en base de datos");
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar el borrador en base de datos",
        ),
      );
      setSuccess("");
    } finally {
      setIsSavingCampaignEmailDraft(false);
    }
  }

  function applyGuideToEditorFields({ force = true } = {}) {
    const guide = campaignGuidance;
    if (!guide || !selectedCampaignId) {
      return false;
    }

    const suggestedSubject = String(guide?.example?.subject || "").trim();
    const suggestedPreheader = String(guide?.example?.preheader || "").trim();
    const suggestedCta = String(guide?.example?.cta || "").trim();
    const suggestedSendType = String(guide?.suggestedEmailType || "").trim();

    const patch = {};
    if (
      suggestedSubject &&
      (force || !String(currentDraft.subject || "").trim())
    ) {
      patch.subject = suggestedSubject;
    }
    if (
      suggestedPreheader &&
      (force || !String(currentDraft.preheader || "").trim())
    ) {
      patch.preheader = suggestedPreheader;
    }
    if (
      suggestedCta &&
      (force || !String(currentDraft.cta_label || "").trim())
    ) {
      patch.cta_label = suggestedCta;
    }
    if (EMAIL_SEND_TYPE_VALUES.includes(suggestedSendType)) {
      if (force || !String(currentDraft.send_type || "").trim()) {
        patch.send_type = suggestedSendType;
      }
    }

    if (Object.keys(patch).length === 0) {
      return false;
    }

    updateDraft(patch);
    return true;
  }

  async function handleSaveGuide() {
    const campaignKey = String(selectedCampaignId || "").trim();
    if (!campaignKey) return;

    const payload =
      campaignGuideAnalysis &&
      typeof campaignGuideAnalysis === "object" &&
      !Array.isArray(campaignGuideAnalysis)
        ? campaignGuideAnalysis
        : {};

    try {
      setIsSavingCampaignGuide(true);
      setError("");
      const { data } = await api.patch(
        `/api/campaigns/${encodeURIComponent(campaignKey)}/email-guide`,
        {
          campaign_email_guide: payload,
        },
      );

      const savedCampaign = data?.campaign || null;
      if (savedCampaign?.id) {
        setCampaigns((previous) =>
          previous.map((item) =>
            Number(item.id) === Number(savedCampaign.id) ? savedCampaign : item,
          ),
        );
      }

      setGuideAnalysesByCampaignId((previous) => ({
        ...previous,
        [campaignKey]: payload,
      }));
      setCampaignGuideAnalysis(payload);
      setCampaignGuideAnalysisNote("Guia guardada en base de datos.");
      const applied = applyGuideToEditorFields({ force: true });
      setSuccess(
        applied
          ? "Guia guardada y aplicada al editor (asunto, tipo y CTA)."
          : "Guia guardada.",
      );
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar la guia en base de datos",
        ),
      );
      setSuccess("");
    } finally {
      setIsSavingCampaignGuide(false);
    }
  }

  function applySharedDocumentPreviewToDraft(url, labelOverride = "") {
    const nextUrl = String(url || "").trim();
    const nextLabel =
      String(
        labelOverride ||
          currentSharedDocument.linkLabel ||
          currentDraft.cta_label ||
          "",
      ).trim() || "Descargar documento";

    updateDraft({
      cta_url: nextUrl,
      cta_label: nextLabel,
      html_content: buildHtmlWithPrimaryCta(
        currentDraft.html_content,
        nextUrl,
        nextLabel,
      ),
    });
  }

  function buildSharedDocumentPayloadForApi() {
    const documentPublicId = String(
      currentSharedDocument.document?.id || "",
    ).trim();
    if (!documentPublicId) return null;

    return {
      publicId: documentPublicId,
      linkMode:
        currentSharedDocument.linkMode === "general"
          ? "general"
          : "per_recipient",
      expiresDays: Number(currentSharedDocument.expiresDays || 30) || 30,
      useAsPrimaryCta: currentSharedDocument.useAsPrimaryCta !== false,
      linkLabel:
        String(
          currentSharedDocument.linkLabel || currentDraft.cta_label || "",
        ).trim() || undefined,
    };
  }

  async function handleSearchSharedLibrary(event) {
    event?.preventDefault?.();
    const query = String(sharedLibraryQuery || "").trim();
    try {
      setIsLoadingSharedLibrary(true);
      setError("");
      const { data } = await api.get("/api/campaign-emails/library-files", {
        params: { q: query },
      });
      setSharedLibraryResults(Array.isArray(data?.items) ? data.items : []);
      if (!Array.isArray(data?.items) || data.items.length === 0) {
        setSuccess(
          "No se encontraron archivos descargables en biblioteca para esa búsqueda.",
        );
      } else {
        setSuccess("");
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible consultar la biblioteca comercial",
        ),
      );
      setSharedLibraryResults([]);
    } finally {
      setIsLoadingSharedLibrary(false);
    }
  }

  async function handleSelectLibraryDocument(item) {
    try {
      setError("");
      const { data } = await api.post(
        "/api/campaign-emails/shared-documents/library",
        {
          campaignId: Number(selectedCampaignId || 0) || undefined,
          assetPublicId: String(item?.assetPublicId || "").trim(),
          filePublicId: String(item?.filePublicId || "").trim(),
          title:
            String(
              currentSharedDocument.title ||
                item?.title ||
                item?.fileName ||
                "",
            ).trim() || "Documento compartido",
          description:
            String(
              currentSharedDocument.description || item?.summary || "",
            ).trim() || undefined,
        },
      );
      const document = data?.document || null;
      updateSharedDocumentDraft({
        document,
        sourceMode: "library_file",
        title: String(
          document?.title || item?.title || item?.fileName || "",
        ).trim(),
        description: String(
          document?.description || item?.summary || "",
        ).trim(),
        previewUrl: "",
        previewExpiresAt: null,
      });
      setSuccess("Documento de biblioteca preparado para compartir.");
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible seleccionar el documento desde biblioteca",
        ),
      );
      setSuccess("");
    }
  }

  async function handleUploadLocalSharedDocument(file) {
    if (!file) return;
    const title = String(currentSharedDocument.title || file.name || "").trim();
    if (!title) {
      setError("Debes indicar un nombre visible para el documento compartido");
      setSuccess("");
      return;
    }

    try {
      setIsUploadingSharedDocument(true);
      setError("");
      const formData = new FormData();
      formData.append(
        "campaignId",
        String(Number(selectedCampaignId || 0) || ""),
      );
      formData.append("title", title);
      formData.append(
        "description",
        String(currentSharedDocument.description || "").trim(),
      );
      formData.append("file", file);

      const { data } = await api.post(
        "/api/campaign-emails/shared-documents/upload",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );

      updateSharedDocumentDraft({
        document: data?.document || null,
        sourceMode: "local_upload",
        title,
        previewUrl: "",
        previewExpiresAt: null,
      });
      setSuccess("Archivo local preparado para compartir.");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el archivo local compartido",
        ),
      );
      setSuccess("");
    } finally {
      setIsUploadingSharedDocument(false);
    }
  }

  async function handleGenerateSharedPreviewLink() {
    const documentPublicId = String(
      currentSharedDocument.document?.id || "",
    ).trim();
    if (!documentPublicId) {
      setError("Selecciona o carga primero un documento para compartir");
      setSuccess("");
      return;
    }

    try {
      setIsGeneratingSharedPreview(true);
      setError("");
      const { data } = await api.post(
        `/api/campaign-emails/shared-documents/${documentPublicId}/preview-link`,
        {
          expiresDays: Number(currentSharedDocument.expiresDays || 30) || 30,
        },
      );

      updateSharedDocumentDraft({
        previewUrl: String(data?.url || "").trim(),
        previewExpiresAt: data?.expiresAt || null,
      });

      if (currentSharedDocument.useAsPrimaryCta !== false) {
        applySharedDocumentPreviewToDraft(
          data?.url,
          currentSharedDocument.linkLabel,
        );
      }

      setSuccess(
        "Enlace de vista previa generado para el documento compartido.",
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible generar el enlace de vista previa",
        ),
      );
      setSuccess("");
    } finally {
      setIsGeneratingSharedPreview(false);
    }
  }

  function parseTestRecipients(value) {
    return String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function formatTestSendStatusLabel(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "sent") return "Enviado";
    if (normalized === "failed") return "Fallido";
    if (normalized === "invalid") return "Inválido";
    if (normalized === "skipped") return "Omitido";
    return String(status || "").trim() || "Sin estado";
  }

  function formatTestSendDetailMessage(message) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    if (!text) return "Sin detalle";
    if (lower.includes("recipient") && lower.includes("required")) {
      return "Falta el destinatario del correo.";
    }
    const normalized = normalizeUiMessage(text);
    if (
      normalized === "Google no permitió enviar el correo." &&
      lower.includes("google_send_failed")
    ) {
      return "Google no permitió enviar el correo de prueba.";
    }
    return normalized;
  }

  function formatGlobalAlertMessage(rawMessage) {
    return normalizeUiMessage(rawMessage);
  }

  function hasInvalidEmail(entries) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return entries.some((entry) => !emailRegex.test(entry));
  }

  async function handleSendTestEmail() {
    if (isSendingTestEmail) return;

    const recipients = parseTestRecipients(currentDraft.test_recipients);
    if (!recipients.length) {
      const message = "Debes indicar al menos un correo de prueba en el editor";
      setError(message);
      setTestSendNotice({ variant: "error", message });
      setSuccess("");
      return;
    }

    if (hasInvalidEmail(recipients)) {
      const message =
        "La lista de correos de prueba contiene direcciones con formato inválido";
      setError(message);
      setTestSendNotice({ variant: "error", message });
      setSuccess("");
      return;
    }

    const subject = String(currentDraft.subject || "").trim();
    const htmlContent = buildHtmlWithPrimaryCta(
      String(currentDraft.html_content || "").trim(),
      currentDraft.cta_url,
      currentDraft.cta_label,
    );

    if (!subject) {
      const message = "Debes definir asunto antes de enviar prueba";
      setError(message);
      setTestSendNotice({ variant: "error", message });
      setSuccess("");
      return;
    }

    if (!htmlContent) {
      const message = "Debes definir contenido HTML antes de enviar prueba";
      setError(message);
      setTestSendNotice({ variant: "error", message });
      setSuccess("");
      return;
    }

    try {
      setIsSendingTestEmail(true);
      setError("");
      setSuccess("");
      setTestSendNotice(null);

      const { data } = await api.post("/api/campaign-emails/test-send", {
        recipients,
        recipientsText: currentDraft.test_recipients,
        subject,
        preheader: String(currentDraft.preheader || "").trim(),
        htmlContent,
        ctaLabel: String(currentDraft.cta_label || "").trim(),
        ctaUrl: String(currentDraft.cta_url || "").trim(),
        sharedDocument: buildSharedDocumentPayloadForApi(),
      });

      setTestSendSummary(data?.summary || null);
      setTestSendResults(Array.isArray(data?.results) ? data.results : []);

      const sent = Number(data?.summary?.sent || 0);
      const failed = Number(data?.summary?.failed || 0);
      const invalid = Number(data?.summary?.invalid || 0);
      const message = `Prueba enviada. Exitos: ${sent}, Fallidos: ${failed}, Invalidos: ${invalid}.`;
      setSuccess(message);
      setTestSendNotice({ variant: "success", message });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible enviar correos de prueba",
      );
      setError(message);
      setTestSendNotice({ variant: "error", message });
      setSuccess("");
      setTestSendSummary(null);
      setTestSendResults([]);
    } finally {
      setIsSendingTestEmail(false);
    }
  }

  function collectCampaignAudienceEmails() {
    const recipients = [];
    for (const accountItem of campaignAudience) {
      const accountId = Number(accountItem?.account_id || 0) || null;
      const accountName =
        String(accountItem?.account_name || "").trim() || null;
      const contacts = Array.isArray(accountItem?.contacts)
        ? accountItem.contacts
        : [];
      for (const contact of contacts) {
        const email = String(contact?.email || "")
          .trim()
          .toLowerCase();
        if (email) {
          recipients.push({
            email,
            contactId: Number(contact?.contact_id || 0) || null,
            accountId,
            contactName: String(contact?.contact_name || "").trim() || null,
            accountName,
          });
        }
      }
    }

    return Array.from(
      new Map(recipients.map((item) => [item.email, item])).values(),
    );
  }

  async function handleStartCampaignSend() {
    if (isStartingSend) return;

    const recipients = collectCampaignAudienceEmails();
    if (!recipients.length) {
      setError("La campaña no tiene contactos con correo para enviar");
      setSuccess("");
      return;
    }

    const subject = String(currentDraft.subject || "").trim();
    const htmlContent = buildHtmlWithPrimaryCta(
      String(currentDraft.html_content || "").trim(),
      currentDraft.cta_url,
      currentDraft.cta_label,
    );
    if (!subject) {
      setError("Debes definir asunto antes de iniciar envío");
      setSuccess("");
      return;
    }
    if (!htmlContent) {
      setError("Debes definir HTML antes de iniciar envío");
      setSuccess("");
      return;
    }

    const accepted = window.confirm(
      `Se programará el envío automático para ${recipients.length} destinatarios con tope fijo de 50 por hora y 300 por día. ¿Deseas continuar?`,
    );
    if (!accepted) {
      return;
    }

    try {
      setIsStartingSend(true);
      setError("");
      setSuccess("");

      const { data } = await api.post("/api/campaign-emails/send", {
        campaignId: Number(selectedCampaignId || 0) || undefined,
        recipients,
        subject,
        preheader: String(currentDraft.preheader || "").trim(),
        htmlContent,
        ctaLabel: String(currentDraft.cta_label || "").trim(),
        ctaUrl: String(currentDraft.cta_url || "").trim(),
        sharedDocument: buildSharedDocumentPayloadForApi(),
      });
      setCampaignDispatch(data?.dispatch || null);
      setCampaignDispatchResults(
        Array.isArray(data?.invalidResults) ? data.invalidResults : [],
      );

      const queued = Number(data?.summary?.queued || 0);
      const invalid = Number(data?.summary?.invalid || 0);
      setSuccess(
        `${String(data?.message || "Envío programado")} En cola: ${queued}. Invalidos: ${invalid}.`,
      );
      setActiveTab("results");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible iniciar el envío de correos",
        ),
      );
      setSuccess("");
    } finally {
      setIsStartingSend(false);
    }
  }

  async function handleLocalizeExternalImages() {
    if (isLocalizingImages) return;

    const sourceHtml = String(currentDraft.html_content || "").trim();
    if (!sourceHtml) return;

    try {
      setIsLocalizingImages(true);
      const result = await localizeExternalImagesInHtml(sourceHtml);
      if (result.converted > 0) {
        updateDraft({ html_content: result.html });
        setSuccess(
          result.failed > 0
            ? `Se localizaron ${result.converted} imagen(es) y ${result.failed} no pudieron descargarse.`
            : `Se localizaron ${result.converted} imagen(es) externas.`,
        );
        setError("");
        return;
      }

      if (result.failed > 0) {
        setError(
          "No fue posible descargar las imágenes externas detectadas. Revisa que los enlaces sean públicos.",
        );
        setSuccess("");
        return;
      }

      setSuccess("No se encontraron URLs externas de imágenes para localizar.");
      setError("");
    } catch {
      setError("No fue posible localizar imágenes externas del correo");
      setSuccess("");
    } finally {
      setIsLocalizingImages(false);
    }
  }

  function handleOpenAssetSearchModal(initialQuery = "") {
    setAssetSearchQuery(String(initialQuery || "").trim());
    setAssetSearchResults([]);
    setIsAssetSearchModalOpen(true);
  }

  function handleCloseAssetSearchModal() {
    if (isSearchingAssets) return;
    setIsAssetSearchModalOpen(false);
    setAssetSearchSuggestedQueries([]);
    setPendingAiRequest(null);
  }

  async function fetchAssetResultsForQuery(query) {
    const response = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        query,
      )}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=720&format=json&origin=*`,
    );

    if (!response.ok) {
      throw new Error("No fue posible consultar resultados en internet");
    }

    const data = await response.json();
    const pages = Object.values(data?.query?.pages || {});
    return pages
      .map((page) => {
        const imageInfo = Array.isArray(page?.imageinfo)
          ? page.imageinfo[0]
          : null;
        if (!imageInfo?.url) return null;
        return {
          id: Number(page?.pageid || 0),
          title: String(page?.title || "")
            .replace(/^File:/i, "")
            .trim(),
          sourceUrl: String(imageInfo.url || "").trim(),
          thumbnailUrl: String(
            imageInfo.thumburl || imageInfo.url || "",
          ).trim(),
          width: Number(imageInfo.thumbwidth || imageInfo.width || 0),
          height: Number(imageInfo.thumbheight || imageInfo.height || 0),
          mime: String(imageInfo.mime || "").trim(),
        };
      })
      .filter(Boolean)
      .filter((item) => item.thumbnailUrl && item.sourceUrl);
  }

  async function getAiAssetSearchQueries(prompt) {
    if (!selectedCampaign) return [];

    const sessionRes = await api.post("/api/chatbot/sessions", {
      locale: "es",
      userContext: {
        module: "campaign_email_assets",
        objective: "search_graphic_queries",
        campaignName: String(selectedCampaign.name || "").trim(),
      },
    });

    const sessionId = String(sessionRes?.data?.sessionId || "").trim();
    if (!sessionId) {
      throw new Error(
        "No fue posible crear sesión IA para búsqueda de gráficos",
      );
    }

    const aiInstruction = [
      "Genera entre 3 y 5 consultas de búsqueda para encontrar un gráfico o imagen útil para un correo comercial.",
      'Devuelve solo JSON válido con esta estructura: {"queries": ["query 1", "query 2"]}.',
      "Las consultas deben ser cortas, concretas y útiles para buscar en repositorios visuales.",
      "Prioriza términos visuales en inglés cuando ayuden a encontrar mejores resultados.",
      `Campaña: ${String(selectedCampaign.name || "").trim()}`,
      `Tipo de campaña: ${formatLabel(selectedCampaign.tipo_campana)}`,
      `Subtipo de campaña: ${formatLabel(selectedCampaign.subtipo_campana)}`,
      `Tipo de correo: ${formatLabel(currentDraft.send_type)}`,
      `CTA: ${String(currentDraft.cta_label || "").trim()}`,
      "Pedido del usuario:",
      String(prompt || "").trim(),
    ].join("\n\n");

    const messageRes = await api.post("/api/chatbot/messages", {
      sessionId,
      message: aiInstruction,
      useContext: false,
      featureCode: "chatbot.assistant",
    });

    const jobId = String(messageRes?.data?.jobId || "").trim();
    if (!jobId) {
      throw new Error("No fue posible iniciar la búsqueda guiada por IA");
    }

    let attempts = 0;
    let jobCompleted = false;
    while (attempts < 25) {
      attempts += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const jobRes = await api.get(
        `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
      );
      const status = String(jobRes?.data?.status || "queued").trim();

      if (status === "completed") {
        jobCompleted = true;
        break;
      }

      if (status === "failed") {
        throw new Error("La IA no pudo proponer búsquedas de gráficos");
      }
    }

    if (!jobCompleted) {
      throw new Error(
        "Tiempo de espera agotado para búsquedas de gráficos con IA",
      );
    }

    const historyRes = await api.get(
      `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    const messages = Array.isArray(historyRes?.data?.items)
      ? historyRes.data.items
      : [];
    const assistantMessage = [...messages]
      .reverse()
      .find((item) => String(item?.role || "").trim() === "assistant");
    const assistantContent = String(assistantMessage?.content || "").trim();
    return extractSearchQueriesFromAssistantText(assistantContent);
  }

  async function handleSearchAssets(
    event,
    queryOverride = "",
    queryCandidates = [],
  ) {
    event?.preventDefault?.();
    const query = String(queryOverride || assetSearchQuery || "").trim();
    if (!query) {
      setError("Debes escribir una búsqueda para encontrar gráficos");
      setSuccess("");
      return;
    }

    try {
      setIsSearchingAssets(true);
      setError("");
      setSuccess("");
      const orderedQueries = Array.from(
        new Set(
          [query, ...(Array.isArray(queryCandidates) ? queryCandidates : [])]
            .map((entry) => normalizeAssetSearchQuery(entry))
            .filter(Boolean),
        ),
      );

      if (!orderedQueries.length) {
        throw new Error("La IA no propuso consultas de búsqueda válidas");
      }

      let results = [];
      let resolvedQuery = orderedQueries[0] || query;
      for (const candidateQuery of orderedQueries) {
        const candidateResults =
          await fetchAssetResultsForQuery(candidateQuery);
        if (candidateResults.length) {
          results = candidateResults;
          resolvedQuery = candidateQuery;
          break;
        }
      }

      setAssetSearchQuery(resolvedQuery);
      setAssetSearchResults(results);
      if (!results.length) {
        setError("No se encontraron imágenes útiles para esa búsqueda");
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible buscar gráficos en internet",
        ),
      );
      setAssetSearchResults([]);
    } finally {
      setIsSearchingAssets(false);
    }
  }

  async function handleApproveAsset(asset) {
    if (pendingAiRequest?.prompt) {
      setIsAssetSearchModalOpen(false);
      const promptWithAsset = [
        pendingAiRequest.prompt,
        "",
        "Usa este asset aprobado por el usuario si resulta pertinente:",
        `Título: ${String(asset?.title || "").trim()}`,
        `URL: ${String(asset?.sourceUrl || "").trim()}`,
      ].join("\n");
      setPendingAiRequest(null);
      await handleGenerateEmailWithAi(
        promptWithAsset,
        pendingAiRequest.mode,
        asset,
      );
      return;
    }

    updateDraft({
      html_content: insertAssetIntoEmailHtml(currentDraft.html_content, asset),
    });
    setIsAssetSearchModalOpen(false);
    setSuccess("Gráfico aprobado e insertado en el correo");
    setError("");
  }

  function handleOpenAiPromptModal(mode) {
    if (!selectedCampaign) {
      setError("Selecciona una campaña antes de usar IA");
      setSuccess("");
      return;
    }

    const normalizedMode = mode === "improve" ? "improve" : "generate";
    setAiActionMode(normalizedMode);

    setAiPromptText((current) => {
      if (String(current || "").trim()) return current;
      return [
        `Campaña: ${selectedCampaign.name || ""}`,
        `Tipo de campaña: ${formatLabel(selectedCampaign.tipo_campana)}`,
        `Subtipo de campaña: ${formatLabel(selectedCampaign.subtipo_campana)}`,
        `Tipo de correo: ${formatLabel(currentDraft.send_type)}`,
        `CTA principal: ${currentDraft.cta_label || ""}`,
        "Objetivo del correo:",
        "Audiencia:",
        "Tono deseado:",
        normalizedMode === "improve"
          ? "Cambios puntuales sobre el correo actual:"
          : "Lineamientos para generar el correo desde cero:",
      ].join("\n");
    });

    setIsAiPromptModalOpen(true);
  }

  function handleCloseAiPromptModal() {
    if (isGeneratingWithAi) return;
    setIsAiPromptModalOpen(false);
  }

  async function handleGenerateEmailWithAi(
    initialPrompt,
    mode = "generate",
    approvedAsset = null,
  ) {
    if (!selectedCampaign) {
      setError("Selecciona una campaña antes de usar IA");
      setSuccess("");
      return;
    }

    const prompt = String(initialPrompt || "").trim();
    if (!prompt) {
      setError("Debes escribir instrucciones para IA");
      setSuccess("");
      return;
    }

    try {
      setIsGeneratingWithAi(true);
      setAiProgressText("Preparando contexto para IA...");
      setError("");
      setSuccess("");

      const sessionRes = await api.post("/api/chatbot/sessions", {
        locale: "es",
        userContext: {
          module: "campaign_email",
          objective: "generate_campaign_email_html",
          campaignName: String(selectedCampaign.name || "").trim(),
          campaignType: String(selectedCampaign.tipo_campana || "").trim(),
          campaignSubtype: String(
            selectedCampaign.subtipo_campana || "",
          ).trim(),
          emailType: String(currentDraft.send_type || "").trim(),
        },
      });

      const sessionId = String(sessionRes?.data?.sessionId || "").trim();
      if (!sessionId) throw new Error("No fue posible crear sesión IA");

      setAiProgressText("Enviando instrucciones al asistente...");

      const aiInstruction = [
        mode === "improve"
          ? "Mejora un correo HTML existente para una campaña comercial."
          : "Genera un correo HTML completo desde cero para una campaña comercial.",
        'Devuelve exclusivamente un JSON válido con esta estructura: {"subject":"...","html":"<!doctype html>..."}.',
        "No devuelvas explicaciones, ni markdown, ni texto adicional fuera del JSON.",
        "Debe ser responsive, profesional, claro y orientado a conversión.",
        `Campaña: ${String(selectedCampaign.name || "").trim() || "Campaña"}`,
        `Tipo de campaña: ${formatLabel(selectedCampaign.tipo_campana)}`,
        `Subtipo de campaña: ${formatLabel(selectedCampaign.subtipo_campana)}`,
        `Tipo de correo: ${formatLabel(currentDraft.send_type)}`,
        `Asunto actual: ${String(currentDraft.subject || "").trim()}`,
        `CTA principal: ${String(currentDraft.cta_label || "").trim()}`,
        `URL CTA: ${String(currentDraft.cta_url || "").trim()}`,
        `Descripción campaña: ${String(selectedCampaign.description || "").trim()}`,
        `Audiencia estimada: ${audienceContactsCount} contactos en ${audienceAccountsCount} cuentas`,
        approvedAsset?.sourceUrl
          ? `Asset aprobado por el usuario: ${String(approvedAsset.sourceUrl || "").trim()}`
          : "",
        approvedAsset?.title
          ? `Nombre del asset aprobado: ${String(approvedAsset.title || "").trim()}`
          : "",
        mode === "improve"
          ? "HTML actual de referencia:"
          : "Plantilla base de referencia:",
        String(
          mode === "improve"
            ? currentDraft.html_content || DEFAULT_HTML
            : DEFAULT_HTML,
        )
          .trim()
          .slice(0, 50000),
        "Instrucciones del usuario:",
        prompt,
      ].join("\n\n");

      const messageRes = await api.post("/api/chatbot/messages", {
        sessionId,
        message: aiInstruction,
        useContext: false,
        featureCode: "chatbot.assistant",
      });

      const jobId = String(messageRes?.data?.jobId || "").trim();
      if (!jobId) throw new Error("No fue posible iniciar generación IA");

      setAiProgressText("Generando correo con IA...");

      let attempts = 0;
      let jobCompleted = false;
      while (attempts < 35) {
        attempts += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const jobRes = await api.get(
          `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
        );
        const status = String(jobRes?.data?.status || "queued").trim();

        if (status === "completed") {
          jobCompleted = true;
          break;
        }

        if (status === "failed") {
          throw new Error("La IA no pudo completar la generación");
        }
      }

      if (!jobCompleted) {
        throw new Error("Tiempo de espera agotado para IA");
      }

      const historyRes = await api.get(
        `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
      );
      const messages = Array.isArray(historyRes?.data?.items)
        ? historyRes.data.items
        : [];
      const assistantMessage = [...messages]
        .reverse()
        .find((item) => String(item?.role || "").trim() === "assistant");
      const assistantContent = String(assistantMessage?.content || "").trim();
      const generatedPayload = extractEmailAiPayload(assistantContent);
      if (!generatedPayload?.html) {
        throw new Error("La IA no devolvió asunto o HTML utilizable");
      }

      updateDraft({
        subject:
          generatedPayload.subject ||
          currentDraft.subject ||
          "Asunto del correo",
        preheader: generatedPayload.preheader || currentDraft.preheader || "",
        html_content: generatedPayload.html,
      });
      setSuccess(
        mode === "improve"
          ? "Correo mejorado con IA"
          : "Correo generado con IA",
      );
      return;
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible generar el correo con IA",
        ),
      );
      setSuccess("");
    } finally {
      setIsGeneratingWithAi(false);
      setAiProgressText("");
    }
  }

  async function handleSubmitAiPrompt(event) {
    event.preventDefault();
    const prompt = String(aiPromptText || "").trim();
    if (!prompt) {
      setError("Debes escribir instrucciones para IA");
      setSuccess("");
      return;
    }

    setIsAiPromptModalOpen(false);
    await handleGenerateEmailWithAi(prompt, aiActionMode);
  }

  return (
    <section className="campaign-email-page">
      <header className="campaign-email-head">
        <div>
          <h2>Correos de campana</h2>
          <p>
            Modulo temporal para crear, organizar y monitorear correos ligados a
            campanas y su audiencia objetivo.
          </p>
        </div>
        <div className="campaign-email-head-actions">
          <NavLink className="campaign-email-inline-link" to="/campaigns">
            Volver a Campanas
          </NavLink>
          <NavLink className="campaign-email-inline-link" to="/landing">
            Ir a Landing por evento
          </NavLink>
        </div>
      </header>

      <div
        className="campaign-email-tabs"
        role="tablist"
        aria-label="Secciones correo"
      >
        {MODULE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "is-active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="campaign-email-alert campaign-email-alert-error">
          <span>{formatGlobalAlertMessage(error)}</span>
          <button
            type="button"
            className="campaign-email-alert-close"
            onClick={() => setError("")}
            aria-label="Cerrar notificacion de error"
          >
            ×
          </button>
        </div>
      ) : null}
      {success ? (
        <div className="campaign-email-alert campaign-email-alert-success">
          <span>{formatGlobalAlertMessage(success)}</span>
          <button
            type="button"
            className="campaign-email-alert-close"
            onClick={() => setSuccess("")}
            aria-label="Cerrar notificacion de exito"
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="campaign-email-panel">
        <div
          className={`campaign-email-grid-main ${showCampaignSidebar ? "campaign-email-grid-two" : ""}`.trim()}
        >
          {showCampaignSidebar ? (
            <article className="campaign-email-card campaign-email-sidebar-card">
              <div className="campaign-email-list-head">
                <h3>Campanas</h3>
                <small>{campaigns.length} registradas</small>
              </div>
              {isLoadingCampaigns ? (
                <p className="campaign-email-muted">Cargando campanas...</p>
              ) : null}
              {!isLoadingCampaigns && campaigns.length === 0 ? (
                <p className="campaign-email-muted">
                  No hay campanas disponibles.
                </p>
              ) : null}
              <div className="campaign-email-campaign-list">
                {campaigns.map((campaign) => {
                  const isSelected =
                    Number(campaign.id) === Number(selectedCampaignId);
                  return (
                    <button
                      key={campaign.id}
                      type="button"
                      className={isSelected ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedCampaignId(Number(campaign.id));
                        setSuccess("");
                        setError("");
                      }}
                    >
                      <strong>{campaign.name}</strong>
                      <span>
                        {formatLabel(campaign.tipo_campana)} ·{" "}
                        {formatLabel(campaign.subtipo_campana)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>
          ) : null}

          <article className="campaign-email-card">
            {selectedCampaign ? (
              <>
                <div className="campaign-email-summary-head">
                  <div>
                    <h3>{selectedCampaign.name}</h3>
                    <p>
                      {formatLabel(selectedCampaign.tipo_campana)} ·{" "}
                      {formatLabel(selectedCampaign.subtipo_campana)} ·{" "}
                      {formatLabel(selectedCampaign.estado_campana)}
                    </p>
                  </div>
                  <div className="campaign-email-metrics">
                    <div>
                      <strong>{audienceAccountsCount}</strong>
                      <span>Cuentas</span>
                    </div>
                    <div>
                      <strong>{audienceContactsCount}</strong>
                      <span>Contactos</span>
                    </div>
                  </div>
                </div>

                {activeTab === "overview" ? (
                  <>
                    <div className="campaign-email-guide-panel">
                      <div className="campaign-email-guide-head">
                        <div className="campaign-email-guide-head-title">
                          <strong>Guia del correo</strong>
                          <small>
                            {campaignGuideAnalysisNote ||
                              "La guia se mostrara cuando ejecutes el analisis con IA."}
                          </small>
                        </div>
                        <div className="campaign-email-guide-head-actions">
                          <button
                            type="button"
                            className="campaign-email-guide-ai-button"
                            onClick={() =>
                              handleAnalyzeCampaignGuide({ force: true })
                            }
                            disabled={isAnalyzingCampaignGuide}
                          >
                            {isAnalyzingCampaignGuide
                              ? "Reanalizando guia..."
                              : "Analizar con IA"}
                          </button>
                          <button
                            type="button"
                            className="campaign-email-guide-ai-button"
                            onClick={handleSaveGuide}
                            disabled={
                              isAnalyzingCampaignGuide ||
                              isSavingCampaignGuide ||
                              !isCampaignGuideDirty
                            }
                          >
                            {isSavingCampaignGuide
                              ? "Guardando guia..."
                              : "Guardar guia"}
                          </button>
                          <small className="campaign-email-muted">
                            {isCampaignGuideDirty
                              ? "Cambios pendientes en guia"
                              : "Guia guardada"}
                          </small>
                          {campaignGuidance ? (
                            <span
                              className={`campaign-email-guide-priority campaign-email-guide-priority-${campaignGuidance.priority}`}
                            >
                              {campaignGuidance.priority === "prioritaria"
                                ? "Prioritaria"
                                : campaignGuidance.priority === "secundaria"
                                  ? "Secundaria"
                                  : "Informativa"}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {campaignGuidance ? (
                        <>
                          {campaignGuidance.summary ? (
                            <div className="campaign-email-guide-block campaign-email-guide-ai-summary">
                              <h4>Analisis pedagogico de la campaña</h4>
                              <p>{campaignGuidance.summary}</p>
                              {campaignGuidance.reason ? (
                                <p>
                                  <strong>Razón del analisis:</strong>{" "}
                                  {campaignGuidance.reason}
                                </p>
                              ) : null}
                              {Array.isArray(campaignGuidance.aiTeachingTips) &&
                              campaignGuidance.aiTeachingTips.length ? (
                                <>
                                  <small>Cómo leer esta guía:</small>
                                  <ul className="campaign-email-guide-list">
                                    {campaignGuidance.aiTeachingTips.map(
                                      (item) => (
                                        <li key={item}>{item}</li>
                                      ),
                                    )}
                                  </ul>
                                </>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="campaign-email-guide-block">
                            <h4>Contexto de campana</h4>
                            {hasCampaignContextInGuide ? (
                              <>
                                {campaignGuidance.tipoCampana ||
                                campaignGuidance.subtipoCampana ? (
                                  <p>
                                    {formatLabel(campaignGuidance.tipoCampana)}
                                    {campaignGuidance.subtipoCampana
                                      ? ` · ${formatLabel(campaignGuidance.subtipoCampana)}`
                                      : ""}
                                  </p>
                                ) : null}
                                {campaignGuidance.campaignContextDescription ? (
                                  <p>
                                    {
                                      campaignGuidance.campaignContextDescription
                                    }
                                  </p>
                                ) : null}
                                {campaignGuidance.subtypeContextDescription ? (
                                  <p>
                                    {campaignGuidance.subtypeContextDescription}
                                  </p>
                                ) : null}
                                {campaignGuidance.deliveryContextDescription ? (
                                  <p>
                                    {
                                      campaignGuidance.deliveryContextDescription
                                    }
                                  </p>
                                ) : null}
                                {campaignGuidance.typeSubtypeContext
                                  ?.interpretation ? (
                                  <p>
                                    {
                                      campaignGuidance.typeSubtypeContext
                                        .interpretation
                                    }
                                  </p>
                                ) : null}
                                {campaignGuidance.typeSubtypeContext
                                  ?.useWhen ? (
                                  <p>
                                    {
                                      campaignGuidance.typeSubtypeContext
                                        .useWhen
                                    }
                                  </p>
                                ) : null}
                                {campaignGuidance.typeSubtypeContext
                                  ?.avoidWhen ? (
                                  <p>
                                    {
                                      campaignGuidance.typeSubtypeContext
                                        .avoidWhen
                                    }
                                  </p>
                                ) : null}
                                {campaignGuidance.stageClarity ? (
                                  <>
                                    {campaignGuidance.stageClarity
                                      .definition ? (
                                      <p>
                                        {
                                          campaignGuidance.stageClarity
                                            .definition
                                        }
                                      </p>
                                    ) : null}
                                    {Array.isArray(
                                      campaignGuidance.stageClarity
                                        .validSignals,
                                    ) &&
                                    campaignGuidance.stageClarity.validSignals
                                      .length ? (
                                      <>
                                        <small>
                                          Senales validas de interes previo:
                                        </small>
                                        <ul className="campaign-email-guide-list">
                                          {campaignGuidance.stageClarity.validSignals.map(
                                            (item) => (
                                              <li key={item}>{item}</li>
                                            ),
                                          )}
                                        </ul>
                                      </>
                                    ) : null}
                                    {Array.isArray(
                                      campaignGuidance.stageClarity.boundaries,
                                    ) &&
                                    campaignGuidance.stageClarity.boundaries
                                      .length ? (
                                      <>
                                        <small>Limites de uso:</small>
                                        <ul className="campaign-email-guide-list">
                                          {campaignGuidance.stageClarity.boundaries.map(
                                            (item) => (
                                              <li key={item}>{item}</li>
                                            ),
                                          )}
                                        </ul>
                                      </>
                                    ) : null}
                                    {Array.isArray(
                                      campaignGuidance.stageClarity.rules,
                                    ) &&
                                    campaignGuidance.stageClarity.rules
                                      .length ? (
                                      <>
                                        <small>Reglas operativas:</small>
                                        <ul className="campaign-email-guide-list">
                                          {campaignGuidance.stageClarity.rules.map(
                                            (item) => (
                                              <li key={item}>{item}</li>
                                            ),
                                          )}
                                        </ul>
                                      </>
                                    ) : null}
                                  </>
                                ) : null}
                                {campaignGuidance.emailTypeContextDescription ? (
                                  <>
                                    <small>
                                      Tipo sugerido:{" "}
                                      {formatLabel(
                                        campaignGuidance.suggestedEmailType,
                                      )}
                                    </small>
                                    <p>
                                      {
                                        campaignGuidance.emailTypeContextDescription
                                      }
                                    </p>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </div>

                          <div className="campaign-email-guide-block">
                            <h4>Objetivo del correo</h4>
                            <p>{campaignGuidance.objectiveDetail.context}</p>
                            <p>
                              {campaignGuidance.objectiveDetail.expectedResult}
                            </p>
                            <p>
                              {campaignGuidance.objectiveDetail.successSignal}
                            </p>
                            <p>{campaignGuidance.objectiveDetail.nextStep}</p>
                          </div>

                          <div className="campaign-email-guide-block">
                            <h4>A quien debe ir dirigido</h4>
                            <p>
                              <strong>Primario:</strong>{" "}
                              {campaignGuidance.audience.primary}
                            </p>
                            <p>
                              <strong>Secundario:</strong>{" "}
                              {campaignGuidance.audience.secondary}
                            </p>
                            <p>
                              <strong>Exclusion:</strong>{" "}
                              {campaignGuidance.audience.exclusions}
                            </p>
                          </div>

                          <div className="campaign-email-guide-block campaign-email-guide-example">
                            <h4>Ejemplo sugerido</h4>
                            <p>
                              <strong>Asunto:</strong>{" "}
                              {campaignGuidance.example.subject}
                            </p>
                            <p>
                              <strong>Apertura:</strong>{" "}
                              {campaignGuidance.exampleDetail.opening}
                            </p>
                            <p>
                              <strong>Mensaje central:</strong>{" "}
                              {campaignGuidance.exampleDetail.value}
                            </p>
                            <p>
                              <strong>Prueba/Confianza:</strong>{" "}
                              {campaignGuidance.exampleDetail.proof}
                            </p>
                            <p>
                              <strong>Siguiente paso:</strong>{" "}
                              {campaignGuidance.exampleDetail.nextStep}
                            </p>
                            <p>
                              <strong>Cierre:</strong>{" "}
                              {campaignGuidance.exampleDetail.closing}
                            </p>
                            <p>
                              <strong>CTA:</strong>{" "}
                              {campaignGuidance.example.cta}
                            </p>
                          </div>

                          <div className="campaign-email-guide-block">
                            <h4>Recursos necesarios</h4>
                            {campaignGuidance.resources.length > 0 ? (
                              <ul className="campaign-email-guide-resource-list">
                                {campaignGuidance.resources.map((resource) => (
                                  <li key={resource.key}>
                                    <span>{resource.label}</span>
                                    <span
                                      className={`campaign-email-guide-resource-status campaign-email-guide-resource-status-${resource.status}`}
                                    >
                                      {resource.status === "disponible"
                                        ? "Disponible"
                                        : "Pendiente"}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="campaign-email-muted">
                                No requiere recurso adicional.
                              </p>
                            )}
                            {campaignGuidance.resourceExamples.length > 0 ? (
                              <div className="campaign-email-guide-resource-examples">
                                <small>Ejemplos por subtipo:</small>
                                <ul className="campaign-email-guide-list">
                                  {campaignGuidance.resourceExamples.map(
                                    (item) => (
                                      <li key={item}>{item}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {activeTab === "editor" ? (
                  <>
                    <div className="campaign-email-editor-layout">
                      <div className="campaign-email-content-grid">
                        <div className="campaign-email-editor-setup-grid campaign-email-field-wide">
                          <label className="campaign-email-editor-field">
                            Asunto
                            <input
                              value={currentDraft.subject}
                              onChange={(event) =>
                                updateDraft({ subject: event.target.value })
                              }
                              placeholder="Asunto del correo"
                            />
                          </label>
                          <label className="campaign-email-editor-field">
                            Tipo de correo
                            <select
                              value={currentDraft.send_type}
                              onChange={(event) =>
                                updateDraft({ send_type: event.target.value })
                              }
                            >
                              <option value="correo_masivo">
                                {`Correo masivo - ${EMAIL_TYPE_DESCRIPTIONS.correo_masivo}`}
                              </option>
                              <option value="secuencia">
                                {`Secuencia - ${EMAIL_TYPE_DESCRIPTIONS.secuencia}`}
                              </option>
                              <option value="recordatorio">
                                {`Recordatorio - ${EMAIL_TYPE_DESCRIPTIONS.recordatorio}`}
                              </option>
                              <option value="seguimiento">
                                {`Seguimiento - ${EMAIL_TYPE_DESCRIPTIONS.seguimiento}`}
                              </option>
                            </select>
                          </label>
                        </div>

                        <div className="campaign-email-cta-section campaign-email-field-wide">
                          <div className="campaign-email-editor-field campaign-email-editor-field-wide campaign-email-cta-mode-card">
                            <span className="campaign-email-editor-field-title">
                              Destino del CTA principal
                            </span>
                            <span className="campaign-email-editor-field-caption">
                              Elige si el CTA principal llevará a una landing o
                              a una descarga de documento.
                            </span>
                            <div className="campaign-email-cta-mode-buttons">
                              <button
                                type="button"
                                className={`campaign-email-cta-mode-button ${
                                  ctaDestinationMode === "landing"
                                    ? "is-active"
                                    : ""
                                }`}
                                onClick={() => {
                                  setCtaDestinationMode("landing");
                                  updateSharedDocumentDraft({
                                    useAsPrimaryCta: false,
                                  });
                                }}
                              >
                                Landing
                              </button>
                              <button
                                type="button"
                                className={`campaign-email-cta-mode-button ${
                                  ctaDestinationMode === "download"
                                    ? "is-active"
                                    : ""
                                }`}
                                onClick={() => {
                                  setCtaDestinationMode("download");
                                  updateSharedDocumentDraft({
                                    useAsPrimaryCta: true,
                                  });
                                }}
                              >
                                Descarga
                              </button>
                            </div>
                          </div>

                          {ctaDestinationMode === "landing" ? (
                            <div className="campaign-email-cta-config-card">
                              <label className="campaign-email-editor-field campaign-email-editor-field-stack">
                                <span className="campaign-email-editor-field-title">
                                  CTA principal
                                </span>
                                <span className="campaign-email-editor-field-caption">
                                  Define el texto del boton principal y usa una
                                  sugerencia rapida cuando aplique.
                                </span>
                                <div className="campaign-email-editor-input-stack">
                                  <span className="campaign-email-editor-input-label">
                                    Sugerencias
                                  </span>
                                  <select
                                    value={selectedCtaSuggestionValue}
                                    onChange={(event) => {
                                      const value = String(
                                        event.target.value || "",
                                      ).trim();
                                      if (value) {
                                        updateDraft({ cta_label: value });
                                      }
                                    }}
                                  >
                                    <option value="">
                                      Seleccionar sugerencia...
                                    </option>
                                    {CTA_SUGGESTIONS.map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="campaign-email-editor-input-stack">
                                  <span className="campaign-email-editor-input-label">
                                    Texto final
                                  </span>
                                  <input
                                    value={currentDraft.cta_label}
                                    onChange={(event) =>
                                      updateDraft({
                                        cta_label: event.target.value,
                                      })
                                    }
                                    placeholder="Ej. Registrarme"
                                  />
                                </div>
                              </label>

                              <label className="campaign-email-editor-field campaign-email-editor-field-stack">
                                <span className="campaign-email-editor-field-title">
                                  URL CTA
                                </span>
                                <span className="campaign-email-editor-field-caption">
                                  Selecciona una landing existente o pega la URL
                                  final de destino.
                                </span>
                                <div className="campaign-email-editor-input-stack">
                                  <span className="campaign-email-editor-input-label">
                                    Landings relacionadas
                                  </span>
                                  <select
                                    value={
                                      visibleLandingUrlSuggestions.some(
                                        (entry) => entry.url === currentDraft.cta_url,
                                      )
                                        ? currentDraft.cta_url
                                        : ""
                                    }
                                    onChange={(event) => {
                                      const value = String(
                                        event.target.value || "",
                                      ).trim();
                                      if (value) {
                                        updateDraft({ cta_url: value });
                                      }
                                    }}
                                  >
                                    <option value="">
                                      Seleccionar landing creada...
                                    </option>
                                    {visibleLandingUrlSuggestions.length > 0 ? (
                                      visibleLandingUrlSuggestions.map(
                                        (entry) => (
                                          <option
                                            key={entry.url}
                                            value={entry.url}
                                          >
                                            {`${entry.eventName || "Landing"} (${entry.slug})`}
                                          </option>
                                        ),
                                      )
                                    ) : (
                                      <option value="" disabled>
                                        No hay landings relacionadas para esta
                                        campaña
                                      </option>
                                    )}
                                  </select>
                                </div>
                                <div className="campaign-email-editor-input-stack">
                                  <span className="campaign-email-editor-input-label">
                                    URL final
                                  </span>
                                  <input
                                    value={currentDraft.cta_url}
                                    onChange={(event) =>
                                      updateDraft({
                                        cta_url: event.target.value,
                                      })
                                    }
                                    placeholder="https://..."
                                  />
                                </div>
                              </label>
                            </div>
                          ) : null}

                          {ctaDestinationMode === "download" ? (
                            <div className="campaign-email-shared-doc-card">
                              <div className="campaign-email-shared-doc-head">
                                <div>
                                  <strong>Documento para descargar</strong>
                                  <span>
                                    Comparte un archivo local o un recurso de
                                    biblioteca mediante enlace seguro y
                                    rastreable.
                                  </span>
                                </div>
                              </div>

                              <div className="campaign-email-content-grid">
                                <label>
                                  Origen del documento
                                  <select
                                    value={currentSharedDocument.sourceMode}
                                    onChange={(event) => {
                                      updateSharedDocumentDraft({
                                        sourceMode: event.target.value,
                                        previewUrl: "",
                                        previewExpiresAt: null,
                                      });
                                      setSharedLibraryResults([]);
                                    }}
                                  >
                                    <option value="library_file">
                                      Biblioteca
                                    </option>
                                    <option value="local_upload">
                                      Archivo local
                                    </option>
                                  </select>
                                </label>

                                <label>
                                  Nombre visible del documento
                                  <input
                                    value={currentSharedDocument.title}
                                    onChange={(event) =>
                                      updateSharedDocumentDraft({
                                        title: event.target.value,
                                      })
                                    }
                                    placeholder="Ej. Propuesta comercial"
                                  />
                                </label>

                                <label className="campaign-email-field-wide">
                                  Descripción interna
                                  <textarea
                                    rows={2}
                                    value={currentSharedDocument.description}
                                    onChange={(event) =>
                                      updateSharedDocumentDraft({
                                        description: event.target.value,
                                      })
                                    }
                                    placeholder="Notas internas para este documento compartido"
                                  />
                                </label>

                                {currentSharedDocument.sourceMode ===
                                "local_upload" ? (
                                  <label className="campaign-email-field-wide">
                                    Subir archivo local
                                    <input
                                      type="file"
                                      onChange={(event) => {
                                        void handleUploadLocalSharedDocument(
                                          event.target.files?.[0] || null,
                                        );
                                        event.target.value = "";
                                      }}
                                      disabled={isUploadingSharedDocument}
                                    />
                                    <small className="campaign-email-field-help">
                                      {isUploadingSharedDocument
                                        ? "Cargando archivo compartido..."
                                        : "Se persistirá como documento compartible de esta campaña."}
                                    </small>
                                  </label>
                                ) : (
                                  <div className="campaign-email-field-wide campaign-email-library-picker">
                                    <form
                                      className="campaign-email-library-search-row"
                                      onSubmit={handleSearchSharedLibrary}
                                    >
                                      <label>
                                        Buscar en biblioteca
                                        <input
                                          value={sharedLibraryQuery}
                                          onChange={(event) =>
                                            setSharedLibraryQuery(
                                              event.target.value,
                                            )
                                          }
                                          placeholder="Buscar por nombre o resumen"
                                        />
                                      </label>
                                      <button
                                        type="submit"
                                        className="campaign-email-test-send-inline"
                                        disabled={isLoadingSharedLibrary}
                                      >
                                        {isLoadingSharedLibrary
                                          ? "Buscando..."
                                          : "Buscar"}
                                      </button>
                                    </form>

                                    {sharedLibraryResults.length > 0 ? (
                                      <div className="campaign-email-library-results">
                                        {sharedLibraryResults.map((item) => (
                                          <article
                                            key={`${item.assetPublicId}-${item.filePublicId}`}
                                            className="campaign-email-library-item"
                                          >
                                            <div>
                                              <strong>
                                                {item.title || item.fileName}
                                              </strong>
                                              <p>{item.fileName}</p>
                                              <small>
                                                {item.summary ||
                                                  "Sin resumen disponible"}
                                              </small>
                                            </div>
                                            <button
                                              type="button"
                                              className="campaign-email-ai-action campaign-email-ai-action-secondary"
                                              onClick={() => {
                                                void handleSelectLibraryDocument(
                                                  item,
                                                );
                                              }}
                                            >
                                              Seleccionar
                                            </button>
                                          </article>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                )}

                                <label>
                                  Tipo de enlace
                                  <select
                                    value={currentSharedDocument.linkMode}
                                    onChange={(event) =>
                                      updateSharedDocumentDraft({
                                        linkMode: event.target.value,
                                      })
                                    }
                                  >
                                    <option value="per_recipient">
                                      Enlace único por destinatario
                                    </option>
                                    <option value="general">
                                      Un enlace general para toda la campaña
                                    </option>
                                  </select>
                                </label>

                                <label>
                                  Vigencia del enlace (días)
                                  <input
                                    type="number"
                                    min="1"
                                    max="365"
                                    value={currentSharedDocument.expiresDays}
                                    onChange={(event) =>
                                      updateSharedDocumentDraft({
                                        expiresDays: event.target.value,
                                      })
                                    }
                                  />
                                </label>

                                <label>
                                  Texto del enlace / CTA
                                  <input
                                    value={currentSharedDocument.linkLabel}
                                    onChange={(event) =>
                                      updateSharedDocumentDraft({
                                        linkLabel: event.target.value,
                                      })
                                    }
                                    placeholder="Ej. Descargar propuesta"
                                  />
                                </label>

                                <label>
                                  URL del CTA principal
                                  <input
                                    value={currentDraft.cta_url}
                                    onChange={(event) =>
                                      updateDraft({
                                        cta_url: event.target.value,
                                      })
                                    }
                                    placeholder="https://..."
                                  />
                                  <small className="campaign-email-field-help">
                                    Si el enlace del documento se usa como CTA
                                    principal, esta URL se toma como respaldo.
                                  </small>
                                </label>

                                <label>
                                  Uso del enlace
                                  <select
                                    value={
                                      currentSharedDocument.useAsPrimaryCta
                                        ? "yes"
                                        : "no"
                                    }
                                    onChange={(event) =>
                                      updateSharedDocumentDraft({
                                        useAsPrimaryCta:
                                          event.target.value === "yes",
                                      })
                                    }
                                  >
                                    <option value="yes">
                                      Usar como CTA principal
                                    </option>
                                    <option value="no">
                                      Solo generar y copiar
                                    </option>
                                  </select>
                                </label>

                                <div className="campaign-email-inline-actions campaign-email-field-wide">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleGenerateSharedPreviewLink();
                                    }}
                                    disabled={isGeneratingSharedPreview}
                                  >
                                    {isGeneratingSharedPreview
                                      ? "Generando enlace..."
                                      : "Generar enlace de vista previa"}
                                  </button>
                                </div>

                                {currentSharedDocument.document ? (
                                  <div className="campaign-email-shared-doc-selected campaign-email-field-wide">
                                    <strong>
                                      {currentSharedDocument.document.title ||
                                        currentSharedDocument.title ||
                                        "Documento seleccionado"}
                                    </strong>
                                    <span>
                                      Fuente:{" "}
                                      {currentSharedDocument.document
                                        .sourceType === "local_upload"
                                        ? "Archivo local"
                                        : "Biblioteca"}
                                    </span>
                                    {currentSharedDocument.document
                                      .originalFileName ? (
                                      <span>
                                        Archivo:{" "}
                                        {
                                          currentSharedDocument.document
                                            .originalFileName
                                        }
                                      </span>
                                    ) : null}
                                    {currentSharedDocument.previewUrl ? (
                                      <>
                                        <a
                                          className="campaign-email-inline-link"
                                          href={
                                            currentSharedDocument.previewUrl
                                          }
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Abrir vista previa
                                        </a>
                                        <span>
                                          Expira:{" "}
                                          {formatDateTime(
                                            currentSharedDocument.previewExpiresAt,
                                          )}
                                        </span>
                                      </>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="campaign-email-editor-actions campaign-email-field-wide">
                          <button
                            type="button"
                            className="campaign-email-ai-action"
                            onClick={() => handleOpenAiPromptModal("generate")}
                            disabled={isGeneratingWithAi}
                            title="Generar desde cero con IA"
                            aria-label="Generar desde cero con IA"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="currentColor"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path d="M12 2l1.09 3.26L16.5 6l-3.41 1.09L12 10.5l-1.09-3.41L7.5 6l3.41-1.09L12 2zm6 10l.73 2.18L21 15l-2.27.73L18 18l-.73-2.27L15 15l2.27-.73L18 12zm-12 0l.73 2.18L9 15l-2.27.73L6 18l-.73-2.27L3 15l2.27-.73L6 12z" />
                            </svg>
                            <span>Generar desde cero</span>
                          </button>
                          <button
                            type="button"
                            className="campaign-email-ai-action campaign-email-ai-action-secondary"
                            onClick={() => handleOpenAiPromptModal("improve")}
                            disabled={isGeneratingWithAi}
                            title="Mejorar HTML actual con IA"
                            aria-label="Mejorar HTML actual con IA"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="currentColor"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm14.71-9.04a1.003 1.003 0 000-1.42l-2.5-2.5a1.003 1.003 0 00-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79z" />
                            </svg>
                            <span>Mejorar HTML actual</span>
                          </button>
                          <button
                            type="button"
                            className="campaign-email-ai-action campaign-email-ai-action-secondary"
                            onClick={handleLocalizeExternalImages}
                            disabled={isGeneratingWithAi || isLocalizingImages}
                            title="Descargar imágenes externas"
                            aria-label="Descargar imágenes externas"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="currentColor"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path d="M12 3a1 1 0 011 1v8.59l2.3-2.29a1 1 0 111.4 1.42l-4 3.98a1 1 0 01-1.4 0l-4-3.98a1 1 0 111.4-1.42L11 12.59V4a1 1 0 011-1zM5 17a1 1 0 011 1v1h12v-1a1 1 0 112 0v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2a1 1 0 011-1z" />
                            </svg>
                            <span>
                              {isLocalizingImages
                                ? "Descargando imágenes..."
                                : "Descargar imágenes"}
                            </span>
                          </button>
                        </div>
                        <label className="campaign-email-field-wide">
                          <span>HTML del correo</span>
                          <textarea
                            className="campaign-email-html-editor-textarea"
                            value={currentDraft.html_content}
                            onChange={(event) =>
                              updateDraft({ html_content: event.target.value })
                            }
                            onBlur={() => {
                              handleLocalizeExternalImages();
                            }}
                            rows={18}
                          />
                        </label>
                      </div>
                      <div className="campaign-email-preview-card">
                        <div className="campaign-email-preview-meta">
                          <small>Asunto del correo</small>
                          <strong>
                            {currentDraft.subject || "Sin asunto"}
                          </strong>
                        </div>
                        <div className="campaign-email-preview-shell">
                          <div className="campaign-email-preview-shell-top">
                            <div
                              className="campaign-email-preview-shell-dots"
                              aria-hidden="true"
                            >
                              <span />
                              <span />
                              <span />
                            </div>
                            <small>Vista previa del correo</small>
                          </div>
                          <div className="campaign-email-preview-canvas">
                            <iframe
                              title="Vista previa del correo"
                              className="campaign-email-preview-frame"
                              srcDoc={currentDraft.html_content || DEFAULT_HTML}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="campaign-email-editor-tail">
                      <div className="campaign-email-test-recipient-row">
                        <label>
                          Correos de prueba
                          <input
                            value={currentDraft.test_recipients}
                            onChange={(event) =>
                              updateDraft({
                                test_recipients: event.target.value,
                              })
                            }
                            placeholder="correo1@empresa.com, correo2@empresa.com"
                          />
                        </label>
                        <button
                          type="button"
                          className="campaign-email-test-send-inline"
                          onClick={handleSendTestEmail}
                          disabled={isSendingTestEmail}
                        >
                          {isSendingTestEmail
                            ? "Enviando prueba..."
                            : "Enviar prueba"}
                        </button>
                        <button
                          type="button"
                          className="campaign-email-test-send-inline campaign-email-test-send-inline-secondary"
                          onClick={handleSaveLocalDraft}
                          disabled={isSavingCampaignEmailDraft}
                        >
                          {isSavingCampaignEmailDraft
                            ? "Guardando en base de datos..."
                            : "Guardar"}
                        </button>
                      </div>
                      {testSendNotice ? (
                        <div
                          className={`campaign-email-alert ${
                            testSendNotice.variant === "error"
                              ? "campaign-email-alert-error"
                              : "campaign-email-alert-success"
                          }`}
                        >
                          <span>{testSendNotice.message}</span>
                          <button
                            type="button"
                            className="campaign-email-alert-close"
                            onClick={() => setTestSendNotice(null)}
                            aria-label="Cerrar notificacion de envio de prueba"
                          >
                            ×
                          </button>
                        </div>
                      ) : null}
                      {testSendSummary ? (
                        <div className="campaign-email-test-send-summary">
                          <strong>Resultado de envio de prueba</strong>
                          <span>
                            Total: {Number(testSendSummary.total || 0)} ·
                            Exitos: {Number(testSendSummary.sent || 0)} ·
                            Fallidos: {Number(testSendSummary.failed || 0)} ·
                            Invalidos: {Number(testSendSummary.invalid || 0)}
                          </span>
                        </div>
                      ) : null}
                      {testSendResults.length > 0 ? (
                        <div className="campaign-email-test-send-table-wrap">
                          <table className="campaign-email-test-send-table">
                            <thead>
                              <tr>
                                <th>Correo</th>
                                <th>Estado</th>
                                <th>Detalle</th>
                              </tr>
                            </thead>
                            <tbody>
                              {testSendResults.map((item) => (
                                <tr key={`${item.email}-${item.status}`}>
                                  <td>{item.email}</td>
                                  <td>{formatTestSendStatusLabel(item.status)}</td>
                                  <td>
                                    {formatTestSendDetailMessage(item.message)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {activeTab === "schedule" ? (
                  <div className="campaign-email-content-grid">
                    <label>
                      Fecha programada
                      <input
                        type="date"
                        value={currentDraft.scheduled_at}
                        onChange={(event) =>
                          updateDraft({ scheduled_at: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Tamano de lote
                      <input type="number" min="1" value="50" disabled />
                    </label>
                    <label>
                      Numero maximo de envios por hora
                      <input type="number" min="1" value="50" disabled />
                    </label>
                    <label>
                      Numero maximo de envios por dia
                      <input type="number" min="1" value="300" disabled />
                    </label>
                    <div className="campaign-email-schedule-hints campaign-email-field-wide">
                      <div>
                        <strong>Configuracion activa (V1)</strong>
                        <ul>
                          <li>Envio automatico en cola: maximo 50 por hora.</li>
                          <li>
                            Tope diario estricto: maximo 300 enviados por dia.
                          </li>
                          <li>
                            Cuando llega al tope diario, el envio continua al
                            dia siguiente.
                          </li>
                        </ul>
                      </div>
                    </div>
                    <div className="campaign-email-inline-actions campaign-email-field-wide">
                      <button
                        type="button"
                        onClick={handleStartCampaignSend}
                        disabled={isStartingSend || isLoadingAudience}
                      >
                        {isStartingSend
                          ? "Iniciando envío..."
                          : "Iniciar envío de correos"}
                      </button>
                      {campaignDispatch?.status === "running" ? (
                        <button
                          type="button"
                          onClick={handlePauseDispatch}
                          disabled={isUpdatingDispatch}
                        >
                          {isUpdatingDispatch ? "Procesando..." : "Pausar"}
                        </button>
                      ) : null}
                      {campaignDispatch?.status === "paused" ||
                      campaignDispatch?.status === "failed" ? (
                        <button
                          type="button"
                          onClick={handleResumeDispatch}
                          disabled={isUpdatingDispatch}
                        >
                          {isUpdatingDispatch ? "Procesando..." : "Reanudar"}
                        </button>
                      ) : null}
                      {campaignDispatch?.status === "running" ||
                      campaignDispatch?.status === "paused" ? (
                        <button
                          type="button"
                          onClick={handleCancelDispatch}
                          disabled={isUpdatingDispatch}
                        >
                          {isUpdatingDispatch ? "Procesando..." : "Cancelar"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activeTab === "results" ? (
                  <div className="campaign-email-results-grid">
                    <div className="campaign-email-inline-actions campaign-email-field-wide">
                      <button
                        type="button"
                        onClick={refreshDispatchStatus}
                        disabled={isLoadingDispatch || !campaignDispatch?.id}
                      >
                        {isLoadingDispatch
                          ? "Actualizando..."
                          : "Actualizar estado"}
                      </button>
                    </div>
                    <article>
                      <strong>
                        {formatDispatchStatus(campaignDispatch?.status)}
                      </strong>
                      <span>Estado de la corrida</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.total || 0)}
                      </strong>
                      <span>Total en cola</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.sent || 0)}
                      </strong>
                      <span>Enviados</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.pending || 0)}
                      </strong>
                      <span>Pendientes</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.failed || 0)}
                      </strong>
                      <span>Fallidos</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.skipped || 0)}
                      </strong>
                      <span>Omitidos</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.sentLastHour || 0)}
                      </strong>
                      <span>Enviados ultima hora</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.sentToday || 0)}
                      </strong>
                      <span>Enviados hoy</span>
                    </article>
                    {campaignDispatch?.summary?.documentTracking ? (
                      <>
                        <article>
                          <strong>
                            {Number(
                              campaignDispatch.summary.documentTracking
                                .accessCount || 0,
                            )}
                          </strong>
                          <span>Accesos al documento</span>
                        </article>
                        <article>
                          <strong>
                            {Number(
                              campaignDispatch.summary.documentTracking
                                .downloadCount || 0,
                            )}
                          </strong>
                          <span>Descargas del documento</span>
                        </article>
                        <article className="campaign-email-field-wide">
                          <strong>
                            Documento:{" "}
                            {campaignDispatch.summary.documentTracking.title}
                          </strong>
                          <span>
                            Modo:{" "}
                            {campaignDispatch.summary.documentTracking
                              .shareMode === "general"
                              ? "Enlace general"
                              : "Enlace por destinatario"}
                            {" · "}
                            Último acceso:{" "}
                            {formatDateTime(
                              campaignDispatch.summary.documentTracking
                                .lastAccessedAt,
                            )}
                          </span>
                        </article>
                      </>
                    ) : null}
                    <article className="campaign-email-field-wide">
                      <strong>
                        Inicio: {formatDateTime(campaignDispatch?.startedAt)} ·
                        Fin: {formatDateTime(campaignDispatch?.finishedAt)}
                      </strong>
                      <span>
                        Siguiente reintento:{" "}
                        {formatDateTime(campaignDispatch?.summary?.nextRetryAt)}
                      </span>
                    </article>
                    {campaignDispatch?.lastErrorMessage ? (
                      <article className="campaign-email-field-wide">
                        <strong>Ultimo error</strong>
                        <span>{campaignDispatch.lastErrorMessage}</span>
                      </article>
                    ) : null}
                    {campaignDispatchResults.length > 0 ? (
                      <div className="campaign-email-test-send-table-wrap campaign-email-field-wide">
                        <div className="campaign-email-field-inline-row campaign-email-results-filter-row">
                          <label className="campaign-email-results-filter-label">
                            Vendedor
                            <select
                              className="campaign-email-results-filter-select"
                              value={resultsSellerFilter}
                              onChange={(event) =>
                                setResultsSellerFilter(event.target.value)
                              }
                            >
                              <option value="">Todos los vendedores</option>
                              {resultSellerOptions.map((sellerName) => (
                                <option key={sellerName} value={sellerName}>
                                  {sellerName}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <table className="campaign-email-test-send-table">
                          <thead>
                            <tr>
                              <th>Contacto</th>
                              <th>Móvil</th>
                              <th>Cuenta</th>
                              <th>Vendedor</th>
                              <th>Correo</th>
                              <th>Estado</th>
                              <th>Accesos</th>
                              <th>Descargas</th>
                              <th>Último acceso</th>
                              <th>Detalle</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredCampaignDispatchResults
                              .slice(0, 80)
                              .map((item) => (
                                <tr
                                  key={`${item.email}-${item.status}-${item.updatedAt || ""}`}
                                >
                                  <td>{item.contactName || "-"}</td>
                                  <td>{item.contactMobile || "-"}</td>
                                  <td>{item.accountName || "-"}</td>
                                  <td>{item.sellerName || "-"}</td>
                                  <td>{item.email}</td>
                                  <td>{item.status}</td>
                                  <td>{Number(item.accessCount || 0)}</td>
                                  <td>{Number(item.downloadCount || 0)}</td>
                                  <td>{formatDateTime(item.lastAccessedAt)}</td>
                                  <td>{item.message}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="campaign-email-muted">
                Selecciona una campana para comenzar.
              </p>
            )}
          </article>
        </div>
      </section>

      {isAiPromptModalOpen ? (
        <div
          className="campaign-email-ai-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Instrucciones para generar correo con IA"
        >
          <form
            className="campaign-email-ai-modal"
            onSubmit={handleSubmitAiPrompt}
          >
            <h4>Instrucciones para IA</h4>
            <p>
              {aiActionMode === "improve"
                ? "Describe cómo mejorar el correo actual. La IA ajustará asunto y HTML usando como base lo ya definido."
                : "Describe cómo debe generarse el correo desde cero. La IA propondrá asunto y HTML usando como contexto la campaña y el CTA."}
            </p>
            <textarea
              className="campaign-email-ai-prompt-textarea"
              value={aiPromptText}
              onChange={(event) => setAiPromptText(event.target.value)}
              rows={10}
              placeholder={[
                "Objetivo del correo:",
                "Audiencia:",
                "Tono:",
                "CTA:",
                aiActionMode === "improve"
                  ? "Cambios puntuales sobre el correo actual:"
                  : "Lineamientos para generar el correo desde cero:",
              ].join("\n")}
              autoFocus
            />
            <div className="campaign-email-ai-modal-actions">
              <button
                type="button"
                className="campaign-email-ai-cancel-button"
                onClick={handleCloseAiPromptModal}
              >
                Cancelar
              </button>
              <button type="submit" className="campaign-email-ai-submit-button">
                {aiActionMode === "improve"
                  ? "Mejorar con IA"
                  : "Generar con IA"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isAssetSearchModalOpen ? (
        <div
          className="campaign-email-ai-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Buscar gráfico en internet"
        >
          <div className="campaign-email-ai-modal campaign-email-asset-modal">
            <h4>Buscar gráfico en internet</h4>
            <p>
              Busca imágenes o gráficos reales en internet y aprueba una antes
              de insertarla en el correo.
            </p>
            {assetSearchSuggestedQueries.length > 0 ? (
              <div className="campaign-email-asset-query-list">
                <strong>Consultas sugeridas por IA</strong>
                <ul>
                  {assetSearchSuggestedQueries.map((query) => (
                    <li key={query}>{query}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <form
              className="campaign-email-asset-search-form"
              onSubmit={handleSearchAssets}
            >
              <input
                value={assetSearchQuery}
                onChange={(event) => setAssetSearchQuery(event.target.value)}
                placeholder="Ej. growth chart cybersecurity business"
              />
              <div className="campaign-email-ai-modal-actions">
                <button
                  type="button"
                  className="campaign-email-ai-cancel-button"
                  onClick={handleCloseAssetSearchModal}
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  className="campaign-email-ai-submit-button"
                  disabled={isSearchingAssets}
                >
                  {isSearchingAssets ? "Buscando..." : "Buscar"}
                </button>
              </div>
            </form>

            <div className="campaign-email-asset-results">
              {!isSearchingAssets && assetSearchResults.length === 0 ? (
                <p className="campaign-email-muted">
                  Ejecuta una búsqueda para ver opciones aprobables.
                </p>
              ) : null}

              {assetSearchResults.map((asset) => (
                <article
                  key={asset.id || asset.sourceUrl}
                  className="campaign-email-asset-card"
                >
                  <img src={asset.thumbnailUrl} alt={asset.title} />
                  <div className="campaign-email-asset-card-body">
                    <strong>{asset.title || "Imagen"}</strong>
                    <small>
                      {asset.width > 0 && asset.height > 0
                        ? `${asset.width} x ${asset.height}`
                        : "Dimensiones no disponibles"}
                    </small>
                    <small>{asset.mime || "Tipo no disponible"}</small>
                    <div className="campaign-email-ai-modal-actions">
                      <a
                        className="campaign-email-inline-link"
                        href={asset.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver original
                      </a>
                      <button
                        type="button"
                        className="campaign-email-ai-submit-button"
                        onClick={() => handleApproveAsset(asset)}
                      >
                        Aprobar e insertar
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isGeneratingWithAi ? (
        <div
          className="campaign-email-ai-modal-backdrop"
          role="status"
          aria-live="polite"
        >
          <div className="campaign-email-ai-modal">
            <div
              className="campaign-email-ai-modal-spinner"
              aria-hidden="true"
            />
            <h4>Generando correo con IA</h4>
            <p>{aiProgressText || "Procesando solicitud..."}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
