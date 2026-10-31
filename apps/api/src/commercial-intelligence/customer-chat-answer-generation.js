import { getDeadlineSignal } from "./customer-chat-records.js";
import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { customerComponentAnswerRules } from "./turn-contract.js";
import { CUSTOMER_FRIENDLY_STYLE_INSTRUCTIONS } from "./customer-presentation.js";

export async function generateCustomerAnswer({ deadlineAt, contractComponent, snapshot, user, jobId, deterministicOperationResponse, answerEvidenceContext }) {
  const fallback = {
    answer: "Respuesta basada únicamente en la evidencia autorizada.",
    evidence: [],
    inferences: [],
    confidence: "medium",
    pendingItems: [],
    recommendedActions: [],
    operations: [],
  };
  const aiResult =
    deterministicOperationResponse ||
    (await runStructuredTextResearch({
      schemaName: "account_contextual_chat",
      systemPrompt:
        (contractComponent
          ? `Conserva el propósito de turnComponent (${contractComponent.category}). Responde únicamente ese componente. Una consulta no pide recomendaciones ni escritura; una recomendación no autoriza operaciones. No cambies la categoría ni agregues tareas implícitas. ${customerComponentAnswerRules(contractComponent)}`
          : "") +
        "Responde usando exclusivamente authorizedEvidence y verifiedEmptyResults. La información aportada en question o conversationHistory no está registrada ni verificada en CRM por el hecho de mencionarse: conserva su atribución al vendedor o cliente y no afirmes que ya se documentó. conversationHistory solo sirve para resolver referencias conversacionales, nunca como prueba factual. Cada afirmación debe estar respaldada por un resultado con la fuente correcta; no traslades métricas de cuenta a una oportunidad ni viceversa. Distingue fuentes CRM (crm_internal) de fuentes públicas (public_web), y no presentes estas últimas como hechos CRM. Para toda afirmación basada en public_web, incluye en evidence el título o URL de la fuente pública autorizada que la respalda y no generalices más allá del hallazgo. Si evidenceVerification es no_results, usa verifiedEmptyResults para explicar qué consulta autorizada terminó sin filas dentro de qué cuenta o entidad; comunica únicamente que no se encontraron registros en ese alcance, no que nunca existan. Un cero verificado es un resultado, no evidencia faltante. Nunca afirmes ausencia si una consulta falló, quedó truncada o no se ejecutó. Omite datos no consultados o colócalos en pendingItems. Cuando identifiques una oportunidad como foco, devuelve su ID en entities.opportunityId solo si aparece en evidencia CRM autorizada y es inequívoca; no inventes IDs. Las operaciones son propuestas que requieren revisión y confirmación; no ejecutes operaciones ni envíes correos. Si el vendedor acepta preparar una actividad ofrecida en el turno anterior, por ejemplo con 'proponla', devuelve el borrador estructurado en operations cuando activity esté permitido y sus vínculos estén verificados; no repitas la oferta ni exijas preferencias del contacto o acuerdos que el usuario no pidió consultar. Los detalles futuros son propuestas, no hechos CRM. Si falta fecha/hora, deja scheduledAt vacío, añade scheduledAt a missingFields y pide completarlo para abrir Calendario; nunca inventes una cita ni afirmes que está coordinada, aceptada, guardada o ejecutada. " +
        CUSTOMER_FRIENDLY_STYLE_INSTRUCTIONS,
      subject: snapshot.account?.name || "cuenta",
      context: answerEvidenceContext,
      currentValues: {},
      fields: [
        { key: "answer", type: "string", example: fallback.answer },
        {
          key: "entities",
          type: "object",
          fields: [{ key: "opportunityId", type: "number", example: 0 }],
        },
        {
          key: "evidence",
          type: "array",
          example: [],
          items: { type: "string", example: "Evidencia" },
        },
        {
          key: "inferences",
          type: "array",
          example: [],
          items: { type: "string", example: "Hipótesis" },
        },
        {
          key: "confidence",
          type: "enum",
          enum: ["high", "medium", "low"],
          example: "medium",
        },
        {
          key: "pendingItems",
          type: "array",
          example: [],
          items: { type: "string", example: "Dato no verificado" },
        },
        {
          key: "recommendedActions",
          type: "array",
          example: [],
          items: {
            type: "object",
            fields: [
              { key: "title", type: "string", example: "Actividad" },
              { key: "opportunityId", type: "string", example: "" },
              { key: "actionType", type: "string", example: "call" },
              { key: "notes", type: "string", example: "" },
              { key: "successCriteria", type: "string", example: "" },
              {
                key: "requiresConfirmation",
                type: "string",
                example: "true",
              },
            ],
          },
        },
        {
          key: "operations",
          type: "array",
          example: [],
          items: {
            type: "object",
            fields: [
              {
                key: "kind",
                type: "enum",
                enum: [
                  "activity",
                  "stage_answer",
                  "lead_call_outcome",
                  "account_field",
                  "contact_field",
                  "create_contact",
                  "create_opportunity",
                  "link_contact_to_opportunity",
                  "opportunity_field",
                ],
                example: "opportunity_field",
              },
              {
                key: "title",
                type: "string",
                example: "Actualizar importe",
              },
              { key: "accountId", type: "number", example: 7 },
              {
                key: "payload",
                type: "object",
                fields: [
                  { key: "accountId", type: "number", example: 7 },
                  {
                    key: "name",
                    type: "string",
                    example: "Renovación anual",
                  },
                  { key: "amountUsd", type: "number", example: 12000 },
                  {
                    key: "closeDate",
                    type: "string",
                    example: "2027-12-31",
                  },
                  { key: "contactId", type: "number", example: 12 },
                  { key: "firstName", type: "string", example: "" },
                  { key: "lastName", type: "string", example: "" },
                  { key: "positionTitle", type: "string", example: "" },
                  { key: "email", type: "string", example: "" },
                  { key: "phone", type: "string", example: "" },
                  { key: "mobile", type: "string", example: "" },
                  { key: "department", type: "string", example: "" },
                  { key: "city", type: "string", example: "" },
                  { key: "stateRegion", type: "string", example: "" },
                ],
              },
              { key: "contactId", type: "number", example: 12 },
              { key: "opportunityId", type: "number", example: 18 },
              { key: "interactionId", type: "number", example: 25 },
              { key: "field", type: "string", example: "amountUsd" },
              { key: "currentValue", type: "string", example: "10000" },
              { key: "value", type: "string", example: "12000" },
              { key: "questionId", type: "number", example: 4 },
              { key: "answerValue", type: "string", example: "" },
              {
                key: "answerMode",
                type: "enum",
                enum: ["replace", "append"],
                example: "replace",
              },
              { key: "substatusCode", type: "string", example: "" },
              { key: "reasonCode", type: "string", example: "" },
              { key: "requiredActionCode", type: "string", example: "" },
              { key: "comment", type: "string", example: "" },
              {
                key: "actionType",
                type: "enum",
                enum: [
                  "next_step",
                  "follow_up",
                  "call",
                  "meeting",
                  "conference",
                  "presentation",
                  "visit",
                  "send_email",
                  "waiting_customer",
                  "demo",
                  "quotation",
                  "negotiation",
                  "other",
                ],
                example: "call",
              },
              {
                key: "status",
                type: "enum",
                enum: ["pending", "in_progress", "blocked", "done"],
                example: "pending",
              },
              {
                key: "priority",
                type: "enum",
                enum: ["low", "medium", "high"],
                example: "medium",
              },
              { key: "scheduledAt", type: "string", example: "" },
              { key: "dueDate", type: "string", example: "" },
              { key: "notes", type: "string", example: "" },
              { key: "successCriteria", type: "string", example: "" },
              {
                key: "evidence",
                type: "array",
                example: [],
                items: {
                  type: "object",
                  fields: [
                    {
                      key: "sourceType",
                      type: "string",
                      example: "opportunity",
                    },
                    { key: "sourceId", type: "number", example: 18 },
                    { key: "label", type: "string", example: "Dato CRM" },
                    { key: "excerpt", type: "string", example: "" },
                  ],
                },
              },
            ],
          },
        },
        { key: "source", type: "string", example: "account_intelligence" },
      ],
      aiUsageContext: {
        userId: Number(user.id),
        featureCode: "commercial_intelligence.account_chat",
        jobType: "account_chat",
        jobId,
      },
      signal: getDeadlineSignal(deadlineAt),
    }));
  return { aiResult };
}
