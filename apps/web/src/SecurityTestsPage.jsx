import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./tools/tools.css";

const POLL_MS = 1000;
const DDOS_CLOUD_DURATION_SECONDS = 120;

const WAF_TEST_GUIDE = [
  {
    id: "test-01-normal-home",
    title: "Pagina principal",
    method: "GET",
    target: "/",
    detail:
      "Envia una solicitud normal a la pagina principal para confirmar que el WAF no bloquea trafico legitimo.",
    expected: "Respuesta exitosa sin alerta WAF.",
    kind: "legit",
    threatLevel: "Ninguna (trafico legitimo)",
  },
  {
    id: "test-public-health",
    title: "Endpoint de salud",
    method: "GET",
    target: "/health",
    detail:
      "Consulta el endpoint publico de salud para confirmar que las rutas de monitoreo no se vean afectadas.",
    expected: "Respuesta HTTP 200.",
    kind: "legit",
    threatLevel: "Ninguna (trafico legitimo)",
  },
  {
    id: "test-02-sensitive-env",
    title: "Archivo de entorno",
    method: "GET",
    target: "/.env",
    detail:
      "Intenta leer el archivo .env, que puede contener credenciales y llaves secretas si quedara expuesto.",
    expected: "HTTP 403 o 404 y nunca contenido sensible.",
    kind: "attack",
    threatLevel: "Alto (fuga de credenciales)",
  },
  {
    id: "test-03-sensitive-git",
    title: "Configuracion Git",
    method: "GET",
    target: "/.git/config",
    detail:
      "Intenta leer la configuracion del repositorio Git, que podria revelar la estructura del codigo fuente.",
    expected: "HTTP 403 o 404 y nunca contenido del repositorio.",
    kind: "attack",
    threatLevel: "Medio (exposicion de codigo fuente)",
  },
  {
    id: "test-05-traversal-path",
    title: "Recorrido de directorios",
    method: "GET",
    target: "Ruta con ../",
    detail:
      "Envia una ruta con '../' para intentar salir del directorio del sitio y leer archivos del servidor.",
    expected: "F5 detecta el ataque.",
    kind: "attack",
    threatLevel: "Alto (acceso a archivos del servidor)",
  },
  {
    id: "test-07-sqli-query",
    title: "Inyeccion SQL",
    method: "GET",
    target: "Parametro search",
    detail:
      "Envia un patron de inyeccion SQL para intentar manipular o extraer datos de la base de datos.",
    expected: "F5 detecta SQL injection.",
    kind: "attack",
    threatLevel: "Alto (robo o corrupcion de datos)",
  },
  {
    id: "test-09-xss-script",
    title: "XSS",
    method: "GET",
    target: "Parametro q",
    detail:
      "Envia una etiqueta <script> para verificar si el sitio ejecutaria codigo malicioso en el navegador de otros usuarios.",
    expected: "F5 detecta cross-site scripting.",
    kind: "attack",
    threatLevel: "Alto (robo de sesion o phishing)",
  },
  {
    id: "test-11-trace",
    title: "Metodo TRACE",
    method: "TRACE",
    target: "/",
    detail:
      "Envia el metodo TRACE, usado en ataques de Cross-Site Tracing para robar cookies o encabezados.",
    expected: "HTTP 405 o evento F5.",
    kind: "attack",
    threatLevel: "Medio (robo de credenciales de sesion)",
  },
  {
    id: "test-12-delete",
    title: "Metodo DELETE",
    method: "DELETE",
    target: "/",
    detail:
      "Envia el metodo DELETE para comprobar que no se pueda borrar contenido desde una ruta publica sin autorizacion.",
    expected: "HTTP 405 o evento F5.",
    kind: "attack",
    threatLevel: "Alto (perdida de datos)",
  },
  {
    id: "test-13-options",
    title: "Politica OPTIONS",
    method: "OPTIONS",
    target: "/",
    detail:
      "Envia una solicitud OPTIONS para revisar la politica de CORS y metodos permitidos configurados.",
    expected: "Respuesta acorde con la configuracion.",
    kind: "neutral",
    threatLevel: "Bajo (configuracion expuesta)",
  },
  {
    id: "test-14-tool-user-agent",
    title: "User-Agent automatizado",
    method: "GET",
    target: "/",
    detail:
      "Envia un User-Agent tipico de herramientas automatizadas para validar si la politica de bots lo detecta.",
    expected: "Resultado acorde con la politica configurada.",
    kind: "neutral",
    threatLevel: "Medio (automatizacion no autorizada)",
  },
];

const RATE_LIMIT_TEST_GUIDE = [
  {
    id: "test-21-rate-limit",
    title: "Límite de frecuencia (120 RPS / 10s)",
    method: "GET",
    target: "/",
    detail:
      "Envía una ráfaga sostenida de 10 segundos con k6 desde una IP única a una tasa de 120 solicitudes por segundo (~1,200 solicitudes) para comprobar si el límite de frecuencia de F5 DCS mitiga la sobrecarga.",
    expected: "HTTP 429 o evento de limitación en F5 DCS.",
    kind: "attack",
    threatLevel: "Medio (agotamiento de recursos o fuerza bruta)",
  },
];

const BOT_DEFENSE_TEST_GUIDE = [
  {
    id: "bot-headed-browser",
    title: "Navegador con interfaz",
    method: "GET",
    target: "/",
    detail:
      "Abre un navegador visible con JavaScript habilitado para representar a un usuario legitimo. F5 DCS debe permitir la navegacion sin generar un evento de seguridad.",
    expected:
      "Navegacion permitida, sin bloqueo y sin evento de seguridad en F5 DCS.",
    kind: "legit",
    threatLevel: "Ninguna (trafico legitimo)",
  },
  {
    id: "bot-headless",
    title: "Navegador headless",
    method: "GET",
    target: "/",
    detail:
      "Simula un navegador headless (sin interfaz grafica), un patron tipico de bots automatizados.",
    expected: "Bot Defense puede marcarlo como sospechoso.",
    kind: "attack",
    threatLevel: "Medio (automatizacion no autorizada)",
  },
  {
    id: "bot-javascript-disabled",
    title: "JavaScript deshabilitado",
    method: "GET",
    target: "/",
    detail:
      "Simula un cliente sin JavaScript, tipico de scripts simples que no ejecutan un navegador completo.",
    expected: "Bot Defense puede marcarlo como sospechoso.",
    kind: "attack",
    threatLevel: "Medio (automatizacion no autorizada)",
  },
];

const TEST_GUIDES = {
  waf: WAF_TEST_GUIDE,
  rate_limit: RATE_LIMIT_TEST_GUIDE,
  bot_defense: BOT_DEFENSE_TEST_GUIDE,
};

const API_F5_STATUS_LABELS = {
  INVENTORIED: "Inventariada",
  DISCOVERED: "Descubierta",
  SHADOW: "Shadow",
  UNKNOWN: "Desconocida",
  NO_DATA: "Sin datos",
  QUERY_ERROR: "Error de consulta",
};

