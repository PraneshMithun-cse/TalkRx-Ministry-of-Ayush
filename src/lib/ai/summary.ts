import "server-only";
import { groq, GROQ_TEXT_MODEL } from "@/lib/groq";
import type { StructuredHpiSummary } from "@/components/talkrx/types";

export interface IntakeAnswer {
  category: string;
  question: string;
  answer: string;
}

const SEVERITY = ["Life-Threatening", "Moderate", "Mild"] as const;

const HPI_SCHEMA = {
  type: "object",
  properties: {
    chiefComplaint: { type: "string", description: "One concise line — the main reason for the visit" },
    duration: { type: "string", description: "How long the complaint has been present, e.g. '3 days', 'Not stated'" },
    hpiNarrative: {
      type: "string",
      description: "A physician-style History of Present Illness paragraph in third person, 2–5 sentences, using only what the patient stated",
    },
    pertinentPositives: { type: "array", items: { type: "string" } },
    pertinentNegatives: { type: "array", items: { type: "string" } },
    pastMedicalHistory: { type: "array", items: { type: "string" } },
    pastSurgicalHistory: { type: "array", items: { type: "string" } },
    familyHistory: { type: "array", items: { type: "string" } },
    lifestyle: {
      type: "object",
      properties: {
        smoking: { type: "string" },
        alcohol: { type: "string" },
        diet: { type: "string" },
        sleep: { type: "string" },
      },
      required: ["smoking", "alcohol", "diet", "sleep"],
      additionalProperties: false,
    },
    reviewOfSystems: {
      type: "array",
      items: {
        type: "object",
        properties: { system: { type: "string" }, findings: { type: "string" } },
        required: ["system", "findings"],
        additionalProperties: false,
      },
    },
    allergies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          allergen: { type: "string" },
          reaction: { type: "string" },
          severity: { type: "string", enum: ["Life-Threatening", "Moderate", "Mild"] },
        },
        required: ["allergen", "reaction", "severity"],
        additionalProperties: false,
      },
    },
    currentMedications: { type: "array", items: { type: "string" } },
  },
  required: [
    "chiefComplaint",
    "duration",
    "hpiNarrative",
    "pertinentPositives",
    "pertinentNegatives",
    "pastMedicalHistory",
    "pastSurgicalHistory",
    "familyHistory",
    "lifestyle",
    "reviewOfSystems",
    "allergies",
    "currentMedications",
  ],
  additionalProperties: false,
} as const;

type HpiModelOutput = {
  chiefComplaint: string;
  duration: string;
  hpiNarrative: string;
  pertinentPositives: string[];
  pertinentNegatives: string[];
  pastMedicalHistory: string[];
  pastSurgicalHistory: string[];
  familyHistory: string[];
  lifestyle: { smoking: string; alcohol: string; diet: string; sleep: string };
  reviewOfSystems: Array<{ system: string; findings: string }>;
  allergies: Array<{ allergen: string; reaction: string; severity: (typeof SEVERITY)[number] }>;
  currentMedications: string[];
};

export type GeneratedHpi = Omit<StructuredHpiSummary, "redFlagsDetected" | "generatedAt" | "intakeDurationSeconds">;

function fallbackFromAnswers(answers: IntakeAnswer[]): GeneratedHpi {
  const first = answers[0]?.answer || "Not specified";
  return {
    chiefComplaint: first,
    duration: answers[1]?.answer || "Not stated",
    hpiNarrative: answers.map((a) => `${a.category}: ${a.answer}`).join(" — "),
    pertinentPositives: answers.slice(0, 4).map((a) => a.answer).filter(Boolean),
    pertinentNegatives: [],
    pastMedicalHistory: answers.find((a) => /HISTORY|PRAKRITI/i.test(a.category))?.answer
      ? [answers.find((a) => /HISTORY|PRAKRITI/i.test(a.category))!.answer]
      : [],
    pastSurgicalHistory: [],
    familyHistory: [],
    lifestyle: { smoking: "Not captured", alcohol: "Not captured", diet: "Not captured", sleep: "Not captured" },
    reviewOfSystems: Object.fromEntries(answers.map((a) => [a.category, a.answer])),
    allergies: [],
    currentMedications: [],
  };
}

/**
 * Turns the raw case-taking Q&A into a physician-ready structured HPI using Groq.
 * `documentContext` is a short summary of anything already extracted from the
 * patient's uploaded reports so the narrative can reconcile them.
 */
export async function buildHpiFromAnswers(
  answers: IntakeAnswer[],
  mode: "conventional" | "ayush",
  documentContext?: string
): Promise<GeneratedHpi> {
  if (answers.length === 0) return fallbackFromAnswers(answers);

  const transcript = answers.map((a, i) => `${i + 1}. [${a.category}] Q: ${a.question}\n   A: ${a.answer}`).join("\n");
  const docBlock = documentContext ? `\n\nAlready on file from uploaded reports:\n${documentContext}` : "";

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      max_tokens: 2200,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a clinical scribe for an Indian OPD. From the patient's kiosk answers, produce a concise, " +
            "physician-ready structured History of Present Illness. Use ONLY information the patient actually gave — " +
            "never invent findings, diagnoses, vitals or medications. If something was not mentioned, use an empty " +
            "array or 'Not stated'. Keep the hpiNarrative to 2–5 plain sentences in the third person. " +
            "ALLERGIES: if the patient names ANY allergy (food, drug or environmental — e.g. 'peanut allergy', " +
            "'allergic to penicillin', 'sulfa rash'), you MUST add one entry per allergen to the allergies array. " +
            "Put the substance in 'allergen' (e.g. 'Peanut'), the described or typical reaction in 'reaction' " +
            "(use 'Not specified' if unknown), and pick a severity. Only leave allergies empty when the patient " +
            "clearly said none / NKDA / no known allergies." +
            (mode === "ayush"
              ? " This is an AYUSH (Ayurvedic) Dashavidha Pariksha intake — keep Ayurvedic terms the patient used."
              : ""),
        },
        { role: "user", content: `Case-taking transcript:\n${transcript}${docBlock}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "structured_hpi", schema: HPI_SCHEMA, strict: true } },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion");
    const p = JSON.parse(raw) as HpiModelOutput;

    return {
      chiefComplaint: p.chiefComplaint || answers[0]?.answer || "Not specified",
      duration: p.duration || "Not stated",
      hpiNarrative: p.hpiNarrative || fallbackFromAnswers(answers).hpiNarrative,
      pertinentPositives: p.pertinentPositives ?? [],
      pertinentNegatives: p.pertinentNegatives ?? [],
      pastMedicalHistory: p.pastMedicalHistory ?? [],
      pastSurgicalHistory: p.pastSurgicalHistory ?? [],
      familyHistory: p.familyHistory ?? [],
      lifestyle: p.lifestyle ?? { smoking: "Not captured", alcohol: "Not captured", diet: "Not captured", sleep: "Not captured" },
      reviewOfSystems: Object.fromEntries((p.reviewOfSystems ?? []).map((r) => [r.system, r.findings])),
      allergies: (p.allergies ?? []).map((a) => ({
        allergen: a.allergen,
        reaction: a.reaction,
        severity: (SEVERITY as readonly string[]).includes(a.severity) ? a.severity : "Moderate",
      })),
      currentMedications: [],
    };
  } catch (err) {
    console.error("buildHpiFromAnswers: Groq failed", err);
    return fallbackFromAnswers(answers);
  }
}
