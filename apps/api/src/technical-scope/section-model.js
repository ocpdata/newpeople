import { z } from "zod";
import { hashContent } from "./hash.js";
import { ensureSectionContent } from "./tiptap.js";

// Sections of the technical scope, in the order they appear in the proposal.
export const TECHNICAL_SECTION_CATALOG = [
  {
    code: "requirements",
    title: "Entendimiento de requerimientos",
    instruction:
      "Resume los requerimientos y objetivos tecnicos del cliente tal como se desprenden de las respuestas del cuestionario y de los documentos. No inventes requerimientos.",
  },
  {
    code: "current_situation",
    title: "Situacion actual",
    instruction:
      "Describe el entorno actual del cliente (sitios, plataformas, aplicaciones, herramientas vigentes) usando solo lo respaldado por el cuestionario y los documentos del cliente.",
  },
  {
    code: "proposed_solution",
    title: "Solucion propuesta",
    instruction:
      "Describe la solucion por cada grupo de partidas cotizadas. Cada elemento debe referenciar los codigos de producto de la cotizacion en itemRefs. Todas las partidas cotizadas deben quedar cubiertas.",
  },
  {
    code: "architecture",
    title: "Arquitectura y componentes",
    instruction:
      "Describe la arquitectura, componentes, flujo de trafico o de datos e integraciones de la solucion propuesta, alineada con el playbook y las respuestas del cliente.",
  },
  {
    code: "scope_included",
    title: "Alcance incluido",
    instruction:
      "Lista concreta de actividades y entregas incluidas, derivada del esqueleto del playbook y ajustada a las partidas cotizadas y a las respuestas.",
  },
  {
    code: "scope_excluded",
    title: "Exclusiones",
    instruction:
      "Lista de lo que no esta incluido, basada en las exclusiones del playbook y en lo que no fue cotizado.",
  },
  {
    code: "assumptions",
    title: "Supuestos y responsabilidades del cliente",
    instruction:
      "Supuestos del proyecto y responsabilidades del cliente. Incluye como supuesto explicito cada dato obligatorio que no fue respondido en el cuestionario.",
  },
  {
    code: "deliverables",
    title: "Entregables",
    instruction:
      "Entregables del proyecto con una descripcion breve de cada uno, segun el playbook.",
  },
  {
    code: "phases",
    title: "Fases y cronograma",
    instruction:
      "Fases del proyecto con actividades y duracion estimada. Usa las duraciones de referencia del playbook solo como estimacion orientativa.",
  },
  {
    code: "acceptance",
    title: "Criterios de aceptacion",
    instruction:
      "Criterios verificables para considerar completado el proyecto o cada fase.",
  },
  {
    code: "support_sla",
    title: "Soporte y niveles de servicio",
    instruction:
      "Soporte incluido y niveles de servicio. Solo lo respaldado por las partidas cotizadas o por el playbook.",
  },
  {
    code: "risks",
    title: "Riesgos y dependencias",
    instruction:
      "Riesgos y dependencias tecnicas que el cliente debe conocer. No incluyas informacion comercial interna.",
  },
];

export const TECHNICAL_SECTION_CODES = TECHNICAL_SECTION_CATALOG.map(
  (section) => section.code,
);

export function getTechnicalSectionDefinition(code) {
  return (
    TECHNICAL_SECTION_CATALOG.find((section) => section.code === code) || null
  );
}

const textSchema = z.string().trim().max(20_000);

export const sectionBlockSchema = z
  .object({
    type: z.enum(["heading", "paragraph", "list", "table"]),
    text: textSchema.optional().default(""),
    items: z.array(z.string().trim().max(2_000)).max(80).optional().default([]),
    table: z
      .object({
        headers: z.array(z.string().trim().max(200)).max(8).default([]),
        rows: z
          .array(z.array(z.string().trim().max(1_000)).max(8))
          .max(80)
          .default([]),
      })
      .optional()
      .nullable(),
  })
  .transform((block) => ({
    type: block.type,
    text: block.text || "",
    items: block.items || [],
    table: block.table || null,
  }));

export const sectionSourceSchema = z.object({
  kind: z.enum(["answer", "document", "quotation", "rag", "playbook", "crm"]),
  ref: z.string().trim().max(300).optional().default(""),
  label: z.string().trim().max(300).optional().default(""),
});

export const technicalSectionSchema = z.object({
  code: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(180),
  blocks: z.array(sectionBlockSchema).max(60).default([]),
  // Editor content (a TipTap document); blocks are derived from it for the verifier and the AI.
  content: z.any().optional().nullable(),
  itemRefs: z.array(z.string().trim().max(120)).max(200).optional().default([]),
  sources: z.array(sectionSourceSchema).max(30).optional().default([]),
  edited: z.boolean().optional().default(false),
  generatedAt: z.string().max(40).optional().nullable(),
});

export const technicalSectionsSchema = z.array(technicalSectionSchema).max(40);

function normalizeSectionForHash(section) {
  return {
    code: section.code,
    title: section.title,
    content: ensureSectionContent(section),
  };
}

export function computeScopeContentHash({
  sections,
  topology,
  asisTopology,
  quotationVersionId,
  snapshotAnswers,
}) {
  return hashContent({
    sections: (Array.isArray(sections) ? sections : []).map(
      normalizeSectionForHash,
    ),
    topology: topology || null,
    asisTopology: asisTopology || null,
    quotationVersionId: Number(quotationVersionId || 0),
    answers: (Array.isArray(snapshotAnswers) ? snapshotAnswers : []).map(
      (answer) => ({
        playbookCode: answer.playbookCode,
        questionCode: answer.questionCode,
        value: answer.value ?? null,
      }),
    ),
  });
}
