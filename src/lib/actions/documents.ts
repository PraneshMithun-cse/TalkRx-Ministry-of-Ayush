"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/actions/auth-helpers";
import { loadPatient } from "@/lib/actions/vault";
import { nowParts } from "@/lib/actions/serialize";
import { extractMedicalDocument, extractMedicalDocumentFromPdf } from "@/lib/ai/ocr";
import type { PatientProfile } from "@/components/talkrx/types";

const VALID_CATEGORIES = ["prescription", "lab_report", "discharge_summary", "diagnostic_scan", "ayush_consult"] as const;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface ExtractedLabLite {
  parameter: string;
  value: string;
  unit: string;
  isAbnormal: boolean;
}

type VitalsPatch = {
  bloodGlucose?: string;
  bloodGlucoseType?: string;
  bloodPressure?: string;
  bloodPressureStatus?: string;
  heartRate?: string;
  spO2?: string;
  temperature?: string;
  weight?: string;
  height?: string;
};

/** Auto-fills the Health Overview vitals from recognised lab parameters in an uploaded report. */
function mapLabsToVitals(labs: ExtractedLabLite[]): VitalsPatch {
  const patch: VitalsPatch = {};
  let systolic = "";
  let diastolic = "";

  for (const l of labs) {
    const p = l.parameter.toLowerCase().trim();
    let v = l.value.trim();
    if (!v) continue;
    const withUnit = l.unit ? `${v} ${l.unit}`.trim() : v;

    // Sometimes the model puts the reading straight into the parameter name ("BP 148/94")
    const inlineBp = `${p} ${v}`.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);

    if (/glucose|glyc(a|)emia|blood sugar|\brbs\b|\bfbs\b|\bppbs\b/.test(p) && !/hba1c|glycated|haemoglobin a1c|hemoglobin a1c/.test(p)) {
      patch.bloodGlucose = v.replace(/\s*mg\/?d?l?\s*/i, "").trim();
      patch.bloodGlucoseType = /fast|fbs/.test(p)
        ? "Fasting (from report)"
        : /post|pp|random|rbs/.test(p)
        ? "Post-prandial (from report)"
        : "From uploaded report";
    } else if (/blood\s*pressure|\bb\.?\s?p\.?\b|\barterial pressure\b|systolic|diastolic/.test(p) || inlineBp) {
      if (/diastolic/.test(p)) {
        diastolic = v.replace(/[^\d]/g, "");
      } else if (/systolic/.test(p)) {
        systolic = v.replace(/[^\d]/g, "");
      } else {
        const m = v.match(/(\d{2,3})\s*\/\s*(\d{2,3})/) ?? inlineBp;
        if (m) {
          patch.bloodPressure = `${m[1]}/${m[2]}`;
          patch.bloodPressureStatus = l.isAbnormal ? "Flagged on report" : "From uploaded report";
        }
      }
    } else if (/pulse|heart\s*rate|\bhr\b/.test(p)) {
      v = v.replace(/[^\d.]/g, "");
      patch.heartRate = v ? `${v} bpm` : withUnit;
    } else if (/spo2|sp o2|oxygen saturation|o2 sat|saturation/.test(p)) {
      v = v.replace(/[^\d.]/g, "");
      patch.spO2 = v ? `${v}%` : withUnit;
    } else if (/temperature|\btemp\b/.test(p)) {
      patch.temperature = withUnit;
    } else if (/\bweight\b|\bwt\b|body weight/.test(p)) {
      patch.weight = withUnit;
    } else if (/\bheight\b|\bht\b|body height/.test(p)) {
      patch.height = withUnit;
    }
  }

  if (!patch.bloodPressure && systolic && diastolic) {
    patch.bloodPressure = `${systolic}/${diastolic}`;
    patch.bloodPressureStatus = "From uploaded report";
  }
  return patch;
}

/** Last-resort regex sweep of the raw OCR text for vitals the structured extraction missed. */
function scrapeVitalsFromText(text: string): VitalsPatch {
  const patch: VitalsPatch = {};
  const t = text.replace(/\s+/g, " ");

  const bp = t.match(/(?:b\.?\s?p\.?|blood\s*pressure)[^\d]{0,12}(\d{2,3})\s*\/\s*(\d{2,3})/i);
  if (bp) {
    patch.bloodPressure = `${bp[1]}/${bp[2]}`;
    patch.bloodPressureStatus = "From uploaded report";
  }
  const pulse = t.match(/(?:pulse|heart\s*rate|\bhr\b)[^\d]{0,12}(\d{2,3})\s*(?:\/?\s*min|bpm)?/i);
  if (pulse) patch.heartRate = `${pulse[1]} bpm`;

  const spo2 = t.match(/(?:spo2|sp\s?o2|oxygen\s*saturation|o2\s*sat)[^\d]{0,12}(\d{2,3})\s*%?/i);
  if (spo2) patch.spO2 = `${spo2[1]}%`;

  const temp = t.match(/(?:temp(?:erature)?)[^\d]{0,12}(\d{2,3}(?:\.\d)?)\s*(?:°?\s?[cf]|deg)?/i);
  if (temp) patch.temperature = `${temp[1]} °F`;

  const fbs = t.match(/(?:fasting\s*(?:blood\s*)?(?:glucose|sugar)|fbs)[^\d]{0,14}(\d{2,3}(?:\.\d)?)/i);
  const rbs = t.match(/(?:random\s*(?:blood\s*)?(?:glucose|sugar)|rbs|post[- ]?prandial)[^\d]{0,14}(\d{2,3}(?:\.\d)?)/i);
  if (fbs) {
    patch.bloodGlucose = fbs[1];
    patch.bloodGlucoseType = "Fasting (from report)";
  } else if (rbs) {
    patch.bloodGlucose = rbs[1];
    patch.bloodGlucoseType = "Post-prandial (from report)";
  }
  return patch;
}

