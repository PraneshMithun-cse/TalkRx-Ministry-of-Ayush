import "server-only";
import { groq, GROQ_VISION_MODEL, GROQ_TEXT_MODEL } from "@/lib/groq";
import type { ExtractedMedicationResult } from "@/lib/ai/extraction";

export interface ExtractedLabResultData {
  parameter: string;
  value: string;
  unit: string;
  referenceRange: string;
  isAbnormal: boolean;
  loincCode?: string;
}

export interface DocumentOcrResult {
  rawText: string;
  ocrConfidence: number;
  extractedMedicines: ExtractedMedicationResult[];
  extractedLabs: ExtractedLabResultData[];
  extractedDiagnoses: string[];
}

const DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    rawText: { type: "string", description: "The full transcribed text of the document, as literally as possible" },
    ocrConfidence: { type: "number", description: "0 to 1 confidence in the overall transcription quality" },
    extractedMedicines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rawText: { type: "string" },
          standardMolecule: { type: "string" },
          dosage: { type: "string" },
          frequency: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["rawText", "standardMolecule", "dosage", "frequency", "confidence"],
        additionalProperties: false,
      },
    },
    extractedLabs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          parameter: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          referenceRange: { type: "string" },
          isAbnormal: { type: "boolean" },
          loincCode: { type: "string" },
        },
        required: ["parameter", "value", "unit", "referenceRange", "isAbnormal", "loincCode"],
        additionalProperties: false,
      },
    },
    extractedDiagnoses: { type: "array", items: { type: "string" } },
  },
  required: ["rawText", "ocrConfidence", "extractedMedicines", "extractedLabs", "extractedDiagnoses"],
  additionalProperties: false,
} as const;

/** Same as DOCUMENT_SCHEMA but without `rawText` — used for the PDF text path so the model
 * never has to echo the whole document back (which blew past the token limit). */
const PDF_DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    ocrConfidence: { type: "number", description: "0 to 1 confidence the extraction is faithful to the source" },
    extractedMedicines: DOCUMENT_SCHEMA.properties.extractedMedicines,
    extractedLabs: DOCUMENT_SCHEMA.properties.extractedLabs,
    extractedDiagnoses: DOCUMENT_SCHEMA.properties.extractedDiagnoses,
  },
  required: ["ocrConfidence", "extractedMedicines", "extractedLabs", "extractedDiagnoses"],
  additionalProperties: false,
} as const;

function clampConfidence(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0.5;
  return Math.min(1, Math.max(0, Math.round(v * 100) / 100));
}

/**
 * Runs real vision OCR + structured extraction on an uploaded prescription/lab/discharge-summary
 * image via Groq's qwen3.6-27b (the only vision-capable model on this account). `imageDataUrl`
 * must be a `data:image/...;base64,...` URL.
 */
export async function extractMedicalDocument(imageDataUrl: string): Promise<DocumentOcrResult> {
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_VISION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a medical document OCR and extraction assistant for an Indian OPD. Transcribe the " +
            "uploaded image (a prescription, lab report, or discharge summary — often handwritten or a phone " +
            "photo) and extract structured data: medications (molecule/brand, dosage, frequency), lab results " +
            "(parameter, value, unit, reference range, whether abnormal), and diagnoses mentioned. Also include " +
            "any recorded vital signs as lab results using these exact parameter names when present: " +
            "'Blood Pressure' (value like 148/94, unit mmHg), 'Pulse' or 'Heart Rate' (unit bpm), " +
            "'SpO2' (unit %), 'Temperature', 'Weight', 'Height', and 'Glucose - Fasting' / 'Random Blood Glucose'. " +
            "Leave a field as an empty array/string if it genuinely isn't present rather than guessing. " +
            "loincCode should be an empty string if unknown.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all clinical information from this document." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "medical_document_extraction", schema: DOCUMENT_SCHEMA, strict: true },
      },
      temperature: 0.1,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion from Groq");
    const parsed = JSON.parse(raw) as {
      rawText: string;
      ocrConfidence: number;
      extractedMedicines: ExtractedMedicationResult[];
      extractedLabs: (ExtractedLabResultData & { loincCode?: string })[];
      extractedDiagnoses: string[];
    };

    return {
      rawText: parsed.rawText,
      ocrConfidence: clampConfidence(parsed.ocrConfidence),
      extractedMedicines: parsed.extractedMedicines.map((m) => ({ ...m, confidence: clampConfidence(m.confidence) })),
      extractedLabs: parsed.extractedLabs.map((l) => ({ ...l, loincCode: l.loincCode || undefined })),
      extractedDiagnoses: parsed.extractedDiagnoses,
    };
  } catch (err) {
    console.error("extractMedicalDocument: Groq vision call failed", err);
    return {
      rawText: "AI OCR unavailable for this document — please verify manually.",
      ocrConfidence: 0.2,
      extractedMedicines: [],
      extractedLabs: [],
      extractedDiagnoses: [],
    };
  }
}

