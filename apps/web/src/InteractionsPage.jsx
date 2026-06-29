import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import {
  addDaysToIsoDate,
  formatBusinessDate,
  formatBusinessDateTime,
  getTodayBusinessDate,
} from "./business-timezone";
import ModalInlineHelp from "./help/ModalInlineHelp";
import {
  getLeadCallOutcomeActionGuide,
  getLeadCallOutcomeReasonGuide,
  getLeadCallOutcomeSubstatusGuide,
} from "./interactions/leadCallOutcomeGuideData";
import {
  LeadCallOutcomeInlineGuide,
  LeadCallOutcomeOptionCards,
} from "./interactions/LeadCallOutcomeGuides";
import LeadOperationEmailModal from "./interactions/LeadOperationEmailModal";

const INTERACTION_FILE_ACCEPT =
  ".pdf,.docx,.xlsx,.xls,.csv,.txt,.eml,.png,.jpg,.jpeg,.mp3,.wav,.m4a,.mp4";
const INTERACTION_ANALYSIS_TIMEOUT_MS = 60000;
const INTERACTION_ANALYSIS_JOB_POLL_INTERVAL_MS = 3000;
const INTERACTION_ANALYSIS_TOTAL_POLL_TIMEOUT_MS = 120000;
const LEAD_SOURCE_OPTIONS = [
  { value: "fabricante", label: "Fabricante" },
  { value: "mayorista", label: "Mayorista" },
  { value: "empresa_marketing", label: "Empresa de Marketing" },
  { value: "vendedor", label: "Vendedor" },
  { value: "campana", label: "Campaña" },
  { value: "web", label: "Web" },
  { value: "correo", label: "Correo" },
  { value: "redes", label: "Redes" },
  { value: "consultor", label: "Consultor" },
  { value: "webinar", label: "Webinar" },
  { value: "evento", label: "Evento" },
  { value: "otro", label: "Otro" },
];
const LEAD_STATUS_FILTER_OPTIONS = [
  { value: "created", label: "Creado" },
  { value: "lead_unassigned", label: "Lead no asignado" },
  { value: "lead_assigned", label: "Lead asignado" },
  { value: "lead_qualified", label: "Lead calificado" },
  { value: "lead_disqualified", label: "Lead descalificado" },
];
const LEAD_STATUS_FILTER_VALUES = LEAD_STATUS_FILTER_OPTIONS.map(
  (option) => option.value,
);
const LEAD_DASHBOARD_PERIOD_OPTIONS = [
  { value: "all", label: "Todo" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
];
const LEAD_QUEUE_FILTER_OPTIONS = [
  { value: "all", label: "Todas las colas" },
  { value: "overdue", label: "Seguimiento vencido" },
  { value: "no_contact", label: "Sin contacto" },
  { value: "stagnant", label: "Estancados" },
  {
    value: "assigned_without_opportunity",
    label: "Asignados sin oportunidad",
  },
];
const EMPTY_LEAD_SUBSTATUS_FILTER = "__none__";
const OPERATIONS_SITUATION_PAGE_SIZE = 10;
const LEAD_EMAIL_MAX_LIBRARY_ASSETS = 3;
const LEAD_EXECUTION_CRITERIA_ITEMS = [
  {
    id: "interest",
    badge: "Criterio 1",
    title: "Detectar interés real",
    description:
      "Confirma que el cliente sí mostró interés en alguna de nuestras soluciones.",
    routeLabel: "Ruta de interés",
    routeSummary:
      "Usa esta ruta cuando el cliente ya mostró intención de avanzar, pero todavía falta ordenar el siguiente paso.",
    steps: [
      {
        title: "1. Leer el contexto",
        description: "Revisa el lead y ubica qué solución despertó interés.",
      },
      {
        title: "2. Confirmar interés",
        description:
          "Valida con el usuario qué le llamó la atención y por qué.",
      },
      {
        title: "3. Cerrar con reunión",
        description: "Agenda una siguiente reunión para profundizar el caso.",
      },
    ],
    validations: [
      "Confirmar la solución que despertó interés.",
      "Dejar claro por qué le interesa.",
      "Asegurar la siguiente reunión o demo.",
    ],
    emailHint:
      "El correo acompaña la conversación y deja listo el siguiente contacto.",
  },
  {
    id: "motive",
    badge: "Criterio 2",
    title: "Entender el motivo",
    description:
      "Aterriza por qué le interesa la solución y qué problema quiere resolver.",
    routeLabel: "Ruta de motivo",
    routeSummary:
      "Selecciona esta ruta cuando ya sabes que hay interés, pero aún falta precisar el motivo real de negocio.",
    steps: [
      {
        title: "1. Leer el contexto",
        description:
          "Recupera la situación actual y detecta el problema de negocio.",
      },
      {
        title: "2. Profundizar en el motivo",
        description:
          "Pregunta qué problema resuelve, por qué ahora y qué resultado espera.",
      },
      {
        title: "3. Preparar la demo",
        description:
          "Alinea la siguiente reunión técnica con ese motivo específico.",
      },
    ],
    validations: [
      "Registrar el motivo principal detectado.",
      "Identificar el problema que el cliente quiere resolver.",
      "Dejar la demo alineada al interés real.",
    ],
    emailHint:
      "El correo debe reforzar el problema detectado y abrir la siguiente conversación.",
  },
  {
    id: "meeting",
    badge: "Criterio 3",
    title: "Asegurar la siguiente reunión",
    description:
      "Deja lista la reunión técnica o la demo orientada al motivo de interés.",
    routeLabel: "Ruta de reunión",
    routeSummary:
      "Usa esta ruta cuando ya hay interés y motivo definidos, pero falta asegurar el encuentro siguiente.",
    steps: [
      {
        title: "1. Leer el contexto",
        description:
          "Confirma los datos relevantes antes de cerrar el calendario.",
      },
      {
        title: "2. Confirmar la reunión",
        description:
          "Define asistentes, fecha y objetivo de la reunión técnica.",
      },
      {
        title: "3. Cerrar con trazabilidad",
        description:
          "Deja el lead listo para seguimiento y comunicación posterior.",
      },
    ],
    validations: [
      "Confirmar fecha o ventana de reunión.",
      "Asegurar participantes clave.",
      "Dejar la reunión técnica o demo claramente agendada.",
    ],
    emailHint:
      "El correo sirve para confirmar la reunión y dejar trazabilidad del acuerdo.",
  },
];
const LEAD_EXECUTION_WIZARD_STEPS = [
  { id: 1, label: "Contexto" },
  { id: 2, label: "Secuencia" },
  { id: 3, label: "Resultado" },
  { id: 4, label: "Correo" },
];
const LEAD_EXECUTION_SEQUENCE_ITEMS = [
  { id: "company_intro", title: "Presentación de la empresa" },
  {
    id: "confirm_expectations",
    title: "Confirmación de expectativas del prospecto",
  },
  { id: "solution_intro", title: "Iniciar la presentación de la solución" },
  { id: "pain_slides", title: "Dolor, reto o problema del prospecto" },
  { id: "how_we_solve", title: "Cómo resolvemos el problema" },
  {
    id: "solution_highlights",
    title: "Puntos clave de la solución (2–3 puntos)",
  },
  { id: "conclusion", title: "Conclusión: dolor → solución → puntos clave" },
  {
    id: "storytelling",
    title: "Historia o caso de uso para mantener el interés",
  },
  { id: "demo_request", title: "Ofrecer demo y solicitar reunión técnica" },
  { id: "next_meeting", title: "Definir fecha y hora de la siguiente reunión" },
];
const LEAD_EXECUTION_GUIDE_DEFAULTS = {
  company_intro:
    "Presenta brevemente quiénes somos, qué hacemos y por qué somos relevantes para el prospecto. Mantén esta parte corta: no más de 2-3 minutos.",
  confirm_expectations:
    "Pregunta al prospecto qué espera de esta reunión y qué temas le interesan más. Esto te permite ajustar el enfoque antes de empezar.",
  solution_intro:
    "Haz una introducción general de la solución que vas a presentar. Contextualiza el portafolio antes de entrar al detalle.",
  pain_slides:
    "Esta es la parte más importante. Presenta el dolor, reto o problema que puede estar enfrentando el prospecto. El objetivo es que se identifique con la situación para que el resto de la presentación tenga sentido.",
  how_we_solve:
    "Explica de forma clara y concisa cómo la solución resuelve el problema presentado. Conecta directamente el dolor con la propuesta de valor.",
  solution_highlights:
    "Muestra 2 o 3 puntos clave que diferencian la solución. No más de eso para no perder la atención. Apóyate en evidencia, datos o casos concretos.",
  conclusion:
    "Resume los tres elementos: el problema que identificamos, cómo lo resolvemos y los puntos más importantes. Cierra con una idea clara y memorable.",
  storytelling:
    "Después de cada bloque importante puedes compartir una historia breve o caso de uso real para mantener al cliente interesado y hacer la propuesta más tangible.",
  demo_request:
    "Ofrece una demostración práctica y propón una reunión técnica de seguimiento. Sugiere al prospecto que invite a personal técnico de su equipo para poder profundizar.",
  next_meeting:
    "Cierra la reunión acordando una fecha y hora concretas para el siguiente encuentro. No salgas sin un compromiso claro.",
};

function sortLeadStatusFilters(values) {
  if (!Array.isArray(values)) return [];
  const selected = new Set(
    values
      .map((value) => String(value || "").trim())
      .filter((value) => LEAD_STATUS_FILTER_VALUES.includes(value)),
  );
  return LEAD_STATUS_FILTER_VALUES.filter((value) => selected.has(value));
}
function normalizeLeadStatusFilters(values) {
  const sorted = sortLeadStatusFilters(values);
  return sorted.length ? sorted : [...LEAD_STATUS_FILTER_VALUES];
}

function getLeadStatusFilterButtonLabel(selectedStatuses) {
  const selectedCount = normalizeLeadStatusFilters(selectedStatuses).length;
  if (selectedCount === LEAD_STATUS_FILTER_VALUES.length) {
    return "Estado: Todas";
  }
  return `Estado: ${selectedCount} seleccionado${selectedCount === 1 ? "" : "s"}`;
}

function getLeadSourceLabel(sourceCode) {
  return (
    LEAD_SOURCE_OPTIONS.find((option) => option.value === sourceCode)?.label ||
    sourceCode ||
    "Sin fuente"
  );
}

function getLeadQueueLabel(queueCode) {
  return (
    LEAD_QUEUE_FILTER_OPTIONS.find((option) => option.value === queueCode)
      ?.label || "Cola"
  );
}

function formatPercent(value, total) {
  const numerator = Number(value || 0);
  const denominator = Number(total || 0);
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatDateTime(value) {
  return formatBusinessDateTime(value, {
    options: {
      dateStyle: "short",
      timeStyle: "short",
    },
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseEmailList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isValidEmail(value) {
  const email = normalizeText(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildLeadEmailTemplate(detail, currentUser, purposeOther) {
  const contacts = Array.isArray(detail?.contacts) ? detail.contacts : [];
  const firstRecipient =
    contacts.find((contact) => normalizeText(contact?.email)) || null;
  const recipientName = normalizeText(firstRecipient?.fullName || "");
  const sellerName =
    normalizeText(detail?.seller?.fullName || "") ||
    normalizeText(currentUser?.full_name || "");
  const accountName = normalizeText(detail?.accountName || "");
  const greeting = recipientName ? `Hola ${recipientName},` : "Hola,";
  const signature = sellerName ? `\n\nSaludos,\n${sellerName}` : "\n\nSaludos.";
  const normalizedPurpose = normalizeText(purposeOther) || "company_intro";

  if (normalizedPurpose === "solution_detail") {
    return {
      subject: accountName
        ? `Detalle de solucion - ${accountName}`
        : "Detalle de solucion",
      messageBody: `${greeting}\n\nComparto informacion adicional sobre una de nuestras soluciones para que Ud. pueda revisar su alcance, beneficios y posibles casos de uso dentro de su operacion.${signature}`,
    };
  }

  if (normalizedPurpose === "meeting_request") {
    return {
      subject: accountName
        ? `Solicitud de reunion - ${accountName}`
        : "Solicitud de reunion",
      messageBody: `${greeting}\n\nMe gustaria proponerle una reunion breve para conocer mejor sus prioridades actuales y revisar si existe una linea de trabajo en la que podamos apoyarle.${signature}`,
    };
  }

  if (normalizedPurpose === "demo_request") {
    return {
      subject: accountName
        ? `Solicitud de demostracion - ${accountName}`
        : "Solicitud de demostracion",
      messageBody: `${greeting}\n\nQuisiera coordinar una demostracion para mostrarle de forma practica como funciona la solucion y revisar si encaja con lo que hoy necesita su equipo.${signature}`,
    };
  }

  return {
    subject: accountName
      ? `Presentacion de la empresa - ${accountName}`
      : "Presentacion de la empresa",
    messageBody: `${greeting}\n\nQuiero presentarle brevemente nuestra empresa y compartirle como apoyamos a organizaciones en iniciativas comerciales, operativas y de transformacion tecnologica.${signature}`,
  };
}

function buildLeadEmailDefaultDraft(detail, currentUser) {
  const contacts = Array.isArray(detail?.contacts) ? detail.contacts : [];
  const firstRecipient =
    contacts.find((contact) => normalizeText(contact?.email)) || null;
  const recipient = normalizeText(firstRecipient?.email || "");
  const recipientName = normalizeText(firstRecipient?.fullName || "");
  const sellerName =
    normalizeText(detail?.seller?.fullName || "") ||
    normalizeText(currentUser?.full_name || "");
  const sellerEmail =
    normalizeText(detail?.seller?.email || "") ||
    normalizeText(currentUser?.email || "");
  const template = buildLeadEmailTemplate(detail, currentUser, "company_intro");

  return {
    recipient,
    cc: sellerEmail,
    purposeOther: "company_intro",
    subject: template.subject,
    messageBody: template.messageBody,
    attachments: [],
  };
}

function mapLocalFileToLeadEmailAttachment(file, index = 0) {
  if (!(file instanceof File)) return null;
  return {
    id: `local:${Date.now()}:${index}:${file.name}`,
    sourceType: "local_upload",
    sourceLabel: "Archivo local",
    fileName: normalizeText(file.name) || "archivo",
    mimeType:
      normalizeText(file.type || "").toLowerCase() ||
      "application/octet-stream",
    byteSize: Number(file.size || 0),
    file,
  };
}

function mapLibraryOptionToLeadEmailAttachment(
  option,
  selectionSource = "manual",
) {
  if (!option) return null;
  const id = normalizeText(option?.id);
  const resourcePublicId = normalizeText(option?.resourcePublicId);
  const filePublicId = normalizeText(option?.filePublicId);
  if (!id || !resourcePublicId || !filePublicId) {
    return null;
  }

  return {
    id,
    sourceType: "library_file",
    sourceLabel: normalizeText(option?.sourceLabel) || "Biblioteca",
    resourcePublicId,
    filePublicId,
    fileName: normalizeText(option?.fileName) || "archivo",
    mimeType:
      normalizeText(option?.mimeType).toLowerCase() ||
      "application/octet-stream",
    byteSize: Number(option?.byteSize || 0),
    title: normalizeText(option?.title),
    summary: normalizeText(option?.summary),
    assetTypeLabel: normalizeText(option?.assetTypeLabel),
    selectionSource:
      normalizeText(selectionSource).toLowerCase() === "ai"
        ? "library_ai"
        : "library_manual",
  };
}

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function getIsoWeekKey(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function buildFullWeekRange(fromStr, toStr, dataRows) {
  if (!fromStr || !toStr) return dataRows;
  const toDate = new Date(toStr + "T00:00:00Z");
  const dataMap = new Map((dataRows || []).map((r) => [r.weekKey, r]));
  const result = [];
  let cursor = getMondayOfWeek(fromStr);
  while (cursor <= toDate) {
    const key = getIsoWeekKey(cursor);
    const existing = dataMap.get(key);
    result.push({
      weekKey: key,
      total: Number(existing?.total || 0),
      qualifiedTotal: Number(existing?.qualifiedTotal || 0),
    });
    cursor = new Date(cursor.getTime() + 7 * 24 * 3600 * 1000);
  }
  return result;
}

function getMondayDateFromWeekKey(weekKey) {
  // Returns the Monday date of an ISO week string "YYYY-Www"
  const match = String(weekKey || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(
    jan4.getTime() + (week - 1) * 7 * 86400000 - (jan4Day - 1) * 86400000,
  );
  return monday;
}

function formatWeekDateLabel(weekKey) {
  const d = getMondayDateFromWeekKey(weekKey);
  if (!d) return weekKey;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function formatIsoWeekLabel(weekKey) {
  const raw = String(weekKey || "").trim();
  const match = raw.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return raw || "Semana";
  return `Sem ${Number(match[2])} · ${match[1]}`;
}

function LeadWeeklyChart({ rows }) {
  const W = 600;
  const H = 220;
  const padL = 44;
  const padR = 20;
  const padT = 28; // extra top for legend
  const padB = 56;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  if (!rows || rows.length === 0) {
    return (
      <div className="lead-weekly-chart-empty">
        No hay datos para el rango seleccionado.
      </div>
    );
  }

  const maxVal = Math.max(
    ...rows.map((r) => Math.max(r.total, r.qualifiedTotal || 0)),
    1,
  );
  const ySteps = 4;
  const rawStep = maxVal / ySteps;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const niceStep = Math.ceil(rawStep / magnitude) * magnitude || 1;
  const yMax = niceStep * ySteps;

  const n = rows.length;
  const xStep = n > 1 ? plotW / (n - 1) : plotW;

  function xPos(i) {
    return padL + (n > 1 ? i * xStep : plotW / 2);
  }
  function yPos(val) {
    return padT + plotH - (val / yMax) * plotH;
  }

  const pointsTotal = rows.map((r, i) => [xPos(i), yPos(r.total)]);
  const pointsQual = rows.map((r, i) => [xPos(i), yPos(r.qualifiedTotal || 0)]);

  const polylineTotal = pointsTotal.map((p) => p.join(",")).join(" ");
  const polylineQual = pointsQual.map((p) => p.join(",")).join(" ");

  const areaPath = [
    `M ${pointsTotal[0][0]},${padT + plotH}`,
    ...pointsTotal.map((p) => `L ${p[0]},${p[1]}`),
    `L ${pointsTotal[pointsTotal.length - 1][0]},${padT + plotH}`,
    "Z",
  ].join(" ");

  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) =>
    Math.round((yMax / ySteps) * i),
  );

  const maxLabels = Math.max(2, Math.floor(plotW / 38));
  const xLabelStep = Math.max(1, Math.ceil(n / maxLabels));

  return (
    <svg
      className="lead-weekly-chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="Gráfica de leads creados por semana"
    >
      <defs>
        <linearGradient id="wkAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f5cd7" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#0f5cd7" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Legend */}
      <g>
        <circle cx={padL} cy={10} r="4" fill="#0f5cd7" />
        <text x={padL + 8} y={14} fontSize="9" fill="#3d566e" fontWeight="600">
          Creados
        </text>
        <circle cx={padL + 68} cy={10} r="4" fill="#16a34a" />
        <text x={padL + 76} y={14} fontSize="9" fill="#3d566e" fontWeight="600">
          Calificados
        </text>
      </g>

      {/* Y grid lines + labels */}
      {yLabels.map((val) => {
        const y = yPos(val);
        return (
          <g key={val}>
            <line
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              stroke="#e1e9f3"
              strokeWidth="1"
            />
            <text
              x={padL - 6}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill="#6a7f97"
            >
              {val}
            </text>
          </g>
        );
      })}

      {/* Area fill (total) */}
      <path d={areaPath} fill="url(#wkAreaGrad)" />

      {/* Line: total creados */}
      <polyline
        points={polylineTotal}
        fill="none"
        stroke="#0f5cd7"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Line: calificados */}
      <polyline
        points={polylineQual}
        fill="none"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="4 2"
      />

      {/* Dots total */}
      {pointsTotal.map((p, i) => (
        <g key={`t-${rows[i].weekKey}`}>
          <circle cx={p[0]} cy={p[1]} r="3" fill="#0f5cd7" />
          <title>{`${formatWeekDateLabel(rows[i].weekKey)} (${formatIsoWeekLabel(rows[i].weekKey)}): ${rows[i].total} creado${rows[i].total === 1 ? "" : "s"}`}</title>
        </g>
      ))}

      {/* Dots calificados */}
      {pointsQual.map((p, i) => (
        <g key={`q-${rows[i].weekKey}`}>
          <circle cx={p[0]} cy={p[1]} r="3" fill="#16a34a" />
          <title>{`${formatWeekDateLabel(rows[i].weekKey)} (${formatIsoWeekLabel(rows[i].weekKey)}): ${rows[i].qualifiedTotal || 0} calificado${(rows[i].qualifiedTotal || 0) === 1 ? "" : "s"}`}</title>
        </g>
      ))}

      {/* X axis labels */}
      {rows.map((r, i) => {
        if (i % xLabelStep !== 0 && i !== n - 1) return null;
        const x = xPos(i);
        const yBase = padT + plotH + 14;
        const dateLabel = formatWeekDateLabel(r.weekKey);
        const yearMatch = String(r.weekKey).match(/^(\d{4})/);
        const year = yearMatch ? yearMatch[1] : "";
        const prevYearMatch =
          i > 0 ? String(rows[i - 1]?.weekKey).match(/^(\d{4})/) : null;
        const prevYear = prevYearMatch ? prevYearMatch[1] : null;
        const showYear = i === 0 || year !== prevYear;
        return (
          <g key={r.weekKey}>
            <text
              x={x}
              y={yBase}
              textAnchor="middle"
              fontSize="7"
              fontWeight="600"
              fill="#3d566e"
            >
              {dateLabel}
            </text>
            {showYear && (
              <text
                x={x}
                y={yBase + 11}
                textAnchor="middle"
                fontSize="6"
                fill="#8fa3b8"
              >
                {year}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LeadDashboardStatCard({
  label,
  value,
  helper = "",
  tone = "default",
  onClick,
}) {
  const className = [
    "lead-dashboard-stat-card",
    `is-${tone}`,
    onClick ? "is-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span className="lead-dashboard-stat-label">{label}</span>
        <strong className="lead-dashboard-stat-value">{value}</strong>
        {helper ? (
          <span className="lead-dashboard-stat-helper">{helper}</span>
        ) : null}
      </button>
    );
  }

  return (
    <div className={className}>
      <span className="lead-dashboard-stat-label">{label}</span>
      <strong className="lead-dashboard-stat-value">{value}</strong>
      {helper ? (
        <span className="lead-dashboard-stat-helper">{helper}</span>
      ) : null}
    </div>
  );
}

function LeadDashboardQueueTable({
  title,
  emptyLabel,
  items,
  onOpenLead,
  onOpenQueue,
}) {
  return (
    <section className="lead-dashboard-queue-card">
      <div className="lead-dashboard-queue-card-header">
        <div>
          <h3>{title}</h3>
          <p>
            {items.length
              ? `${items.length} lead${items.length === 1 ? "" : "s"} destacados`
              : emptyLabel}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onOpenQueue}>
          Ver bandeja
        </button>
      </div>
      {items.length ? (
        <div className="lead-dashboard-queue-table-wrap">
          <table className="lead-dashboard-queue-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Vendedor</th>
                <th>Contacto</th>
                <th>Seguimiento</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="lead-dashboard-row-title">
                      <strong>{item.title || "Lead sin título"}</strong>
                      <span>
                        {item.accountName ||
                          getLeadSourceLabel(item.leadSource)}
                      </span>
                    </div>
                  </td>
                  <td>
                    {item.sellerName || item.sellerEmail || "Sin vendedor"}
                  </td>
                  <td>
                    {Array.isArray(item.contacts) && item.contacts.length > 0
                      ? item.contacts[0].fullName ||
                        item.contacts[0].email ||
                        "Sin contacto"
                      : "Sin contacto"}
                  </td>
                  <td>
                    {item.nextActionDueAt
                      ? formatDateTime(item.nextActionDueAt)
                      : formatDateTime(item.updatedAt || item.createdAt)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onOpenLead(item.id)}
                    >
                      Abrir lead
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="account-opps-empty lead-dashboard-empty-inline">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function buildPastedTextFileName(label) {
  const normalizedLabel = String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${normalizedLabel || "texto-referencia"}-${timestamp}.txt`;
}

function buildPastedTextFile({ fileName, text }) {
  return new File([String(text || "")], fileName, {
    type: "text/plain",
    lastModified: Date.now(),
  });
}

function formatDate(value) {
  return formatBusinessDate(value, {
    options: { day: "2-digit", month: "2-digit", year: "numeric" },
  });
}

function formatLeadOutcomeCode(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "-";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatCurrencyUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function getOptionLabel(
  optionsList,
  optionId,
  labelKeys = ["name", "full_name"],
) {
  const numericId = Number(optionId || 0);
  if (!numericId) return "";
  const option = optionsList.find((item) => Number(item.id) === numericId);
  if (!option) return "";

  for (const key of labelKeys) {
    if (option[key]) return String(option[key]);
  }

  return "";
}

function formatContactName(contactDraft, fallbackLabel) {
  const fullName = [contactDraft?.firstName, contactDraft?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || fallbackLabel;
}

function buildLegacySellerOption(detail) {
  if (!detail?.sellerUserId) return null;
  return {
    id: Number(detail.sellerUserId),
    full_name:
      detail?.seller?.fullName ||
      detail?.seller?.email ||
      `Usuario ${Number(detail.sellerUserId)}`,
  };
}

function buildEffectiveResolutionForm(
  resolutionForm,
  currentUser,
  commercialAssignmentPolicy = null,
  detail = null,
) {
  if (!resolutionForm) return null;

  const effectiveContactResolutions = (
    resolutionForm.contactResolutions || []
  ).map((item) => ({ ...item }));
  const effectiveOpportunityResolutions = (
    resolutionForm.opportunityResolutions || []
  ).map((item) => ({
    ...item,
    draft: item.draft ? { ...item.draft } : item.draft,
  }));

  let effectiveSellerUserId = resolutionForm.sellerUserId || "";
  let assignCurrentUserAsOwnerSeller = Boolean(
    resolutionForm.assignCurrentUserAsOwnerSeller,
  );
  const accountMode = resolutionForm.accountResolution?.mode || "ignore";

  if (accountMode === "ignore") {
    return {
      ...resolutionForm,
      sellerUserId: "",
      assignCurrentUserAsOwnerSeller: false,
      contactResolutions: effectiveContactResolutions.map((item) => ({
        ...item,
        mode: "ignore",
        contactId: "",
      })),
      opportunityResolutions: effectiveOpportunityResolutions.map((item) => ({
        ...item,
        mode: "ignore",
        opportunityId: "",
        isPrimary: false,
      })),
    };
  }

  const hasResolvedContacts = effectiveContactResolutions.some(
    (item) => item.mode !== "ignore",
  );
  const assignmentMode = commercialAssignmentPolicy?.mode || "none";
  const hasPersistedLinkedOpportunity = Boolean(
    detail?.primaryOpportunityId ||
    (Array.isArray(detail?.suggestedOpportunities)
      ? detail.suggestedOpportunities.some(
          (item) => item?.selectedOpportunityId,
        )
      : false),
  );

  if (!hasResolvedContacts) {
    effectiveSellerUserId = "";
    assignCurrentUserAsOwnerSeller = false;
  } else if (assignmentMode === "none") {
    effectiveSellerUserId = detail?.sellerUserId
      ? String(detail.sellerUserId)
      : "";
    assignCurrentUserAsOwnerSeller = false;
  } else if (
    !effectiveSellerUserId &&
    detail?.sellerUserId &&
    hasResolvedContacts
  ) {
    effectiveSellerUserId = String(detail.sellerUserId);
    assignCurrentUserAsOwnerSeller = false;
  } else if (
    !effectiveSellerUserId &&
    hasPersistedLinkedOpportunity &&
    detail?.sellerUserId
  ) {
    effectiveSellerUserId = String(detail.sellerUserId);
    assignCurrentUserAsOwnerSeller = false;
  } else if (
    assignmentMode === "self_only" &&
    currentUser?.id &&
    (!effectiveSellerUserId ||
      Number(effectiveSellerUserId) === Number(currentUser.id))
  ) {
    effectiveSellerUserId = String(currentUser.id);
    assignCurrentUserAsOwnerSeller = true;
  } else if (
    assignCurrentUserAsOwnerSeller &&
    currentUser?.id &&
    commercialAssignmentPolicy?.currentUserIsSellerEligible
  ) {
    effectiveSellerUserId = String(currentUser.id);
  }

  if (!hasResolvedContacts || !effectiveSellerUserId) {
    for (const item of effectiveOpportunityResolutions) {
      item.mode = "ignore";
      item.opportunityId = "";
      item.isPrimary = false;
      if (item.draft) {
        item.draft.sellerUserId = "";
      }
    }
  } else {
    for (const item of effectiveOpportunityResolutions) {
      if (item.draft) {
        item.draft.sellerUserId = effectiveSellerUserId;
      }
    }
  }

  return {
    ...resolutionForm,
    sellerUserId: effectiveSellerUserId,
    assignCurrentUserAsOwnerSeller,
    contactResolutions: effectiveContactResolutions,
    opportunityResolutions: effectiveOpportunityResolutions,
  };
}

function normalizeLeadDisplayText(value) {
  const text = String(value || "");
  if (!text) return "";

  return text
    .replace(
      /\b(interacciones|interacciónes|ieracciones|ieracciónes)\b/gi,
      (match) =>
        match.charAt(0) === match.charAt(0).toUpperCase() ? "Leads" : "leads",
    )
    .replace(
      /\b(interaccion|interacción|iteraccion|iteracción)\b/gi,
      (match) =>
        match.charAt(0) === match.charAt(0).toUpperCase() ? "Lead" : "lead",
    )
    .replace(/\b[Nn]ueva\s+lead\b/g, (match) =>
      match.charAt(0) === "N" ? "Nuevo lead" : "nuevo lead",
    );
}

function buildResolveConfirmationPreview(
  detail,
  resolutionForm,
  options,
  currentUser,
) {
  const effectiveResolutionForm = buildEffectiveResolutionForm(
    resolutionForm,
    currentUser,
    detail?.commercialAssignmentPolicy,
    detail,
  );
  if (!detail || !effectiveResolutionForm || !options) return null;

  const accountResolution = effectiveResolutionForm.accountResolution || {};
  const accountDraft = accountResolution.draft || {};
  const accountToCreate =
    accountResolution.mode === "create_new"
      ? accountDraft.name || "Nueva cuenta"
      : "";
  const accountToLink =
    accountResolution.mode === "link_existing"
      ? getOptionLabel(options.accounts || [], accountResolution.accountId)
      : "";

  const contactsToCreate = (effectiveResolutionForm.contactResolutions || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.mode === "create_new")
    .map(({ item, index }) => ({
      title: formatContactName(item.draft, `Contacto ${index + 1}`),
      meta: [item.draft?.email, item.draft?.positionTitle]
        .filter(Boolean)
        .join(" · "),
    }));

  const contactsToLink = (effectiveResolutionForm.contactResolutions || [])
    .filter((item) => item.mode === "link_existing")
    .map((item) =>
      getOptionLabel(options.contacts || [], item.contactId, [
        "full_name",
        "name",
      ]),
    )
    .filter(Boolean);

  const opportunitiesToCreate = (
    effectiveResolutionForm.opportunityResolutions || []
  )
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.mode === "create_new")
    .map(({ item, index }) => ({
      title: item.draft?.name || `Oportunidad ${index + 1}`,
      meta: [
        formatCurrencyUsd(item.draft?.amountUsd),
        item.draft?.closeDate
          ? `Cierre ${formatDate(item.draft.closeDate)}`
          : "",
        getOptionLabel(options.businessLines || [], item.draft?.businessLineId),
        effectiveResolutionForm.sellerUserId
          ? `Vendedor: ${
              Number(effectiveResolutionForm.sellerUserId) ===
              Number(currentUser?.id)
                ? currentUser?.full_name || ""
                : getOptionLabel(
                    options.sellerUsers || [],
                    effectiveResolutionForm.sellerUserId,
                    ["full_name", "name"],
                  )
            }`
          : "",
        item.draft?.presalesUserId
          ? `Preventa: ${getOptionLabel(options.presalesUsers || [], item.draft.presalesUserId, ["full_name", "name"])}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    }));

  const opportunitiesToLink = (
    effectiveResolutionForm.opportunityResolutions || []
  )
    .filter((item) => item.mode === "link_existing")
    .map((item) =>
      getOptionLabel(options.opportunities || [], item.opportunityId),
    )
    .filter(Boolean);

  const selfAssignedSellerLabel =
    effectiveResolutionForm.assignCurrentUserAsOwnerSeller && currentUser?.id
      ? currentUser.full_name || currentUser.email || "Usuario actual"
      : "";

  const sellerToAssign = effectiveResolutionForm.sellerUserId
    ? selfAssignedSellerLabel ||
      getOptionLabel(
        effectiveResolutionForm.accountResolution.mode === "link_existing"
          ? options.sellerUsersByAccountId?.[
              String(effectiveResolutionForm.accountResolution.accountId || "")
            ] || []
          : options.sellerUsers || [],
        effectiveResolutionForm.sellerUserId,
        ["full_name", "fullName", "name"],
      )
    : "";

  const hasAccount =
    effectiveResolutionForm.accountResolution.mode === "link_existing"
      ? Boolean(effectiveResolutionForm.accountResolution.accountId)
      : effectiveResolutionForm.accountResolution.mode === "create_new"
        ? Boolean(effectiveResolutionForm.accountResolution.draft?.name)
        : false;
  const hasContacts = (effectiveResolutionForm.contactResolutions || []).some(
    (item) => item.mode !== "ignore",
  );
  const hasOpportunities = (
    effectiveResolutionForm.opportunityResolutions || []
  ).some((item) => item.mode !== "ignore");
  const targetStatus =
    !hasAccount || !hasContacts
      ? "Creado"
      : !effectiveResolutionForm.sellerUserId
        ? "Lead no asignado"
        : hasOpportunities
          ? "Lead Calificado"
          : "Lead Asignado";

  return {
    interactionTitle:
      normalizeLeadDisplayText(detail.title) || "Lead sin título",
    accountToCreate,
    accountToLink,
    contactsToCreate,
    contactsToLink,
    opportunitiesToCreate,
    opportunitiesToLink,
    sellerToAssign,
    selfAssignedSellerLabel,
    targetStatus,
    ignoredContactsCount: (
      effectiveResolutionForm.contactResolutions || []
    ).filter((item) => item.mode === "ignore").length,
    ignoredOpportunitiesCount: (
      effectiveResolutionForm.opportunityResolutions || []
    ).filter((item) => item.mode === "ignore").length,
  };
}

function isQualifiedLeadStatus(status) {
  return status === "lead_qualified";
}

function isDisqualifiedLeadStatus(status) {
  return status === "lead_disqualified";
}

function isFinalizedLeadStatus(status) {
  return isQualifiedLeadStatus(status) || isDisqualifiedLeadStatus(status);
}

function getInteractionStatusMeta(status) {
  switch (status) {
    case "lead_qualified":
      return {
        label: "Lead Calificado",
        className: "interaction-status-pill is-resolved",
        toneClassName: "interaction-summary-card is-resolved",
      };
    case "lead_unassigned":
      return {
        label: "Lead no asignado",
        className: "interaction-status-pill is-uploaded",
        toneClassName: "interaction-summary-card is-uploaded",
      };
    case "lead_assigned":
      return {
        label: "Lead Asignado",
        className: "interaction-status-pill is-analyzed",
        toneClassName: "interaction-summary-card is-analyzed",
      };
    case "lead_disqualified":
      return {
        label: "Lead Descalificado",
        className: "interaction-status-pill is-rejected",
        toneClassName: "interaction-summary-card is-uploaded",
      };
    case "created":
      return {
        label: "Creado",
        className: "interaction-status-pill is-uploaded",
        toneClassName: "interaction-summary-card is-uploaded",
      };
    default:
      return {
        label: status || "Sin estado",
        className: "interaction-status-pill",
        toneClassName: "interaction-summary-card",
      };
  }
}

function getLeadCatalogEntryByCode(entries, code) {
  if (!Array.isArray(entries) || !code) return null;
  return entries.find((entry) => String(entry?.code) === String(code)) || null;
}

const EMPTY_LEAD_CATALOG = Object.freeze([]);
const EMPTY_LEAD_HISTORY = Object.freeze([]);

function getLeadOutcomeEventTypeLabel(eventType) {
  switch (eventType) {
    case "admin_correction":
      return "Corrección administrativa";
    case "legacy_snapshot":
      return "Snapshot heredado";
    case "activity_update":
    default:
      return "Actualización por actividad";
  }
}

function extractLeadOutcomeDateText(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function formatLeadOutcomeDateLabel(value) {
  if (!value) return "";
  const dateOnlyText = extractLeadOutcomeDateText(value);
  if (dateOnlyText) {
    return formatBusinessDate(dateOnlyText, {
      options: { day: "2-digit", month: "2-digit", year: "numeric" },
      fallback: "",
    });
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatBusinessDate(parsed, {
    options: { day: "2-digit", month: "2-digit", year: "numeric" },
    fallback: "",
  });
}

function hasLeadSituationInformation(detail) {
  if (!detail) return false;
  if (normalizeText(detail.summary)) return true;
  if (normalizeText(detail.accountName)) return true;
  if (Array.isArray(detail.contacts) && detail.contacts.length) return true;
  if (Array.isArray(detail.documents) && detail.documents.length) return true;
  return false;
}

function buildLeadSituationNarrative(detail) {
  if (!hasLeadSituationInformation(detail)) {
    return "No hay información suficiente para generar el análisis narrativo de la situación actual del lead.";
  }

  const accountName = normalizeText(detail?.accountName);
  const firstContact = Array.isArray(detail?.contacts)
    ? detail.contacts[0]
    : null;
  const contactName = normalizeText(firstContact?.fullName);
  const baseSummary = normalizeText(detail?.summary);
  const inferredNeed = Array.isArray(detail?.topics) ? detail.topics[0] : "";

  const chunks = [];
  chunks.push(
    `Situación actual: ${accountName ? `la cuenta asociada es ${accountName}` : "aún no hay cuenta vinculada"}${contactName ? ` y el contacto principal identificado es ${contactName}` : " y no hay contacto principal confirmado"}.`,
  );

  if (baseSummary) {
    chunks.push(`Contexto narrativo detectado: ${baseSummary}`);
  }

  if (normalizeText(inferredNeed)) {
    chunks.push(
      `Señal principal de interés o reto: ${normalizeText(inferredNeed)}.`,
    );
  }

  chunks.push(
    "Siguiente enfoque recomendado: confirmar interés real, validar el motivo del interés y cerrar una siguiente reunión técnica con demostración orientada al caso.",
  );

  return chunks.join("\n\n");
}

function isPresentationAttachment(option) {
  const fileName = String(option?.fileName || "").toLowerCase();
  const mimeType = String(option?.mimeType || "").toLowerCase();
  const assetTypeLabel = String(option?.assetTypeLabel || "").toLowerCase();
  return (
    fileName.endsWith(".ppt") ||
    fileName.endsWith(".pptx") ||
    fileName.endsWith(".pdf") ||
    mimeType.includes("presentation") ||
    assetTypeLabel.includes("present")
  );
}

function buildDefaultLeadExecutionPlan(detail) {
  const existing =
    detail?.leadExecutionPlan && typeof detail.leadExecutionPlan === "object"
      ? detail.leadExecutionPlan
      : {};
  const checklistDefaults = Object.fromEntries(
    LEAD_EXECUTION_SEQUENCE_ITEMS.map((item) => [item.id, false]),
  );
  const existingChecklist =
    existing?.screen2?.checklist &&
    typeof existing.screen2.checklist === "object"
      ? existing.screen2.checklist
      : {};

  return {
    activeScreen: Number(existing.activeScreen || 1),
    screen1: {
      selectedSolutionCode: String(
        existing?.screen1?.selectedSolutionCode || "",
      ),
      selectedSolutionLabel: String(
        existing?.screen1?.selectedSolutionLabel || "",
      ),
      selectedPresentationIds: Array.isArray(
        existing?.screen1?.selectedPresentationIds,
      )
        ? existing.screen1.selectedPresentationIds
        : [],
      narrative: String(existing?.screen1?.narrative || ""),
    },
    screen2: {
      checklist: {
        ...checklistDefaults,
        ...Object.fromEntries(
          Object.entries(existingChecklist).map(([key, value]) => [
            key,
            Boolean(value),
          ]),
        ),
      },
    },
    screen3: {
      lastStatusCode: String(existing?.screen3?.lastStatusCode || ""),
      lastSubstatusCode: String(existing?.screen3?.lastSubstatusCode || ""),
      lastReasonCode: String(existing?.screen3?.lastReasonCode || ""),
      lastActionCode: String(existing?.screen3?.lastActionCode || ""),
    },
    screen4: {
      aiInstructionText: String(existing?.screen4?.aiInstructionText || ""),
    },
    updatedAt: String(existing?.updatedAt || ""),
  };
}

function LeadExecutionSection({
  detail,
  canOpenLeadEmailModal,
  leadEmailDisabledHint,
  onOpenLeadEmailModal,
  onOpenLeadCallOutcomeModal,
  canManageLeadCallOutcome,
}) {
  const [wizardPlan, setWizardPlan] = useState(() =>
    buildDefaultLeadExecutionPlan(detail),
  );
  const [guides, setGuides] = useState({ ...LEAD_EXECUTION_GUIDE_DEFAULTS });
  const [activeGuideItemId, setActiveGuideItemId] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [solutionOptions, setSolutionOptions] = useState([]);
  const [presentationOptions, setPresentationOptions] = useState([]);
  const [savingPlan, setSavingPlan] = useState(false);
  const canSendExecutionEmail = Boolean(canOpenLeadEmailModal);
  const selectedSolutionCode = String(
    wizardPlan?.screen1?.selectedSolutionCode || "",
  );
  const selectedSolutionLabel = String(
    wizardPlan?.screen1?.selectedSolutionLabel || "",
  );
  const selectedSolutionOption = useMemo(
    () =>
      solutionOptions.find((entry) => entry.code === selectedSolutionCode) ||
      null,
    [selectedSolutionCode, solutionOptions],
  );
  const visiblePresentationOptions = useMemo(() => {
    if (!selectedSolutionCode) return [];
    const selectedCode = selectedSolutionCode.toLowerCase();

    if (selectedCode === "company_solutions_overview") {
      return presentationOptions;
    }

    return presentationOptions.filter((item) => {
      const codes = Array.isArray(item?.solutionCodes)
        ? item.solutionCodes
        : [];
      const labels = Array.isArray(item?.solutionLabels)
        ? item.solutionLabels
        : [];

      return codes.some(
        (code) => normalizeText(code).toLowerCase() === selectedCode,
      );
    });
  }, [presentationOptions, selectedSolutionCode]);

  useEffect(() => {
    setWizardPlan(buildDefaultLeadExecutionPlan(detail));
  }, [detail?.id]);

  const activeScreen = Math.min(
    4,
    Math.max(1, Number(wizardPlan?.activeScreen || 1)),
  );

  const narrativeText = useMemo(() => {
    const persistedNarrative = normalizeText(wizardPlan?.screen1?.narrative);
    if (persistedNarrative) return persistedNarrative;
    return buildLeadSituationNarrative(detail);
  }, [detail, wizardPlan?.screen1?.narrative]);

  async function persistPlan(nextPlan) {
    if (!detail?.id) return;
    setSavingPlan(true);
    try {
      await api.put(`/api/interactions/${detail.id}/lead-execution-plan`, {
        plan: {
          ...nextPlan,
          updatedAt: new Date().toISOString(),
        },
      });
    } catch {
      // Keep local state to avoid interrupting user flow on transient failures.
    } finally {
      setSavingPlan(false);
    }
  }

  function updateWizardPlan(updater) {
    setWizardPlan((current) => {
      const nextPlan =
        typeof updater === "function" ? updater(current) : updater;
      void persistPlan(nextPlan);
      return nextPlan;
    });
  }

  async function loadGuideTexts() {
    try {
      const { data } = await api.get("/api/interactions/lead-execution-guides");
      const nextGuides = {
        ...LEAD_EXECUTION_GUIDE_DEFAULTS,
        ...(data?.guides && typeof data.guides === "object" ? data.guides : {}),
      };
      setGuides(nextGuides);
    } catch {
      setGuides({ ...LEAD_EXECUTION_GUIDE_DEFAULTS });
    }
  }

  async function loadPresentationOptions(solutionCode = "") {
    if (!detail?.id) return;
    setLibraryLoading(true);
    setLibraryError("");
    try {
      const [attachmentsResponse, catalogsResponse] = await Promise.all([
        api.get(`/api/interactions/${detail.id}/email-attachments/options`, {
          params: {
            q: "",
          },
        }),
        api.get("/api/commercial-enablement/catalogs"),
      ]);

      const { data } = attachmentsResponse;

      const rawLibraryOptions = Array.isArray(data?.libraryFiles)
        ? data.libraryFiles
        : [];

      const presentationItems = rawLibraryOptions
        .filter((item) => isPresentationAttachment(item))
        .map((item) => ({
          id: normalizeText(item?.id),
          resourcePublicId: normalizeText(item?.resourcePublicId),
          filePublicId: normalizeText(item?.filePublicId),
          fileName: normalizeText(item?.fileName),
          title: normalizeText(item?.title),
          summary: normalizeText(item?.summary),
          sourceLabel: normalizeText(item?.sourceLabel || "Biblioteca"),
          mimeType: normalizeText(item?.mimeType),
          assetTypeLabel: normalizeText(item?.assetTypeLabel),
          solutionCodes: Array.isArray(item?.solutionCodes)
            ? item.solutionCodes
            : [],
          solutionLabels: Array.isArray(item?.solutionLabels)
            ? item.solutionLabels
            : [],
          technologyCodes: Array.isArray(item?.technologyCodes)
            ? item.technologyCodes
            : [],
          technologyLabels: Array.isArray(item?.technologyLabels)
            ? item.technologyLabels
            : [],
        }))
        .filter(
          (item) => item.id && item.resourcePublicId && item.filePublicId,
        );

      const catalogSolutions = Array.isArray(catalogsResponse?.data?.solution)
        ? catalogsResponse.data.solution
        : [];

      const normalizedSolutions = catalogSolutions.map((entry) => ({
        code: normalizeText(entry?.code),
        label: String(entry?.name || entry?.label || entry?.code || "").trim(),
      }));

      setSolutionOptions(normalizedSolutions.filter((entry) => entry.code));
      setPresentationOptions(presentationItems);
    } catch (error) {
      setLibraryError(
        getApiErrorMessage(
          error,
          "No fue posible cargar presentaciones de biblioteca comercial.",
        ),
      );
      setPresentationOptions([]);
      setSolutionOptions([]);
    } finally {
      setLibraryLoading(false);
    }
  }

  useEffect(() => {
    void loadGuideTexts();
  }, [detail?.id]);

  useEffect(() => {
    void loadPresentationOptions(
      wizardPlan?.screen1?.selectedSolutionCode || "",
    );
  }, [detail?.id, wizardPlan?.screen1?.selectedSolutionCode]);

  function updateActiveScreen(nextScreen) {
    updateWizardPlan((current) => ({
      ...current,
      activeScreen: Math.min(4, Math.max(1, Number(nextScreen || 1))),
    }));
  }

  function handleSelectSolution(solutionCode, solutionLabel) {
    updateWizardPlan((current) => ({
      ...current,
      screen1: {
        ...current.screen1,
        selectedSolutionCode: solutionCode,
        selectedSolutionLabel: solutionLabel,
        narrative: narrativeText,
      },
    }));
  }

  function togglePresentationSelection(itemId) {
    updateWizardPlan((current) => {
      const selectedIds = Array.isArray(
        current?.screen1?.selectedPresentationIds,
      )
        ? current.screen1.selectedPresentationIds
        : [];
      const nextIds = selectedIds.includes(itemId)
        ? selectedIds.filter((id) => id !== itemId)
        : [...selectedIds, itemId];

      return {
        ...current,
        screen1: {
          ...current.screen1,
          selectedPresentationIds: nextIds,
          narrative: narrativeText,
        },
      };
    });
  }

  function toggleChecklistItem(itemId) {
    updateWizardPlan((current) => ({
      ...current,
      screen2: {
        ...current.screen2,
        checklist: {
          ...(current?.screen2?.checklist || {}),
          [itemId]: !Boolean(current?.screen2?.checklist?.[itemId]),
        },
      },
    }));
  }

  function buildExecutionEmailInstruction() {
    const selectedSolutionLabel =
      normalizeText(wizardPlan?.screen1?.selectedSolutionLabel) ||
      "sin solución seleccionada";
    const completedChecklist = LEAD_EXECUTION_SEQUENCE_ITEMS.filter((item) =>
      Boolean(wizardPlan?.screen2?.checklist?.[item.id]),
    ).map((item) => item.title);

    const outcomeSummary = [
      detail?.leadSubstatusCode
        ? `Situación: ${detail.leadSubstatusCode}`
        : "Situación: sin registrar",
      detail?.leadReasonCode
        ? `Motivo: ${detail.leadReasonCode}`
        : "Motivo: sin registrar",
      detail?.leadRequiredActionCode
        ? `Acción: ${detail.leadRequiredActionCode}`
        : "Acción: sin registrar",
    ].join(" | ");

    return [
      "Genera un correo comercial formal en español para continuar el lead.",
      `Solución seleccionada por el vendedor: ${selectedSolutionLabel}.`,
      `Resumen de ejecución de presentación (checklist): ${completedChecklist.length ? completedChecklist.join(", ") : "sin items marcados"}.`,
      `Resultado de la reunión: ${outcomeSummary}.`,
      "Objetivo del correo: confirmar lo conversado, proponer siguiente reunión técnica/demo y cerrar una fecha tentativa.",
    ].join("\n");
  }

  function openExecutionEmailStep() {
    if (!canSendExecutionEmail) return;
    onOpenLeadEmailModal({
      purposeOther: "meeting_request",
      aiInstructionText: buildExecutionEmailInstruction(),
      autoGenerateAi: true,
    });
  }

  async function handleDownloadPresentationFile(item) {
    const assetPublicId = String(item?.resourcePublicId || "").trim();
    const filePublicId = String(item?.filePublicId || "").trim();
    if (!assetPublicId || !filePublicId || typeof window === "undefined") {
      return;
    }

    setLibraryError("");
    try {
      const response = await api.get(
        `/api/commercial-enablement/assets/${encodeURIComponent(assetPublicId)}/files/${encodeURIComponent(filePublicId)}/content`,
        {
          responseType: "blob",
          timeout: 60000,
        },
      );

      const contentDisposition = String(
        response?.headers?.["content-disposition"] || "",
      );
      const utfFileNameMatch = contentDisposition.match(
        /filename\*=UTF-8''([^;]+)/i,
      );
      const plainFileNameMatch = contentDisposition.match(
        /filename="?([^";]+)"?/i,
      );
      const decodedFileName = utfFileNameMatch?.[1]
        ? decodeURIComponent(utfFileNameMatch[1])
        : plainFileNameMatch?.[1] || item?.fileName || item?.title || "archivo";

      const blob = new Blob([response.data], {
        type:
          String(response?.headers?.["content-type"] || "").trim() ||
          item?.mimeType ||
          "application/octet-stream",
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = decodedFileName;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (requestError) {
      setLibraryError(
        getApiErrorMessage(
          requestError,
          "No fue posible descargar el archivo seleccionado.",
        ),
      );
    }
  }

  const selectedGuide = activeGuideItemId
    ? LEAD_EXECUTION_SEQUENCE_ITEMS.find(
        (item) => item.id === activeGuideItemId,
      )
    : null;

  return (
    <details
      className="account-form-section account-modal-section interaction-detail-section lead-execution-section"
      open
    >
      <summary className="lead-execution-summary-trigger">
        <div className="lead-execution-header-copy">
          <span className="lead-execution-kicker">Ejecución del lead</span>
          <h4>Flujo guiado de reunión comercial</h4>
          <p className="field-hint lead-execution-header-description">
            Navega entre 4 pantallas para preparar la reunión, ejecutar la
            secuencia, registrar resultado y enviar correo al cliente.
          </p>
        </div>
        <span className="lead-execution-summary-hint">
          Pantalla {activeScreen} de 4
        </span>
      </summary>

      <div className="lead-execution-content">
        <div className="lead-execution-wizard-nav">
          {LEAD_EXECUTION_WIZARD_STEPS.map((step) => (
            <button
              type="button"
              key={step.id}
              className={`lead-execution-wizard-step${activeScreen === step.id ? " is-active" : ""}${activeScreen > step.id ? " is-complete" : ""}`}
              onClick={() => updateActiveScreen(step.id)}
            >
              <span className="lead-execution-wizard-step-number">
                {step.id}
              </span>
              <span className="lead-execution-wizard-step-label">
                {step.label}
              </span>
            </button>
          ))}
        </div>

        {activeScreen === 1 ? (
          <section className="lead-execution-screen">
            <article className="lead-execution-purpose-panel">
              <strong>Objetivo de la reunión</strong>
              <p>
                Identificar o confirmar el interés del cliente, entender por qué
                le interesa y agendar una siguiente reunión con detalle técnico
                y demostración orientada a sus motivos.
              </p>
            </article>

            <article className="lead-execution-ai-narrative">
              <div className="lead-execution-ai-narrative-header">
                <strong>Análisis narrativo de situación actual</strong>
                <span className="lead-execution-ai-pill">✦ IA</span>
              </div>
              <div className="lead-execution-ai-narrative-body">
                {narrativeText
                  .split("\n\n")
                  .filter(Boolean)
                  .filter((_, i) => i !== 1)
                  .map((chunk, i) => (
                    <p key={i}>{chunk}</p>
                  ))}
              </div>
            </article>

            <div className="lead-execution-solutions-wrap">
              <div className="lead-execution-section-head">
                <strong>Soluciones</strong>
                <p className="field-hint">
                  Selecciona una solución para ver debajo solo sus archivos
                  asociados.
                </p>
              </div>

              <div className="lead-execution-solution-list" role="list">
                {solutionOptions.map((entry) => {
                  const selected = entry.code === selectedSolutionCode;
                  return (
                    <button
                      type="button"
                      key={entry.code}
                      role="listitem"
                      className={`lead-execution-solution-card${selected ? " is-selected" : ""}`}
                      onClick={() =>
                        handleSelectSolution(entry.code, entry.label)
                      }
                    >
                      <strong>{entry.label}</strong>
                      {selected ? <span>Seleccionada</span> : null}
                    </button>
                  );
                })}
              </div>

              {selectedSolutionCode ? (
                <p className="field-hint lead-execution-selected-solution-note">
                  Archivos para:{" "}
                  {selectedSolutionOption?.label ||
                    selectedSolutionLabel ||
                    selectedSolutionCode}
                </p>
              ) : (
                <p className="field-hint lead-execution-selected-solution-note">
                  Selecciona una solución para ver sus archivos.
                </p>
              )}
            </div>

            <div className="lead-execution-presentations-wrap">
              <div className="lead-execution-section-head">
                <strong>Archivos de la solución seleccionada</strong>
              </div>

              {libraryLoading ? (
                <p className="field-hint">Cargando archivos...</p>
              ) : null}
              {libraryError ? (
                <p className="form-error">{libraryError}</p>
              ) : null}

              {!libraryLoading &&
              selectedSolutionCode &&
              visiblePresentationOptions.length === 0 ? (
                <p className="field-hint">
                  No hay archivos para la solución seleccionada.
                </p>
              ) : null}

              {selectedSolutionCode && visiblePresentationOptions.length ? (
                <div className="lead-execution-presentation-list">
                  {visiblePresentationOptions.map((item) => {
                    return (
                      <article
                        key={item.id}
                        className="lead-execution-presentation-card"
                      >
                        <div>
                          <strong>
                            {item.fileName || item.title || "Archivo"}
                          </strong>
                          <p className="field-hint">
                            {item.title || "Biblioteca comercial"}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="interaction-detail-icon-btn"
                          onClick={() => {
                            void handleDownloadPresentationFile(item);
                          }}
                          title="Descargar"
                          aria-label="Descargar"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            focusable="false"
                            aria-hidden="true"
                          >
                            <path d="M12 4v10" />
                            <path d="M8.5 10.5 12 14l3.5-3.5" />
                            <path d="M5 19h14" />
                          </svg>
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeScreen === 2 ? (
          <section className="lead-execution-screen">
            <div className="lead-execution-section-head">
              <strong>Secuencia de presentación</strong>
              <p className="field-hint">
                Marca cada punto que hayas ejecutado. No es obligatorio
                completar toda la secuencia para continuar.
              </p>
            </div>
            <div className="lead-execution-checklist">
              {LEAD_EXECUTION_SEQUENCE_ITEMS.map((item, index) => {
                const done = Boolean(wizardPlan?.screen2?.checklist?.[item.id]);
                return (
                  <article
                    key={item.id}
                    className={`lead-execution-checklist-item${done ? " is-done" : ""}`}
                  >
                    <span className="lead-execution-checklist-step">
                      {done ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </span>
                    <label className="lead-execution-checklist-label">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => toggleChecklistItem(item.id)}
                      />
                      <span>{item.title}</span>
                    </label>
                    <button
                      type="button"
                      className="lead-execution-guide-button"
                      onClick={() => setActiveGuideItemId(item.id)}
                      aria-label={`Ver guía para ${item.title}`}
                      title="Ver guía"
                    >
                      ?
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeScreen === 3 ? (
          <section className="lead-execution-screen">
            <div className="lead-execution-section-head">
              <strong>Resultado de la reunión</strong>
              <p className="field-hint">
                Registra la situación de la reunión usando el mismo flujo actual
                de resultado comercial del lead.
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={onOpenLeadCallOutcomeModal}
              disabled={!canManageLeadCallOutcome}
            >
              Registrar situación del lead
            </button>
          </section>
        ) : null}

        {activeScreen === 4 ? (
          <section className="lead-execution-screen">
            <div className="lead-execution-section-head">
              <strong>Correo al cliente</strong>
              <p className="field-hint">
                El correo se abrirá prellenado con recomendación de IA basada en
                lo registrado en los pasos 1, 2 y 3.
              </p>
            </div>
            {leadEmailDisabledHint ? (
              <p className="field-hint">{leadEmailDisabledHint}</p>
            ) : null}
            <button
              type="button"
              className="btn-secondary"
              onClick={openExecutionEmailStep}
              disabled={!canSendExecutionEmail}
            >
              Abrir correo prellenado
            </button>
          </section>
        ) : null}

        <div className="lead-execution-wizard-actions">
          {savingPlan ? (
            <span className="field-hint">Guardando checklist y avance...</span>
          ) : null}
        </div>
      </div>

      {selectedGuide ? (
        <div className="modal-overlay">
          <div className="modal-dialog lead-execution-guide-modal">
            <div className="lead-execution-guide-modal-header">
              <span className="lead-execution-guide-modal-kicker">
                Guía de ejecución
              </span>
              <button
                type="button"
                className="lead-execution-guide-modal-close"
                onClick={() => setActiveGuideItemId("")}
                aria-label="Cerrar guía"
                title="Cerrar"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="lead-execution-guide-modal-body">
              <p className="lead-execution-guide-modal-step">
                Paso{" "}
                {LEAD_EXECUTION_SEQUENCE_ITEMS.findIndex(
                  (i) => i.id === selectedGuide.id,
                ) + 1}{" "}
                de {LEAD_EXECUTION_SEQUENCE_ITEMS.length}
              </p>
              <h3 className="lead-execution-guide-modal-title">
                {selectedGuide.title}
              </h3>
              <p className="lead-execution-guide-modal-text">
                {guides[selectedGuide.id] ||
                  LEAD_EXECUTION_GUIDE_DEFAULTS[selectedGuide.id] ||
                  "Sin guía configurada"}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </details>
  );
}

function getDocumentStageLabel(status, labels = {}) {
  switch (status) {
    case "completed":
      return labels.completed || "Completada";
    case "pending":
      return labels.pending || "Pendiente";
    case "failed":
      return labels.failed || "Fallida";
    default:
      return status || "Sin estado";
  }
}

function documentNeedsTranscription(document) {
  const extension = String(document?.fileExtension || "").toLowerCase();
  const mimeType = String(document?.mimeType || "").toLowerCase();
  return (
    [".mp3", ".wav", ".m4a"].includes(extension) ||
    mimeType.startsWith("audio/")
  );
}

function getDocumentProcessingSummary(document) {
  const extractionLabel = getDocumentStageLabel(document?.extractionStatus, {
    completed: "Completada",
    pending: "Pendiente",
    failed: "Fallida",
  });

  const transcriptionLabel = documentNeedsTranscription(document)
    ? getDocumentStageLabel(document?.transcriptionStatus, {
        completed: "Completada",
        pending: "Pendiente",
        failed: "Fallida",
      })
    : "No aplica";

  return `Extracción: ${extractionLabel} | Transcripción: ${transcriptionLabel}`;
}

function buildLeadCallOutcomeForm(detail, transitionRules) {
  const initialRule =
    transitionRules.find(
      (rule) =>
        rule.substatusCode === detail?.leadSubstatusCode &&
        rule.reasonCode === detail?.leadReasonCode &&
        rule.requiredActionCode === detail?.leadRequiredActionCode,
    ) ||
    transitionRules[0] ||
    null;

  return {
    substatusCode: initialRule?.substatusCode || "",
    reasonCode: initialRule?.reasonCode || "",
    requiredActionCode: initialRule?.requiredActionCode || "",
    comment: detail?.leadCommercialComment || "",
    nextActionDueAt: extractLeadOutcomeDateText(detail?.leadNextActionDueAt),
    referredContactName: detail?.leadReferredContactName || "",
    referredAreaName: detail?.leadReferredAreaName || "",
    eventType: "activity_update",
    correctionReason: "",
    correctionTargetEventId: "",
  };
}

function buildDefaultOpportunityDraft(suggestion, options, currentUser) {
  const closeDate = addDaysToIsoDate(getTodayBusinessDate(), 30);
  return {
    name: suggestion?.name || "",
    contactId: "",
    amountUsd:
      suggestion?.amountUsd === null || suggestion?.amountUsd === undefined
        ? ""
        : String(suggestion.amountUsd),
    closeDate: suggestion?.closeDate || closeDate,
    businessLineId: suggestion?.selectedBusinessLineId
      ? String(suggestion.selectedBusinessLineId)
      : options.businessLines[0]?.id
        ? String(options.businessLines[0].id)
        : "",
    sellerUserId: suggestion?.selectedSellerUserId
      ? String(suggestion.selectedSellerUserId)
      : options.currentUserIsSellerEligible && currentUser?.id
        ? String(currentUser.id)
        : options.sellerUsers[0]?.id
          ? String(options.sellerUsers[0].id)
          : "",
    presalesUserId: suggestion?.selectedPresalesUserId
      ? String(suggestion.selectedPresalesUserId)
      : options.presalesUsers[0]?.id
        ? String(options.presalesUsers[0].id)
        : "",
    summary: suggestion?.summary || "",
  };
}

function buildInitialResolutionForm(detail, options, currentUser) {
  const commercialAssignmentPolicy = detail?.commercialAssignmentPolicy || null;
  const suggestedAccount = detail?.suggestedAccount || null;
  const persistedAccountMode =
    typeof suggestedAccount?.resolutionMode === "string"
      ? suggestedAccount.resolutionMode
      : "";
  const accountResolution =
    suggestedAccount?.selectedAccountId &&
    (persistedAccountMode === "link_existing" ||
      (Number(suggestedAccount?.selectedAccountId || 0) > 0 &&
        Number(detail?.accountId || 0) > 0 &&
        Number(suggestedAccount?.selectedAccountId) ===
          Number(detail?.accountId)))
      ? {
          mode: "link_existing",
          accountId: String(suggestedAccount.selectedAccountId),
          draft: {
            name: suggestedAccount.name || "",
            website: suggestedAccount.website || "",
            phone: suggestedAccount.phone || "",
            city: suggestedAccount.city || "",
            stateRegion: suggestedAccount.stateRegion || "",
            countryId: suggestedAccount.countryId
              ? String(suggestedAccount.countryId)
              : "",
            description: suggestedAccount.description || "",
          },
        }
      : persistedAccountMode === "ignore"
        ? {
            mode: "ignore",
            accountId: "",
            draft: {
              name: suggestedAccount?.name || "",
              website: suggestedAccount?.website || "",
              phone: suggestedAccount?.phone || "",
              city: suggestedAccount?.city || "",
              stateRegion: suggestedAccount?.stateRegion || "",
              countryId: suggestedAccount?.countryId
                ? String(suggestedAccount.countryId)
                : "",
              description:
                suggestedAccount?.description || detail?.summary || "",
            },
          }
        : suggestedAccount?.name
          ? {
              mode: "create_new",
              accountId: "",
              draft: {
                name: suggestedAccount.name || "",
                website: suggestedAccount.website || "",
                phone: suggestedAccount.phone || "",
                city: suggestedAccount.city || "",
                stateRegion: suggestedAccount.stateRegion || "",
                countryId: suggestedAccount.countryId
                  ? String(suggestedAccount.countryId)
                  : "",
                description:
                  suggestedAccount.description || detail?.summary || "",
              },
            }
          : {
              mode: "ignore",
              accountId: "",
              draft: {
                name: "",
                website: "",
                phone: "",
                city: "",
                stateRegion: "",
                countryId: "",
                description: "",
              },
            };

  const contactResolutions = (detail?.suggestedContacts || []).map(
    (contact) => {
      const persistedMode =
        typeof contact?.resolutionMode === "string"
          ? contact.resolutionMode
          : "";
      return {
        suggestionId: contact.suggestionId,
        mode:
          persistedMode === "link_existing" && contact.selectedContactId
            ? "link_existing"
            : persistedMode === "ignore"
              ? "ignore"
              : contact.fullName
                ? "create_new"
                : "ignore",
        contactId:
          persistedMode === "link_existing" && contact.selectedContactId
            ? String(contact.selectedContactId)
            : "",
        draft: {
          firstName: contact.firstName || "",
          lastName: contact.lastName || "",
          email: contact.email || "",
          phone: contact.phone || "",
          phoneExtension: "",
          mobile: contact.mobile || "",
          positionTitle: contact.positionTitle || "",
          department: contact.department || "",
          countryId: "",
          stateRegion: "",
          city: "",
        },
      };
    },
  );

  if (!contactResolutions.length) {
    contactResolutions.push({
      suggestionId: "manual_contact_1",
      mode: "ignore",
      contactId: "",
      draft: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        phoneExtension: "",
        mobile: "",
        positionTitle: "",
        department: "",
        countryId: "",
        stateRegion: "",
        city: "",
      },
    });
  }

  const opportunityResolutions = (detail?.suggestedOpportunities || []).map(
    (opportunity, index) => {
      const persistedMode =
        typeof opportunity?.resolutionMode === "string"
          ? opportunity.resolutionMode
          : "";
      return {
        suggestionId: opportunity.suggestionId,
        mode:
          persistedMode === "link_existing" && opportunity.selectedOpportunityId
            ? "link_existing"
            : persistedMode === "ignore"
              ? "ignore"
              : detail?.sellerUserId && opportunity.name
                ? "create_new"
                : "ignore",
        opportunityId:
          persistedMode === "link_existing" && opportunity.selectedOpportunityId
            ? String(opportunity.selectedOpportunityId)
            : "",
        isPrimary: index === 0,
        draft: buildDefaultOpportunityDraft(opportunity, options, currentUser),
      };
    },
  );

  if (!opportunityResolutions.length) {
    opportunityResolutions.push({
      suggestionId: "manual_opportunity_1",
      mode: "ignore",
      opportunityId: "",
      isPrimary: true,
      draft: buildDefaultOpportunityDraft(null, options, currentUser),
    });
  }

  return {
    sellerUserId: detail?.sellerUserId
      ? String(detail.sellerUserId)
      : commercialAssignmentPolicy?.mode === "self_only" && currentUser?.id
        ? String(currentUser.id)
        : "",
    assignCurrentUserAsOwnerSeller: false,
    accountResolution,
    contactResolutions,
    opportunityResolutions,
  };
}

function buildEditableForm(detail) {
  return {
    title: detail?.title || "",
    leadSource: detail?.leadSource || "empresa_marketing",
    sourceNotes: detail?.sourceNotes || "",
    summary: detail?.summary || "",
    topics: Array.isArray(detail?.topics) ? detail.topics : [],
    actionsTaken: Array.isArray(detail?.actionsTaken)
      ? detail.actionsTaken
      : [],
    nextSteps: Array.isArray(detail?.nextSteps) ? detail.nextSteps : [],
    suggestedAccount: detail?.suggestedAccount || null,
    suggestedContacts: Array.isArray(detail?.suggestedContacts)
      ? detail.suggestedContacts
      : [],
    suggestedOpportunities: Array.isArray(detail?.suggestedOpportunities)
      ? detail.suggestedOpportunities
      : [],
  };
}

function normalizeTagEditorLines(value) {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function TagEditor({ label, values, onChange, placeholder }) {
  const [draftValue, setDraftValue] = useState(() => values.join("\n"));

  useEffect(() => {
    const nextValue = values.join("\n");
    setDraftValue((currentValue) =>
      currentValue === nextValue ? currentValue : nextValue,
    );
  }, [values]);

  return (
    <div className="field-group interaction-tag-editor">
      <label>{label}</label>
      <textarea
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={() => onChange(normalizeTagEditorLines(draftValue))}
        placeholder={placeholder}
      />
    </div>
  );
}

function CreateInteractionModal({
  isOpen,
  onClose,
  onSubmit,
  creating,
  isUploadingFiles,
  setCreateInfoMessage,
  leadSource,
  setLeadSource,
  files,
  setFiles,
  onUploadFiles,
  pastedTextName,
  setPastedTextName,
  pastedText,
  setPastedText,
}) {
  if (!isOpen) return null;

  const handleFileChange = async (event) => {
    const nextFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!nextFiles.length) return;

    try {
      await onUploadFiles(nextFiles);
      setFiles((currentFiles) => [...currentFiles, ...nextFiles]);
    } catch (error) {
      setCreateInfoMessage?.(
        getApiErrorMessage(error, "No fue posible subir los archivos"),
      );
    }
  };

  const handleAddPastedText = async () => {
    const trimmedText = String(pastedText || "").trim();
    if (!trimmedText) return;

    const pastedTextFile = buildPastedTextFile({
      fileName: buildPastedTextFileName(pastedTextName),
      text: trimmedText,
    });

    try {
      await onUploadFiles([pastedTextFile]);
      setFiles((currentFiles) => [...currentFiles, pastedTextFile]);
    } catch (error) {
      setCreateInfoMessage?.(
        getApiErrorMessage(error, "No fue posible subir el texto al lead"),
      );
      return;
    }
    setPastedTextName("");
    setPastedText("");
  };

  return (
    <div className="modal-overlay">
      <div
        className={`modal-dialog modal-dialog-wide interaction-modal modal-dialog-with-scroll-shell${creating ? " modal-dialog-busy" : ""}`}
        aria-busy={creating || isUploadingFiles}
      >
        <div className="modal-dialog-scroll-shell">
          <div className="modal-header interaction-modal-header-with-close">
            <button
              type="button"
              className="btn-secondary account-modal-close-button interaction-modal-close-left"
              onClick={onClose}
              disabled={creating}
              aria-label="Cerrar modal de crear lead"
              title="Cerrar"
            >
              ×
            </button>
            <div className="interaction-create-header">
              <div className="interaction-create-heading">
                <span className="interaction-create-kicker">Nuevo lead</span>
                <div className="account-modal-title-row">
                  <h3 className="modal-title">Crear lead</h3>
                  <ModalInlineHelp helpKey="lead.create" />
                </div>
                <p className="interaction-create-subtitle">
                  Reúne evidencia, agrega contexto en texto y deja listo el lead
                  para análisis y seguimiento.
                </p>
              </div>
              <div className="interaction-create-header-meta">
                <span className="interaction-documents-count-badge">
                  {files.length} {files.length === 1 ? "archivo" : "archivos"}
                </span>
                <span className="interaction-documents-count-badge">
                  {pastedText.trim() ? "Texto listo" : "Sin texto"}
                </span>
                <span className="interaction-create-format-pill">
                  PDF, Office, EML, imágenes y audio
                </span>
              </div>
            </div>
          </div>
          <fieldset
            className="interaction-detail-lock-shell"
            disabled={creating || isUploadingFiles}
          >
            <form
              className="account-create-form interaction-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              <section className="account-form-section account-modal-section interaction-create-dropzone-section">
                <div className="interaction-create-grid">
                  <label className="interaction-create-dropzone">
                    <input
                      type="file"
                      multiple
                      accept={INTERACTION_FILE_ACCEPT}
                      onChange={(event) => {
                        void handleFileChange(event);
                      }}
                    />
                    <span
                      className="interaction-create-dropzone-icon"
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M12 3.75a.75.75 0 0 1 .75.75v8.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75" />
                        <path d="M5.75 15.5a.75.75 0 0 1 .75.75v1.25c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-1.25a.75.75 0 0 1 1.5 0v1.25A2.75 2.75 0 0 1 16.25 20h-8.5A2.75 2.75 0 0 1 5 17.25v-1.25a.75.75 0 0 1 .75-.75" />
                      </svg>
                    </span>
                    <strong>Selecciona uno o varios archivos</strong>
                    <span className="interaction-create-dropzone-copy">
                      Adjunta correos, cotizaciones, minutas, audios o archivos
                      de soporte. Si prefieres, también puedes crear el lead
                      solo con texto pegado.
                    </span>
                    <span className="interaction-create-dropzone-action">
                      Elegir archivos
                    </span>
                    {files.length ? (
                      <span className="interaction-create-dropzone-selected">
                        {files.length} archivo{files.length === 1 ? "" : "s"}
                        seleccionado{files.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {isUploadingFiles ? (
                      <span className="interaction-create-dropzone-selected interaction-create-dropzone-selected-uploading">
                        Subiendo archivos...
                      </span>
                    ) : null}
                    <span className="interaction-create-dropzone-footnote">
                      Formatos soportados: PDF, DOCX, XLSX, XLS, CSV, TXT, EML,
                      PNG, JPG, JPEG, MP3, WAV, M4A y MP4.
                    </span>
                  </label>

                  <div className="interaction-create-guidance">
                    <div className="interaction-create-guidance-card">
                      <span className="interaction-create-guidance-step">
                        Paso 1
                      </span>
                      <strong>Carga evidencia</strong>
                      <p>
                        Reúne los archivos que explican el contexto comercial
                        del caso.
                      </p>
                    </div>
                    <div className="interaction-create-guidance-card">
                      <span className="interaction-create-guidance-step">
                        Paso 2
                      </span>
                      <strong>Crea el lead</strong>
                      <p>
                        El lead se guarda con la evidencia documental que
                        cargaste.
                      </p>
                    </div>
                    <div className="interaction-create-guidance-card">
                      <span className="interaction-create-guidance-step">
                        Paso 3
                      </span>
                      <strong>Analiza y resuelve</strong>
                      <p>
                        Abre el lead y usa "Analizar documentos para llenar
                        información" antes de resolver vínculos en el CRM.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="account-form-section account-modal-section">
                <div className="field-group">
                  <label>Fuente del lead</label>
                  <select
                    value={leadSource}
                    onChange={(event) => setLeadSource(event.target.value)}
                    required
                  >
                    <option value="">Selecciona una fuente</option>
                    {LEAD_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="account-form-section account-modal-section interaction-create-text-section">
                <div className="interaction-create-text-card">
                  <div className="interaction-create-text-card-head">
                    <div className="interaction-create-text-card-copy">
                      <span className="interaction-create-kicker">
                        Texto de referencia
                      </span>
                      <strong>Agrega más fuentes de texto al lead</strong>
                      <p className="section-helper-text interaction-create-text-card-hint">
                        Convierte correos, minutas o notas en archivos `.txt`
                        para analizarlos junto con el resto de la evidencia.
                      </p>
                    </div>
                  </div>

                  <div className="interaction-create-text-controls">
                    <div className="field-group interaction-create-text-name-field">
                      <label>Nombre del archivo de texto</label>
                      <input
                        type="text"
                        value={pastedTextName}
                        onChange={(event) =>
                          setPastedTextName(event.target.value)
                        }
                        placeholder="Ej. correo-cliente, minuta-reunion, contexto-inicial"
                      />
                    </div>
                    <div className="interaction-create-text-actions">
                      <button
                        type="button"
                        className="btn-secondary interaction-create-add-text-button"
                        onClick={handleAddPastedText}
                        disabled={creating || !String(pastedText || "").trim()}
                      >
                        Agregar texto como evidencia
                      </button>
                    </div>
                  </div>

                  <div className="interaction-create-text-grid">
                    <div className="field-group interaction-create-text-body-field">
                      <label>Pegar texto</label>
                      <textarea
                        className="interaction-create-textarea"
                        value={pastedText}
                        onChange={(event) => setPastedText(event.target.value)}
                        placeholder="Pega aquí el contenido que quieres añadir como evidencia del lead."
                      />
                    </div>
                  </div>

                  <span className="field-hint interaction-create-text-footnote">
                    Se agregará como un archivo `.txt` al repositorio del lead.
                  </span>
                </div>
              </section>

              <section className="account-form-section account-modal-section interaction-create-files-section">
                <div className="interaction-create-files-header">
                  <h4>Archivos seleccionados</h4>
                  <p className="section-helper-text">
                    Revisa aquí la evidencia que se usará para crear el lead.
                  </p>
                </div>

                {files.length ? (
                  <div className="interaction-create-files-list">
                    {files.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="interaction-create-file-card"
                      >
                        <span className="interaction-create-file-name">
                          {file.name}
                        </span>
                        <span className="interaction-create-file-meta">
                          {Math.max(1, Math.round(file.size / 1024))} KB
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="interaction-create-empty-state">
                    Aún no has seleccionado archivos. Empieza cargando la
                    evidencia del caso.
                  </div>
                )}
              </section>
              <div className="modal-buttons">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creating || isUploadingFiles || !leadSource}
                >
                  {creating ? "Creando..." : "Crear lead"}
                </button>
              </div>
            </form>
          </fieldset>
        </div>
        {creating ? (
          <div
            className="modal-dialog-blocking-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="modal-dialog-blocking-card">
              <span
                className="interaction-progress-spinner"
                aria-hidden="true"
              />
              <strong>Creando lead</strong>
              <span>Estamos guardando la evidencia del lead.</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InteractionInfoModal({ message, onClose }) {
  if (!message) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog interaction-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Información de lead"
      >
        <div className="modal-header">
          <h3 className="modal-title">Información</h3>
        </div>
        <div className="account-form-section account-modal-section">
          <p>{message}</p>
        </div>
        <div className="modal-buttons">
          <button type="button" className="btn-primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

function getResolveDuplicateReviewTitle(review) {
  const code = String(review?.code || "");
  if (code.startsWith("ACCOUNT_")) return "Cuenta similar detectada";
  if (code.startsWith("CONTACT_")) return "Contacto similar detectado";
  if (code.startsWith("OPPORTUNITY_")) return "Oportunidad similar detectada";
  return "Coincidencias detectadas";
}

function getResolveDuplicateReviewSourceLabel(source) {
  if (source === "ai") return "Con apoyo de IA";
  return "Con reglas internas";
}

function getResolveDuplicateCandidateKey(warning, index) {
  return String(
    warning.accountId ||
      warning.contactId ||
      warning.opportunityId ||
      warning.email ||
      warning.opportunityName ||
      warning.accountName ||
      `${index}`,
  );
}

function getResolveDuplicateCandidateTitle(warning) {
  return (
    warning.accountName ||
    warning.opportunityName ||
    warning.contactName ||
    warning.email ||
    "Registro coincidente"
  );
}

function getResolveDuplicateCandidateMeta(warning) {
  const parts = [];
  if (warning.reasonLabel) {
    parts.push(warning.reasonLabel);
  }
  if (warning.severityMessage) {
    parts.push(warning.severityMessage);
  }
  if (warning.contactName && warning.opportunityName) {
    parts.push(`Contacto relacionado: ${warning.contactName}`);
  }
  if (warning.accountName && warning.email) {
    parts.push(`Email: ${warning.email}`);
  }
  if (
    Number.isFinite(Number(warning.similarityScore)) &&
    Number(warning.similarityScore) > 0
  ) {
    parts.push(
      `Similitud estimada: ${Math.round(Number(warning.similarityScore) * 100)}%`,
    );
  }
  return parts;
}

function InteractionResolveDuplicateReview({ review, onDismiss }) {
  if (!review) return null;

  const warnings = Array.isArray(review.duplicateWarnings)
    ? review.duplicateWarnings
    : [];
  const aiSummary = String(review.duplicateReview?.summary || "").trim();
  const aiRecommendation = String(
    review.duplicateReview?.recommendation || "",
  ).trim();

  return (
    <section className="interaction-duplicate-review" aria-live="polite">
      <div className="interaction-duplicate-review-header">
        <div>
          <span className="interaction-duplicate-review-eyebrow">
            Revisa antes de guardar
          </span>
          <h4>{getResolveDuplicateReviewTitle(review)}</h4>
          <p>{review.message}</p>
        </div>
        <button
          type="button"
          className="btn-secondary interaction-duplicate-review-dismiss"
          onClick={onDismiss}
        >
          Ocultar detalle
        </button>
      </div>

      <div className="interaction-duplicate-review-tags">
        <span className="interaction-duplicate-review-tag">
          {warnings.length}{" "}
          {warnings.length === 1 ? "coincidencia" : "coincidencias"}
        </span>
        <span className="interaction-duplicate-review-tag">
          {getResolveDuplicateReviewSourceLabel(
            review.duplicateValidationSource,
          )}
        </span>
      </div>

      {review.duplicateReview ? (
        <article className="interaction-duplicate-review-ai-card">
          <strong>Resumen adicional</strong>
          {aiSummary ? <p>{aiSummary}</p> : null}
          {aiRecommendation && aiRecommendation !== aiSummary ? (
            <p className="field-hint">{aiRecommendation}</p>
          ) : null}
        </article>
      ) : null}

      <div className="interaction-duplicate-review-list">
        {warnings.map((warning, index) => {
          const meta = getResolveDuplicateCandidateMeta(warning);
          return (
            <article
              key={getResolveDuplicateCandidateKey(warning, index)}
              className="interaction-duplicate-review-card"
            >
              <strong>{getResolveDuplicateCandidateTitle(warning)}</strong>
              {meta.map((item) => (
                <p key={item} className="field-hint">
                  {item}
                </p>
              ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function InteractionDetailModal({
  isOpen,
  onClose,
  currentUser,
  detail,
  editForm,
  setEditForm,
  resolutionForm,
  setResolutionForm,
  options,
  resolveDuplicateReview,
  onDismissResolveDuplicateReview,
  resolving,
  reanalyzing,
  canAnalyze,
  canResolve,
  addingDocuments,
  canAddDocuments,
  deletingDocumentPublicId,
  downloadingDocumentPublicId,
  canDeleteDocuments,
  onDownloadDocument,
  onAddDocuments,
  onDeleteDocument,
  onResolve,
  onReanalyze,
  leadOutcomeCatalogs,
  onOpenLeadCallOutcomeModal,
  canManageLeadCallOutcome,
  onOpenLeadEmailModal,
  canOpenLeadEmailModal,
  leadEmailDisabledHint,
}) {
  const [uploadInputKey, setUploadInputKey] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUploadInputKey((currentValue) => currentValue + 1);
  }, [detail?.id, isOpen]);

  if (!isOpen || !detail || !editForm || !resolutionForm) return null;

  const isAnalysisLocked = reanalyzing || addingDocuments || resolving;
  const analysisProgressTitle = resolving
    ? "Guardando lead"
    : reanalyzing
      ? "Reanalizando lead"
      : "Subiendo archivos";
  const analysisProgressMessage = resolving
    ? "Estamos validando duplicados y guardando los cambios del lead."
    : reanalyzing
      ? "Estamos actualizando la sinopsis, sugerencias y relaciones detectadas."
      : "Estamos cargando los archivos nuevos al lead.";

  const statusMeta = getInteractionStatusMeta(detail.analysisStatus);
  const activeAccounts = (options.accounts || []).filter(
    (account) =>
      String(account?.activation_status_code || "").trim() === "activada",
  );
  const resolvedAccountId =
    resolutionForm.accountResolution.mode === "link_existing"
      ? Number(resolutionForm.accountResolution.accountId || 0) || null
      : null;
  const availableContacts = resolvedAccountId
    ? options.contacts.filter(
        (contact) =>
          Number(contact.account_id) === resolvedAccountId &&
          String(contact?.activation_status_code || "").trim() === "activado",
      )
    : [];
  const availableOpportunities = resolvedAccountId
    ? options.opportunities.filter(
        (opportunity) => Number(opportunity.account_id) === resolvedAccountId,
      )
    : [];
  const hasPersistedLinkedOpportunity = Boolean(
    detail?.primaryOpportunityId ||
    (editForm?.suggestedOpportunities || []).some(
      (opportunity) => opportunity?.selectedOpportunityId,
    ),
  );
  const hasPersistedSellerAssignment = Boolean(detail?.sellerUserId);
  const commercialAssignmentPolicy = detail?.commercialAssignmentPolicy || {
    mode: "none",
    locked: true,
    allowedSellerUserId: null,
    reason: null,
    currentUserIsSellerEligible: false,
  };
  const canEditCommercialAssignment = commercialAssignmentPolicy.mode === "any";
  const availableSellerUsers = canEditCommercialAssignment
    ? options.sellerUsers || []
    : resolvedAccountId
      ? options.sellerUsersByAccountId?.[String(resolvedAccountId)] || []
      : [];
  const legacySellerOption = buildLegacySellerOption(detail);
  const canUseLegacySellerOption = !resolvedAccountId;
  const sellerOptionList =
    canUseLegacySellerOption &&
    legacySellerOption &&
    !availableSellerUsers.some(
      (user) => Number(user.id) === Number(legacySellerOption.id),
    )
      ? [legacySellerOption, ...availableSellerUsers]
      : availableSellerUsers;
  const commercialSellerUserId = resolutionForm.assignCurrentUserAsOwnerSeller
    ? currentUser?.id
      ? String(currentUser.id)
      : ""
    : resolutionForm.sellerUserId || "";
  const commercialSellerLabel = commercialSellerUserId
    ? Number(commercialSellerUserId) === Number(currentUser?.id)
      ? currentUser?.full_name || currentUser?.email || "Usuario actual"
      : getOptionLabel(sellerOptionList, commercialSellerUserId, [
          "full_name",
          "name",
        ])
    : "";
  const isCommercialAssignmentSelfOnly =
    commercialAssignmentPolicy.mode === "self_only";
  const showLeadFollowUpSection = true;
  const currentUserIsSellerEligible = Boolean(
    commercialAssignmentPolicy.currentUserIsSellerEligible,
  );
  const showDependentResolutionSections =
    resolutionForm.accountResolution.mode !== "ignore";
  const hasResolvedSuggestedContact = resolutionForm.contactResolutions.some(
    (resolution) => resolution.mode !== "ignore",
  );
  const contactSuggestionCards = (editForm.suggestedContacts || []).length
    ? editForm.suggestedContacts
    : [
        {
          suggestionId:
            resolutionForm.contactResolutions[0]?.suggestionId ||
            "manual_contact_1",
          fullName: "Contacto manual",
          firstName: "",
          lastName: "",
          reason:
            "No se detectaron contactos en el analisis. Puedes crear uno nuevo o vincular uno existente.",
          selectedContactId: null,
          resolutionMode: null,
        },
      ];
  const opportunitySuggestionCards = (editForm.suggestedOpportunities || [])
    .length
    ? editForm.suggestedOpportunities
    : [
        {
          suggestionId:
            resolutionForm.opportunityResolutions[0]?.suggestionId ||
            "manual_opportunity_1",
          name: "Oportunidad manual",
          summary: "",
          reason:
            "No se detectaron oportunidades en el analisis. Puedes crear una nueva o vincular una existente.",
          selectedOpportunityId: null,
          resolutionMode: null,
        },
      ];
  const hasMinimumCommercialLinks = Boolean(
    resolutionForm.accountResolution.mode !== "ignore" &&
    hasResolvedSuggestedContact,
  );
  const canSelfAssignCurrentUserAsOwnerSeller = Boolean(
    canEditCommercialAssignment &&
    hasResolvedSuggestedContact &&
    currentUserIsSellerEligible &&
    ((resolutionForm.accountResolution.mode === "link_existing" &&
      resolvedAccountId &&
      availableSellerUsers.length === 0) ||
      resolutionForm.accountResolution.mode === "create_new"),
  );
  const canSelectOpportunityResolution = Boolean(
    hasMinimumCommercialLinks && commercialSellerUserId,
  );

  const handleAdditionalFileChange = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedFiles.length || !onAddDocuments) return;

    const added = await onAddDocuments(selectedFiles);
    if (added) {
      setUploadInputKey((currentValue) => currentValue + 1);
    }
  };

  const interactionDocumentCount = Array.isArray(detail?.documents)
    ? detail.documents.length
    : 0;
  const leadSubstatus = getLeadCatalogEntryByCode(
    leadOutcomeCatalogs?.substatuses,
    detail?.leadSubstatusCode,
  );
  const leadReason = getLeadCatalogEntryByCode(
    leadOutcomeCatalogs?.reasons,
    detail?.leadReasonCode,
  );
  const leadRequiredAction = getLeadCatalogEntryByCode(
    leadOutcomeCatalogs?.requiredActions,
    detail?.leadRequiredActionCode,
  );
  const leadSubstatusGuide = getLeadCallOutcomeSubstatusGuide(
    detail?.leadSubstatusCode,
  );
  const leadReasonGuide = getLeadCallOutcomeReasonGuide(detail?.leadReasonCode);
  const leadRequiredActionGuide = getLeadCallOutcomeActionGuide(
    detail?.leadRequiredActionCode,
  );
  const leadOutcomeTransitionRules = Array.isArray(
    leadOutcomeCatalogs?.transitionRules,
  )
    ? leadOutcomeCatalogs.transitionRules
    : EMPTY_LEAD_CATALOG;
  const leadOutcomeGuideSubstatusOptions = leadOutcomeTransitionRules.length
    ? leadOutcomeTransitionRules
        .map((rule) =>
          getLeadCatalogEntryByCode(
            leadOutcomeCatalogs?.substatuses,
            rule.substatusCode,
          ),
        )
        .filter(Boolean)
        .filter(
          (entry, index, entries) =>
            entries.findIndex((candidate) => candidate.code === entry.code) ===
            index,
        )
    : leadSubstatus
      ? [leadSubstatus]
      : EMPTY_LEAD_CATALOG;
  const leadOutcomeGuideReasonOptions = leadReason
    ? [leadReason]
    : EMPTY_LEAD_CATALOG;
  const leadOutcomeGuideActionOptions = leadRequiredAction
    ? [leadRequiredAction]
    : EMPTY_LEAD_CATALOG;
  const leadOutcomeHistory = Array.isArray(detail?.leadOutcomeHistory)
    ? detail.leadOutcomeHistory
    : EMPTY_LEAD_HISTORY;
  const materializedSuggestedAccountId = Number(
    editForm.suggestedAccount?.selectedAccountId || 0,
  );
  const hasMaterializedSuggestedAccount = materializedSuggestedAccountId > 0;
  const displayedAccountResolutionMode = hasMaterializedSuggestedAccount
    ? "link_existing"
    : resolutionForm.accountResolution.mode;

  return (
    <div className="modal-overlay">
      <div
        className={`modal-dialog modal-dialog-wide interaction-modal interaction-detail-modal modal-dialog-with-scroll-shell${isAnalysisLocked ? " modal-dialog-busy" : ""}`}
        aria-busy={isAnalysisLocked}
      >
        <div className="modal-dialog-scroll-shell">
          <div className="modal-header interaction-modal-header-with-close">
            <button
              type="button"
              className="btn-secondary account-modal-close-button interaction-modal-close-left"
              onClick={onClose}
              disabled={isAnalysisLocked}
              aria-label="Cerrar modal de editar lead"
              title="Cerrar"
            >
              ×
            </button>
            <div className="interaction-detail-header-copy">
              <div className="account-modal-title-row">
                <h3 className="modal-title">Editar lead</h3>
                <ModalInlineHelp helpKey="lead.edit" />
              </div>
              <p className="roles-subtitle">
                Creada {formatDate(detail.createdAt)}
              </p>
            </div>
            <div className="interaction-detail-header-actions">
              <span className={statusMeta.className}>{statusMeta.label}</span>
            </div>
          </div>
          <fieldset
            className="interaction-detail-lock-shell"
            disabled={isAnalysisLocked}
          >
            <div className="interaction-detail-scroll">
              <section className="account-form-section account-modal-section">
                <InteractionResolveDuplicateReview
                  review={resolveDuplicateReview}
                  onDismiss={onDismissResolveDuplicateReview}
                />

                {canAddDocuments ? (
                  <div className="interaction-documents-toolbar">
                    <div className="field-group interaction-documents-upload-field">
                      <div className="interaction-documents-toolbar-head">
                        <div>
                          <label>Agregar más archivos</label>
                          <p className="field-hint interaction-documents-step-hint">
                            Selecciona los archivos para subirlos de inmediato
                            al lead.
                          </p>
                        </div>
                        <span className="interaction-documents-count-badge">
                          {interactionDocumentCount} archivo
                          {interactionDocumentCount === 1 ? "" : "s"} en el lead
                        </span>
                      </div>
                      <div className="interaction-documents-toolbar-row">
                        <input
                          key={`${detail.id}-${uploadInputKey}`}
                          type="file"
                          multiple
                          accept={INTERACTION_FILE_ACCEPT}
                          onChange={handleAdditionalFileChange}
                          disabled={addingDocuments}
                        />
                      </div>
                      <div className="interaction-documents-upload-meta">
                        <p className="field-hint interaction-documents-auto-note">
                          Luego usa "Analizar documentos para llenar
                          información" para actualizar sugerencias.
                        </p>
                        {addingDocuments ? (
                          <span className="interaction-documents-pending-note">
                            Subiendo archivos...
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="interaction-documents-grid">
                  {(detail.documents || []).map((document) => (
                    <article
                      key={document.publicId}
                      className="interaction-document-card"
                    >
                      <div className="interaction-document-card-head">
                        <div>
                          <strong>{document.originalFileName}</strong>
                          <p className="field-hint">
                            {document.detectedFormat || document.mimeType} ·{" "}
                            {Math.round((document.byteSize || 0) / 1024)} KB
                          </p>
                          <p className="field-hint">
                            {getDocumentProcessingSummary(document)}
                          </p>
                        </div>
                        {canDeleteDocuments ? (
                          <div className="interaction-document-actions">
                            {onDownloadDocument ? (
                              <button
                                type="button"
                                className="interaction-detail-icon-btn interaction-document-download-btn"
                                onClick={() => onDownloadDocument(document)}
                                disabled={
                                  downloadingDocumentPublicId ===
                                  document.publicId
                                }
                                aria-label={
                                  downloadingDocumentPublicId ===
                                  document.publicId
                                    ? "Descargando archivo"
                                    : "Descargar archivo"
                                }
                                title={
                                  downloadingDocumentPublicId ===
                                  document.publicId
                                    ? "Descargando..."
                                    : "Descargar archivo"
                                }
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  focusable="false"
                                  aria-hidden="true"
                                >
                                  <path d="M12 4v10" />
                                  <path d="M8.5 10.5 12 14l3.5-3.5" />
                                  <path d="M5 19h14" />
                                </svg>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="interaction-detail-icon-btn interaction-document-delete-btn"
                              onClick={() =>
                                onDeleteDocument(document.publicId)
                              }
                              disabled={
                                deletingDocumentPublicId === document.publicId
                              }
                              aria-label={
                                deletingDocumentPublicId === document.publicId
                                  ? "Eliminando archivo"
                                  : "Eliminar archivo"
                              }
                              title={
                                deletingDocumentPublicId === document.publicId
                                  ? "Eliminando..."
                                  : "Eliminar archivo"
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                focusable="false"
                                aria-hidden="true"
                              >
                                <path d="M5 7h14" />
                                <path d="M9 7V5h6v2" />
                                <path d="M8 7l1 12h6l1-12" />
                                <path d="M10 11v5" />
                                <path d="M14 11v5" />
                              </svg>
                            </button>
                          </div>
                        ) : onDownloadDocument ? (
                          <button
                            type="button"
                            className="interaction-detail-icon-btn interaction-document-download-btn"
                            onClick={() => onDownloadDocument(document)}
                            disabled={
                              downloadingDocumentPublicId === document.publicId
                            }
                            aria-label={
                              downloadingDocumentPublicId === document.publicId
                                ? "Descargando archivo"
                                : "Descargar archivo"
                            }
                            title={
                              downloadingDocumentPublicId === document.publicId
                                ? "Descargando..."
                                : "Descargar archivo"
                            }
                          >
                            <svg
                              viewBox="0 0 24 24"
                              focusable="false"
                              aria-hidden="true"
                            >
                              <path d="M12 4v10" />
                              <path d="M8.5 10.5 12 14l3.5-3.5" />
                              <path d="M5 19h14" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="account-form-section account-modal-section interaction-detail-section interaction-synopsis-section">
                <div className="interaction-resolution-header">
                  <div>
                    <h4>Sinopsis</h4>
                  </div>
                  {canAnalyze ? (
                    <button
                      type="button"
                      className="interaction-synopsis-analyze-btn"
                      onClick={onReanalyze}
                      disabled={isAnalysisLocked}
                      aria-label={
                        reanalyzing
                          ? "Analizando documentos para llenar información"
                          : "Analizar documentos para llenar información"
                      }
                      title={
                        reanalyzing
                          ? "Analizando documentos..."
                          : "Analizar documentos para llenar información"
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M12 4.5l1.64 3.86L17.5 10l-3.86 1.64L12 15.5l-1.64-3.86L6.5 10l3.86-1.64L12 4.5Z" />
                        <path d="M18.5 5.5l.62 1.38 1.38.62-1.38.62-.62 1.38-.62-1.38-1.38-.62 1.38-.62.62-1.38Z" />
                        <circle cx="6.2" cy="6.2" r="1" />
                        <circle cx="17.7" cy="17.7" r="1" />
                      </svg>
                      <span>
                        {reanalyzing
                          ? "Analizando documentos..."
                          : "Analizar documentos para llenar información"}
                      </span>
                    </button>
                  ) : null}
                </div>
                <div className="field-group">
                  <label>Título</label>
                  <input
                    value={editForm.title}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        title: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Fuente del lead</label>
                  <select
                    value={editForm.leadSource}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        leadSource: event.target.value,
                      }))
                    }
                  >
                    {LEAD_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>Notas iniciales</label>
                  <textarea
                    value={editForm.sourceNotes}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        sourceNotes: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Resumen</label>
                  <textarea
                    value={editForm.summary}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        summary: event.target.value,
                      }))
                    }
                  />
                </div>
                <TagEditor
                  label="Temas detectados"
                  values={editForm.topics}
                  onChange={(values) =>
                    setEditForm((currentValue) => ({
                      ...currentValue,
                      topics: values,
                    }))
                  }
                  placeholder="Un tema por línea"
                />
                <TagEditor
                  label="Acciones realizadas"
                  values={editForm.actionsTaken}
                  onChange={(values) =>
                    setEditForm((currentValue) => ({
                      ...currentValue,
                      actionsTaken: values,
                    }))
                  }
                  placeholder="Una acción por línea"
                />
                <TagEditor
                  label="Próximos pasos"
                  values={editForm.nextSteps}
                  onChange={(values) =>
                    setEditForm((currentValue) => ({
                      ...currentValue,
                      nextSteps: values,
                    }))
                  }
                  placeholder="Un siguiente paso por línea"
                />
              </section>

              <section className="account-form-section account-modal-section interaction-detail-section interaction-account-suggestion-section">
                <div className="interaction-resolution-header">
                  <div>
                    <h4>Cuenta sugerida</h4>
                    <p className="field-hint">
                      Define si el lead se vincula a una cuenta existente o crea
                      una nueva.
                    </p>
                  </div>
                </div>
                <div className="interaction-resolution-grid interaction-account-suggestion-grid">
                  <div className="field-group interaction-resolution-action-field">
                    <label>Acción</label>
                    {hasMaterializedSuggestedAccount ? (
                      <div className="interaction-readonly-field interaction-readonly-field-compact">
                        <span className="interaction-readonly-pill">
                          Vincular existente
                        </span>
                      </div>
                    ) : (
                      <select
                        value={displayedAccountResolutionMode}
                        onChange={(event) =>
                          setResolutionForm((currentValue) => ({
                            ...currentValue,
                            accountResolution: {
                              ...currentValue.accountResolution,
                              mode: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="link_existing">
                          Vincular existente
                        </option>
                        <option value="ignore">Ignorar</option>
                        <option value="create_new">Crear cuenta</option>
                      </select>
                    )}
                  </div>
                  {displayedAccountResolutionMode === "link_existing" ? (
                    <div className="field-group interaction-grid-span-2 interaction-account-existing-field">
                      <label>Cuenta existente</label>
                      {hasMaterializedSuggestedAccount ? (
                        <div className="interaction-readonly-field interaction-readonly-link-field">
                          <span className="interaction-readonly-value-title">
                            {getOptionLabel(
                              activeAccounts,
                              resolutionForm.accountResolution.accountId ||
                                String(materializedSuggestedAccountId || ""),
                              ["name"],
                            ) || "Cuenta vinculada"}
                          </span>
                          <span className="interaction-readonly-value-subtitle">
                            Vinculo materializado desde este lead
                          </span>
                        </div>
                      ) : (
                        <select
                          value={resolutionForm.accountResolution.accountId}
                          onChange={(event) =>
                            setResolutionForm((currentValue) => ({
                              ...currentValue,
                              accountResolution: {
                                ...currentValue.accountResolution,
                                accountId: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="">Selecciona cuenta</option>
                          {activeAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : null}
                  {hasMaterializedSuggestedAccount ? (
                    <div className="field-group interaction-materialized-hint-field">
                      <span className="field-hint">
                        Esta sugerencia ya genero una cuenta y no puede
                        modificarse desde este lead.
                      </span>
                    </div>
                  ) : null}
                  {displayedAccountResolutionMode !== "link_existing" ? (
                    <div className="field-group interaction-account-name-field">
                      <label>Nombre</label>
                      <input
                        value={resolutionForm.accountResolution.draft.name}
                        onChange={(event) =>
                          setResolutionForm((currentValue) => ({
                            ...currentValue,
                            accountResolution: {
                              ...currentValue.accountResolution,
                              draft: {
                                ...currentValue.accountResolution.draft,
                                name: event.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </div>
                  ) : null}
                  {displayedAccountResolutionMode !== "link_existing" ? (
                    <>
                      <div className="field-group">
                        <label>Website</label>
                        <input
                          value={resolutionForm.accountResolution.draft.website}
                          onChange={(event) =>
                            setResolutionForm((currentValue) => ({
                              ...currentValue,
                              accountResolution: {
                                ...currentValue.accountResolution,
                                draft: {
                                  ...currentValue.accountResolution.draft,
                                  website: event.target.value,
                                },
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="field-group">
                        <label>Teléfono</label>
                        <input
                          value={resolutionForm.accountResolution.draft.phone}
                          onChange={(event) =>
                            setResolutionForm((currentValue) => ({
                              ...currentValue,
                              accountResolution: {
                                ...currentValue.accountResolution,
                                draft: {
                                  ...currentValue.accountResolution.draft,
                                  phone: event.target.value,
                                },
                              },
                            }))
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </section>

              {showDependentResolutionSections ? (
                <>
                  <section className="account-form-section account-modal-section interaction-detail-section interaction-contact-suggestion-section interaction-commercial-assignment-section">
                    <h4>Contactos sugeridos</h4>
                    {contactSuggestionCards.map((contact, index) => {
                      const resolution =
                        resolutionForm.contactResolutions[index];
                      if (!resolution) return null;
                      const isMaterializedContactSuggestion = Boolean(
                        contact.selectedContactId &&
                        String(contact?.resolutionMode || "").trim() ===
                          "link_existing",
                      );
                      const hasExistingContactOptions =
                        Boolean(resolvedAccountId) &&
                        availableContacts.length > 0;
                      const displayedContactMode =
                        isMaterializedContactSuggestion
                          ? "link_existing"
                          : resolution.mode === "link_existing" &&
                              !hasExistingContactOptions
                            ? "ignore"
                            : resolution.mode;
                      return (
                        <article
                          key={contact.suggestionId}
                          className="interaction-resolution-card"
                        >
                          <div className="interaction-resolution-card-head">
                            <strong>
                              {contact.fullName ||
                                `${contact.firstName} ${contact.lastName}`.trim() ||
                                "Contacto"}
                            </strong>
                            <span className="field-hint">
                              {contact.reason || "Sugerido por análisis"}
                            </span>
                          </div>
                          <div className="interaction-resolution-grid interaction-contact-suggestion-grid">
                            <div className="field-group interaction-resolution-action-field">
                              <label>Acción</label>
                              {isMaterializedContactSuggestion ? (
                                <div className="interaction-readonly-field interaction-readonly-field-compact">
                                  <span className="interaction-readonly-pill">
                                    Vincular existente
                                  </span>
                                </div>
                              ) : (
                                <select
                                  value={displayedContactMode}
                                  onChange={(event) =>
                                    setResolutionForm((prev) => ({
                                      ...prev,
                                      contactResolutions:
                                        prev.contactResolutions.map(
                                          (item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  mode: event.target.value,
                                                }
                                              : item,
                                        ),
                                    }))
                                  }
                                >
                                  <option
                                    value="link_existing"
                                    disabled={!hasExistingContactOptions}
                                  >
                                    Vincular existente
                                  </option>
                                  <option value="ignore">Ignorar</option>
                                  <option value="create_new">
                                    Crear contacto
                                  </option>
                                </select>
                              )}
                            </div>
                            {displayedContactMode === "link_existing" ? (
                              <div className="field-group interaction-grid-span-2 interaction-contact-existing-field">
                                <label>Contacto existente</label>
                                {isMaterializedContactSuggestion ? (
                                  <div className="interaction-readonly-field interaction-readonly-link-field">
                                    <span className="interaction-readonly-value-title">
                                      {getOptionLabel(
                                        availableContacts,
                                        resolution.contactId,
                                        ["full_name", "name"],
                                      ) || "Contacto vinculado"}
                                    </span>
                                    <span className="interaction-readonly-value-subtitle">
                                      Vinculo materializado desde este lead
                                    </span>
                                  </div>
                                ) : (
                                  <select
                                    value={resolution.contactId}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    contactId:
                                                      event.target.value,
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  >
                                    <option value="">
                                      Selecciona contacto
                                    </option>
                                    {availableContacts.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.full_name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            ) : null}
                            {isMaterializedContactSuggestion ? (
                              <div className="field-group interaction-materialized-hint-field">
                                <span className="field-hint">
                                  Esta sugerencia ya genero un contacto y no
                                  puede modificarse desde este lead.
                                </span>
                              </div>
                            ) : null}
                            {resolution.mode !== "link_existing" ? (
                              <>
                                <div className="field-group interaction-contact-name-field">
                                  <label>Nombre</label>
                                  <input
                                    value={resolution.draft.firstName}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      firstName:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Apellido</label>
                                  <input
                                    value={resolution.draft.lastName}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      lastName:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Email</label>
                                  <input
                                    value={resolution.draft.email}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      email: event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Cargo</label>
                                  <input
                                    value={resolution.draft.positionTitle}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      positionTitle:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Teléfono</label>
                                  <input
                                    value={resolution.draft.phone}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      phone: event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Extensión</label>
                                  <input
                                    value={resolution.draft.phoneExtension}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      phoneExtension:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Móvil</label>
                                  <input
                                    value={resolution.draft.mobile}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      mobile:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                              </>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </section>

                  <section className="account-form-section account-modal-section interaction-detail-section interaction-contact-suggestion-section">
                    <div className="interaction-resolution-header">
                      <div>
                        <h4>Asignación comercial</h4>
                        <p className="field-hint">
                          {canEditCommercialAssignment
                            ? "Puedes asignar cualquier vendedor activo."
                            : "El vendedor debe ser uno de los owners vendedores de la cuenta vinculada."}
                        </p>
                      </div>
                    </div>
                    <div className="interaction-resolution-grid interaction-contact-suggestion-grid interaction-commercial-assignment-grid">
                      <div className="field-group interaction-grid-span-2">
                        <label>Vendedor asignado</label>
                        {canEditCommercialAssignment ? (
                          <>
                            <select
                              value={resolutionForm.sellerUserId || ""}
                              onChange={(event) =>
                                setResolutionForm((prev) => ({
                                  ...prev,
                                  sellerUserId: event.target.value,
                                  assignCurrentUserAsOwnerSeller: false,
                                }))
                              }
                              disabled={!hasMinimumCommercialLinks}
                            >
                              {!hasPersistedLinkedOpportunity &&
                              !hasPersistedSellerAssignment ? (
                                <option value="">Sin asignar</option>
                              ) : null}
                              {sellerOptionList.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.full_name}
                                </option>
                              ))}
                            </select>
                            {!hasMinimumCommercialLinks ? (
                              <span className="field-hint">
                                Vincula cuenta y al menos un contacto para poder
                                asignar vendedor.
                              </span>
                            ) : hasPersistedLinkedOpportunity ? (
                              <span className="field-hint">
                                Este lead ya tiene una oportunidad vinculada,
                                por lo que no puede quedar sin vendedor
                                asignado.
                              </span>
                            ) : canSelfAssignCurrentUserAsOwnerSeller ? (
                              <>
                                <label className="interaction-primary-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(
                                      resolutionForm.assignCurrentUserAsOwnerSeller,
                                    )}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        assignCurrentUserAsOwnerSeller:
                                          event.target.checked,
                                        sellerUserId: event.target.checked
                                          ? String(currentUser.id)
                                          : "",
                                      }))
                                    }
                                  />
                                  <span className="interaction-primary-checkbox-text">
                                    {resolutionForm.accountResolution.mode ===
                                    "create_new"
                                      ? "Asignarme como owner vendedor de la nueva cuenta"
                                      : "Asignarme como owner vendedor de esta cuenta"}
                                  </span>
                                </label>
                                <span className="field-hint">
                                  {resolutionForm.accountResolution.mode ===
                                  "create_new"
                                    ? "Al guardar, se te asignará explícitamente como owner vendedor para poder continuar con la oportunidad."
                                    : "La cuenta no tiene owners vendedores. Si continúas, se te agregará explícitamente como owner vendedor para poder vincular la oportunidad."}
                                </span>
                              </>
                            ) : !availableSellerUsers.length ? (
                              <span className="field-hint">
                                La cuenta no tiene owners con rol de vendedor.
                              </span>
                            ) : null}
                          </>
                        ) : isCommercialAssignmentSelfOnly ? (
                          <>
                            <div className="interaction-readonly-value">
                              {detail?.seller?.fullName ||
                                detail?.seller?.email ||
                                currentUser?.full_name ||
                                currentUser?.email ||
                                "Usuario actual"}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="interaction-readonly-value">
                              {detail?.seller?.fullName ||
                                detail?.seller?.email ||
                                "Sin asignar"}
                            </div>
                            <span className="field-hint">
                              No tienes permiso para modificar la asignacion
                              comercial del lead.
                            </span>
                          </>
                        )}
                      </div>
                      {hasMinimumCommercialLinks &&
                      hasPersistedSellerAssignment ? (
                        <div className="field-group interaction-materialized-hint-field">
                          <span className="field-hint">
                            Este lead ya tiene vendedor asignado y no puede
                            quedar sin vendedor desde este modal.
                          </span>
                        </div>
                      ) : null}
                      {isCommercialAssignmentSelfOnly ? (
                        <div className="field-group interaction-materialized-hint-field">
                          <span className="field-hint">
                            {detail?.sellerUserId
                              ? "Este lead solo admite tu propia asignacion comercial y ya no puede modificarse."
                              : hasMinimumCommercialLinks
                                ? "Al guardar, este lead se asignara automaticamente a ti."
                                : "Vincula cuenta y al menos un contacto para que el lead se asigne automaticamente a ti al guardar."}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {hasResolvedSuggestedContact ? (
                    <section className="account-form-section account-modal-section interaction-detail-section interaction-opportunity-suggestion-section">
                      <h4>Oportunidades sugeridas</h4>
                      <p className="field-hint">
                        Si la oportunidad ya existe en la cuenta, usa "Vincular
                        existente" para mantener la trazabilidad del lead hacia
                        la oportunidad ya creada.
                      </p>
                      {availableOpportunities.length ? (
                        <p className="field-hint">
                          La cuenta vinculada tiene{" "}
                          {availableOpportunities.length} oportunidad
                          {availableOpportunities.length === 1 ? "" : "es"}{" "}
                          disponibles para vincular.
                        </p>
                      ) : null}
                      {opportunitySuggestionCards.map((opportunity, index) => {
                        const resolution =
                          resolutionForm.opportunityResolutions[index];
                        if (!resolution) return null;
                        const isMaterializedOpportunitySuggestion = Boolean(
                          opportunity.selectedOpportunityId,
                        );
                        const hasExistingOpportunityOptions =
                          availableOpportunities.length > 0;
                        const displayedOpportunityMode =
                          isMaterializedOpportunitySuggestion
                            ? "link_existing"
                            : canSelectOpportunityResolution
                              ? resolution.mode
                              : "ignore";
                        return (
                          <article
                            key={opportunity.suggestionId}
                            className="interaction-resolution-card"
                          >
                            <div className="interaction-resolution-card-head interaction-resolution-card-head-split">
                              <div>
                                <strong>
                                  {opportunity.name ||
                                    `Oportunidad ${index + 1}`}
                                </strong>
                                <p className="field-hint">
                                  {opportunity.reason ||
                                    "Sugerida por análisis"}
                                </p>
                              </div>
                            </div>
                            <div className="interaction-resolution-grid interaction-opportunity-suggestion-grid">
                              <div className="field-group interaction-resolution-action-field">
                                <label>Acción</label>
                                {isMaterializedOpportunitySuggestion ? (
                                  <div className="interaction-readonly-field interaction-readonly-field-compact">
                                    <span className="interaction-readonly-pill">
                                      Vincular existente
                                    </span>
                                  </div>
                                ) : (
                                  <select
                                    value={displayedOpportunityMode}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        opportunityResolutions:
                                          prev.opportunityResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    mode: event.target.value,
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                    disabled={!canSelectOpportunityResolution}
                                  >
                                    <option
                                      value="link_existing"
                                      disabled={!hasExistingOpportunityOptions}
                                    >
                                      Vincular existente (recomendado)
                                    </option>
                                    <option value="ignore">Ignorar</option>
                                    <option value="create_new">
                                      Crear oportunidad
                                    </option>
                                  </select>
                                )}
                                {!canSelectOpportunityResolution ? (
                                  <span className="field-hint">
                                    El vendedor de la oportunidad se define en
                                    Asignación comercial.
                                  </span>
                                ) : null}
                              </div>
                              {displayedOpportunityMode === "link_existing" ? (
                                <div className="field-group interaction-grid-span-3 interaction-opportunity-existing-field">
                                  <label>Oportunidad existente</label>
                                  {isMaterializedOpportunitySuggestion ? (
                                    <div className="interaction-readonly-field interaction-readonly-link-field">
                                      <span className="interaction-readonly-value-title">
                                        {getOptionLabel(
                                          availableOpportunities,
                                          resolution.opportunityId,
                                          ["name"],
                                        ) || "Oportunidad vinculada"}
                                      </span>
                                      <span className="interaction-readonly-value-subtitle">
                                        Vinculo materializado desde este lead
                                      </span>
                                    </div>
                                  ) : (
                                    <select
                                      value={resolution.opportunityId}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      opportunityId:
                                                        event.target.value,
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    >
                                      <option value="">
                                        Selecciona oportunidad
                                      </option>
                                      {availableOpportunities.map((option) => (
                                        <option
                                          key={option.id}
                                          value={option.id}
                                        >
                                          {option.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              ) : null}
                              {isMaterializedOpportunitySuggestion ? (
                                <div className="field-group interaction-materialized-hint-field">
                                  <span className="field-hint">
                                    Esta sugerencia ya genero una oportunidad y
                                    no puede modificarse desde este lead.
                                  </span>
                                </div>
                              ) : null}
                              {displayedOpportunityMode === "create_new" ? (
                                <>
                                  <div className="field-group interaction-grid-span-3 interaction-opportunity-name-field">
                                    <label>Nombre</label>
                                    <input
                                      value={resolution.draft.name}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        name: event.target
                                                          .value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Monto USD</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={resolution.draft.amountUsd}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        amountUsd:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Fecha estimada de cierre</label>
                                    <input
                                      type="date"
                                      value={resolution.draft.closeDate}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        closeDate:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Línea de negocio</label>
                                    <select
                                      value={resolution.draft.businessLineId}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        businessLineId:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    >
                                      <option value="">Selecciona línea</option>
                                      {options.businessLines.map((line) => (
                                        <option key={line.id} value={line.id}>
                                          {line.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="field-group">
                                    <label>Vendedor</label>
                                    <input
                                      value={commercialSellerLabel}
                                      disabled
                                      placeholder="El vendedor de la oportunidad se define en Asignación comercial"
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Preventa</label>
                                    <select
                                      value={resolution.draft.presalesUserId}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        presalesUserId:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    >
                                      <option value="">Sin preventa</option>
                                      {options.presalesUsers.map((user) => (
                                        <option key={user.id} value={user.id}>
                                          {user.full_name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  ) : null}
                </>
              ) : null}

              <LeadExecutionSection
                detail={detail}
                canOpenLeadEmailModal={canOpenLeadEmailModal}
                leadEmailDisabledHint={leadEmailDisabledHint}
                onOpenLeadEmailModal={onOpenLeadEmailModal}
                onOpenLeadCallOutcomeModal={onOpenLeadCallOutcomeModal}
                canManageLeadCallOutcome={canManageLeadCallOutcome}
              />

              {showLeadFollowUpSection ? (
                <section className="account-form-section account-modal-section interaction-detail-section lead-follow-up-section">
                  <div className="interaction-resolution-header lead-follow-up-header">
                    <div className="lead-follow-up-header-copy">
                      <span className="lead-follow-up-kicker">
                        Seguimiento comercial alternativo
                      </span>
                      <p className="field-hint lead-follow-up-header-description">
                        Usa este bloque si no ejecutaste la guía y necesitas
                        registrar o revisar el seguimiento comercial directo.
                      </p>
                    </div>
                    <div className="lead-follow-up-actions-row">
                      <button
                        type="button"
                        className="btn-secondary lead-follow-up-secondary-action"
                        onClick={() =>
                          onOpenLeadEmailModal({
                            purposeOther: "meeting_request",
                          })
                        }
                        disabled={!canOpenLeadEmailModal}
                        title="Enviar correo"
                        aria-label="Enviar correo"
                      >
                        Enviar correo
                      </button>
                      {canManageLeadCallOutcome ? (
                        <button
                          type="button"
                          className="btn-secondary lead-follow-up-secondary-action"
                          onClick={onOpenLeadCallOutcomeModal}
                        >
                          Registrar nueva situación
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {!canOpenLeadEmailModal && leadEmailDisabledHint ? (
                    <p className="field-hint lead-follow-up-header-description">
                      {leadEmailDisabledHint}
                    </p>
                  ) : null}
                  {leadSubstatus || leadReason || leadRequiredAction ? (
                    <div className="lead-follow-up-overview">
                      <div className="lead-follow-up-status-block">
                        <strong>Seguimiento comercial actualizado</strong>
                        <p className="field-hint">
                          Revisa la situación actual del lead y abre el detalle
                          si necesitas ajustarlo.
                        </p>
                      </div>
                      <div className="lead-follow-up-grid">
                        <article className="lead-follow-up-card is-substatus">
                          <span className="lead-follow-up-card-label">
                            Situación
                          </span>
                          <strong>{leadSubstatus?.name || "-"}</strong>
                          <p className="field-hint lead-follow-up-card-copy">
                            {leadSubstatusGuide?.optionHint ||
                              leadSubstatusGuide?.whenToUse ||
                              leadSubstatus?.description ||
                              "Sin detalle adicional"}
                          </p>
                        </article>

                        <article className="lead-follow-up-card is-reason">
                          <span className="lead-follow-up-card-label">
                            Motivo principal
                          </span>
                          <strong>{leadReason?.name || "-"}</strong>
                          <p className="field-hint lead-follow-up-card-copy">
                            {leadReasonGuide?.optionHint ||
                              leadReasonGuide?.whenToUse ||
                              "Sin detalle adicional"}
                          </p>
                        </article>

                        <article className="lead-follow-up-card is-action">
                          <span className="lead-follow-up-card-label">
                            Acción obligatoria
                          </span>
                          <strong>{leadRequiredAction?.name || "-"}</strong>
                          <p className="field-hint lead-follow-up-card-copy">
                            {leadRequiredActionGuide?.optionHint ||
                              leadRequiredActionGuide?.whenToUse ||
                              "Sin detalle adicional"}
                          </p>
                        </article>
                      </div>

                      {detail?.leadNextActionDueAt ||
                      detail?.leadReferredContactName ||
                      detail?.leadReferredAreaName ? (
                        <div className="lead-follow-up-meta-row">
                          {detail?.leadNextActionDueAt ? (
                            <span className="interaction-readonly-pill lead-follow-up-meta-pill">
                              Fecha compromiso:{" "}
                              {formatLeadOutcomeDateLabel(
                                detail.leadNextActionDueAt,
                              )}
                            </span>
                          ) : null}
                          {detail?.leadReferredContactName ? (
                            <span className="interaction-readonly-pill lead-follow-up-meta-pill">
                              Persona referida: {detail.leadReferredContactName}
                            </span>
                          ) : null}
                          {detail?.leadReferredAreaName ? (
                            <span className="interaction-readonly-pill lead-follow-up-meta-pill">
                              Área objetivo: {detail.leadReferredAreaName}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {detail?.leadCommercialComment ? (
                        <article className="lead-follow-up-comment-card">
                          <span className="lead-follow-up-card-label">
                            Comentario del vendedor
                          </span>
                          <p>{detail.leadCommercialComment}</p>
                        </article>
                      ) : null}

                      {leadOutcomeHistory.length ? (
                        <article className="lead-follow-up-comment-card">
                          <span className="lead-follow-up-card-label">
                            Historial de situaciones
                          </span>
                          <div className="lead-follow-up-history-list">
                            {leadOutcomeHistory.map((eventItem) => {
                              const eventSubstatus = getLeadCatalogEntryByCode(
                                leadOutcomeCatalogs?.substatuses,
                                eventItem.substatusCode,
                              );
                              const eventReason = getLeadCatalogEntryByCode(
                                leadOutcomeCatalogs?.reasons,
                                eventItem.reasonCode,
                              );
                              const eventAction = getLeadCatalogEntryByCode(
                                leadOutcomeCatalogs?.requiredActions,
                                eventItem.requiredActionCode,
                              );
                              const eventStatus = getInteractionStatusMeta(
                                eventItem.toStatusCode,
                              );

                              return (
                                <article
                                  className="lead-follow-up-history-item"
                                  key={eventItem.id}
                                >
                                  <div className="lead-follow-up-history-item-head">
                                    <strong>
                                      {eventSubstatus?.name ||
                                        "Situación registrada"}
                                    </strong>
                                    <span className="field-hint">
                                      {`${formatDateTime(eventItem.createdAt)} · ${getLeadOutcomeEventTypeLabel(eventItem.eventType)}`}
                                    </span>
                                  </div>
                                  <p className="field-hint lead-follow-up-history-item-copy">
                                    {`Motivo: ${eventReason?.name || "Sin motivo"} · Acción: ${eventAction?.name || "Sin acción"}`}
                                  </p>
                                  <p className="field-hint lead-follow-up-history-item-copy">
                                    {`Estado resultante: ${eventStatus.label}`}
                                  </p>
                                  {eventItem.comment ? (
                                    <p className="lead-follow-up-history-item-comment">
                                      {eventItem.comment}
                                    </p>
                                  ) : null}
                                  {eventItem.correctionReason ? (
                                    <p className="field-hint lead-follow-up-history-item-copy">
                                      {`Corrección: ${eventItem.correctionReason}`}
                                    </p>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                        </article>
                      ) : null}
                    </div>
                  ) : (
                    <div className="lead-follow-up-empty-state">
                      <strong>Seguimiento comercial pendiente</strong>
                      <p className="field-hint">
                        Aún no se ha definido la situación del lead, el motivo
                        ni la siguiente acción.
                      </p>
                    </div>
                  )}
                </section>
              ) : null}
            </div>

            <div className="modal-buttons interaction-detail-modal-buttons">
              {canResolve ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={onResolve}
                  disabled={resolving}
                >
                  {resolving ? "Guardando..." : "Guardar lead"}
                </button>
              ) : null}
            </div>
          </fieldset>
        </div>
        {isAnalysisLocked ? (
          <div
            className="modal-dialog-blocking-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="modal-dialog-blocking-card">
              <span
                className="interaction-progress-spinner"
                aria-hidden="true"
              />
              <strong>{analysisProgressTitle}</strong>
              <span>{analysisProgressMessage}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResolveInteractionConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  resolving,
  preview,
}) {
  if (!isOpen || !preview) return null;

  const hasRecordsToCreate = Boolean(
    preview.accountToCreate ||
    preview.contactsToCreate.length ||
    preview.opportunitiesToCreate.length,
  );
  const hasLinks = Boolean(
    preview.accountToLink ||
    preview.contactsToLink.length ||
    preview.opportunitiesToLink.length,
  );

  return (
    <div
      className="modal-overlay modal-overlay-elevated"
      onClick={(event) => {
        if (event.target === event.currentTarget && !resolving) onClose();
      }}
    >
      <div className="modal-dialog resolve-confirmation-modal lead-decision-modal">
        <div className="modal-header">
          <div>
            <span className="lead-decision-kicker">Resolución comercial</span>
            <h3 className="modal-title">Confirmar cambios del lead</h3>
            <p className="roles-subtitle resolve-confirmation-subtitle">
              Revisa lo que se aplicará al lead {preview.interactionTitle}.
            </p>
          </div>
        </div>

        <div className="resolve-confirmation-body lead-decision-body">
          {hasRecordsToCreate ? (
            <section className="resolve-confirmation-section lead-decision-panel">
              <h4>Se crearán</h4>
              <div className="resolve-confirmation-list">
                {preview.accountToCreate ? (
                  <article className="resolve-confirmation-item">
                    <strong>Cuenta: {preview.accountToCreate}</strong>
                  </article>
                ) : null}
                {preview.contactsToCreate.map((contact) => (
                  <article
                    key={`create-contact-${contact.title}-${contact.meta}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Contacto: {contact.title}</strong>
                    {contact.meta ? <span>{contact.meta}</span> : null}
                  </article>
                ))}
                {preview.opportunitiesToCreate.map((opportunity) => (
                  <article
                    key={`create-opportunity-${opportunity.title}-${opportunity.meta}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Oportunidad: {opportunity.title}</strong>
                    {opportunity.meta ? <span>{opportunity.meta}</span> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="resolve-confirmation-section lead-decision-panel">
              <h4>Se crearán</h4>
              <p className="field-hint resolve-confirmation-empty-state">
                No se crearán registros nuevos con la configuración actual.
              </p>
            </section>
          )}

          {hasLinks ? (
            <section className="resolve-confirmation-section lead-decision-panel">
              <h4>También se vincularán</h4>
              <div className="resolve-confirmation-list">
                {preview.accountToLink ? (
                  <article className="resolve-confirmation-item">
                    <strong>Cuenta existente: {preview.accountToLink}</strong>
                  </article>
                ) : null}
                {preview.contactsToLink.map((contactName) => (
                  <article
                    key={`link-contact-${contactName}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Contacto existente: {contactName}</strong>
                  </article>
                ))}
                {preview.opportunitiesToLink.map((opportunityName) => (
                  <article
                    key={`link-opportunity-${opportunityName}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Oportunidad existente: {opportunityName}</strong>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="resolve-confirmation-section lead-decision-panel lead-decision-panel-highlight">
            <h4>Estado resultante</h4>
            <div className="resolve-confirmation-list">
              <article className="resolve-confirmation-item">
                <strong>{preview.targetStatus}</strong>
                {preview.sellerToAssign ? (
                  <span>Vendedor: {preview.sellerToAssign}</span>
                ) : null}
              </article>
            </div>
          </section>

          {preview.ignoredContactsCount || preview.ignoredOpportunitiesCount ? (
            <section className="resolve-confirmation-section">
              <h4>Sugerencias ignoradas</h4>
              <p className="field-hint resolve-confirmation-empty-state">
                {preview.ignoredContactsCount
                  ? `${preview.ignoredContactsCount} contacto${preview.ignoredContactsCount === 1 ? "" : "s"}`
                  : ""}
                {preview.ignoredContactsCount &&
                preview.ignoredOpportunitiesCount
                  ? " · "
                  : ""}
                {preview.ignoredOpportunitiesCount
                  ? `${preview.ignoredOpportunitiesCount} oportunidad${preview.ignoredOpportunitiesCount === 1 ? "" : "es"}`
                  : ""}
              </p>
            </section>
          ) : null}
        </div>

        <div className="modal-buttons lead-decision-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={resolving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={resolving}
          >
            {resolving ? "Guardando..." : "Confirmar y guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadCallOutcomeModal({
  isOpen,
  detail,
  catalogs,
  onClose,
  onSubmit,
  saving,
}) {
  const transitionRules = Array.isArray(catalogs?.transitionRules)
    ? catalogs.transitionRules
    : EMPTY_LEAD_CATALOG;
  const substatuses = Array.isArray(catalogs?.substatuses)
    ? catalogs.substatuses
    : EMPTY_LEAD_CATALOG;
  const reasons = Array.isArray(catalogs?.reasons)
    ? catalogs.reasons
    : EMPTY_LEAD_CATALOG;
  const requiredActions = Array.isArray(catalogs?.requiredActions)
    ? catalogs.requiredActions
    : EMPTY_LEAD_CATALOG;
  const statuses = Array.isArray(catalogs?.statuses)
    ? catalogs.statuses
    : EMPTY_LEAD_CATALOG;
  const [form, setForm] = useState(() =>
    buildLeadCallOutcomeForm(detail, transitionRules),
  );

  const substatusOptions = useMemo(
    () =>
      transitionRules
        .map((rule) =>
          getLeadCatalogEntryByCode(substatuses, rule.substatusCode),
        )
        .filter(Boolean)
        .filter(
          (entry, index, entries) =>
            entries.findIndex((candidate) => candidate.code === entry.code) ===
            index,
        ),
    [substatuses, transitionRules],
  );

  const selectedSubstatusCode = substatusOptions.some(
    (entry) => entry.code === form.substatusCode,
  )
    ? form.substatusCode
    : substatusOptions[0]?.code || "";

  const reasonOptions = useMemo(() => {
    return transitionRules
      .filter((rule) => rule.substatusCode === selectedSubstatusCode)
      .map((rule) => getLeadCatalogEntryByCode(reasons, rule.reasonCode))
      .filter(Boolean)
      .filter(
        (entry, index, entries) =>
          entries.findIndex((candidate) => candidate.code === entry.code) ===
          index,
      );
  }, [reasons, selectedSubstatusCode, transitionRules]);

  const selectedReasonCode = reasonOptions.some(
    (entry) => entry.code === form.reasonCode,
  )
    ? form.reasonCode
    : reasonOptions[0]?.code || "";

  const requiredActionOptions = useMemo(() => {
    return transitionRules
      .filter(
        (rule) =>
          rule.substatusCode === selectedSubstatusCode &&
          rule.reasonCode === selectedReasonCode,
      )
      .map((rule) =>
        getLeadCatalogEntryByCode(requiredActions, rule.requiredActionCode),
      )
      .filter(Boolean)
      .filter(
        (entry, index, entries) =>
          entries.findIndex((candidate) => candidate.code === entry.code) ===
          index,
      );
  }, [
    requiredActions,
    selectedReasonCode,
    selectedSubstatusCode,
    transitionRules,
  ]);

  const selectedRequiredActionCode = requiredActionOptions.some(
    (entry) => entry.code === form.requiredActionCode,
  )
    ? form.requiredActionCode
    : requiredActionOptions[0]?.code || "";

  const selectedRule = useMemo(
    () =>
      transitionRules.find(
        (rule) =>
          rule.substatusCode === selectedSubstatusCode &&
          rule.reasonCode === selectedReasonCode &&
          rule.requiredActionCode === selectedRequiredActionCode,
      ) || null,
    [
      selectedReasonCode,
      selectedRequiredActionCode,
      selectedSubstatusCode,
      transitionRules,
    ],
  );

  if (!isOpen || !detail) return null;

  const resultStatus = getLeadCatalogEntryByCode(
    statuses,
    selectedRule?.resultStatusCode,
  );
  const selectedSubstatus = getLeadCatalogEntryByCode(
    substatuses,
    selectedSubstatusCode,
  );
  const selectedSubstatusGuide = getLeadCallOutcomeSubstatusGuide(
    selectedSubstatusCode,
  );
  const selectedReason = getLeadCatalogEntryByCode(reasons, selectedReasonCode);
  const selectedReasonGuide = getLeadCallOutcomeReasonGuide(selectedReasonCode);
  const selectedRequiredAction = getLeadCatalogEntryByCode(
    requiredActions,
    selectedRequiredActionCode,
  );
  const selectedActionGuide = getLeadCallOutcomeActionGuide(
    selectedRequiredActionCode,
  );
  const leadOutcomeHistory = Array.isArray(detail?.leadOutcomeHistory)
    ? detail.leadOutcomeHistory
    : EMPTY_LEAD_HISTORY;

  return (
    <div
      className="modal-overlay modal-overlay-elevated"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="modal-dialog resolve-confirmation-modal lead-outcome-modal">
        <div className="modal-header interaction-modal-header-with-close">
          <button
            type="button"
            className="btn-secondary account-modal-close-button interaction-modal-close-left"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar modal de resultado de llamada"
            title="Cerrar"
          >
            ×
          </button>
          <div>
            <span className="lead-decision-kicker">Resultado guiado</span>
            <h3 className="modal-title">Registrar situación del lead</h3>
            <p className="roles-subtitle resolve-confirmation-subtitle">
              {normalizeLeadDisplayText(detail.title)}
            </p>
          </div>
        </div>

        <form
          className="account-create-form in-modal lead-outcome-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedRule || saving) return;
            onSubmit({
              ...form,
              substatusCode: selectedSubstatusCode,
              reasonCode: selectedReasonCode,
              requiredActionCode: selectedRequiredActionCode,
              eventType: form.eventType || "activity_update",
              correctionTargetEventId: form.correctionTargetEventId
                ? Number(form.correctionTargetEventId)
                : null,
            });
          }}
        >
          <div className="lead-outcome-modal-layout">
            <div className="lead-outcome-modal-main">
              <div className="lead-outcome-modal-grid">
                <section className="lead-outcome-modal-block">
                  <LeadCallOutcomeOptionCards
                    label="Situación del lead"
                    entries={substatusOptions}
                    selectedCode={selectedSubstatusCode}
                    disabled={saving}
                    getGuide={getLeadCallOutcomeSubstatusGuide}
                    kind="substatus"
                    onSelect={(code) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        substatusCode: code,
                        reasonCode: "",
                        requiredActionCode: "",
                      }))
                    }
                  />
                  {selectedSubstatusGuide || selectedSubstatus?.description ? (
                    <p className="field-hint lead-outcome-modal-selection-hint">
                      {selectedSubstatusGuide?.whenToUse ||
                        selectedSubstatus?.description ||
                        ""}
                    </p>
                  ) : null}
                </section>

                <section className="lead-outcome-modal-block">
                  <LeadCallOutcomeOptionCards
                    label="Motivo principal"
                    entries={reasonOptions}
                    selectedCode={selectedReasonCode}
                    disabled={saving || !reasonOptions.length}
                    getGuide={getLeadCallOutcomeReasonGuide}
                    kind="reason"
                    onSelect={(code) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        reasonCode: code,
                        requiredActionCode: "",
                      }))
                    }
                  />
                  {selectedReasonGuide || selectedReason ? (
                    <p className="field-hint lead-outcome-modal-selection-hint">
                      {selectedReasonGuide?.whenToUse ||
                        selectedReason?.name ||
                        ""}
                    </p>
                  ) : null}
                </section>

                <section className="lead-outcome-modal-block lead-outcome-modal-block-wide">
                  <LeadCallOutcomeOptionCards
                    label="Siguiente acción obligatoria"
                    entries={requiredActionOptions}
                    selectedCode={selectedRequiredActionCode}
                    disabled={saving || !requiredActionOptions.length}
                    getGuide={getLeadCallOutcomeActionGuide}
                    kind="action"
                    onSelect={(code) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        requiredActionCode: code,
                      }))
                    }
                  />
                  {selectedActionGuide || selectedRequiredAction ? (
                    <p className="field-hint lead-outcome-modal-selection-hint">
                      {selectedActionGuide?.whenToUse ||
                        selectedRequiredAction?.name ||
                        ""}
                    </p>
                  ) : null}
                </section>
              </div>
            </div>

            <aside className="lead-outcome-modal-sidebar">
              <section className="account-form-section account-modal-section lead-outcome-summary-panel">
                <div className="lead-outcome-summary-head">
                  <strong>Lectura rápida</strong>
                  <span className="lead-outcome-summary-pill">
                    {resultStatus?.name || "Sin transición válida"}
                  </span>
                </div>
                <div className="lead-outcome-summary-list">
                  <article className="lead-outcome-summary-item">
                    <span>Situación</span>
                    <strong>{selectedSubstatus?.name || "Sin definir"}</strong>
                  </article>
                  <article className="lead-outcome-summary-item">
                    <span>Motivo</span>
                    <strong>{selectedReason?.name || "Sin definir"}</strong>
                  </article>
                  <article className="lead-outcome-summary-item">
                    <span>Acción</span>
                    <strong>
                      {selectedRequiredAction?.name || "Sin definir"}
                    </strong>
                  </article>
                </div>
              </section>

              <section className="account-form-section account-modal-section lead-outcome-side-panel">
                <div className="field-group">
                  <label>Tipo de registro</label>
                  <select
                    value={form.eventType || "activity_update"}
                    onChange={(event) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        eventType: event.target.value,
                        correctionTargetEventId:
                          event.target.value === "admin_correction"
                            ? currentValue.correctionTargetEventId
                            : "",
                        correctionReason:
                          event.target.value === "admin_correction"
                            ? currentValue.correctionReason
                            : "",
                      }))
                    }
                    disabled={saving}
                  >
                    <option value="activity_update">
                      Actualización por actividad
                    </option>
                    <option value="admin_correction">
                      Corrección administrativa
                    </option>
                  </select>
                </div>

                {form.eventType === "admin_correction" ? (
                  <>
                    <div className="field-group">
                      <label>Evento a corregir (opcional)</label>
                      <select
                        value={form.correctionTargetEventId || ""}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            correctionTargetEventId: event.target.value,
                          }))
                        }
                        disabled={saving}
                      >
                        <option value="">Seleccionar evento</option>
                        {leadOutcomeHistory.map((eventItem) => (
                          <option
                            key={eventItem.id}
                            value={String(eventItem.id)}
                          >
                            {`${formatDateTime(eventItem.createdAt)} · ${getLeadOutcomeEventTypeLabel(eventItem.eventType)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Motivo de la corrección</label>
                      <textarea
                        value={form.correctionReason || ""}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            correctionReason: event.target.value,
                          }))
                        }
                        disabled={saving}
                        rows={3}
                        placeholder="Describe por qué se corrige el registro anterior"
                      />
                    </div>
                  </>
                ) : null}
              </section>

              {selectedRule?.requiresDueDate ||
              selectedRule?.requiresReferredContact ||
              selectedRule?.requiresReferredArea ? (
                <section className="account-form-section account-modal-section lead-outcome-side-panel">
                  <strong>Datos obligatorios para esta ruta</strong>
                  {selectedRule?.requiresDueDate ? (
                    <div className="field-group">
                      <label>Fecha compromiso</label>
                      <input
                        type="date"
                        value={form.nextActionDueAt}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            nextActionDueAt: event.target.value,
                          }))
                        }
                        disabled={saving}
                      />
                    </div>
                  ) : null}

                  {selectedRule?.requiresReferredContact ? (
                    <div className="field-group">
                      <label>Persona referida</label>
                      <input
                        value={form.referredContactName}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            referredContactName: event.target.value,
                          }))
                        }
                        disabled={saving}
                        placeholder="Nombre o referencia del nuevo contacto"
                      />
                    </div>
                  ) : null}

                  {selectedRule?.requiresReferredArea ? (
                    <div className="field-group">
                      <label>Área objetivo</label>
                      <input
                        value={form.referredAreaName}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            referredAreaName: event.target.value,
                          }))
                        }
                        disabled={saving}
                        placeholder="Ej. Compras, Operaciones, TI"
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="account-form-section account-modal-section lead-outcome-side-panel">
                <label>Comentario del vendedor</label>
                <textarea
                  value={form.comment}
                  onChange={(event) =>
                    setForm((currentValue) => ({
                      ...currentValue,
                      comment: event.target.value,
                    }))
                  }
                  disabled={saving}
                  rows={5}
                  placeholder="Resumen corto de la conversación y contexto de la decisión"
                />
              </section>
            </aside>
          </div>

          <div className="modal-buttons lead-decision-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={!selectedRule || saving}
            >
              {saving ? "Guardando..." : "Registrar situación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InteractionsPage({ can, currentUser }) {
  const helpRef = useRef(null);
  const interactionMenuRef = useRef(null);
  const statusFilterRef = useRef(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [query, setQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState([
    ...LEAD_STATUS_FILTER_VALUES,
  ]);
  const [statusFilterMenuOpen, setStatusFilterMenuOpen] = useState(false);
  const [statusFilterDraft, setStatusFilterDraft] = useState([
    ...LEAD_STATUS_FILTER_VALUES,
  ]);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [queueFilter, setQueueFilter] = useState("all");
  const [activeView, setActiveView] = useState("inbox");
  const [weeklyFrom, setWeeklyFrom] = useState(() => {
    return addDaysToIsoDate(getTodayBusinessDate(), -90);
  });
  const [weeklyTo, setWeeklyTo] = useState(() => getTodayBusinessDate());
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [operationsSelectedSubstatusCode, setOperationsSelectedSubstatusCode] =
    useState("");
  const [operationsSelectedSubstatusName, setOperationsSelectedSubstatusName] =
    useState("");
  const [operationsSituationItems, setOperationsSituationItems] = useState([]);
  const [operationsSituationPage, setOperationsSituationPage] = useState(1);
  const [operationsSituationTotal, setOperationsSituationTotal] = useState(0);
  const [operationsSituationLoading, setOperationsSituationLoading] =
    useState(false);
  const [operationsSituationError, setOperationsSituationError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInfoMessage, setCreateInfoMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [createFiles, setCreateFiles] = useState([]);
  const [createLeadSource, setCreateLeadSource] = useState("");
  const [createPastedTextName, setCreatePastedTextName] = useState("");
  const [createPastedText, setCreatePastedText] = useState("");
  const [createUploadSessionPublicId, setCreateUploadSessionPublicId] =
    useState("");
  const [createUploadingFilesCount, setCreateUploadingFilesCount] = useState(0);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [isLeadEmailModalOpen, setIsLeadEmailModalOpen] = useState(false);
  const [leadEmailDraft, setLeadEmailDraft] = useState(null);
  const [leadEmailError, setLeadEmailError] = useState("");
  const [leadEmailNotice, setLeadEmailNotice] = useState("");
  const [leadEmailLibraryError, setLeadEmailLibraryError] = useState("");
  const [leadEmailGoogleMailStatus, setLeadEmailGoogleMailStatus] = useState({
    loading: false,
    connected: false,
    canSend: false,
    missingScope: false,
    needsReconnect: false,
    googleEmail: "",
    startUrl: "/api/auth/google-mail/start",
  });
  const [leadEmailLibraryQuery, setLeadEmailLibraryQuery] = useState("");
  const [leadEmailLibraryOptions, setLeadEmailLibraryOptions] = useState([]);
  const [
    leadEmailSelectedLibraryAttachmentIds,
    setLeadEmailSelectedLibraryAttachmentIds,
  ] = useState([]);
  const [leadEmailAiInstructionText, setLeadEmailAiInstructionText] =
    useState("");
  const [leadEmailAiSuggestion, setLeadEmailAiSuggestion] = useState({
    subject: "",
    messageBody: "",
    source: "",
    sourceReason: "",
  });
  const [leadEmailLoadingLibraryOptions, setLeadEmailLoadingLibraryOptions] =
    useState(false);
  const [leadEmailGeneratingAiDraft, setLeadEmailGeneratingAiDraft] =
    useState(false);
  const [
    leadEmailGeneratingAiAttachments,
    setLeadEmailGeneratingAiAttachments,
  ] = useState(false);
  const [leadEmailSending, setLeadEmailSending] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [resolutionForm, setResolutionForm] = useState(null);
  const [options, setOptions] = useState({
    accounts: [],
    contacts: [],
    opportunities: [],
    businessLines: [],
    sellerUsers: [],
    sellerUsersByAccountId: {},
    presalesUsers: [],
    currentUserIsSellerEligible: false,
  });
  const [leadOutcomeCatalogs, setLeadOutcomeCatalogs] = useState({
    statuses: [],
    substatuses: [],
    reasons: [],
    requiredActions: [],
    transitionRules: [],
  });
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving] = useState(false);
  const [savingLeadOutcome, setSavingLeadOutcome] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [addingDocuments, setAddingDocuments] = useState(false);
  const [deletingDocumentPublicId, setDeletingDocumentPublicId] = useState("");
  const [downloadingDocumentPublicId, setDownloadingDocumentPublicId] =
    useState("");
  const [deletingInteractionId, setDeletingInteractionId] = useState(null);
  const [openInteractionMenuId, setOpenInteractionMenuId] = useState(null);
  const [showLeadCallOutcomeModal, setShowLeadCallOutcomeModal] =
    useState(false);
  const [showResolveConfirmation, setShowResolveConfirmation] = useState(false);
  const [resolveDuplicateReview, setResolveDuplicateReview] = useState(null);
  const interactionAnalysisPollingTokenRef = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const operationsSituationTotalPages = Math.max(
    1,
    Math.ceil(operationsSituationTotal / OPERATIONS_SITUATION_PAGE_SIZE),
  );
  const canAccessLeadDashboard =
    can("interacciones.dashboard.access") ||
    can("interacciones.read") ||
    can("interacciones.read_all");
  const canViewExecutiveDashboard =
    can("interacciones.dashboard.executive.view") ||
    can("interacciones.read_all");
  const canViewManagementDashboard =
    can("interacciones.dashboard.management.view") ||
    can("interacciones.read_all");
  const canViewOperationsDashboard =
    can("interacciones.dashboard.operations.view") ||
    can("interacciones.read") ||
    can("interacciones.read_all");
  const canCreate = can("interacciones.create");
  const canUpdate = can("interacciones.update");
  const canAnalyze = can("interacciones.analyze");
  const canResolve = can("interacciones.resolve");
  const availableViews = useMemo(
    () => [
      { id: "inbox", label: "Bandeja" },
      ...(canAccessLeadDashboard && canViewExecutiveDashboard
        ? [{ id: "executive", label: "Ejecutivo" }]
        : []),
      ...(canAccessLeadDashboard && canViewManagementDashboard
        ? [{ id: "management", label: "Gestión" }]
        : []),
      ...(canAccessLeadDashboard && canViewOperationsDashboard
        ? [{ id: "operations", label: "Situación" }]
        : []),
    ],
    [
      canAccessLeadDashboard,
      canViewExecutiveDashboard,
      canViewManagementDashboard,
      canViewOperationsDashboard,
    ],
  );
  const selectedView = availableViews.some((view) => view.id === activeView)
    ? activeView
    : availableViews[0]?.id || "inbox";
  const resolveConfirmationPreview = useMemo(
    () =>
      buildResolveConfirmationPreview(
        detail,
        resolutionForm,
        options,
        currentUser,
      ),
    [detail, resolutionForm, options, currentUser],
  );
  const leadPrimaryEmail = useMemo(() => {
    if (!detail) return "";
    const contacts = Array.isArray(detail.contacts) ? detail.contacts : [];
    return normalizeText(
      contacts.find((contact) => normalizeText(contact?.email))?.email || "",
    );
  }, [detail]);
  const canOpenLeadEmailModal = Boolean(
    canUpdate && detail?.sellerUserId && leadPrimaryEmail,
  );
  const leadEmailDisabledHint = !canUpdate
    ? "No tienes permisos para enviar correos desde este lead."
    : !detail?.sellerUserId
      ? "Este lead debe estar asignado antes de enviar correos."
      : !leadPrimaryEmail
        ? "No hay contacto con email disponible para enviar correo desde este lead."
        : "";
  const selectedLeadLibraryAttachments = useMemo(() => {
    const attachments = Array.isArray(leadEmailDraft?.attachments)
      ? leadEmailDraft.attachments
      : [];
    const selectedIds = Array.isArray(leadEmailSelectedLibraryAttachmentIds)
      ? leadEmailSelectedLibraryAttachmentIds
      : [];
    return attachments
      .filter(
        (attachment) =>
          attachment?.sourceType === "library_file" &&
          selectedIds.includes(attachment?.id),
      )
      .filter(Boolean);
  }, [leadEmailDraft?.attachments, leadEmailSelectedLibraryAttachmentIds]);

  function closeDetailModal() {
    setIsLeadEmailModalOpen(false);
    setShowResolveConfirmation(false);
    setShowLeadCallOutcomeModal(false);
    setResolveDuplicateReview(null);
    setShowDetailModal(false);
  }

  async function loadLeadEmailGoogleMailStatus({ silent = false } = {}) {
    setLeadEmailGoogleMailStatus((current) => ({
      ...current,
      loading: true,
    }));

    try {
      const { data } = await api.get("/api/auth/google-mail/status");
      const nextStatus = {
        loading: false,
        connected: Boolean(data?.connected),
        canSend: Boolean(data?.canSend),
        missingScope: Boolean(data?.missingScope),
        needsReconnect: Boolean(data?.needsReconnect),
        googleEmail: String(data?.googleEmail || ""),
        startUrl: String(data?.startUrl || "/api/auth/google-mail/start"),
      };
      setLeadEmailGoogleMailStatus(nextStatus);

      if (!silent && !nextStatus.canSend) {
        if (nextStatus.connected && nextStatus.missingScope) {
          setLeadEmailNotice(
            "Tu conexion de Google no incluye permiso de envio. Reconecta y acepta el permiso solicitado.",
          );
        } else {
          setLeadEmailNotice(
            "Debes conectar Google para habilitar el envio de correos.",
          );
        }
      }

      return nextStatus;
    } catch (err) {
      setLeadEmailGoogleMailStatus({
        loading: false,
        connected: false,
        canSend: false,
        missingScope: false,
        needsReconnect: false,
        googleEmail: "",
        startUrl: "/api/auth/google-mail/start",
      });

      if (!silent) {
        setLeadEmailError(
          getApiErrorMessage(
            err,
            "No fue posible validar la conexion de Google.",
          ),
        );
      }

      return null;
    }
  }

  async function loadLeadEmailAttachmentOptions({ queryText = "" } = {}) {
    if (!detail?.id) return;
    setLeadEmailLoadingLibraryOptions(true);
    setLeadEmailLibraryError("");

    try {
      const { data } = await api.get(
        `/api/interactions/${detail.id}/email-attachments/options`,
        {
          params: {
            q: normalizeText(queryText),
          },
        },
      );

      const libraryOptions = (
        Array.isArray(data?.libraryFiles) ? data.libraryFiles : []
      )
        .map((item) => ({
          id: normalizeText(item?.id),
          sourceLabel: normalizeText(item?.sourceLabel) || "Biblioteca",
          resourcePublicId: normalizeText(item?.resourcePublicId),
          filePublicId: normalizeText(item?.filePublicId),
          fileName: normalizeText(item?.fileName),
          mimeType: normalizeText(item?.mimeType),
          byteSize: Number(item?.byteSize || 0),
          title: normalizeText(item?.title),
          summary: normalizeText(item?.summary),
          assetTypeLabel: normalizeText(item?.assetTypeLabel),
        }))
        .filter(
          (item) => item.id && item.resourcePublicId && item.filePublicId,
        );

      setLeadEmailLibraryOptions(libraryOptions);
    } catch (err) {
      setLeadEmailLibraryError(
        getApiErrorMessage(
          err,
          "No fue posible cargar contenido de biblioteca comercial.",
        ),
      );
    } finally {
      setLeadEmailLoadingLibraryOptions(false);
    }
  }

  async function handleOpenLeadEmailModal(prefill = null) {
    if (!detail || !canOpenLeadEmailModal) return;

    const baseDraft = buildLeadEmailDefaultDraft(detail, currentUser);
    const nextPurpose =
      normalizeText(prefill?.purposeOther) || baseDraft.purposeOther;
    const templateDraft =
      nextPurpose === baseDraft.purposeOther
        ? baseDraft
        : {
            ...baseDraft,
            ...buildLeadEmailTemplate(detail, currentUser, nextPurpose),
            purposeOther: nextPurpose,
          };

    setLeadEmailDraft({
      ...templateDraft,
      subject: normalizeText(prefill?.subject) || templateDraft.subject,
      messageBody:
        normalizeText(prefill?.messageBody) || templateDraft.messageBody,
    });
    setLeadEmailError("");
    setLeadEmailNotice("");
    setLeadEmailLibraryError("");
    setLeadEmailLibraryQuery("");
    setLeadEmailSelectedLibraryAttachmentIds([]);
    setLeadEmailAiInstructionText(normalizeText(prefill?.aiInstructionText));
    setLeadEmailAiSuggestion({
      subject: "",
      messageBody: "",
      source: "",
      sourceReason: "",
    });
    setIsLeadEmailModalOpen(true);

    void loadLeadEmailAttachmentOptions({ queryText: "" });
    const googleStatus = await loadLeadEmailGoogleMailStatus({ silent: true });
    if (!googleStatus?.canSend) {
      setLeadEmailNotice("Conecta Google para habilitar el envio desde Leads.");
    }

    if (prefill?.autoGenerateAi) {
      try {
        setLeadEmailGeneratingAiDraft(true);
        const response = await api.post(
          `/api/interactions/${detail.id}/email-suggestion`,
          {
            details: {
              recipient: normalizeText(templateDraft.recipient),
              cc: normalizeText(templateDraft.cc),
              subject: normalizeText(templateDraft.subject),
              messageBody: normalizeText(templateDraft.messageBody),
              purpose: "other",
              purposeOther: normalizeText(nextPurpose) || "meeting_request",
              aiInstructionText: normalizeText(prefill?.aiInstructionText),
              attachments: [],
            },
          },
        );

        const aiSubject = normalizeText(response?.data?.subject);
        const aiMessageBody = normalizeText(response?.data?.messageBody);
        setLeadEmailAiSuggestion({
          subject: aiSubject,
          messageBody: aiMessageBody,
          source: normalizeText(response?.data?.source || "fallback"),
          sourceReason: normalizeText(response?.data?.sourceReason),
        });
        setLeadEmailDraft((current) => ({
          ...(current || templateDraft),
          subject: aiSubject || current?.subject || templateDraft.subject,
          messageBody:
            aiMessageBody || current?.messageBody || templateDraft.messageBody,
        }));
      } catch (err) {
        setLeadEmailError(
          getApiErrorMessage(
            err,
            "No fue posible generar la recomendación IA para el correo.",
          ),
        );
      } finally {
        setLeadEmailGeneratingAiDraft(false);
      }
    }
  }

  function handleCloseLeadEmailModal() {
    if (leadEmailSending || leadEmailGeneratingAiDraft) return;
    setIsLeadEmailModalOpen(false);
    setLeadEmailError("");
    setLeadEmailNotice("");
  }

  function handleLeadEmailFieldChange(field, value) {
    setLeadEmailDraft((current) => {
      const nextDraft = {
        ...(current || {}),
        [field]: value,
      };

      if (field === "purposeOther") {
        const template = buildLeadEmailTemplate(detail, currentUser, value);
        nextDraft.subject = template.subject;
        nextDraft.messageBody = template.messageBody;
      }

      return nextDraft;
    });
    setLeadEmailError("");
    setLeadEmailNotice("");
  }

  function handleLeadEmailAiInstructionChange(value) {
    setLeadEmailAiInstructionText(value);
    setLeadEmailError("");
    setLeadEmailNotice("");
  }

  function handleLeadEmailLibraryQueryChange(value) {
    setLeadEmailLibraryQuery(value);
  }

  function handleToggleLeadLibraryAttachment(attachmentId) {
    const normalizedId = normalizeText(attachmentId);
    if (!normalizedId) return;

    const option = (
      Array.isArray(leadEmailLibraryOptions) ? leadEmailLibraryOptions : []
    ).find((asset) => asset.id === normalizedId);
    const mappedAttachment = mapLibraryOptionToLeadEmailAttachment(
      option,
      "manual",
    );

    setLeadEmailSelectedLibraryAttachmentIds((current) => {
      if (current.includes(normalizedId)) {
        setLeadEmailDraft((draftCurrent) => ({
          ...(draftCurrent || {}),
          attachments: (draftCurrent?.attachments || []).filter(
            (attachment) => attachment.id !== normalizedId,
          ),
        }));
        return current.filter((id) => id !== normalizedId);
      }

      if (current.length >= LEAD_EMAIL_MAX_LIBRARY_ASSETS) {
        setLeadEmailError(
          `Solo puedes seleccionar hasta ${LEAD_EMAIL_MAX_LIBRARY_ASSETS} activos de biblioteca.`,
        );
        return current;
      }

      if (mappedAttachment) {
        setLeadEmailDraft((draftCurrent) => ({
          ...(draftCurrent || {}),
          attachments: [
            ...(draftCurrent?.attachments || []).filter(
              (attachment) => attachment.id !== mappedAttachment.id,
            ),
            mappedAttachment,
          ],
        }));
      }

      return [...current, normalizedId];
    });

    setLeadEmailNotice("");
  }

  function handleUseLeadEmailAiSuggestion() {
    const subject = normalizeText(leadEmailAiSuggestion.subject);
    const messageBody = normalizeText(leadEmailAiSuggestion.messageBody);
    if (!subject && !messageBody) return;

    setLeadEmailDraft((current) => ({
      ...(current || {}),
      subject: subject || current?.subject,
      messageBody: messageBody || current?.messageBody,
    }));
    setLeadEmailNotice("Sugerencia copiada al borrador.");
  }

  async function handleRequestLeadAiDraft() {
    if (!detail?.id || !leadEmailDraft) return;
    setLeadEmailGeneratingAiDraft(true);
    setLeadEmailError("");
    setLeadEmailNotice("");

    try {
      const response = await api.post(
        `/api/interactions/${detail.id}/email-suggestion`,
        {
          details: {
            recipient: normalizeText(leadEmailDraft.recipient),
            cc: normalizeText(leadEmailDraft.cc),
            subject: normalizeText(leadEmailDraft.subject),
            messageBody: normalizeText(leadEmailDraft.messageBody),
            purpose: "other",
            purposeOther:
              normalizeText(leadEmailDraft.purposeOther) || "company_intro",
            aiInstructionText: normalizeText(leadEmailAiInstructionText),
            attachments: selectedLeadLibraryAttachments,
          },
        },
      );

      setLeadEmailAiSuggestion({
        subject: normalizeText(response?.data?.subject),
        messageBody: normalizeText(response?.data?.messageBody),
        source: normalizeText(response?.data?.source || "fallback"),
        sourceReason: normalizeText(response?.data?.sourceReason),
      });
      setLeadEmailNotice("Sugerencia generada con IA.");
    } catch (err) {
      setLeadEmailError(
        getApiErrorMessage(err, "No fue posible generar el borrador con IA."),
      );
    } finally {
      setLeadEmailGeneratingAiDraft(false);
    }
  }

  async function handleRequestLeadAiAttachments() {
    if (!detail?.id || !leadEmailDraft) return;
    setLeadEmailGeneratingAiAttachments(true);
    setLeadEmailError("");
    setLeadEmailNotice("");

    try {
      const response = await api.post(
        `/api/interactions/${detail.id}/email-attachment-suggestions`,
        {
          details: {
            purposeOther:
              normalizeText(leadEmailDraft.purposeOther) || "company_intro",
            aiInstructionText: normalizeText(leadEmailAiInstructionText),
            attachments: selectedLeadLibraryAttachments,
          },
        },
      );

      const suggestedOptions = (
        Array.isArray(response?.data?.suggestions)
          ? response.data.suggestions
          : []
      )
        .map((item) => ({
          id: normalizeText(item?.id),
          sourceLabel: normalizeText(item?.sourceLabel) || "Biblioteca",
          resourcePublicId: normalizeText(item?.resourcePublicId),
          filePublicId: normalizeText(item?.filePublicId),
          fileName: normalizeText(item?.fileName),
          mimeType: normalizeText(item?.mimeType),
          byteSize: Number(item?.byteSize || 0),
          title: normalizeText(item?.title),
          summary: normalizeText(item?.summary),
          assetTypeLabel: normalizeText(item?.assetTypeLabel),
        }))
        .filter((item) => item.id && item.resourcePublicId && item.filePublicId)
        .slice(0, LEAD_EMAIL_MAX_LIBRARY_ASSETS);

      if (!suggestedOptions.length) {
        setLeadEmailNotice("No se encontraron adjuntos sugeridos por IA.");
        return;
      }

      const currentSelectedIds = Array.isArray(
        leadEmailSelectedLibraryAttachmentIds,
      )
        ? leadEmailSelectedLibraryAttachmentIds
        : [];
      const availableSlots = Math.max(
        LEAD_EMAIL_MAX_LIBRARY_ASSETS - currentSelectedIds.length,
        0,
      );

      const suggestedAttachments = suggestedOptions
        .map((item) => mapLibraryOptionToLeadEmailAttachment(item, "ai"))
        .filter(Boolean);

      const newSuggestedAttachments = suggestedAttachments
        .filter((attachment) => !currentSelectedIds.includes(attachment.id))
        .slice(0, availableSlots);

      if (!newSuggestedAttachments.length) {
        setLeadEmailNotice(
          "No se agregaron nuevos adjuntos porque ya alcanzaste el limite o ya estaban seleccionados.",
        );
        return;
      }

      setLeadEmailSelectedLibraryAttachmentIds((current) =>
        Array.from(
          new Set([
            ...(Array.isArray(current) ? current : []),
            ...newSuggestedAttachments.map((attachment) => attachment.id),
          ]),
        ),
      );

      setLeadEmailDraft((current) => {
        const currentAttachments = Array.isArray(current?.attachments)
          ? current.attachments
          : [];
        const mergedById = new Map(
          currentAttachments.map((attachment) => [attachment.id, attachment]),
        );
        newSuggestedAttachments.forEach((attachment) => {
          mergedById.set(attachment.id, attachment);
        });

        return {
          ...(current || {}),
          attachments: Array.from(mergedById.values()),
        };
      });

      setLeadEmailNotice(
        `La IA sugirio ${newSuggestedAttachments.length} adjunto(s) de biblioteca.`,
      );
    } catch (err) {
      setLeadEmailError(
        getApiErrorMessage(err, "No fue posible sugerir adjuntos con IA."),
      );
    } finally {
      setLeadEmailGeneratingAiAttachments(false);
    }
  }

  function handleRemoveLeadEmailAttachment(attachmentId) {
    const normalizedId = normalizeText(attachmentId);
    setLeadEmailDraft((current) => ({
      ...(current || {}),
      attachments: (current?.attachments || []).filter(
        (attachment) => attachment.id !== normalizedId,
      ),
    }));
    setLeadEmailSelectedLibraryAttachmentIds((current) =>
      current.filter((id) => id !== normalizedId),
    );
    setLeadEmailError("");
    setLeadEmailNotice("");
  }

  async function handleAddLeadEmailAttachments(files) {
    if (!leadEmailDraft) return;

    const incomingFiles = Array.isArray(files) ? files : [];
    if (!incomingFiles.length) return;

    const currentAttachments = Array.isArray(leadEmailDraft.attachments)
      ? leadEmailDraft.attachments
      : [];
    if (currentAttachments.length + incomingFiles.length > 10) {
      setLeadEmailError("Solo puedes adjuntar hasta 10 archivos.");
      return;
    }

    const mapped = incomingFiles
      .map((file, index) => mapLocalFileToLeadEmailAttachment(file, index))
      .filter(Boolean);

    setLeadEmailDraft((current) => ({
      ...(current || {}),
      attachments: [...currentAttachments, ...mapped],
    }));
    setLeadEmailError("");
    setLeadEmailNotice("");
  }

  async function handleConnectLeadEmailGoogleMail() {
    if (typeof window === "undefined") return;
    const connectUrl =
      leadEmailGoogleMailStatus.startUrl || "/api/auth/google-mail/start";
    const returnTo = window.location.href;

    try {
      await api.post("/api/auth/google-mail/disconnect").catch(() => null);
      const { data } = await api.get(connectUrl, {
        params: { returnTo, mode: "json" },
      });
      const oauthUrl = String(data?.url || "").trim();
      if (!oauthUrl) {
        setLeadEmailError("No fue posible iniciar la conexion con Google.");
        return;
      }
      window.location.assign(oauthUrl);
    } catch (err) {
      setLeadEmailError(
        getApiErrorMessage(
          err,
          "No fue posible iniciar la conexion con Google.",
        ),
      );
    }
  }

  async function handleRequestSendLeadEmail() {
    if (!detail?.id || !leadEmailDraft) return;

    const recipient =
      normalizeText(leadEmailDraft.recipient) || leadPrimaryEmail;
    const subject = normalizeText(leadEmailDraft.subject);
    const messageBody = normalizeText(leadEmailDraft.messageBody);
    const ccList = parseEmailList(leadEmailDraft.cc);

    if (!normalizeText(leadEmailDraft.recipient) && recipient) {
      setLeadEmailDraft((current) => ({
        ...(current || {}),
        recipient,
      }));
    }

    if (!recipient) {
      setLeadEmailError(
        "No hay destinatario principal disponible en este lead.",
      );
      return;
    }
    if (!subject) {
      setLeadEmailError("Indica el asunto del correo.");
      return;
    }
    if (!messageBody) {
      setLeadEmailError("El mensaje no puede ir vacio.");
      return;
    }
    if (!isValidEmail(recipient)) {
      setLeadEmailError("Hay correos con formato invalido.");
      return;
    }
    if (ccList.some((email) => !isValidEmail(email))) {
      setLeadEmailError("Hay correos con formato invalido en CC.");
      return;
    }

    const latestGoogleStatus = await loadLeadEmailGoogleMailStatus({
      silent: true,
    });
    if (!latestGoogleStatus?.canSend) {
      if (latestGoogleStatus?.connected && latestGoogleStatus?.missingScope) {
        setLeadEmailError(
          "Tu conexion de Google no incluye permiso de envio. Reconecta y acepta el permiso solicitado.",
        );
      } else {
        setLeadEmailError(
          "Tu conexion de Google no esta lista para enviar correos.",
        );
      }
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Se enviara este correo ahora a ${recipient}. ¿Deseas continuar?`,
      );
      if (!confirmed) {
        return;
      }
    }

    setLeadEmailSending(true);
    setLeadEmailError("");
    setLeadEmailNotice("");
    setError("");
    setSuccess("");

    try {
      const draftAttachments = Array.isArray(leadEmailDraft.attachments)
        ? leadEmailDraft.attachments
        : [];
      const nonLocalAttachments = draftAttachments.filter(
        (attachment) => attachment?.sourceType !== "local_upload",
      );
      const localAttachments = draftAttachments.filter(
        (attachment) =>
          attachment?.sourceType === "local_upload" && attachment?.file,
      );
      const mergedAttachments = [
        ...nonLocalAttachments,
        ...selectedLeadLibraryAttachments,
      ].filter(Boolean);
      const uniqueNonLocalAttachments = Array.from(
        new Map(
          mergedAttachments.map((attachment) => [attachment.id, attachment]),
        ).values(),
      );
      const formData = new FormData();
      formData.append(
        "details",
        JSON.stringify({
          recipient,
          cc: normalizeText(leadEmailDraft.cc),
          subject,
          messageBody,
          purpose: "other",
          purposeOther:
            normalizeText(leadEmailDraft.purposeOther) || "company_intro",
          aiInstructionText: normalizeText(leadEmailAiInstructionText),
          attachments: uniqueNonLocalAttachments,
          markDoneOnSend: false,
        }),
      );
      localAttachments.forEach((attachment, index) => {
        formData.append(`file_${index}`, attachment.file, attachment.file.name);
      });

      await api.post(`/api/interactions/${detail.id}/send-email`, formData);

      const successMessage = `Correo enviado correctamente a ${recipient}.`;
      setLeadEmailNotice(successMessage);
      setSuccess(successMessage);
      setIsLeadEmailModalOpen(false);
      await loadInteractions();
      if (detail?.id) {
        const { data } = await api.get(`/api/interactions/${detail.id}`);
        setDetail(data);
        setEditForm(buildEditableForm(data));
        setResolutionForm(
          buildInitialResolutionForm(data, options, currentUser),
        );
      }
    } catch (err) {
      const reason = String(err?.response?.data?.reason || "").toLowerCase();
      const missingFields = Array.isArray(err?.response?.data?.missingFields)
        ? err.response.data.missingFields
        : [];
      if (reason === "google_reconnect_required") {
        const reconnectMessage =
          "La conexion con Google expiro o fue revocada. Reconecta para continuar.";
        setLeadEmailError(reconnectMessage);
        setError(reconnectMessage);
        await loadLeadEmailGoogleMailStatus({ silent: true });
      } else if (reason === "google_scope_missing") {
        const missingScopeMessage =
          "La conexion de Google no incluye permiso de envio. Reconecta y acepta el permiso solicitado.";
        setLeadEmailError(missingScopeMessage);
        setError(missingScopeMessage);
        await loadLeadEmailGoogleMailStatus({ silent: true });
      } else if (missingFields.includes("recipient")) {
        const missingRecipientMessage =
          "Debes completar el destinatario principal antes de enviar.";
        setLeadEmailError(missingRecipientMessage);
        setError(missingRecipientMessage);
      } else if (missingFields.includes("subject")) {
        const missingSubjectMessage =
          "Debes completar el asunto antes de enviar.";
        setLeadEmailError(missingSubjectMessage);
        setError(missingSubjectMessage);
      } else if (missingFields.includes("messageBody")) {
        const missingMessageMessage =
          "Debes completar el mensaje base antes de enviar.";
        setLeadEmailError(missingMessageMessage);
        setError(missingMessageMessage);
      } else {
        const errorMessage = getApiErrorMessage(
          err,
          "No fue posible enviar el correo desde Lead.",
        );
        setLeadEmailError(errorMessage);
        setError(errorMessage);
      }
    } finally {
      setLeadEmailSending(false);
    }
  }

  async function loadLeadOutcomeCatalogs(statusCode) {
    const { data } = await api.get("/api/interactions/call-outcome-catalogs", {
      params: { status: statusCode },
    });
    setLeadOutcomeCatalogs(
      data || {
        statuses: [],
        substatuses: [],
        reasons: [],
        requiredActions: [],
        transitionRules: [],
      },
    );
    return data;
  }

  function openLeadCallOutcomeModal() {
    if (!detail || isFinalizedLeadStatus(detail.analysisStatus)) return;
    setShowLeadCallOutcomeModal(true);
  }

  function closeLeadCallOutcomeModal() {
    if (savingLeadOutcome) return;
    setShowLeadCallOutcomeModal(false);
  }

  async function ensureCreateUploadSession() {
    if (createUploadSessionPublicId) {
      return createUploadSessionPublicId;
    }

    const { data } = await api.post(
      "/api/interactions/document-upload-sessions",
    );
    const nextSessionPublicId = String(data?.session?.publicId || "").trim();
    if (!nextSessionPublicId) {
      throw new Error("No fue posible crear la sesion documental del lead");
    }

    setCreateUploadSessionPublicId(nextSessionPublicId);
    return nextSessionPublicId;
  }

  async function uploadCreateFilesToSession(filesToUpload) {
    const nextFiles = Array.isArray(filesToUpload) ? filesToUpload : [];
    if (!nextFiles.length) return null;

    const sessionPublicId = await ensureCreateUploadSession();
    const formData = new FormData();
    nextFiles.forEach((file) => formData.append("files", file));

    setCreateUploadingFilesCount(
      (currentCount) => currentCount + nextFiles.length,
    );
    try {
      const { data } = await api.post(
        `/api/interactions/document-upload-sessions/${sessionPublicId}/files`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 120000,
        },
      );
      return data;
    } finally {
      setCreateUploadingFilesCount((currentCount) =>
        Math.max(0, currentCount - nextFiles.length),
      );
    }
  }

  function openResolveConfirmation() {
    if (!detail || !editForm || !resolutionForm || resolving) return;
    setShowResolveConfirmation(true);
  }

  function toggleInteractionMenu(interactionId) {
    setOpenInteractionMenuId((currentValue) =>
      currentValue === interactionId ? null : interactionId,
    );
  }

  function openStatusFilterMenu() {
    setStatusFilterDraft(statusFilters);
    setStatusFilterMenuOpen(true);
  }

  const closeStatusFilterMenu = useCallback(
    ({ restoreDraft = false } = {}) => {
      if (restoreDraft) {
        setStatusFilterDraft(statusFilters);
      }
      setStatusFilterMenuOpen(false);
    },
    [statusFilters],
  );

  function toggleStatusFilterDraft(statusValue) {
    if (statusValue === "all") {
      setStatusFilterDraft([...LEAD_STATUS_FILTER_VALUES]);
      return;
    }
    setStatusFilterDraft((currentValues) => {
      const currentSet = new Set(sortLeadStatusFilters(currentValues));
      if (currentSet.has(statusValue)) {
        currentSet.delete(statusValue);
      } else {
        currentSet.add(statusValue);
      }
      return LEAD_STATUS_FILTER_VALUES.filter((value) => currentSet.has(value));
    });
  }

  function applyStatusFilters() {
    const normalized = sortLeadStatusFilters(statusFilterDraft);
    if (!normalized.length) {
      return;
    }
    setPage(1);
    setStatusFilters(normalized);
    closeStatusFilterMenu();
  }

  function applyDashboardDrilldown({
    statuses = null,
    source = null,
    queue = "all",
    queryText = null,
  } = {}) {
    setPage(1);
    setActiveView("inbox");
    setQueueFilter(queue);
    if (statuses) {
      setStatusFilters(normalizeLeadStatusFilters(statuses));
      setStatusFilterDraft(normalizeLeadStatusFilters(statuses));
    }
    if (source) {
      setSourceFilter(source);
    }
    if (queryText !== null) {
      setQuery(queryText);
    }
  }

  function openDashboardView(viewId) {
    setActiveView(viewId);
    if (viewId !== "inbox") {
      setQueueFilter("all");
    }
  }

  function handleLeadSort(nextSortBy) {
    setPage(1);
    if (sortBy === nextSortBy) {
      setSortDir((currentSortDir) =>
        currentSortDir === "asc" ? "desc" : "asc",
      );
      return;
    }
    setSortBy(nextSortBy);
    setSortDir(nextSortBy === "createdAt" ? "desc" : "asc");
  }

  function getLeadSortIndicator(columnSortBy) {
    if (sortBy !== columnSortBy) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  useEffect(() => {
    if (!openInteractionMenuId) return undefined;

    function handlePointerDown(event) {
      if (
        interactionMenuRef.current &&
        !interactionMenuRef.current.contains(event.target)
      ) {
        setOpenInteractionMenuId(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenInteractionMenuId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openInteractionMenuId]);

  useEffect(() => {
    if (!isLeadEmailModalOpen) return;
    const timer = window.setTimeout(() => {
      void loadLeadEmailAttachmentOptions({ queryText: leadEmailLibraryQuery });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [isLeadEmailModalOpen, leadEmailLibraryQuery]);

  useEffect(() => {
    if (!statusFilterMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (
        statusFilterRef.current &&
        !statusFilterRef.current.contains(event.target)
      ) {
        closeStatusFilterMenu({ restoreDraft: true });
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeStatusFilterMenu({ restoreDraft: true });
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeStatusFilterMenu, statusFilterMenuOpen, statusFilters]);

  const loadInteractions = useCallback(
    async (overrides = {}) => {
      const effectivePage = Math.max(1, Number(overrides.page ?? page) || 1);
      const effectivePageSize = Math.min(
        50,
        Math.max(1, Number(overrides.pageSize ?? pageSize) || 10),
      );
      const effectiveQuery = String(overrides.query ?? query);
      const rawEffectiveStatuses = overrides.statuses ?? statusFilters;
      const effectiveStatuses = normalizeLeadStatusFilters(
        Array.isArray(rawEffectiveStatuses)
          ? rawEffectiveStatuses
          : [rawEffectiveStatuses],
      );
      const statusesParam =
        effectiveStatuses.length === LEAD_STATUS_FILTER_VALUES.length
          ? "all"
          : effectiveStatuses.join(",");
      const effectiveSource = String(overrides.source ?? sourceFilter);
      const effectivePeriod = String(
        (overrides.period ?? periodFilter) || "all",
      );
      const effectiveQueue = String((overrides.queue ?? queueFilter) || "all");
      const effectiveSortBy = String(
        (overrides.sortBy ?? sortBy) || "createdAt",
      );
      const effectiveSortDir =
        String((overrides.sortDir ?? sortDir) || "desc").toLowerCase() === "asc"
          ? "asc"
          : "desc";

      setLoading(true);
      try {
        const { data } = await api.get("/api/interactions", {
          params: {
            page: effectivePage,
            pageSize: effectivePageSize,
            query: effectiveQuery,
            statuses: statusesParam,
            source: effectiveSource,
            period: effectivePeriod,
            queue: effectiveQueue,
            sortBy: effectiveSortBy,
            sortDir: effectiveSortDir,
          },
        });
        setItems(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number(data?.total || 0));
      } catch (err) {
        setError(getApiErrorMessage(err, "No fue posible cargar los leads"));
      } finally {
        setLoading(false);
      }
    },
    [
      page,
      pageSize,
      query,
      statusFilters,
      sourceFilter,
      periodFilter,
      queueFilter,
      sortBy,
      sortDir,
    ],
  );

  const loadDashboard = useCallback(async () => {
    const effectiveStatuses = normalizeLeadStatusFilters(statusFilters);
    const statusesParam =
      effectiveStatuses.length === LEAD_STATUS_FILTER_VALUES.length
        ? "all"
        : effectiveStatuses.join(",");

    setDashboardLoading(true);
    setDashboardError("");
    try {
      const { data } = await api.get("/api/interactions/dashboard", {
        params: {
          query,
          statuses: statusesParam,
          source: sourceFilter,
          period: periodFilter,
          weeklyFrom,
          weeklyTo,
        },
      });
      setDashboard(data || null);
    } catch (err) {
      setDashboardError(
        getApiErrorMessage(err, "No fue posible cargar los tableros de leads"),
      );
    } finally {
      setDashboardLoading(false);
    }
  }, [periodFilter, query, sourceFilter, statusFilters, weeklyFrom, weeklyTo]);

  const loadOperationsSituationLeads = useCallback(
    async ({ substatusCode, substatusName, page: situationPage = 1 }) => {
      if (!substatusCode) return;
      const effectiveStatuses = normalizeLeadStatusFilters(statusFilters);
      const statusesParam =
        effectiveStatuses.length === LEAD_STATUS_FILTER_VALUES.length
          ? "all"
          : effectiveStatuses.join(",");

      setOperationsSituationLoading(true);
      setOperationsSituationError("");
      setOperationsSelectedSubstatusCode(substatusCode);
      setOperationsSelectedSubstatusName(substatusName || "Sin situación");
      setOperationsSituationPage(situationPage);

      try {
        const { data } = await api.get("/api/interactions", {
          params: {
            page: situationPage,
            pageSize: OPERATIONS_SITUATION_PAGE_SIZE,
            query,
            statuses: statusesParam,
            source: sourceFilter,
            period: periodFilter,
            substatus: substatusCode,
          },
        });
        setOperationsSituationItems(
          Array.isArray(data?.items) ? data.items : [],
        );
        setOperationsSituationTotal(Number(data?.total || 0));
      } catch (err) {
        setOperationsSituationItems([]);
        setOperationsSituationTotal(0);
        setOperationsSituationError(
          getApiErrorMessage(
            err,
            "No fue posible cargar los leads de esta situación",
          ),
        );
      } finally {
        setOperationsSituationLoading(false);
      }
    },
    [periodFilter, query, sourceFilter, statusFilters],
  );

  useEffect(() => {
    // Reloading the list on pagination/filter changes is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInteractions();
  }, [loadInteractions]);

  useEffect(() => {
    if (selectedView === "inbox") return;
    // Reloading the dashboard on tab/filter changes is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDashboard();
  }, [selectedView, loadDashboard]);

  useEffect(() => {
    if (selectedView === "operations" && operationsSelectedSubstatusCode) {
      void loadOperationsSituationLeads({
        substatusCode: operationsSelectedSubstatusCode,
        substatusName: operationsSelectedSubstatusName,
        page: operationsSituationPage,
      });
      return;
    }
    if (selectedView !== "operations") {
      setOperationsSelectedSubstatusCode("");
      setOperationsSelectedSubstatusName("");
      setOperationsSituationItems([]);
      setOperationsSituationPage(1);
      setOperationsSituationTotal(0);
      setOperationsSituationError("");
      setOperationsSituationLoading(false);
    }
  }, [
    selectedView,
    operationsSelectedSubstatusCode,
    operationsSelectedSubstatusName,
    operationsSituationPage,
    loadOperationsSituationLeads,
  ]);

  useEffect(() => {
    if (!error && !success) return undefined;
    const timer = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [error, success]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!helpRef.current?.open) {
        return;
      }

      if (!helpRef.current.contains(event.target)) {
        helpRef.current.removeAttribute("open");
      }
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape" || !helpRef.current?.open) {
        return;
      }

      helpRef.current.removeAttribute("open");
      helpRef.current.querySelector("summary")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function resetCreateForm() {
    setShowCreateModal(false);
    setCreateFiles([]);
    setCreateLeadSource("");
    setCreatePastedTextName("");
    setCreatePastedText("");
    setCreateUploadSessionPublicId("");
    setCreateUploadingFilesCount(0);
  }

  async function openDetail(itemId) {
    setLoadingDetail(true);
    setError("");
    try {
      const [detailRes, optionsRes] = await Promise.all([
        api.get(`/api/interactions/${itemId}`),
        api.get("/api/interactions/resolution-options"),
      ]);
      await loadLeadOutcomeCatalogs(detailRes.data?.analysisStatus);
      setDetail(detailRes.data);
      setOptions(optionsRes.data || options);
      setEditForm(buildEditableForm(detailRes.data));
      setResolutionForm(
        buildInitialResolutionForm(
          detailRes.data,
          optionsRes.data || options,
          currentUser,
        ),
      );
      setResolveDuplicateReview(null);
      setShowDetailModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible abrir el lead"));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleSaveLeadCallOutcome(form) {
    if (!detail?.id) return;

    setSavingLeadOutcome(true);
    setError("");
    try {
      const { data } = await api.post(
        `/api/interactions/${detail.id}/call-outcome`,
        form,
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      await loadLeadOutcomeCatalogs(data.analysisStatus);
      setShowLeadCallOutcomeModal(false);
      setSuccess("Situación comercial registrada");
      await loadInteractions();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar el resultado comercial del lead",
        ),
      );
    } finally {
      setSavingLeadOutcome(false);
    }
  }

  async function handleCreate() {
    const trimmedPastedText = createPastedText.trim();
    if (!createLeadSource) return;
    setCreating(true);
    setError("");
    setCreateInfoMessage("");
    try {
      const formData = new FormData();
      formData.append("leadSource", createLeadSource);
      if (createUploadSessionPublicId) {
        formData.append("uploadSessionPublicId", createUploadSessionPublicId);
      } else {
        const filesToUpload = [...createFiles];
        if (trimmedPastedText) {
          filesToUpload.push(
            buildPastedTextFile({
              fileName: buildPastedTextFileName(createPastedTextName),
              text: trimmedPastedText,
            }),
          );
        }
        filesToUpload.forEach((file) => formData.append("files", file));
      }
      await api.post("/api/interactions", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      resetCreateForm();
      setPage(1);
      setQuery("");
      setStatusFilters([...LEAD_STATUS_FILTER_VALUES]);
      setStatusFilterDraft([...LEAD_STATUS_FILTER_VALUES]);
      setSourceFilter("all");
      setSuccess(
        'Lead creado. Abre el lead y pulsa "Analizar documentos para llenar información".',
      );
      await loadInteractions({
        page: 1,
        query: "",
        statuses: LEAD_STATUS_FILTER_VALUES,
        source: "all",
      });
    } catch (err) {
      setCreateInfoMessage(
        getApiErrorMessage(err, "No fue posible crear el lead"),
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteDocument(documentPublicId) {
    if (!detail?.id || !documentPublicId) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Este archivo se eliminará del lead. ¿Quieres continuar?")
    ) {
      return;
    }
    setDeletingDocumentPublicId(documentPublicId);
    setError("");
    try {
      const { data } = await api.delete(
        `/api/interactions/${detail.id}/documents/${documentPublicId}`,
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      setSuccess("Archivo eliminado del lead");
      await loadInteractions();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible eliminar el archivo"));
    } finally {
      setDeletingDocumentPublicId("");
    }
  }

  async function handleDownloadDocument(documentItem) {
    if (!detail?.id || !documentItem?.publicId) return;
    setDownloadingDocumentPublicId(String(documentItem.publicId));
    setError("");
    try {
      const response = await api.get(
        `/api/interactions/${detail.id}/documents/${documentItem.publicId}/download`,
        {
          responseType: "blob",
          timeout: 60000,
        },
      );

      const contentDisposition = String(
        response?.headers?.["content-disposition"] || "",
      );
      const utfFileNameMatch = contentDisposition.match(
        /filename\*=UTF-8''([^;]+)/i,
      );
      const plainFileNameMatch = contentDisposition.match(
        /filename="?([^";]+)"?/i,
      );
      const decodedFileName = utfFileNameMatch?.[1]
        ? decodeURIComponent(utfFileNameMatch[1])
        : plainFileNameMatch?.[1] ||
          documentItem.originalFileName ||
          "documento";

      const blob = new Blob([response.data], {
        type:
          String(response?.headers?.["content-type"] || "").trim() ||
          documentItem.mimeType ||
          "application/octet-stream",
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = decodedFileName;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible descargar el archivo"));
    } finally {
      setDownloadingDocumentPublicId("");
    }
  }

  async function handleAddDocuments(files) {
    if (!detail?.id || !files?.length) return false;
    setAddingDocuments(true);
    setError("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const { data } = await api.post(
        `/api/interactions/${detail.id}/documents`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      setSuccess(
        'Archivos subidos. Usa "Analizar documentos para llenar información" para actualizar sugerencias.',
      );
      await loadInteractions();
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible subir archivos al lead"),
      );
      return false;
    } finally {
      setAddingDocuments(false);
    }
  }

  async function handleDeleteInteraction(interaction) {
    if (!interaction?.id) return;
    if (isFinalizedLeadStatus(interaction.analysisStatus)) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Este lead se eliminará de forma permanente. ¿Quieres continuar?",
      )
    ) {
      return;
    }

    setDeletingInteractionId(interaction.id);
    setOpenInteractionMenuId(null);
    setError("");
    try {
      await api.delete(`/api/interactions/${interaction.id}`);
      if (detail && Number(detail.id) === Number(interaction.id)) {
        closeDetailModal();
        setDetail(null);
        setEditForm(null);
        setResolutionForm(null);
      }
      setSuccess("Lead eliminado");
      await loadInteractions();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible eliminar el lead"));
    } finally {
      setDeletingInteractionId(null);
    }
  }

  async function handleReanalyze() {
    if (!detail) return;
    setReanalyzing(true);
    setError("");
    interactionAnalysisPollingTokenRef.current += 1;
    const pollingToken = interactionAnalysisPollingTokenRef.current;
    try {
      const { data } = await api.post(
        `/api/interactions/${detail.id}/analyze/jobs`,
        {},
        { timeout: INTERACTION_ANALYSIS_TIMEOUT_MS },
      );

      let resolvedData = data;
      if (!resolvedData?.result) {
        const jobId = String(resolvedData?.job?.id || "").trim();
        if (!jobId) {
          throw new Error(
            "No fue posible obtener el identificador del job de análisis",
          );
        }

        const deadline =
          Date.now() + INTERACTION_ANALYSIS_TOTAL_POLL_TIMEOUT_MS;
        let nextDelay = Math.max(
          Number(
            resolvedData?.job?.pollAfterMs ||
              INTERACTION_ANALYSIS_JOB_POLL_INTERVAL_MS,
          ),
          0,
        );

        while (interactionAnalysisPollingTokenRef.current === pollingToken) {
          if (Date.now() >= deadline) {
            resolvedData = {
              error: {
                message:
                  "El análisis sigue tardando mas de 2 minutos. Puedes reintentarlo desde el modal.",
              },
            };
            break;
          }

          if (nextDelay > 0) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, nextDelay);
            });
          }

          if (interactionAnalysisPollingTokenRef.current !== pollingToken) {
            return;
          }

          const pollResponse = await api.get(
            `/api/interactions/${detail.id}/analyze/jobs/${jobId}`,
            { timeout: INTERACTION_ANALYSIS_TIMEOUT_MS },
          );
          resolvedData = pollResponse.data;

          if (resolvedData?.result) {
            break;
          }

          const jobStatus = String(resolvedData?.job?.status || "");
          if (["failed", "stale", "expired"].includes(jobStatus)) {
            break;
          }

          nextDelay = Math.max(
            Number(
              resolvedData?.job?.pollAfterMs ||
                INTERACTION_ANALYSIS_JOB_POLL_INTERVAL_MS,
            ),
            0,
          );
          nextDelay = Math.min(nextDelay, Math.max(deadline - Date.now(), 0));
        }
      }

      if (interactionAnalysisPollingTokenRef.current !== pollingToken) {
        return;
      }

      if (!resolvedData?.result) {
        setError(
          String(resolvedData?.error?.message || "").trim() ||
            "No fue posible reanalizar el lead",
        );
        return;
      }

      const refreshed = await api.get(`/api/interactions/${detail.id}`);
      setDetail(refreshed.data);
      setEditForm(buildEditableForm(refreshed.data));
      setResolutionForm(
        buildInitialResolutionForm(refreshed.data, options, currentUser),
      );
      setSuccess("Lead reanalizado");
      await loadInteractions();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible reanalizar el lead"));
    } finally {
      if (interactionAnalysisPollingTokenRef.current === pollingToken) {
        setReanalyzing(false);
      }
    }
  }

  async function handleResolve() {
    if (!detail || !editForm || !resolutionForm) return;
    const effectiveResolutionForm = buildEffectiveResolutionForm(
      resolutionForm,
      currentUser,
      detail?.commercialAssignmentPolicy,
      detail,
    );
    const canSubmitCommercialAssignment =
      detail?.commercialAssignmentPolicy?.mode !== "none";
    const requiresSellerOwnerForLinkedAccount =
      detail?.commercialAssignmentPolicy?.mode !== "any";
    const linkedAccountId =
      effectiveResolutionForm.accountResolution.mode === "link_existing" &&
      effectiveResolutionForm.accountResolution.accountId
        ? Number(effectiveResolutionForm.accountResolution.accountId)
        : null;
    const sellerUsersForLinkedAccount = linkedAccountId
      ? options?.sellerUsersByAccountId?.[String(linkedAccountId)] || []
      : [];
    const hasInvalidSellerForLinkedAccount = Boolean(
      requiresSellerOwnerForLinkedAccount &&
      canSubmitCommercialAssignment &&
      linkedAccountId &&
      effectiveResolutionForm.sellerUserId &&
      !sellerUsersForLinkedAccount.some(
        (user) =>
          Number(user.id) === Number(effectiveResolutionForm.sellerUserId),
      ),
    );

    if (hasInvalidSellerForLinkedAccount) {
      setError(
        "El vendedor asignado debe ser uno de los owners vendedores de la cuenta vinculada.",
      );
      return;
    }

    setShowResolveConfirmation(false);
    setResolving(true);
    setError("");
    setResolveDuplicateReview(null);
    try {
      const payload = {
        ...editForm,
        sellerUserId:
          canSubmitCommercialAssignment && effectiveResolutionForm.sellerUserId
            ? Number(effectiveResolutionForm.sellerUserId)
            : null,
        assignCurrentUserAsOwnerSeller: canSubmitCommercialAssignment
          ? Boolean(effectiveResolutionForm.assignCurrentUserAsOwnerSeller)
          : false,
        suggestedAccount: {
          ...(editForm.suggestedAccount || {}),
          ...(effectiveResolutionForm.accountResolution.mode === "create_new"
            ? effectiveResolutionForm.accountResolution.draft
            : {}),
          selectedAccountId:
            effectiveResolutionForm.accountResolution.mode ===
              "link_existing" &&
            effectiveResolutionForm.accountResolution.accountId
              ? Number(effectiveResolutionForm.accountResolution.accountId)
              : null,
        },
        suggestedContacts: editForm.suggestedContacts.map((contact, index) => {
          const resolution = effectiveResolutionForm.contactResolutions[index];
          if (!resolution) return contact;
          return {
            ...contact,
            selectedContactId:
              resolution.mode === "link_existing" && resolution.contactId
                ? Number(resolution.contactId)
                : null,
          };
        }),
        suggestedOpportunities: editForm.suggestedOpportunities.map(
          (opportunity, index) => {
            const resolution =
              effectiveResolutionForm.opportunityResolutions[index];
            if (!resolution) return opportunity;
            return {
              ...opportunity,
              selectedOpportunityId:
                resolution.mode === "link_existing" && resolution.opportunityId
                  ? Number(resolution.opportunityId)
                  : null,
              selectedSellerUserId:
                canSubmitCommercialAssignment &&
                effectiveResolutionForm.sellerUserId
                  ? Number(effectiveResolutionForm.sellerUserId)
                  : null,
            };
          },
        ),
        contactResolutions: effectiveResolutionForm.contactResolutions.map(
          (item) => ({
            ...item,
            contactId: item.contactId ? Number(item.contactId) : null,
            draft:
              item.mode === "create_new"
                ? {
                    ...item.draft,
                    countryId: item.draft.countryId
                      ? Number(item.draft.countryId)
                      : null,
                  }
                : undefined,
          }),
        ),
        opportunityResolutions:
          effectiveResolutionForm.opportunityResolutions.map((item) => ({
            ...item,
            opportunityId: item.opportunityId
              ? Number(item.opportunityId)
              : null,
            draft:
              item.mode === "create_new"
                ? {
                    ...item.draft,
                    contactId: item.draft.contactId
                      ? Number(item.draft.contactId)
                      : null,
                    amountUsd: item.draft.amountUsd
                      ? Number(item.draft.amountUsd)
                      : null,
                    businessLineId: item.draft.businessLineId
                      ? Number(item.draft.businessLineId)
                      : null,
                    sellerUserId: item.draft.sellerUserId
                      ? Number(item.draft.sellerUserId)
                      : null,
                    presalesUserId: item.draft.presalesUserId
                      ? Number(item.draft.presalesUserId)
                      : null,
                  }
                : undefined,
          })),
        accountResolution: {
          ...effectiveResolutionForm.accountResolution,
          accountId: effectiveResolutionForm.accountResolution.accountId
            ? Number(effectiveResolutionForm.accountResolution.accountId)
            : null,
          draft:
            effectiveResolutionForm.accountResolution.mode === "create_new"
              ? {
                  ...effectiveResolutionForm.accountResolution.draft,
                  countryId: effectiveResolutionForm.accountResolution.draft
                    .countryId
                    ? Number(
                        effectiveResolutionForm.accountResolution.draft
                          .countryId,
                      )
                    : null,
                }
              : undefined,
        },
      };
      const { data } = await api.post(
        `/api/interactions/${detail.id}/resolve`,
        payload,
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      closeDetailModal();
      setSuccess("Lead guardado");
      await loadInteractions();
    } catch (err) {
      const duplicatePayload = err?.response?.data;
      if (
        duplicatePayload &&
        (Array.isArray(duplicatePayload.duplicateWarnings) ||
          duplicatePayload.duplicateReview)
      ) {
        setResolveDuplicateReview({
          code: duplicatePayload.code || null,
          message: String(duplicatePayload.message || "").trim(),
          duplicateWarnings: Array.isArray(duplicatePayload.duplicateWarnings)
            ? duplicatePayload.duplicateWarnings
            : [],
          duplicateReview: duplicatePayload.duplicateReview || null,
          duplicateValidationSource:
            duplicatePayload.duplicateValidationSource || "heuristic",
        });
      }
      setError(getApiErrorMessage(err, "No fue posible guardar el lead"));
    } finally {
      setResolving(false);
    }
  }

  const statusFilterLabel = useMemo(
    () => getLeadStatusFilterButtonLabel(statusFilters),
    [statusFilters],
  );
  const queueFilterLabel = useMemo(
    () => getLeadQueueLabel(queueFilter),
    [queueFilter],
  );
  const allDraftStatusesSelected =
    statusFilterDraft.length === LEAD_STATUS_FILTER_VALUES.length;
  const createIsUploadingFiles = createUploadingFilesCount > 0;
  const dashboardSummary = dashboard?.summary || {
    totalVisible: 0,
    activeTotal: 0,
    unassignedTotal: 0,
    assignedTotal: 0,
    qualifiedTotal: 0,
    disqualifiedTotal: 0,
    opportunityTotal: 0,
    withNextActionTotal: 0,
    overdueTotal: 0,
    noContactTotal: 0,
    stagnantTotal: 0,
  };
  const dashboardStatusMap = useMemo(
    () =>
      new Map(
        (dashboard?.statusCounts || []).map((entry) => [
          entry.code,
          entry.total,
        ]),
      ),
    [dashboard],
  );
  const weeklyCreatedRows = useMemo(
    () =>
      buildFullWeekRange(weeklyFrom, weeklyTo, dashboard?.weeklyCreated || []),
    [weeklyFrom, weeklyTo, dashboard],
  );
  const executiveCards = [
    {
      label: "Leads visibles",
      value: dashboardSummary.totalVisible,
      helper: `Periodo ${LEAD_DASHBOARD_PERIOD_OPTIONS.find((option) => option.value === periodFilter)?.label || "Todo"}`,
      tone: "default",
      onClick: () => applyDashboardDrilldown({ queue: "all" }),
    },
    {
      label: "Activos",
      value: dashboardSummary.activeTotal,
      helper: formatPercent(
        dashboardSummary.activeTotal,
        dashboardSummary.totalVisible,
      ),
      tone: "accent",
      onClick: () =>
        applyDashboardDrilldown({
          statuses: [
            "created",
            "lead_unassigned",
            "lead_assigned",
            "lead_qualified",
          ],
        }),
    },
    {
      label: "Calificados",
      value: dashboardSummary.qualifiedTotal,
      helper: formatPercent(
        dashboardSummary.qualifiedTotal,
        dashboardSummary.totalVisible,
      ),
      tone: "success",
      onClick: () => applyDashboardDrilldown({ statuses: ["lead_qualified"] }),
    },
    {
      label: "Seguimiento vencido",
      value: dashboardSummary.overdueTotal,
      helper: "Próximo paso fuera de fecha",
      tone: "warning",
      onClick: () => applyDashboardDrilldown({ queue: "overdue" }),
    },
  ];
  const managementCards = [
    {
      label: "Total",
      value: dashboardSummary.totalVisible,
      helper: `Periodo ${LEAD_DASHBOARD_PERIOD_OPTIONS.find((option) => option.value === periodFilter)?.label || "Todo"}`,
      tone: "default",
      onClick: () => applyDashboardDrilldown({ queue: "all" }),
    },
    {
      label: "Asignados",
      value: dashboardSummary.assignedTotal,
      helper: formatPercent(
        dashboardSummary.assignedTotal,
        dashboardSummary.totalVisible,
      ),
      tone: "accent",
      onClick: () => applyDashboardDrilldown({ statuses: ["lead_assigned"] }),
    },
    {
      label: "Calificados",
      value: dashboardSummary.qualifiedTotal,
      helper: formatPercent(
        dashboardSummary.qualifiedTotal,
        dashboardSummary.totalVisible,
      ),
      tone: "success",
      onClick: () => applyDashboardDrilldown({ statuses: ["lead_qualified"] }),
    },
    {
      label: "Descalificados",
      value: dashboardSummary.disqualifiedTotal,
      helper: formatPercent(
        dashboardSummary.disqualifiedTotal,
        dashboardSummary.totalVisible,
      ),
      tone: "danger",
      onClick: () =>
        applyDashboardDrilldown({ statuses: ["lead_disqualified"] }),
    },
  ];
  const operationsSubstatusRows = dashboard?.substatusCounts || [];

  function handleOperationsSubstatusRowClick(row) {
    const rowCode = String(row?.code || EMPTY_LEAD_SUBSTATUS_FILTER);
    const rowName = String(row?.name || "Sin situación");
    if (operationsSelectedSubstatusCode === rowCode) {
      setOperationsSelectedSubstatusCode("");
      setOperationsSelectedSubstatusName("");
      setOperationsSituationItems([]);
      setOperationsSituationPage(1);
      setOperationsSituationTotal(0);
      setOperationsSituationError("");
      setOperationsSituationLoading(false);
      return;
    }
    void loadOperationsSituationLeads({
      substatusCode: rowCode,
      substatusName: rowName,
      page: 1,
    });
  }

  function renderDashboardBody() {
    if (dashboardLoading) {
      return <div className="centered">Cargando tablero...</div>;
    }

    if (dashboardError) {
      return (
        <div className="toast toast-error lead-dashboard-inline-toast">
          {dashboardError}
        </div>
      );
    }

    if (!dashboard) {
      return (
        <div className="account-opps-empty">
          Aún no hay métricas disponibles.
        </div>
      );
    }

    if (selectedView === "executive") {
      return (
        <div className="lead-dashboard-stack">
          <div className="lead-dashboard-stat-grid">
            {executiveCards.map((card) => (
              <LeadDashboardStatCard key={card.label} {...card} />
            ))}
          </div>

          <section className="lead-dashboard-panel">
            <div className="lead-dashboard-panel-header">
              <div>
                <h3>Estados actuales de los leads</h3>
                <p>
                  Haz clic sobre cualquier estado para abrir la bandeja
                  filtrada.
                </p>
              </div>
            </div>
            <div className="lead-dashboard-status-grid">
              {LEAD_STATUS_FILTER_OPTIONS.map((status) => (
                <LeadDashboardStatCard
                  key={status.value}
                  label={status.label}
                  value={dashboardStatusMap.get(status.value) || 0}
                  helper="Abrir bandeja"
                  tone={
                    status.value === "lead_qualified"
                      ? "success"
                      : status.value === "lead_disqualified"
                        ? "danger"
                        : "default"
                  }
                  onClick={() =>
                    applyDashboardDrilldown({
                      statuses: [status.value],
                      queue: "all",
                    })
                  }
                />
              ))}
            </div>
          </section>

          <section className="lead-dashboard-panel">
            <div className="lead-dashboard-panel-header">
              <div>
                <h3>Leads creados por semana</h3>
              </div>
              <div className="lead-weekly-date-range">
                <label className="lead-weekly-date-label">
                  Desde
                  <input
                    type="date"
                    className="lead-weekly-date-input"
                    value={weeklyFrom}
                    max={weeklyTo}
                    onChange={(e) => setWeeklyFrom(e.target.value)}
                  />
                </label>
                <label className="lead-weekly-date-label">
                  Hasta
                  <input
                    type="date"
                    className="lead-weekly-date-input"
                    value={weeklyTo}
                    min={weeklyFrom}
                    onChange={(e) => setWeeklyTo(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <LeadWeeklyChart rows={weeklyCreatedRows} />
          </section>

          <section className="lead-dashboard-panel">
            <div className="lead-dashboard-panel-header">
              <div>
                <h3>Desempeño por fuente</h3>
                <p>Conversión visible según los filtros y el periodo actual.</p>
              </div>
            </div>
            <div className="lead-dashboard-table-wrap">
              <table className="lead-dashboard-table">
                <thead>
                  <tr>
                    <th>Fuente</th>
                    <th>Leads</th>
                    <th>Asignados</th>
                    <th>Calificados</th>
                    <th>Descalificados</th>
                    <th>Conversión</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.sourceCounts || []).map((row) => (
                    <tr key={row.code}>
                      <td>
                        <button
                          type="button"
                          className="lead-dashboard-link-btn"
                          onClick={() =>
                            applyDashboardDrilldown({
                              source: row.code,
                              queue: "all",
                            })
                          }
                        >
                          {getLeadSourceLabel(row.code)}
                        </button>
                      </td>
                      <td>{row.total}</td>
                      <td>{row.assignedTotal || 0}</td>
                      <td>{row.qualifiedTotal}</td>
                      <td>{row.disqualifiedTotal || 0}</td>
                      <td>{formatPercent(row.opportunityTotal, row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      );
    }

    if (selectedView === "management") {
      return (
        <div className="lead-dashboard-stack">
          <div className="lead-dashboard-stat-grid">
            {managementCards.map((card) => (
              <LeadDashboardStatCard key={card.label} {...card} />
            ))}
          </div>

          <section className="lead-dashboard-panel">
            <div className="lead-dashboard-panel-header">
              <div>
                <h3>Seguimiento por vendedor</h3>
                <p>
                  Lectura táctica del backlog y la conversión visible por
                  responsable.
                </p>
              </div>
            </div>
            <div className="lead-dashboard-table-wrap">
              <table className="lead-dashboard-table">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Total</th>
                    <th>Asignados</th>
                    <th>Calificados</th>
                    <th>Descalificados</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.sellerRows || []).map((row) => (
                    <tr key={row.sellerUserId || `seller-${row.sellerName}`}>
                      <td>
                        <div className="lead-dashboard-row-title">
                          <strong>{row.sellerName}</strong>
                          <span>{row.sellerEmail || "Sin correo visible"}</span>
                        </div>
                      </td>
                      <td>{row.totalVisible}</td>
                      <td>
                        {row.assignedTotal} (
                        {formatPercent(row.assignedTotal, row.totalVisible)})
                      </td>
                      <td>
                        {row.qualifiedTotal} (
                        {formatPercent(row.qualifiedTotal, row.totalVisible)})
                      </td>
                      <td>
                        {row.disqualifiedTotal || 0} (
                        {formatPercent(
                          row.disqualifiedTotal || 0,
                          row.totalVisible,
                        )}
                        )
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="lead-dashboard-stack">
        <section className="lead-dashboard-panel">
          <div className="lead-dashboard-panel-header">
            <div>
              <h3>Leads por situación</h3>
              <p>Distribución operativa según la situación actual del lead.</p>
            </div>
          </div>
          <div className="lead-dashboard-table-wrap">
            <table className="lead-dashboard-table">
              <thead>
                <tr>
                  <th>Situación del lead</th>
                  <th>Cantidad</th>
                  <th>Participación</th>
                </tr>
              </thead>
              <tbody>
                {operationsSubstatusRows.length ? (
                  operationsSubstatusRows.map((row) => (
                    <tr
                      key={row.code || "sin-situacion"}
                      className={
                        operationsSelectedSubstatusCode ===
                        String(row.code || EMPTY_LEAD_SUBSTATUS_FILTER)
                          ? "lead-dashboard-row-selectable is-selected"
                          : "lead-dashboard-row-selectable"
                      }
                      onClick={() => handleOperationsSubstatusRowClick(row)}
                    >
                      <td>{row.name}</td>
                      <td>{row.total}</td>
                      <td>
                        {formatPercent(
                          row.total,
                          dashboardSummary.totalVisible,
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>
                      No hay situaciones del lead para los filtros actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {operationsSelectedSubstatusCode ? (
          <section className="lead-dashboard-panel">
            <div className="lead-dashboard-panel-header">
              <div>
                <h3>Leads en situación: {operationsSelectedSubstatusName}</h3>
                <p>
                  Listado de leads para la situación seleccionada (
                  {operationsSituationTotal}).
                </p>
              </div>
            </div>

            {operationsSituationError ? (
              <div className="toast toast-error lead-dashboard-inline-toast">
                {operationsSituationError}
              </div>
            ) : null}

            {operationsSituationLoading ? (
              <div className="centered">Cargando leads de la situación...</div>
            ) : operationsSituationItems.length ? (
              <>
                <div className="lead-dashboard-table-wrap">
                  <table className="lead-dashboard-table">
                    <thead>
                      <tr>
                        <th>Lead</th>
                        <th>Cuenta</th>
                        <th>Razón</th>
                        <th>Acción comercial</th>
                        <th>Vendedor</th>
                        <th>Estado</th>
                        <th>Actualizado</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationsSituationItems.map((item) => {
                        const statusMeta = getInteractionStatusMeta(
                          item.analysisStatus,
                        );
                        return (
                          <tr key={item.id}>
                            <td>
                              <div className="lead-dashboard-row-title">
                                <strong>
                                  {normalizeLeadDisplayText(item.title) ||
                                    "Lead sin título"}
                                </strong>
                              </div>
                            </td>
                            <td>{item.accountName || "-"}</td>
                            <td>
                              {item.leadReasonName ||
                                formatLeadOutcomeCode(item.leadReasonCode)}
                            </td>
                            <td>
                              {item.leadRequiredActionName ||
                                formatLeadOutcomeCode(
                                  item.leadRequiredActionCode,
                                )}
                            </td>
                            <td>
                              {item.sellerName || item.sellerEmail || "-"}
                            </td>
                            <td>
                              <span className={statusMeta.className}>
                                {statusMeta.label}
                              </span>
                            </td>
                            <td>
                              {formatDateTime(item.updatedAt || item.createdAt)}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => {
                                  void openDetail(item.id);
                                }}
                              >
                                Abrir lead
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="users-pagination">
                  <div className="users-pagination-left">
                    <span className="users-pagination-info">
                      {operationsSituationTotal
                        ? `${(operationsSituationPage - 1) * OPERATIONS_SITUATION_PAGE_SIZE + 1}-${Math.min(operationsSituationPage * OPERATIONS_SITUATION_PAGE_SIZE, operationsSituationTotal)} de ${operationsSituationTotal}`
                        : "0"}
                    </span>
                  </div>
                  <div className="users-pagination-center">
                    <button
                      type="button"
                      className="users-page-btn"
                      disabled={operationsSituationPage === 1}
                      onClick={() =>
                        void loadOperationsSituationLeads({
                          substatusCode: operationsSelectedSubstatusCode,
                          substatusName: operationsSelectedSubstatusName,
                          page: Math.max(1, operationsSituationPage - 1),
                        })
                      }
                    >
                      ‹
                    </button>
                    <span className="users-pagination-pages">
                      {operationsSituationPage} /{" "}
                      {operationsSituationTotalPages}
                    </span>
                    <button
                      type="button"
                      className="users-page-btn"
                      disabled={
                        operationsSituationPage >= operationsSituationTotalPages
                      }
                      onClick={() =>
                        void loadOperationsSituationLeads({
                          substatusCode: operationsSelectedSubstatusCode,
                          substatusName: operationsSelectedSubstatusName,
                          page: Math.min(
                            operationsSituationTotalPages,
                            operationsSituationPage + 1,
                          ),
                        })
                      }
                    >
                      ›
                    </button>
                  </div>
                  <div className="users-pagination-right" />
                </div>
              </>
            ) : (
              <div className="account-opps-empty lead-dashboard-empty-inline">
                No hay leads para esta situación con los filtros actuales.
              </div>
            )}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <section className="panel">
      <InteractionInfoModal
        message={createInfoMessage}
        onClose={() => setCreateInfoMessage("")}
      />

      <CreateInteractionModal
        isOpen={showCreateModal}
        onClose={resetCreateForm}
        onSubmit={handleCreate}
        creating={creating}
        isUploadingFiles={createIsUploadingFiles}
        setCreateInfoMessage={setCreateInfoMessage}
        leadSource={createLeadSource}
        setLeadSource={setCreateLeadSource}
        files={createFiles}
        setFiles={setCreateFiles}
        onUploadFiles={uploadCreateFilesToSession}
        pastedTextName={createPastedTextName}
        setPastedTextName={setCreatePastedTextName}
        pastedText={createPastedText}
        setPastedText={setCreatePastedText}
      />

      <InteractionDetailModal
        isOpen={showDetailModal}
        onClose={closeDetailModal}
        currentUser={currentUser}
        detail={detail}
        editForm={editForm}
        setEditForm={setEditForm}
        resolutionForm={resolutionForm}
        setResolutionForm={setResolutionForm}
        options={options}
        resolveDuplicateReview={resolveDuplicateReview}
        onDismissResolveDuplicateReview={() => setResolveDuplicateReview(null)}
        saving={saving}
        resolving={resolving}
        reanalyzing={reanalyzing}
        addingDocuments={addingDocuments}
        canUpdate={canUpdate}
        canAddDocuments={Boolean(
          canUpdate && detail && !isFinalizedLeadStatus(detail.analysisStatus),
        )}
        deletingDocumentPublicId={deletingDocumentPublicId}
        downloadingDocumentPublicId={downloadingDocumentPublicId}
        canDeleteDocuments={Boolean(
          canUpdate && detail && !isFinalizedLeadStatus(detail.analysisStatus),
        )}
        onAddDocuments={handleAddDocuments}
        onDeleteDocument={handleDeleteDocument}
        onDownloadDocument={handleDownloadDocument}
        onResolve={openResolveConfirmation}
        onReanalyze={handleReanalyze}
        leadOutcomeCatalogs={leadOutcomeCatalogs}
        onOpenLeadCallOutcomeModal={openLeadCallOutcomeModal}
        canManageLeadCallOutcome={Boolean(
          canUpdate && detail && !isFinalizedLeadStatus(detail.analysisStatus),
        )}
        onOpenLeadEmailModal={handleOpenLeadEmailModal}
        canOpenLeadEmailModal={canOpenLeadEmailModal}
        leadEmailDisabledHint={leadEmailDisabledHint}
        canAnalyze={Boolean(
          canAnalyze &&
          detail &&
          !isDisqualifiedLeadStatus(detail.analysisStatus),
        )}
        canResolve={Boolean(
          canResolve &&
          detail &&
          !isDisqualifiedLeadStatus(detail.analysisStatus),
        )}
      />

      <ResolveInteractionConfirmationModal
        isOpen={showResolveConfirmation}
        onClose={() => setShowResolveConfirmation(false)}
        onConfirm={handleResolve}
        resolving={resolving}
        preview={resolveConfirmationPreview}
      />

      <LeadCallOutcomeModal
        key={`${detail?.id || "lead"}-${showLeadCallOutcomeModal ? "open" : "closed"}`}
        isOpen={showLeadCallOutcomeModal}
        detail={detail}
        catalogs={leadOutcomeCatalogs}
        onClose={closeLeadCallOutcomeModal}
        onSubmit={handleSaveLeadCallOutcome}
        saving={savingLeadOutcome}
      />

      <LeadOperationEmailModal
        isOpen={isLeadEmailModalOpen}
        interactionId={detail?.id}
        draft={leadEmailDraft}
        sending={leadEmailSending}
        generatingAiDraft={leadEmailGeneratingAiDraft}
        generatingAiAttachments={leadEmailGeneratingAiAttachments}
        error={leadEmailError}
        notice={leadEmailNotice}
        libraryError={leadEmailLibraryError}
        googleMailStatus={leadEmailGoogleMailStatus}
        aiInstructionText={leadEmailAiInstructionText}
        aiSuggestionSubject={leadEmailAiSuggestion.subject}
        aiSuggestionMessageBody={leadEmailAiSuggestion.messageBody}
        aiSuggestionSource={leadEmailAiSuggestion.source}
        aiSuggestionSourceReason={leadEmailAiSuggestion.sourceReason}
        libraryQuery={leadEmailLibraryQuery}
        libraryOptions={leadEmailLibraryOptions}
        libraryLoading={leadEmailLoadingLibraryOptions}
        selectedLibraryAttachmentIds={leadEmailSelectedLibraryAttachmentIds}
        maxLibraryAssets={LEAD_EMAIL_MAX_LIBRARY_ASSETS}
        onClose={handleCloseLeadEmailModal}
        onChangeField={handleLeadEmailFieldChange}
        onChangeAiInstruction={handleLeadEmailAiInstructionChange}
        onChangeLibraryQuery={handleLeadEmailLibraryQueryChange}
        onToggleLibraryAttachment={handleToggleLeadLibraryAttachment}
        onAddAttachments={handleAddLeadEmailAttachments}
        onRemoveAttachment={handleRemoveLeadEmailAttachment}
        onRequestAiDraft={handleRequestLeadAiDraft}
        onRequestAiAttachments={handleRequestLeadAiAttachments}
        onUseAiSuggestion={handleUseLeadEmailAiSuggestion}
        onRequestSend={handleRequestSendLeadEmail}
        onConnectGoogleMail={handleConnectLeadEmailGoogleMail}
      />

      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Leads</h2>
            <span
              className="module-title-icon module-title-icon-contacts"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5zm2.5-1a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1zm2.25 3h6.5a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5m0 4h6.5a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5m0 4h4.5a.75.75 0 1 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5" />
              </svg>
            </span>
            <details className="accounts-module-help" ref={helpRef}>
              <summary
                className="accounts-module-help-trigger"
                aria-label="Ayuda sobre el módulo de leads"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="accounts-module-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Este módulo centraliza evidencia documental de leads, extrae
                  contexto comercial y te ayuda a relacionarlo con cuenta,
                  contactos, vendedor y oportunidad.
                </p>
                <strong>Cómo usarlo</strong>
                <p>
                  Carga documentos o notas, revisa las sugerencias del sistema y
                  resuelve cada lead vinculando o creando los registros
                  correctos antes de guardarlo.
                </p>
                <strong>Estados del lead</strong>
                <ul className="accounts-module-help-list">
                  <li>
                    <strong>Creado:</strong> falta cuenta o falta al menos un
                    contacto.
                  </li>
                  <li>
                    <strong>Lead no asignado:</strong> ya hay cuenta y al menos
                    un contacto, pero aún no tiene vendedor asignado.
                  </li>
                  <li>
                    <strong>Lead asignado:</strong> ya hay cuenta, contacto y
                    vendedor, pero aún no tiene oportunidad vinculada o creada.
                  </li>
                  <li>
                    <strong>Lead calificado:</strong> ya tiene cuenta, contacto,
                    vendedor y oportunidad.
                  </li>
                  <li>
                    <strong>Lead descalificado:</strong> se determinó que no es
                    una oportunidad comercial viable.
                  </li>
                </ul>
                <strong>Regla rápida</strong>
                <p>
                  La progresion normal es: Creado → Lead no asignado → Lead
                  asignado → Lead calificado. Un lead también puede terminar
                  como descalificado.
                </p>
              </div>
            </details>
          </div>
          <p className="roles-subtitle">
            Centraliza evidencia documental de leads, extrae contexto comercial
            y resuelve cuenta, contactos y oportunidades.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            + Crear lead
          </button>
        ) : null}
      </div>

      <div
        className="lead-dashboard-tabs"
        role="tablist"
        aria-label="Vistas del módulo de leads"
      >
        {availableViews.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={selectedView === view.id}
            className={
              selectedView === view.id
                ? "lead-dashboard-tab is-active"
                : "lead-dashboard-tab"
            }
            onClick={() => openDashboardView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row interaction-leads-toolbar">
        <div className="interaction-leads-status-filter" ref={statusFilterRef}>
          <button
            type="button"
            className="accounts-search-inline interaction-leads-status-trigger"
            aria-haspopup="dialog"
            aria-expanded={statusFilterMenuOpen}
            onClick={() => {
              if (statusFilterMenuOpen) {
                closeStatusFilterMenu({ restoreDraft: true });
                return;
              }
              openStatusFilterMenu();
            }}
          >
            <span>{statusFilterLabel}</span>
            <span aria-hidden="true">▾</span>
          </button>

          {statusFilterMenuOpen ? (
            <div
              className="interaction-leads-status-menu"
              role="dialog"
              aria-label="Filtrar leads por estado"
            >
              <p className="interaction-leads-status-menu-title">
                Filtrar por estado
              </p>

              <label className="interaction-leads-status-option">
                <input
                  type="checkbox"
                  checked={allDraftStatusesSelected}
                  onChange={() => toggleStatusFilterDraft("all")}
                />
                <span>Todas</span>
              </label>

              {LEAD_STATUS_FILTER_OPTIONS.map((option) => (
                <label
                  className="interaction-leads-status-option"
                  key={option.value}
                >
                  <input
                    type="checkbox"
                    checked={statusFilterDraft.includes(option.value)}
                    onChange={() => toggleStatusFilterDraft(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}

              {!statusFilterDraft.length ? (
                <p className="interaction-leads-status-validation">
                  Selecciona al menos un estado.
                </p>
              ) : null}

              <div className="interaction-leads-status-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setStatusFilterDraft([...LEAD_STATUS_FILTER_VALUES]);
                  }}
                >
                  Seleccionar todas
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={applyStatusFilters}
                  disabled={!statusFilterDraft.length}
                >
                  Aplicar
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="interaction-leads-toolbar-controls">
          <div
            className="lead-dashboard-period-switch"
            role="group"
            aria-label="Periodo del tablero y la bandeja"
          >
            {LEAD_DASHBOARD_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={periodFilter === option.value ? "is-active" : ""}
                onClick={() => {
                  setPage(1);
                  setPeriodFilter(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            className="accounts-search-inline interaction-search-input interaction-leads-search-input"
            type="text"
            placeholder="Buscar por ID, título, cuenta, oportunidad o resumen"
            value={query}
            onChange={(event) => {
              setPage(1);
              setQuery(event.target.value);
            }}
          />
          <select
            className="accounts-search-inline interaction-leads-source-filter"
            value={sourceFilter}
            onChange={(event) => {
              setPage(1);
              setSourceFilter(event.target.value);
            }}
            aria-label="Filtrar leads por tipo de fuente"
          >
            <option value="all">Todas las fuentes</option>
            {LEAD_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {queueFilter !== "all" ? (
        <div className="lead-dashboard-active-filters">
          <span className="interaction-status-pill is-review">
            Cola activa: {queueFilterLabel}
          </span>
          <button
            type="button"
            className="lead-dashboard-clear-filter"
            onClick={() => {
              setPage(1);
              setQueueFilter("all");
            }}
          >
            Limpiar cola
          </button>
        </div>
      ) : null}

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}

      {selectedView !== "inbox" ? (
        renderDashboardBody()
      ) : loading ? (
        <div className="centered">Cargando leads...</div>
      ) : !items.length ? (
        <div className="account-opps-empty">
          {queueFilter !== "all"
            ? "No hay leads en la cola seleccionada con los filtros actuales."
            : "Aún no hay leads registrados."}
        </div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("id")}
                  >
                    ID {getLeadSortIndicator("id")}
                  </button>
                </th>
                <th className="interaction-title-column">
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("title")}
                  >
                    Lead {getLeadSortIndicator("title")}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("accountName")}
                  >
                    Cuenta {getLeadSortIndicator("accountName")}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("primaryOpportunityName")}
                  >
                    Oportunidad {getLeadSortIndicator("primaryOpportunityName")}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("sellerName")}
                  >
                    Vendedor {getLeadSortIndicator("sellerName")}
                  </button>
                </th>
                <th>Contacto</th>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("leadSource")}
                  >
                    Fuente {getLeadSortIndicator("leadSource")}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("documentCount")}
                  >
                    Archivos {getLeadSortIndicator("documentCount")}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("analysisStatus")}
                  >
                    Estado {getLeadSortIndicator("analysisStatus")}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="sort-header-btn"
                    onClick={() => handleLeadSort("createdAt")}
                  >
                    Creada {getLeadSortIndicator("createdAt")}
                  </button>
                </th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const statusMeta = getInteractionStatusMeta(
                  item.analysisStatus,
                );
                const canDeleteInteraction =
                  canUpdate && !isFinalizedLeadStatus(item.analysisStatus);
                return (
                  <tr
                    key={item.id}
                    className="accounts-row-clickable"
                    onClick={() => {
                      void openDetail(item.id);
                    }}
                  >
                    <td title={item.publicId}>{item.id}</td>
                    <td className="interaction-title-column">
                      <div className="interaction-table-title-cell">
                        <strong
                          className="interaction-table-title-text"
                          title={normalizeLeadDisplayText(item.title)}
                        >
                          {normalizeLeadDisplayText(item.title)}
                        </strong>
                      </div>
                    </td>
                    <td>{item.accountName || "-"}</td>
                    <td>{item.primaryOpportunityName || "-"}</td>
                    <td>{item.sellerName || item.sellerEmail || "-"}</td>
                    <td>
                      {Array.isArray(item.contacts) && item.contacts.length > 0
                        ? item.contacts[0].fullName ||
                          item.contacts[0].email ||
                          "-"
                        : "-"}
                    </td>
                    <td>{getLeadSourceLabel(item.leadSource)}</td>
                    <td>{item.documentCount}</td>
                    <td>
                      <div className="interaction-status-stack">
                        <span className={statusMeta.className}>
                          {statusMeta.label}
                        </span>
                        {item.analysisStatus === "created" ? (
                          <span className="interaction-status-pill is-review">
                            Sin analizar
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td
                      className="accounts-actions-cell"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div
                        className="user-kebab-wrap interactions-kebab-wrap"
                        ref={
                          openInteractionMenuId === item.id
                            ? interactionMenuRef
                            : null
                        }
                      >
                        <button
                          type="button"
                          className="kebab-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleInteractionMenu(item.id);
                          }}
                          aria-label="Abrir acciones"
                        >
                          ⋮
                        </button>
                        {openInteractionMenuId === item.id && (
                          <div className="user-kebab-menu">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenInteractionMenuId(null);
                                void openDetail(item.id);
                              }}
                              disabled={
                                loadingDetail ||
                                deletingInteractionId === item.id
                              }
                            >
                              Editar
                            </button>
                            {canDeleteInteraction ? (
                              <button
                                type="button"
                                className="user-kebab-menu-danger"
                                onClick={() => {
                                  void handleDeleteInteraction(item);
                                }}
                                disabled={deletingInteractionId === item.id}
                              >
                                {deletingInteractionId === item.id
                                  ? "Eliminando..."
                                  : "Eliminar lead"}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="users-pagination">
            <div className="users-pagination-left">
              <span className="users-pagination-info">
                {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}{" "}
                de {total}
              </span>
            </div>
            <div className="users-pagination-center">
              <button
                type="button"
                className="users-page-btn"
                disabled={page === 1}
                onClick={() => setPage((currentPage) => currentPage - 1)}
              >
                ‹
              </button>
              <span className="users-pagination-pages">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="users-page-btn"
                disabled={page === totalPages}
                onClick={() => setPage((currentPage) => currentPage + 1)}
              >
                ›
              </button>
            </div>
            <div className="users-pagination-right">
              <span className="users-pagination-label">Por página</span>
              {[10, 20, 30].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={
                    pageSize === size
                      ? "users-perpage-btn is-active"
                      : "users-perpage-btn"
                  }
                  onClick={() => {
                    setPage(1);
                    setPageSize(size);
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default InteractionsPage;