export async function uploadMedicalDocumentAction(formData: FormData): Promise<PatientProfile> {
  const user = await getCurrentUser();
  const patientId = String(formData.get("patientId") ?? "");
  if (!patientId) throw new Error("patientId is required");

  const categoryRaw = String(formData.get("category") ?? "prescription");
  const category = (VALID_CATEGORIES as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as (typeof VALID_CATEGORIES)[number])
    : "prescription";
  const title = String(formData.get("title") ?? "Uploaded Document");
  const facility = String(formData.get("facility") ?? "TalkRx Digital");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 25 MB limit");

  const bytes = Buffer.from(await file.arrayBuffer());
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  const extraction = isPdf
    ? await extractMedicalDocumentFromPdf(bytes)
    : await extractMedicalDocument(`data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`);
  const { date, time } = nowParts();

  const existingPatient = await prisma.patient.findUniqueOrThrow({
    where: { id: patientId },
    select: { structuredSummary: true, conditions: { select: { label: true } } },
  });

  // Structured labs first, then a raw-text regex sweep fills anything the model missed (e.g. BP).
  const textVitals = scrapeVitalsFromText(extraction.rawText ?? "");
  const vitalsPatch = { ...textVitals, ...mapLabsToVitals(extraction.extractedLabs) };
  const existingSummary = (existingPatient.structuredSummary as Record<string, unknown> | null) ?? {};
  const existingVitals = (existingSummary.vitals as Record<string, unknown> | undefined) ?? {};
  const mergedSummary =
    Object.keys(vitalsPatch).length > 0
      ? { ...existingSummary, vitals: { ...existingVitals, ...vitalsPatch } }
      : null;

  const knownLabels = new Set(existingPatient.conditions.map((c) => c.label.toLowerCase()));
  const newDiagnoses = extraction.extractedDiagnoses.filter((d) => d.trim() && !knownLabels.has(d.trim().toLowerCase()));

  await prisma.$transaction(async (tx) => {
    if (mergedSummary) {
      await tx.patient.update({ where: { id: patientId }, data: { structuredSummary: mergedSummary as unknown as object } });
    }

    if (newDiagnoses.length) {
      await tx.patientCondition.createMany({
        data: newDiagnoses.slice(0, 12).map((label) => ({
          patientId,
          label,
          kind: "condition" as const,
          source: "document-extracted",
          confidence: extraction.ocrConfidence,
          verified: false,
          recordedBy: "Document Intelligence (AI OCR)",
        })),
      });
    }

    const doc = await tx.medicalDocument.create({
      data: {
        patientId,
        title,
        category,
        date,
        facility,
        ocrConfidence: extraction.ocrConfidence,
        extractedDiagnoses: extraction.extractedDiagnoses,
        rawText: extraction.rawText,
        verified: false,
      },
    });

    if (extraction.extractedMedicines.length) {
      await tx.extractedMedication.createMany({
        data: extraction.extractedMedicines.map((m) => ({
          patientId,
          rawText: m.rawText,
          standardMolecule: m.standardMolecule,
          dosage: m.dosage,
          frequency: m.frequency,
          duration: "Unspecified",
          confidence: m.confidence,
          confirmedByPatient: false,
          status: "active",
          source: "document-extracted",
          sourceDocumentId: doc.id,
        })),
      });
    }

    if (extraction.extractedLabs.length) {
      await tx.extractedLabResult.createMany({
        data: extraction.extractedLabs.map((l) => ({
          documentId: doc.id,
          parameter: l.parameter,
          value: l.value,
          unit: l.unit,
          referenceRange: l.referenceRange,
          isAbnormal: l.isAbnormal,
          loincCode: l.loincCode,
          sourceDoc: title,
          date,
        })),
      });
    }

    await tx.timelineEvent.create({
      data: {
        patientId,
        date,
        time,
        title: "Medical Document Digitized",
        subtitle: title,
        category: "document",
        source: "document-extracted",
        sourceEntity: "TalkRx Document Intelligence",
        facility,
        description: `AI extracted ${extraction.extractedMedicines.length} medication(s), ${extraction.extractedLabs.length} lab result(s), and ${extraction.extractedDiagnoses.length} diagnosis mention(s) from the uploaded ${category.replace("_", " ")}.${
          mergedSummary ? ` Health Overview vitals auto-updated (${Object.keys(vitalsPatch).join(", ")}).` : ""
        }${newDiagnoses.length ? ` ${newDiagnoses.length} condition(s) added to the profile.` : ""}`,
        tags: [
          "Document-Extracted",
          `${Math.round(extraction.ocrConfidence * 100)}% OCR Confidence`,
          ...(mergedSummary ? ["Vitals Auto-Filled"] : []),
        ],
      },
    });
  });

  return loadPatient(patientId);
}
