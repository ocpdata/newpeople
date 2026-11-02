// What the seller reads when Coach cannot answer. Each message says what happened and what to try next.

export const COACH_UNSUPPORTED_ANSWER =
  "No pude confirmar esa respuesta con tus datos del CRM, así que prefiero no darte cifras ni hechos que no pueda respaldar. Pregunta por un registro concreto (por ejemplo, «detalle de la oportunidad [nombre] de [cuenta]») o acota la consulta a tu pipeline, una cuenta o un periodo.";

export const COACH_FORMAT_FAILURE_ANSWER =
  "No logré preparar esa respuesta en el formato esperado y no se cambió ningún registro. Intenta formular una sola solicitud a la vez; si querías crear o modificar algo, indica el registro y los datos concretos.";

export const COACH_AUDIT_UNAVAILABLE_ANSWER =
  "No pude comprobar la respuesta antes de mostrártela, así que no la presento. No se cambió ningún registro. Inténtalo de nuevo en unos segundos.";

export const COACH_TIMEOUT_ANSWER =
  "La consulta tardó más de lo esperado y no pude completarla. Inténtalo de nuevo; si se repite, acota la pregunta a una cuenta, una oportunidad o un periodo.";

export const COACH_RESPONSE_FAILED_ANSWER =
  "Tuve un problema al consultar tus datos y no pude completar la respuesta. No se cambió ningún registro. Inténtalo de nuevo en unos segundos.";

export const COACH_NO_EVIDENCE_ANSWER =
  "No encontré en tus registros lo necesario para responder eso. Indica la cuenta, la oportunidad o el periodo que quieres revisar y lo consulto.";

export const COACH_PLAN_INVALID_ANSWER =
  "No logré interpretar esa pregunta con seguridad, así que no consulté ni afirmé ningún dato. Reformúlala indicando la cuenta, la oportunidad o lo que quieres revisar.";

export function coachFailureAnswerFor(error) {
  return error?.code === "coach_turn_timeout"
    ? COACH_TIMEOUT_ANSWER
    : COACH_RESPONSE_FAILED_ANSWER;
}