/**
 * PDF path: extracts the text layer with pdf-parse, then runs structured clinical
 * extraction through Groq's text model. Handles digital lab reports / e-prescriptions.
 * Scanned (image-only) PDFs yield little/no text — flagged with low confidence.
 */
export async function extractMedicalDocumentFromPdf(pdfBuffer: Buffer): Promise<DocumentOcrResult> {
  let pdfText = "";
  let pageCount = 0;
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    const result = await parser.getText();
    pdfText = (result.text ?? "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    pageCount = (result as { total?: number }).total ?? 0;
    await parser.destroy();
  } catch (err) {
    console.error("extractMedicalDocumentFromPdf: pdf-parse failed", err);
  }

  if (pdfText.length < 20) {
    return {
      rawText:
        pdfText ||
        `Scanned PDF received (${pageCount || "?"} page(s)) — no selectable text layer. Re-upload a photo of the document for Vision OCR.`,
      ocrConfidence: 0.15,
      extractedMedicines: [],
      extractedLabs: [],
      extractedDiagnoses: [],
    };
  }

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "You are a medical document extraction assistant for an Indian OPD. You are given the raw text " +
            "of a prescription, lab report, or discharge summary (extracted from a PDF). Extract ONLY structured " +
            "data: medications (molecule/brand, dosage, frequency), lab results (parameter, value, unit, " +
            "reference range, whether abnormal, LOINC code if identifiable), and diagnoses mentioned. Also treat " +
            "any recorded vital signs as lab results, using these exact parameter names when present: " +
            "'Blood Pressure' (e.g. 148/94, unit mmHg), 'Pulse' or 'Heart Rate' (unit bpm), 'SpO2' (unit %), " +
            "'Temperature', 'Weight', 'Height', 'Glucose - Fasting' and 'Random Blood Glucose'. Set ocrConfidence " +
            "to your confidence the extraction is faithful to the source text. Return empty arrays when a " +
            "category is genuinely absent. Do NOT echo the document text back.",
        },
        { role: "user", content: pdfText.slice(0, 18000) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "pdf_document_extraction", schema: PDF_DOCUMENT_SCHEMA, strict: true },
      },
      temperature: 0.1,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion from Groq");
    const parsed = JSON.parse(raw) as {
      ocrConfidence: number;
      extractedMedicines: ExtractedMedicationResult[];
      extractedLabs: (ExtractedLabResultData & { loincCode?: string })[];
      extractedDiagnoses: string[];
    };

    return {
      rawText: pdfText.slice(0, 12000),
      ocrConfidence: clampConfidence(parsed.ocrConfidence),
      extractedMedicines: parsed.extractedMedicines.map((m) => ({ ...m, confidence: clampConfidence(m.confidence) })),
      extractedLabs: parsed.extractedLabs.map((l) => ({ ...l, loincCode: l.loincCode || undefined })),
      extractedDiagnoses: parsed.extractedDiagnoses,
    };
  } catch (err) {
    console.error("extractMedicalDocumentFromPdf: Groq text extraction failed", err);
    return {
      rawText: pdfText.slice(0, 8000),
      ocrConfidence: 0.4,
      extractedMedicines: [],
      extractedLabs: [],
      extractedDiagnoses: [],
    };
  }
}