export default function SecurityTestsPage() {
  const [catalog, setCatalog] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [profileKey, setProfileKey] = useState("f5");
  const [testKey, setTestKey] = useState("waf");
  const [wafMode, setWafMode] = useState("blocking");
  const [progressNow, setProgressNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [topologyOpen, setTopologyOpen] = useState(false);
  const [f5Banner, setF5Banner] = useState(null);
  const stepProgressMaxRef = useRef({});

  const activeTestDefinition = catalog.find((item) => item.key === testKey);
  const profiles = activeTestDefinition?.profiles || [];
  const isApiTest = testKey.startsWith("api_get");
  const isApiOwaspTest = testKey === "api_get_owasp";
  const activeGuide = TEST_GUIDES[testKey] || [];
  const analyzedJob = jobs.find((job) => job.scriptKey === testKey) || null;
  const currentTest = analyzedJob?.progress?.currentTest || "";
  const activeTestIndex = activeGuide.findIndex(
    (test) => test.id === currentTest || currentTest.startsWith(`${test.id}-`),
  );
  const ddosStartedAt = Date.parse(
    analyzedJob?.progress?.cloudTest?.startedAt || analyzedJob?.startedAt || "",
  );
  const ddosDurationSeconds = Number(
    analyzedJob?.progress?.cloudTest?.durationSeconds ||
      DDOS_CLOUD_DURATION_SECONDS,
  );
  const ddosElapsedSeconds = Number.isFinite(ddosStartedAt)
    ? Math.max(
        0,
        Math.min(
          ddosDurationSeconds,
          Math.floor((progressNow - ddosStartedAt) / 1000),
        ),
      )
    : 0;
  const ddosProgressPercent = Math.round(
    (ddosElapsedSeconds / ddosDurationSeconds) * 100,
  );

  useEffect(() => {
    if (
      testKey !== "l7_dos" ||
      analyzedJob?.status !== "running" ||
      !Number.isFinite(ddosStartedAt)
    )
      return undefined;
    const timer = setInterval(() => setProgressNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [analyzedJob?.id, analyzedJob?.status, ddosStartedAt, testKey]);

  // La consulta a F5 suele resolverse en el primer intento (menos de un ciclo de polling),
  // asi que este banner se mantiene visible un minimo de tiempo para que sea perceptible.
  useEffect(() => {
    const jobId = analyzedJob?.id;
    const correlation = analyzedJob?.progress?.f5Correlation;
    const jobActive = ["pending", "running"].includes(analyzedJob?.status);
    if (!jobActive) {
      setF5Banner(null);
      return undefined;
    }
    if (correlation?.active) {
      setF5Banner({
        jobId,
        attempt: correlation.attempt,
        total: correlation.total,
      });
      return undefined;
    }
    const timer = setTimeout(() => {
      setF5Banner((current) => (current?.jobId === jobId ? null : current));
    }, 2500);
    return () => clearTimeout(timer);
  }, [
    analyzedJob?.id,
    analyzedJob?.status,
    analyzedJob?.progress?.f5Correlation?.active,
    analyzedJob?.progress?.f5Correlation?.attempt,
  ]);
  const analysisTotal = activeGuide.length;
  const analysisCompleted = analyzedJob
    ? analyzedJob.status === "completed"
      ? analysisTotal
      : Math.min(
          analysisTotal,
          Math.max(
            Number(analyzedJob.progress?.completed || 0),
            activeTestIndex >= 0 ? activeTestIndex + 1 : 0,
          ),
        )
    : 0;
  const analysisPercent = analysisTotal
    ? Math.round((analysisCompleted / analysisTotal) * 100)
    : 0;
  const apiRows = isApiTest
    ? isApiOwaspTest
      ? analyzedJob?.result?.rows || []
      : (analyzedJob?.result?.rows || []).filter(
          (row) => row.resultado === "PASS",
        )
    : [];
  const apiTotal = Number(
    analyzedJob?.progress?.total || analyzedJob?.result?.total || 0,
  );
  const apiCompleted = Math.min(
    apiTotal,
    Number(analyzedJob?.progress?.completed || 0),
  );
  const apiPercent = apiTotal ? Math.round((apiCompleted / apiTotal) * 100) : 0;
  const apiPassed = apiRows.filter((row) => row.resultado === "PASS").length;
  const apiF5Counts = apiRows.reduce((counts, row) => {
    const status = row.estado_f5 || "UNKNOWN";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  function getTestSlug(id) {
    return String(id || "").replace(/^(test|bot|dos)-(\d+-)?/, "");
  }

  function getResultClassName(label) {
    const normalized = String(label || "").toUpperCase();
    if (
      normalized.includes("RIESGO") ||
      normalized.includes("FALSO POSITIVO") ||
      normalized.includes("ERROR")
    )
      return "error";
    if (normalized.includes("REVISAR")) return "review";
    if (
      normalized.includes("BLOQUE") ||
      normalized.includes("PERMIT") ||
      normalized.includes("CORRECTO")
    )
      return "completed";
    return "pending";
  }

  // Traduce el resultado crudo (PASÓ/FALLÓ/REVISAR/REVIEW_F5/...) a un mensaje explícito
  // según si el caso espera que el tráfico se bloquee (ataque) o se permita (legítimo).
  function getExplicitResultLabel(kind, rawResult) {
    const normalized = String(rawResult || "").toUpperCase();
    if (normalized.includes("PASS_NO_EVENT")) return "Sin evento (correcto)";
    if (normalized.includes("PASS_NO_MITIGATION"))
      return "Sin mitigacion (correcto)";
    if (normalized.includes("PASS_RECOVERED"))
      return "Servicio recuperado (correcto)";
    if (normalized.includes("FAIL_EARLY_BLOCK"))
      return "Mitigacion anticipada (riesgo)";
    if (normalized.includes("FAIL_ORIGIN_DEGRADED"))
      return "Servicio degradado (riesgo)";
    if (normalized.includes("FAIL_NOT_BLOCKED"))
      return "Detectado sin bloqueo (riesgo)";
    if (normalized.includes("FAIL_UNEXPECTED_EVENT"))
      return "Evento inesperado (falso positivo)";
    if (normalized.includes("PASS_BLOCKED"))
      return "Detectado y bloqueado (correcto)";
    if (normalized.includes("DETECTED_ALLOWED")) return "Detectado y permitido";
    if (normalized.includes("FAIL_NO_EVENT")) return "No detectado (riesgo)";
    if (normalized.includes("ERROR_F5")) return "Error al consultar F5";
    if (
      normalized.includes("REVISAR") ||
      normalized.includes("INCONCLUSIVE") ||
      normalized.includes("REVIEW")
    )
      return "Revisar en F5 DCS";
    if (normalized.includes("NO EJECUTADA") || normalized.includes("NOT_RUN"))
      return "No ejecutada";
    if (normalized.includes("ERROR")) return "Error en la prueba";
    if (kind === "attack") {
      if (normalized.includes("PAS")) return "Bloqueado (correcto)";
      if (normalized.includes("FALL")) return "No bloqueado (riesgo)";
    } else if (kind === "legit") {
      if (normalized.includes("PAS")) return "Permitido (correcto)";
      if (normalized.includes("FALL")) return "Bloqueado (falso positivo)";
    }
    return rawResult || "Completado";
  }

  function getBotResponseSummary(rawDetail) {
    const values = Object.fromEntries(
      String(rawDetail || "")
        .split(";")
        .map((segment) => segment.trim().split("="))
        .filter((pair) => pair.length === 2),
    );
    if (!("headless" in values) || !("js" in values)) return rawDetail;
    const browser =
      values.headless === "false"
        ? "Navegador visible"
        : "Navegador automatizado sin interfaz";
    const javascript =
      values.js === "true"
        ? "con JavaScript habilitado"
        : "con JavaScript deshabilitado";
    const resources = values.responses
      ? ` Cargó ${values.responses} ${values.responses === "1" ? "recurso" : "recursos"}.`
      : "";
    const protectedStatus = values.protected_endpoint_status;
    const endpoint =
      protectedStatus === "200"
        ? " Alcanzó el endpoint protegido e inició sesión correctamente con el usuario de prueba."
        : protectedStatus === "401"
          ? " Alcanzó el endpoint protegido, pero F5 o la aplicación rechazaron las credenciales del usuario de prueba."
          : protectedStatus
            ? ` El endpoint protegido respondió HTTP ${protectedStatus}.`
            : "";
    return `${browser} ${javascript}.${resources}${endpoint}`;
  }

  // Algunos casos (ej. rate limiting) generan varias filas sufijadas
  // (test-21-rate-limit-1, -2, ...); se agregan a un solo resultado representativo.
  function findResultRow(rows, testId) {
    if (!rows) return undefined;
    const exact = rows.find(
      (row) => row.prueba === testId || row.test_id === testId,
    );
    if (exact) return exact;
    const group = rows.filter((row) => {
      const rowId = row.prueba || row.test_id || "";
      return rowId.startsWith(`${testId}-`);
    });
    if (!group.length) return undefined;
    const normalized = (row) =>
      String(row.resultado || row.result || "").toUpperCase();
    return (
      group.find((row) => normalized(row).includes("PAS")) ||
      group[group.length - 1]
    );
  }

  // Recorre el historial de jobs (mas reciente primero) y devuelve el ultimo
  // resultado disponible para un caso, sin importar en que job se haya generado.
  function findLatestJobForTest(jobsList, testId) {
    for (const job of jobsList || []) {
      const resultRow = findResultRow(job?.result?.rows, testId);
      if (resultRow) return { job, resultRow };
    }
    return null;
  }

  // Un job que corrio un solo caso (testId) solo debe afectar el estado de ESE caso;
  // los demas conservan su ultimo resultado conocido del historial.
  function resolveTestResult(test) {
    const isTargetOfCurrentJob = Boolean(
      analyzedJob &&
      (!analyzedJob.options?.testId || analyzedJob.options.testId === test.id),
    );
    // Mientras el job actual sigue corriendo y apunta a este caso, no se debe
    // consultar el historial: hay que reflejar el estado en vivo (pendiente/ejecutando),
    // no la ultima fila de una ejecucion anterior.
    const jobInProgress =
      isTargetOfCurrentJob &&
      ["pending", "running"].includes(analyzedJob?.status);
    const currentJobRow = isTargetOfCurrentJob
      ? findResultRow(analyzedJob?.result?.rows, test.id)
      : undefined;
    const historical = currentJobRow
      ? { job: analyzedJob, resultRow: currentJobRow }
      : jobInProgress
        ? null
        : findLatestJobForTest(
            jobs.filter((job) => job.scriptKey === testKey),
            test.id,
          );
    return {
      isTargetOfCurrentJob,
      resultRow: historical?.resultRow,
      sourceJob: historical?.job || analyzedJob,
    };
  }

  // Avance propio de un caso con varios pasos (ej. limite de frecuencia:
  // test-21-rate-limit-1, -2, ...), independiente del avance general del job.
  // El stdout puede llegar fragmentado (ej. "test-21-rate-limit-" sin el numero),
  // asi que nunca se permite que el conteo mostrado retroceda para el mismo job.
  function getStepProgress(test) {
    if (test.id !== "test-21-rate-limit") return null;
    const total = Number(analyzedJob?.options?.stepsTotal || 0);
    if (!total) return null;
    const isTargetOfCurrentJob =
      !analyzedJob?.options?.testId || analyzedJob.options.testId === test.id;
    if (
      !isTargetOfCurrentJob ||
      !["pending", "running"].includes(analyzedJob?.status)
    )
      return null;
    const jobId = analyzedJob?.id;
    // La consulta a F5 solo arranca cuando el loop de solicitudes ya termino por completo
    // (es secuencial en el script), asi que su sola presencia garantiza el 100% del conteo.
    if (analyzedJob?.progress?.f5Correlation) {
      stepProgressMaxRef.current[jobId] = total;
      return { current: total, total, percent: 100 };
    }
    const currentTestId = analyzedJob?.progress?.currentTest || "";
    const match = currentTestId.startsWith(`${test.id}-`)
      ? currentTestId.slice(test.id.length + 1)
      : "";
    const rawCurrent = Math.min(total, Math.max(0, Number(match) || 0));
    const previousMax = stepProgressMaxRef.current[jobId] || 0;
    const current = Math.max(rawCurrent, previousMax);
    stepProgressMaxRef.current[jobId] = current;
    return { current, total, percent: Math.round((current / total) * 100) };
  }

  // Barra de F5 DCS a nivel de job completo (para la tarjeta "Avance" general).
  function getJobF5Progress(job) {
    if (!job) return null;
    if (job.profileKey !== "f5") {
      return { percent: 0, disabled: true, label: "No aplica (perfil sin F5)" };
    }
    const correlation = job.progress?.f5Correlation;
    if (correlation?.active) {
      return {
        indeterminate: true,
        percent: 60,
        label: `Consultando F5 DCS (intento ${correlation.attempt} de ${correlation.total})`,
      };
    }
    if (job.status === "completed" || correlation) {
      return { percent: 100, label: "Consulta a F5 DCS finalizada" };
    }
    return { percent: 0, label: "Pendiente" };
  }

  // Avance de cada fila: dos barras independientes.
  // 1) Solicitud/respuesta HTTP. 2) Consulta de correlacion con F5 DCS (si el perfil la usa).
  function getRowProgress(test, state) {
    const stepProgress = getStepProgress(test);
    const requestBar = stepProgress
      ? {
          percent: stepProgress.percent,
          label: `Solicitud ${stepProgress.current} de ${stepProgress.total}`,
        }
      : state.className === "pending"
        ? { percent: 0, label: "Sin iniciar" }
        : state.className === "running" && !state.waitingForF5
          ? { indeterminate: true, percent: 40, label: "Enviando solicitud..." }
          : { percent: 100, label: "Solicitud enviada y respondida" };

    const profileKeyForRow = state.job?.profileKey || profileKey;
    const f5Applicable = profileKeyForRow === "f5";
    let f5Bar;
    if (!f5Applicable) {
      f5Bar = {
        percent: 0,
        disabled: true,
        label: "No aplica (perfil sin F5)",
      };
    } else if (state.waitingForF5) {
      f5Bar = {
        indeterminate: true,
        percent: 60,
        label: `Consultando F5 DCS (intento ${state.waitingForF5.attempt} de ${state.waitingForF5.total})`,
      };
    } else if (state.resultRow) {
      const evento = String(state.resultRow.evento_f5 || "");
      f5Bar = {
        percent: 100,
        label:
          evento === "Sí"
            ? "Evento F5 correlacionado"
            : evento === "Error al consultar"
              ? "Error al consultar F5"
              : "Sin evento F5 correlacionado",
      };
    } else {
      f5Bar = { percent: 0, label: "Pendiente" };
    }
    return { requestBar, f5Bar };
  }

  function getAnalysisState(test, index) {
    const { isTargetOfCurrentJob, resultRow, sourceJob } =
      resolveTestResult(test);
    if (resultRow) {
      const responseDetail = String(resultRow.detalle_respuesta || "");
      const f5Detail = String(resultRow.detalle_f5 || "");
      const responseRejected =
        responseDetail.includes("response_f5_rejected") ||
        /request rejected|the requested url was rejected/i.test(
          `${responseDetail} ${f5Detail}`,
        );
      const sensitiveContent = responseDetail.includes(
        "sensitive_content_detected",
      );
      const rawResult = responseRejected
        ? sensitiveContent
          ? "FALLÓ"
          : "PASÓ"
        : resultRow.resultado || resultRow.result || "Completado";
      const resultLabel = getExplicitResultLabel(test.kind, rawResult);
      return {
        label: resultLabel,
        className: getResultClassName(resultLabel),
        detail:
          resultRow.que_ocurrio || resultRow.details || "Resultado disponible",
        reason:
          responseRejected && !sensitiveContent
            ? "La respuesta contiene Request Rejected; F5 bloqueo la solicitud aunque devolviera HTTP 200."
            : testKey === "bot_defense"
              ? getBotResponseSummary(resultRow.details)
              : resultRow.que_ocurrio ||
                resultRow.details ||
                "El reporte contiene un resultado para este caso.",
        job: sourceJob,
        resultRow,
      };
    }
    if (
      isTargetOfCurrentJob &&
      ["pending", "running"].includes(analyzedJob?.status)
    ) {
      const correlation = analyzedJob.progress?.f5Correlation;
      if (correlation?.active) {
        return {
          label: "Esperando F5 DCS",
          className: "running",
          detail: "Solicitud enviada; esperando confirmación de F5",
          reason: `Solicitud enviada y respondida; esperando la correlación con F5 DCS (intento ${correlation.attempt} de ${correlation.total}).`,
          job: sourceJob,
          waitingForF5: correlation,
        };
      }
      const isSingleTestJob = Boolean(analyzedJob.options?.testId);
      const isCurrentRow = isSingleTestJob || index === activeTestIndex;
      if (isCurrentRow) {
        return {
          label: "En ejecución",
          className: "running",
          detail: "Procesando este caso",
          reason:
            "La solicitud de este caso se está procesando en el servidor.",
          job: sourceJob,
        };
      }
      if (activeTestIndex > index) {
        return {
          label: "Completado",
          className: "completed",
          detail: "Caso procesado",
          reason: "El servidor ya avanzó al siguiente caso.",
          job: sourceJob,
        };
      }
      return {
        label: "Pendiente",
        className: "pending",
        detail: "Esperando ejecución",
        reason: "Este caso todavía no ha sido procesado.",
        job: sourceJob,
      };
    }
    if (isTargetOfCurrentJob && analyzedJob?.status === "completed") {
      return {
        label: "No reportado",
        className: "pending",
        detail: "No aparece en el reporte generado",
        reason: "La ejecución terminó sin incluir una fila para este caso.",
        job: sourceJob,
      };
    }
    if (
      isTargetOfCurrentJob &&
      (analyzedJob?.status === "failed" || analyzedJob?.status === "timeout")
    ) {
      return {
        label: "No ejecutado",
        className: "pending",
        detail: "La ejecución terminó antes de llegar a este caso",
        reason:
          String(analyzedJob.stderr || "")
            .trim()
            .split("\n")
            .at(-1) ||
          analyzedJob.error?.message ||
          "La ejecución no pudo completar todos los casos.",
        job: sourceJob,
      };
    }
    if (isTargetOfCurrentJob && analyzedJob?.status === "cancelled") {
      return {
        label: "Cancelado",
        className: "pending",
        detail: "La ejecución se canceló antes de llegar a este caso",
        reason:
          "El usuario canceló la ejecución antes de que se procesara este caso.",
        job: sourceJob,
      };
    }
    return {
      label: "Pendiente",
      className: "pending",
      detail: "Esperando ejecución",
      reason: "Este caso todavía no ha sido procesado.",
      job: sourceJob,
    };
  }

  function getF5Message(resultRow) {
    if (resultRow?.detalle_f5) return resultRow.detalle_f5;
    if (resultRow?.evento_f5 === "No") {
      return `No se encontró un evento F5 correlacionado. Resultado: ${resultRow.resultado || "sin clasificar"}.`;
    }
    return "No hay mensaje de F5 disponible para este caso.";
  }

  function getResponseDetail(resultRow) {
    if (resultRow?.detalle_respuesta) return resultRow.detalle_respuesta;
    if (resultRow) {
      return `HTTP ${resultRow.http || resultRow.http_status || "desconocido"}; ${resultRow.que_ocurrio || resultRow.details || "sin explicación adicional"}.`;
    }
    return "La prueba todavía no genera una respuesta.";
  }

  // Best-effort recovery for JSON messages cut mid-structure (server-side length limits).
  function repairTruncatedJson(rawMessage) {
    if (typeof rawMessage !== "string") return null;
    const stack = [];
    let inString = false;
    let escaped = false;
    let lastSafeIndex = -1;
    let lastSafeStack = null;
    for (let index = 0; index < rawMessage.length; index += 1) {
      const char = rawMessage[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
      else if (char === "}" || char === "]") stack.pop();
      if (char === "," || char === "{" || char === "[") {
        lastSafeIndex = index;
        lastSafeStack = stack.slice();
      }
    }
    if (!lastSafeStack || !lastSafeStack.length) return null;
    const truncated = `${rawMessage.slice(0, lastSafeIndex + 1).replace(/,$/, "")}${lastSafeStack.slice().reverse().join("")}`;
    try {
      return JSON.parse(truncated);
    } catch {
      return null;
    }
  }

  function parseF5Message(rawMessage) {
    let parsed;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      parsed = repairTruncatedJson(rawMessage);
    }
    if (!parsed || typeof parsed !== "object") return null;
    const signatures = Array.isArray(parsed.signatures)
      ? parsed.signatures
      : [];
    const summaryFields = [
      { label: "País", value: parsed.country },
      { label: "Aplicación", value: parsed.app_type },
      { label: "Cliente", value: parsed.browser_type },
      { label: "Dispositivo", value: parsed.device_type },
      { label: "Riesgo de solicitud", value: parsed.req_risk },
    ].filter((field) => field.value != null && field.value !== "");
    return { summaryFields, signatures, requestId: parsed.req_id };
  }

  function parseF5RejectionMessage(rawMessage) {
    if (typeof rawMessage !== "string" || !/request rejected/i.test(rawMessage))
      return null;
    const supportIdMatch = rawMessage.match(/support id is ([a-z0-9-]+)/i);
    const notesMatch = rawMessage
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const [firstSegment, ...restSegments] = notesMatch;
    const reason = (firstSegment || rawMessage)
      .replace(/^Respuesta de F5:\s*/i, "")
      .replace(/\s*your support id is [a-z0-9-]+/i, "")
      .replace(/\[go back\]/i, "")
      .trim();
    return {
      reason: reason || "La solicitud fue rechazada por F5.",
      supportId: supportIdMatch ? supportIdMatch[1] : "",
      notes: restSegments,
    };
  }

  function renderF5Message(resultRow) {
    const raw = getF5Message(resultRow);
    const structured = parseF5Message(raw);
    if (structured) {
      return (
        <div className="tools-security-f5-detail">
          {structured.summaryFields.length ? (
            <dl className="tools-security-kv-list">
              {structured.summaryFields.map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {structured.signatures.length ? (
            <ul className="tools-security-signature-list">
              {structured.signatures.map((signature, index) => (
                <li key={`${signature.id || index}`}>
                  <strong>
                    {signature.name ||
                      signature.attack_type ||
                      "Firma sin nombre"}
                  </strong>
                  <span>
                    {[
                      signature.attack_type,
                      signature.risk && `Riesgo: ${signature.risk}`,
                      signature.accuracy && `Precisión: ${signature.accuracy}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {signature.matching_info ? (
                    <small>{signature.matching_info}</small>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    const rejection = parseF5RejectionMessage(raw);
    if (rejection) {
      return (
        <div className="tools-security-f5-detail">
          <p className="tools-security-f5-reason">{rejection.reason}</p>
          {rejection.supportId ? (
            <dl className="tools-security-kv-list">
              <div>
                <dt>Support ID</dt>
                <dd>{rejection.supportId}</dd>
              </div>
            </dl>
          ) : null}
          {rejection.notes.length ? (
            <ul className="tools-security-note-list">
              {rejection.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    return <pre>{raw}</pre>;
  }

  function parseResponseDetail(rawDetail) {
    if (!rawDetail) return null;
    const segments = rawDetail
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const pairs = [];
    const notes = [];
    for (const segment of segments) {
      const separatorIndex = segment.indexOf("=");
      if (separatorIndex > 0) {
        const rawKey = segment.slice(0, separatorIndex);
        const rawValue = segment.slice(separatorIndex + 1).replace(/\.$/, "");
        const labels = {
          js: "JavaScript habilitado",
          headless: "Navegador sin interfaz",
          responses: "Recursos cargados",
          javascript_disabled: "JavaScript deshabilitado",
          protected_endpoint_status: "Respuesta del endpoint protegido",
          test_user_login: "Acceso del usuario de prueba",
        };
        const value = ["js", "headless", "javascript_disabled"].includes(rawKey)
          ? rawValue === "true"
            ? "Sí"
            : "No"
          : rawKey === "protected_endpoint_status" && rawValue === "200"
            ? "200 - Inicio de sesión correcto"
            : rawKey === "test_user_login"
              ? rawValue === "authenticated"
                ? "Correcto"
                : "Rechazado"
              : rawValue;
        pairs.push({ key: labels[rawKey] || rawKey, value });
      } else {
        notes.push(segment);
      }
    }
    if (!pairs.length && !notes.length) return null;
    return { pairs, notes };
  }

  function renderResponseDetail(resultRow) {
    const raw = getResponseDetail(resultRow);
    const structured = parseResponseDetail(raw);
    if (!structured) return <pre>{raw}</pre>;
    return (
      <div className="tools-security-response-detail">
        {structured.pairs.length ? (
          <dl className="tools-security-kv-list">
            {structured.pairs.map((pair, index) => (
              <div key={`${pair.key}-${index}`}>
                <dt>{pair.key}</dt>
                <dd>{pair.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {structured.notes.length ? (
          <ul className="tools-security-note-list">
            {structured.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  async function load() {
    const [catalogResponse, jobsResponse] = await Promise.all([
      api.get("/api/tools/security-tests/catalog"),
      api.get("/api/tools/security-tests/jobs"),
    ]);
    setCatalog(catalogResponse.data?.items || []);
    setJobs(jobsResponse.data?.items || []);
  }

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      load()
        .catch((loadError) => {
          if (active)
            setError(
              getApiErrorMessage(
                loadError,
                "No fue posible cargar las pruebas",
              ),
            );
        })
        .finally(() => active && setLoading(false));
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => ["pending", "running"].includes(job.status)))
      return undefined;
    const timer = setInterval(() => {
      load().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobs]);

  function selectTest(nextTestKey) {
    const item = catalog.find((entry) => entry.key === nextTestKey);
    const list = item?.profiles || [];
    if (list.length && !list.some((profile) => profile.key === profileKey)) {
      setProfileKey(list[0].key);
    }
    setTestKey(nextTestKey);
  }

  async function execute(testId) {
    setRunning(true);
    setError("");
    try {
      await api.post("/api/tools/security-tests/jobs", {
        scriptKey: testKey,
        profileKey,
        wafMode,
        ...(testId ? { testId } : {}),
      });
      await load();
    } catch (executeError) {
      setError(
        getApiErrorMessage(executeError, "No fue posible iniciar la prueba"),
      );
    } finally {
      setRunning(false);
    }
  }

  async function cancelActiveJob() {
    if (!analyzedJob) return;
    setCancelling(true);
    setError("");
    try {
      await api.post(`/api/tools/security-tests/jobs/${analyzedJob.id}/cancel`);
      await load();
    } catch (cancelError) {
      setError(
        getApiErrorMessage(cancelError, "No fue posible cancelar la ejecución"),
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="panel tools-page tools-security-tests-page">
      <header className="tools-page-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Pruebas de seguridad</h2>
          </div>
          <p className="roles-subtitle tools-page-subtitle">
            Ejecuta perfiles controlados para validar el WAF y revisar sus
            resultados.
          </p>
          <p className="field-hint">
            <Link to="/tools">Herramientas</Link> / Pruebas de seguridad
          </p>
        </div>
      </header>

      {error ? <div className="toast toast-error">{error}</div> : null}

      <article
        className={`tools-security-launch-card${testKey === "l7_dos" ? " is-ddos" : ""}`}
      >
        <div
          className="tools-security-test-options"
          role="list"
          aria-label="Tipos de pruebas"
        >
          <button
            type="button"
            className={`tools-security-test-option ${testKey === "waf" ? "is-selected" : ""}`}
            onClick={() => selectTest("waf")}
          >
            <strong>WAF</strong>
            <span>Disponible</span>
            <small>
              Valida ataques, rutas sensibles y respuestas del perímetro.
            </small>
          </button>
          <button
            type="button"
            className={`tools-security-test-option ${testKey === "bot_defense" ? "is-selected" : ""}`}
            onClick={() => selectTest("bot_defense")}
          >
            <strong>Bot Defense</strong>
            <span>Disponible</span>
            <small>
              Valida perfiles de navegación con y sin JavaScript, y navegadores
              headless, ante F5 DCS.
            </small>
          </button>
          <button
            type="button"
            className={`tools-security-test-option ${testKey === "rate_limit" ? "is-selected" : ""}`}
            onClick={() => selectTest("rate_limit")}
          >
            <strong>Rate limit</strong>
            <span>Disponible</span>
            <small>
              Ejecuta una ráfaga a 120 RPS con k6 para validar umbrales de limitación de frecuencia.
            </small>
          </button>
          <button
            type="button"
            className={`tools-security-test-option ${testKey === "l7_dos" ? "is-selected" : ""}`}
            onClick={() => selectTest("l7_dos")}
          >
            <strong>DDoS L7</strong>
            <span>Disponible</span>
            <small>
              Valida carga L7 distribuida, la mitigacion y la recuperacion ante
              F5 DCS.
            </small>
          </button>
          <button
            type="button"
            className={`tools-security-test-option ${testKey === "api_get_outside_inventory" ? "is-selected" : ""}`}
            onClick={() => selectTest("api_get_outside_inventory")}
          >
            <strong>APIs fuera del inventario</strong>
            <span>Disponible</span>
            <small>
              Ejecuta los GET de cuentas, contactos y oportunidades que no están
              declarados en el inventario F5.
            </small>
          </button>
          <button
            type="button"
            className={`tools-security-test-option ${testKey === "api_get_inventory" ? "is-selected" : ""}`}
            onClick={() => selectTest("api_get_inventory")}
          >
            <strong>APIs dentro del inventario</strong>
            <span>Disponible</span>
            <small>
              Ejecuta únicamente los GET declarados en swagger-pruebas.json.
            </small>
          </button>
          <button
            type="button"
            className={`tools-security-test-option ${testKey === "api_get_owasp" ? "is-selected" : ""}`}
            onClick={() => selectTest("api_get_owasp")}
          >
            <strong>APIs OWASP</strong>
            <span>Disponible</span>
            <small>
              Ejecuta amenazas OWASP (SQLi, XSS, Traversal, RCE, SSRF) sobre los GET inventariados.
            </small>
          </button>
          <button
            type="button"
            className="tools-security-test-option tools-security-topology-option"
            onClick={() => setTopologyOpen(true)}
            aria-haspopup="dialog"
          >
            <strong>Topología de prueba</strong>
            <span>Ver diagrama</span>
            <small>
              Muestra el recorrido del tráfico desde Internet hasta AWS a través
              de F5 DCS.
            </small>
          </button>
        </div>
        <div className="tools-security-launch-controls">
          <div className="tools-security-launch-fields">
            <label className="tools-filter-field">
              <span>Perfil</span>
              <select
                value={profileKey}
                onChange={(event) => setProfileKey(event.target.value)}
                disabled={running || loading}
              >
                {profiles.map((profile) => (
                  <option
                    key={profile.key}
                    value={profile.key}
                    disabled={!profile.configured}
                  >
                    {profile.title}
                    {!profile.configured ? " (configuracion incompleta)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {testKey === "waf" || testKey === "rate_limit" || testKey === "api_get_owasp" ? (
              <label className="tools-filter-field">
                <span>Modo WAF</span>
                <select
                  value={wafMode}
                  onChange={(event) => setWafMode(event.target.value)}
                  disabled={running || loading}
                >
                  <option value="monitoring">Monitoreo</option>
                  <option value="blocking">Bloqueo</option>
                </select>
              </label>
            ) : null}
          </div>
          <button
            className="btn-primary"
            type="button"
            onClick={() => execute()}
            disabled={
              running ||
              loading ||
              !profiles.some(
                (profile) => profile.key === profileKey && profile.configured,
              )
            }
          >
            {running
              ? "Ejecutando..."
              : testKey === "l7_dos"
                ? "Ejecutar prueba DDoS L7"
                : testKey === "rate_limit"
                  ? "Ejecutar prueba Rate limit"
                  : isApiTest
                    ? "Ejecutar pruebas de APIs"
                    : "Ejecutar todas las pruebas"}
          </button>
          {["pending", "running"].includes(analyzedJob?.status) ? (
            <button
              className="btn-secondary"
              type="button"
              onClick={cancelActiveJob}
              disabled={cancelling}
            >
              {cancelling ? "Cancelando..." : "Cancelar"}
            </button>
          ) : null}
        </div>
        {testKey === "l7_dos" ? (
          <div className="tools-security-ddos-explanation">
            <div>
              <strong>Prueba distribuida con k6 Cloud</strong>
              <p>
                Durante dos minutos, k6 Cloud envía tráfico HTTPS coordinado
                desde seis regiones hacia el endpoint controlado. El perfil
                incrementa la carga hasta 150 RPS, verifica la respuesta de F5
                DCS y termina con una comprobación de recuperación del servicio.
              </p>
            </div>
            <div>
              <strong>Países de origen</strong>
              <p>
                Estados Unidos, Brasil, Alemania, Reino Unido, Sudáfrica y
                Japón.
              </p>
            </div>
          </div>
        ) : testKey === "rate_limit" ? (
          <div className="tools-security-ddos-explanation">
            <div>
              <strong>Ráfaga con k6 (IP única)</strong>
              <p>
                k6 envía una ráfaga sostenida de 120 solicitudes por
                segundo durante 10 segundos (~1,200 solicitudes) desde una
                única dirección IP de origen para saturar el umbral de limitación
                de 80 RPS configurado en F5 DCS.
              </p>
            </div>
            <div>
              <strong>Origen</strong>
              <p>
                Dirección IP única de la máquina local / VM.
              </p>
            </div>
          </div>
        ) : null}
      </article>

      <section className="tools-security-analysis">
        <div className="tools-card-heading tools-security-analysis-heading">
          <div>
            <h3>
              {testKey === "l7_dos"
                ? "Ejecución k6 Cloud"
                : isApiTest
                  ? "Operaciones GET"
                  : "Lista de pruebas"}
            </h3>
            {!analyzedJob ? (
              <p>
                {testKey === "l7_dos"
                  ? "El avance de la ejecución Cloud aparecerá al iniciar la prueba."
                  : isApiTest
                    ? "Se probarán únicamente las operaciones GET ejecutables sin parámetros de ruta."
                    : "El avance de los casos aparecerá al iniciar una prueba."}
              </p>
            ) : null}
          </div>
          {analyzedJob ? (
            <div className="tools-security-analysis-execution">
              <div className="tools-security-execution-columns">
                <div className="tools-security-execution-column">
                  {testKey === "l7_dos" ? (
                    <>
                      <div className="tools-security-analysis-execution-label">
                        <strong>k6 Cloud</strong>
                        <span>
                          {ddosElapsedSeconds < ddosDurationSeconds &&
                          ["pending", "running"].includes(analyzedJob.status)
                            ? `${Math.floor(ddosElapsedSeconds / 60)}:${String(ddosElapsedSeconds % 60).padStart(2, "0")} de ${Math.floor(ddosDurationSeconds / 60)}:${String(ddosDurationSeconds % 60).padStart(2, "0")}`
                            : analyzedJob.status === "cancelled"
                              ? "Ejecución cancelada"
                              : ["failed", "timeout"].includes(
                                    analyzedJob.status,
                                  )
                                ? "Ejecución interrumpida"
                                : "Carga finalizada"}
                        </span>
                      </div>
                      <div
                        className="tools-security-analysis-execution-track"
                        role="progressbar"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={ddosProgressPercent}
                        aria-label="Avance de la ejecución k6 Cloud"
                      >
                        <span style={{ width: `${ddosProgressPercent}%` }} />
                      </div>
                    </>
                  ) : isApiTest ? (
                    <>
                      <div className="tools-security-analysis-execution-label">
                        <strong>Endpoints</strong>
                        <span>
                          {apiCompleted} de {apiTotal} · {apiPercent}%
                        </span>
                      </div>
                      <div
                        className="tools-security-analysis-execution-track"
                        role="progressbar"
                        aria-valuemin="0"
                        aria-valuemax={apiTotal}
                        aria-valuenow={apiCompleted}
                        aria-label="Avance de las pruebas de APIs"
                      >
                        <span style={{ width: `${apiPercent}%` }} />
                      </div>
                    </>
                  ) : analyzedJob.options?.testId ? (
                    <>
                      <div className="tools-security-analysis-execution-label">
                        <strong>Solicitud</strong>
                        <span>
                          {activeGuide.find(
                            (test) => test.id === analyzedJob.options.testId,
                          )?.title || getTestSlug(analyzedJob.options.testId)}
                        </span>
                      </div>
                      <div
                        className="tools-security-analysis-execution-track"
                        role="progressbar"
                        aria-valuemin="0"
                        aria-valuemax="1"
                        aria-valuenow={
                          analyzedJob.status === "completed" ? 1 : 0
                        }
                        aria-label="Avance de la solicitud"
                      >
                        <span
                          className={
                            ["pending", "running"].includes(analyzedJob.status)
                              ? "is-indeterminate"
                              : undefined
                          }
                          style={{
                            width: ["pending", "running"].includes(
                              analyzedJob.status,
                            )
                              ? "40%"
                              : "100%",
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="tools-security-analysis-execution-label">
                        <strong>Solicitud</strong>
                        <span>
                          {analysisCompleted} de {analysisTotal} casos ·{" "}
                          {analysisPercent}%
                        </span>
                      </div>
                      <div
                        className="tools-security-analysis-execution-track"
                        role="progressbar"
                        aria-valuemin="0"
                        aria-valuemax={analysisTotal}
                        aria-valuenow={analysisCompleted}
                        aria-label="Avance de las solicitudes"
                      >
                        <span style={{ width: `${analysisPercent}%` }} />
                      </div>
                    </>
                  )}
                </div>
                {!isApiTest || analyzedJob?.profileKey === "f5" ? (
                  <div className="tools-security-execution-column">
                    {(() => {
                      const jobF5Progress = getJobF5Progress(analyzedJob);
                      return (
                        <>
                          <div
                            className={`tools-security-analysis-execution-label${jobF5Progress.disabled ? " is-disabled" : ""}`}
                          >
                            <strong>F5 DCS</strong>
                            <span>{jobF5Progress.label}</span>
                          </div>
                          <div
                            className="tools-security-analysis-execution-track is-f5"
                            role="progressbar"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow={jobF5Progress.percent}
                            aria-label="Avance de la consulta a F5 DCS"
                          >
                            <span
                              className={
                                jobF5Progress.indeterminate
                                  ? "is-indeterminate"
                                  : undefined
                              }
                              style={{ width: `${jobF5Progress.percent}%` }}
                            />
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
              <small>
                {analyzedJob.status === "completed"
                  ? "Análisis finalizado."
                  : analyzedJob.status === "cancelled"
                    ? "Análisis cancelado por el usuario."
                    : analyzedJob.status === "failed" ||
                        analyzedJob.status === "timeout"
                      ? String(analyzedJob.stderr || "")
                          .trim()
                          .split("\n")
                          .map((line) => line.trim())
                          .filter((line) => line && line !== "}" && line !== "{")
                          .at(-1) ||
                        "Análisis interrumpido antes de completarse."
                      : f5Banner
                        ? "Solicitudes enviadas; correlacionando con F5 DCS…"
                        : analyzedJob.progress?.currentTest
                          ? `Procesando: ${analyzedJob.progress.currentTest}`
                          : "Preparando análisis..."}
              </small>
            </div>
          ) : null}
          {analyzedJob ? (
            <span className={`tools-state-pill is-${analyzedJob.status}`}>
              {analyzedJob.status}
            </span>
          ) : null}
        </div>
        {activeGuide.length ? (
          <div className="tools-security-analysis-list">
            {activeGuide.map((test, index) => {
              const state = getAnalysisState(test, index);
              const { resultRow, sourceJob } = resolveTestResult(test);
              const rowProgress = getRowProgress(test, state);
              return (
                <article
                  className={`tools-security-analysis-item is-${state.className}`}
                  key={test.id}
                >
                  <span
                    className="tools-security-analysis-marker"
                    aria-hidden="true"
                  />
                  <span className="tools-security-analysis-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{test.title}</strong>
                    <span>
                      {getTestSlug(test.id)} · {test.method} · {test.target}
                    </span>
                    <small>
                      <b>Prueba:</b> {test.detail}
                    </small>
                    <small>
                      <b>Nivel de amenaza:</b> {test.threatLevel}
                    </small>
                    <small>
                      <b>Respuesta:</b> {state.reason}
                    </small>
                    <div className="tools-security-item-progress-row">
                      <div className="tools-security-item-progress">
                        <span className="tools-security-item-progress-label">
                          Solicitud
                        </span>
                        <div
                          className="tools-security-item-progress-track"
                          role="progressbar"
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={rowProgress.requestBar.percent}
                        >
                          <span
                            className={
                              rowProgress.requestBar.indeterminate
                                ? "is-indeterminate"
                                : undefined
                            }
                            style={{
                              width: `${rowProgress.requestBar.percent}%`,
                            }}
                          />
                        </div>
                        <small>{rowProgress.requestBar.label}</small>
                      </div>
                      <div
                        className={`tools-security-item-progress${rowProgress.f5Bar.disabled ? " is-disabled" : ""}`}
                      >
                        <span className="tools-security-item-progress-label">
                          F5 DCS
                        </span>
                        <div
                          className="tools-security-item-progress-track is-f5"
                          role="progressbar"
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={rowProgress.f5Bar.percent}
                        >
                          <span
                            className={
                              rowProgress.f5Bar.indeterminate
                                ? "is-indeterminate"
                                : undefined
                            }
                            style={{ width: `${rowProgress.f5Bar.percent}%` }}
                          />
                        </div>
                        <small>{rowProgress.f5Bar.label}</small>
                      </div>
                    </div>
                  </div>
                  <b>{state.label}</b>
                  {state.className === "running" ? (
                    <button
                      className="btn-secondary tools-security-analysis-run is-cancel"
                      type="button"
                      onClick={cancelActiveJob}
                      disabled={cancelling}
                      title={
                        analyzedJob?.options?.testId === test.id
                          ? "Cancelar esta prueba"
                          : "Cancelar la ejecución completa (afecta a todas las pruebas en curso)"
                      }
                    >
                      {cancelling ? "Cancelando..." : "Cancelar"}
                    </button>
                  ) : testKey !== "l7_dos" ? (
                    <button
                      className="btn-secondary tools-security-analysis-run"
                      type="button"
                      onClick={() => execute(test.id)}
                      disabled={
                        running ||
                        loading ||
                        !profiles.some(
                          (profile) =>
                            profile.key === profileKey && profile.configured,
                        )
                      }
                      title={`Ejecutar solo ${test.title}`}
                    >
                      Ejecutar
                    </button>
                  ) : null}
                  <button
                    className="tools-security-analysis-info"
                    type="button"
                    onClick={() =>
                      setSelectedAnalysis({
                        test,
                        state,
                        resultRow,
                        job: sourceJob,
                      })
                    }
                    title={`Ver detalle de ${test.title}`}
                    aria-label={`Ver detalle de ${test.title}`}
                  >
                    i
                  </button>
                </article>
              );
            })}
          </div>
        ) : null}
        {isApiTest && analyzedJob ? (
          <div className="tools-security-api-results">
            {isApiOwaspTest ? (
              <div
                className="tools-security-api-summary"
                aria-label="Resumen de APIs OWASP"
              >
                <span>
                  <strong>{apiRows.length}</strong> pruebas totales
                </span>
                <span>
                  <strong>{apiPassed}</strong> validadas (PASS)
                </span>
                <span>
                  <strong>
                    {
                      apiRows.filter(
                        (row) =>
                          row.estado_f5 === "Bloqueado" ||
                          row.accion_f5 === "Bloqueada",
                      ).length
                    }
                  </strong>{" "}
                  bloqueadas por F5
                </span>
                <span>
                  <strong>
                    {
                      apiRows.filter(
                        (row) =>
                          row.estado_f5 === "Detectado" ||
                          row.accion_f5 === "Detectada",
                      ).length
                    }
                  </strong>{" "}
                  detectadas por F5
                </span>
              </div>
            ) : (
              <div
                className="tools-security-api-summary"
                aria-label="Resumen de APIs"
              >
                <span>
                  <strong>{apiPassed}</strong> aprobadas
                </span>
                <span>
                  <strong>{apiF5Counts.INVENTORIED || 0}</strong> inventariadas
                </span>
                <span>
                  <strong>{apiF5Counts.DISCOVERED || 0}</strong> descubiertas
                </span>
                <span>
                  <strong>{apiF5Counts.SHADOW || 0}</strong> shadow
                </span>
                <span>
                  <strong>{apiF5Counts.UNKNOWN || 0}</strong> desconocidas
                </span>
              </div>
            )}
            {apiRows.length ? (
              <div className="tools-security-api-table-wrap">
                <table className="tools-security-api-table">
                  <thead>
                    <tr>
                      <th>Resultado</th>
                      {isApiOwaspTest ? <th>Vector OWASP</th> : null}
                      <th>Operación</th>
                      <th>Ruta</th>
                      <th>HTTP</th>
                      <th>Duración</th>
                      <th>Estado F5</th>
                      {isApiOwaspTest ? (
                        <th>Categoría F5</th>
                      ) : (
                        <th>Última observación F5</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {apiRows.map((row) => (
                      <tr key={`${row.prueba}-${row.url}-${row.vector_owasp || ""}`}>
                        <td>
                          <span
                            className={`tools-security-api-result is-${row.resultado === "PASS" ? "pass" : row.resultado?.startsWith("SKIPPED") ? "skipped" : "fail"}`}
                          >
                            {row.resultado}
                          </span>
                        </td>
                        {isApiOwaspTest ? (
                          <td>
                            <strong>{row.vector_owasp || "-"}</strong>
                          </td>
                        ) : null}
                        <td>{row.prueba}</td>
                        <td>
                          <code>
                            {row.metodo} {row.url}
                          </code>
                        </td>
                        <td>{row.http}</td>
                        <td>{row.duracion_ms} ms</td>
                        <td>
                          <span
                            className={`tools-security-f5-status is-${String(row.estado_f5 || "UNKNOWN").toLowerCase()}`}
                            title={row.categorias_f5 || row.categoria_f5 || "Sin categoría F5"}
                          >
                            {API_F5_STATUS_LABELS[row.estado_f5] ||
                              row.estado_f5 ||
                              "Desconocida"}
                          </span>
                        </td>
                        <td>
                          {isApiOwaspTest
                            ? row.categoria_f5 || row.accion_f5 || "-"
                            : row.ultima_observacion_f5 || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="tools-security-api-waiting">
                Los resultados por endpoint aparecerán al finalizar la
                ejecución.
              </p>
            )}
          </div>
        ) : null}
      </section>

      {topologyOpen ? (
        <div
          className="tools-security-modal-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setTopologyOpen(false)
          }
        >
          <div
            className="tools-security-modal tools-security-topology-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-topology-title"
          >
            <div className="tools-security-modal-header">
              <div>
                <h3 id="security-topology-title">Topología de prueba</h3>
                <p>
                  Flujo de las solicitudes durante las pruebas de seguridad.
                </p>
              </div>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setTopologyOpen(false)}
              >
                Cerrar
              </button>
            </div>

            <div
              className="tools-arch-topology"
              role="img"
              aria-label="Diagrama de arquitectura unificada: una sola nube F5 DCS protegiendo el tráfico de usuario hacia Newpeople y las llamadas de backend hacia OpenAI."
            >
              {/* Columna 1: Usuario */}
              <div className="tools-arch-col is-client">
                <div className="tools-arch-node is-user">
                  <span className="tools-arch-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="7" r="4" />
                      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
                    </svg>
                  </span>
                  <small>Cliente</small>
                  <strong>Usuario</strong>
                  <span>Navegador / Cliente API</span>
                </div>
              </div>

              {/* Conector 1: Usuario -> F5 DCS */}
              <div className="tools-arch-connector is-entry">
                <div className="tools-arch-badge-step">1</div>
                <span className="tools-arch-conn-label">HTTPS público</span>
                <div className="tools-arch-line">
                  <i aria-hidden="true" />
                </div>
              </div>

              {/* Columna 2: Nube F5 DCS única */}
              <div className="tools-arch-cloud">
                <div className="tools-arch-cloud-header">
                  <span className="tools-arch-cloud-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.24 8.3 5 5 0 0 0 7 18Z" />
                    </svg>
                  </span>
                  <div>
                    <small>Perímetro de seguridad central</small>
                    <strong>Nube F5 Distributed Cloud (DCS)</strong>
                  </div>
                </div>

                <div className="tools-arch-cloud-services">
                  <div className="tools-arch-service is-ingress">
                    <div className="tools-arch-service-head">
                      <span className="tools-arch-pill is-waf">WAF & Bot Defense</span>
                      <strong>Entrada pública</strong>
                    </div>
                    <code>https://newpip.digitalvs.com</code>
                    <small>Inspección L7, mitigación DDoS y bloqueo de ataques</small>
                  </div>

                  <div className="tools-arch-service is-egress">
                    <div className="tools-arch-service-head">
                      <span className="tools-arch-pill is-ai">AI Proxy Gateway</span>
                      <strong>Proxy OpenAI</strong>
                    </div>
                    <code>https://openai.digitalvs.com/v1</code>
                    <small>Inspección de salida, control de cuota y seguridad de API</small>
                  </div>
                </div>
              </div>

              {/* Columna 3: Conectores hacia backends */}
              <div className="tools-arch-bridge">
                {/* Conexiones con Newpeople (Entrada Web + Salida IA) */}
                <div className="tools-arch-bridge-group is-app">
                  {/* 2: F5 -> Newpeople */}
                  <div className="tools-arch-bridge-item">
                    <div className="tools-arch-badge-step">2</div>
                    <span className="tools-arch-conn-label">Tráfico limpio</span>
                    <div className="tools-arch-line">
                      <i aria-hidden="true" />
                    </div>
                  </div>

                  {/* 3: Newpeople -> F5 (Llamada IA) */}
                  <div className="tools-arch-bridge-item is-reverse-flow">
                    <div className="tools-arch-badge-step is-ai-step">3</div>
                    <span className="tools-arch-conn-label">Consulta IA (openai.digitalvs.com)</span>
                    <div className="tools-arch-line is-reverse">
                      <i aria-hidden="true" />
                    </div>
                  </div>
                </div>

                {/* Conexión con OpenAI (Salida protegida F5 -> OpenAI) */}
                <div className="tools-arch-bridge-group is-ai">
                  {/* 4: F5 -> OpenAI */}
                  <div className="tools-arch-bridge-item">
                    <div className="tools-arch-badge-step is-ai-step">4</div>
                    <span className="tools-arch-conn-label">Salida a OpenAI (api.openai.com)</span>
                    <div className="tools-arch-line">
                      <i aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Columna 4: Destinos (Newpeople y OpenAI) */}
              <div className="tools-arch-col is-destinations">
                <div className="tools-arch-node is-aws">
                  <span className="tools-arch-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <rect x="5" y="3" width="14" height="7" rx="1" />
                      <rect x="5" y="14" width="14" height="7" rx="1" />
                      <path d="M8 6.5h.01M8 17.5h.01" />
                    </svg>
                  </span>
                  <small>Servidor en AWS</small>
                  <strong>Newpeople CRM</strong>
                  <code>newpeople.digitalvs.com</code>
                </div>

                <div className="tools-arch-node is-openai">
                  <span className="tools-arch-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 3 4 7v6c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V7l-8-4Z" />
                      <path d="M9.5 12.5 11 14l3.5-4" />
                    </svg>
                  </span>
                  <small>Proveedor externo</small>
                  <strong>OpenAI API</strong>
                  <code>api.openai.com</code>
                </div>
              </div>
            </div>

            <div className="tools-arch-caption-grid">
              <div className="tools-arch-caption-item">
                <span className="tools-arch-badge-step">1</span>
                <div>
                  <strong>Acceso de usuario:</strong> El navegador o cliente envía peticiones a <code>newpip.digitalvs.com</code>.
                </div>
              </div>
              <div className="tools-arch-caption-item">
                <span className="tools-arch-badge-step">2</span>
                <div>
                  <strong>Reenvío al origen:</strong> F5 DCS aplica reglas WAF/Bot Defense y reenvía el tráfico limpio a <code>newpeople.digitalvs.com</code> en AWS.
                </div>
              </div>
              <div className="tools-arch-caption-item">
                <span className="tools-arch-badge-step">3</span>
                <div>
                  <strong>Llamadas de IA:</strong> Cuando el backend necesita IA, consulta al endpoint proxy <code>openai.digitalvs.com/v1</code> en F5 DCS.
                </div>
              </div>
              <div className="tools-arch-caption-item">
                <span className="tools-arch-badge-step">4</span>
                <div>
                  <strong>Salida segura a OpenAI:</strong> F5 DCS inspecciona y reenvía la llamada a <code>api.openai.com</code>, protegiendo credenciales y tráfico.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedAnalysis ? (
        <div
          className="tools-security-modal-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSelectedAnalysis(null)
          }
        >
          <div
            className="tools-security-modal tools-security-result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-result-title"
          >
            <div className="tools-security-modal-header">
              <div>
                <h3 id="security-result-title">
                  {selectedAnalysis.test.title}
                </h3>
                <p>
                  {getTestSlug(selectedAnalysis.test.id)} ·{" "}
                  {selectedAnalysis.test.method} ·{" "}
                  {selectedAnalysis.test.target}
                </p>
              </div>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setSelectedAnalysis(null)}
              >
                Cerrar
              </button>
            </div>
            <div className="tools-security-result-grid">
              <div>
                <span>Resultado</span>
                <strong>{selectedAnalysis.state.label}</strong>
              </div>
              <div>
                <span>HTTP</span>
                <strong>
                  {selectedAnalysis.resultRow?.http ||
                    selectedAnalysis.resultRow?.http_status ||
                    "Pendiente"}
                </strong>
              </div>
              <div>
                <span>Evento F5</span>
                <strong>
                  {selectedAnalysis.resultRow?.evento_f5 || "Pendiente"}
                </strong>
              </div>
              <div>
                <span>Acción F5</span>
                <strong>
                  {selectedAnalysis.resultRow?.accion_f5 ||
                    "Sin acción registrada"}
                </strong>
              </div>
              <div>
                <span>Categoría F5</span>
                <strong>
                  {selectedAnalysis.resultRow?.categoria_f5 ||
                    "Sin categoría registrada"}
                </strong>
              </div>
              <div>
                <span>Confianza</span>
                <strong>
                  {selectedAnalysis.resultRow?.confianza_correlacion ||
                    "Ninguna"}
                </strong>
              </div>
            </div>
            <div className="tools-security-result-block">
              <span>Mensaje F5</span>
              {renderF5Message(selectedAnalysis.resultRow)}
            </div>
            <div className="tools-security-result-block">
              <span>Detalle de respuesta</span>
              {renderResponseDetail(selectedAnalysis.resultRow)}
            </div>
            <div className="tools-security-result-meta">
              <span>
                ID evento:{" "}
                {selectedAnalysis.resultRow?.id_evento_f5 || "No disponible"}
              </span>
              <span>
                ID solicitud:{" "}
                {selectedAnalysis.resultRow?.id_solicitud_f5 || "No disponible"}
              </span>
              <span>
                Run ID:{" "}
                {selectedAnalysis.resultRow?.run_id ||
                  selectedAnalysis.job?.id ||
                  "No disponible"}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? <p className="field-hint">Cargando análisis...</p> : null}
    </section>
  );
}
