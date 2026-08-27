import "server-only";
import type { PatientWithRelations } from "@/lib/actions/serialize";

/**
 * Minimal but valid FHIR R4 `Bundle` (type `collection`) for a TalkRx patient:
 * Patient, Encounter, Condition[], AllergyIntolerance[], MedicationStatement[],
 * Observation[] (vitals + extracted labs). Enough for ABDM Gateway ingestion demos.
 */

type FhirResource = Record<string, unknown>;

const GENDER_MAP: Record<string, string> = { Male: "male", Female: "female", Other: "other" };

function ref(type: string, id: string) {
  return { reference: `${type}/${id}` };
}

function vitalsObservations(patientRef: { reference: string }, vitals: Record<string, unknown> | null): FhirResource[] {
  if (!vitals) return [];
  const out: FhirResource[] = [];
  const push = (id: string, text: string, value: string) => {
    if (!value) return;
    out.push({
      resourceType: "Observation",
      id: `vital-${id}`,
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
      code: { text },
      subject: patientRef,
      valueString: String(value),
    });
  };
  push("bp", "Blood pressure", String(vitals.bloodPressure ?? ""));
  push("glucose", "Blood glucose", String(vitals.bloodGlucose ?? ""));
  push("hr", "Heart rate", String(vitals.heartRate ?? ""));
  push("spo2", "Oxygen saturation", String(vitals.spO2 ?? ""));
  push("temp", "Body temperature", String(vitals.temperature ?? ""));
  push("weight", "Body weight", String(vitals.weight ?? ""));
  push("height", "Body height", String(vitals.height ?? ""));
  return out;
}

export function buildPatientFhirBundle(p: PatientWithRelations): FhirResource {
  const patientRef = ref("Patient", p.id);
  const encounterId = `enc-${p.id}`;
  const summary = (p.structuredSummary as Record<string, unknown> | null) ?? null;
  const vitals = (summary?.vitals as Record<string, unknown> | null) ?? null;

  const resources: FhirResource[] = [];

  resources.push({
    resourceType: "Patient",
    id: p.id,
    identifier: [
      { system: "https://talkrx.health/serial", value: p.serialNumber },
      ...(p.abhaId && p.abhaId !== "Not Linked" ? [{ system: "https://abdm.gov.in/abha", value: p.abhaId }] : []),
    ],
    name: [{ text: p.name }],
    gender: GENDER_MAP[p.gender] ?? "unknown",
    telecom: p.phone ? [{ system: "phone", value: p.phone }] : [],
    extension: [{ url: "https://talkrx.health/blood-group", valueString: p.bloodGroup }],
  });

  resources.push({
    resourceType: "Encounter",
    id: encounterId,
    status: p.queueStatus === "discharged" ? "finished" : "in-progress",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
    subject: patientRef,
    serviceType: { text: p.department },
    period: { start: p.createdAt.toISOString() },
  });

  for (const c of p.conditions) {
    resources.push({
      resourceType: "Condition",
      id: `cond-${c.id}`,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
      verificationStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
            code: c.verified ? "confirmed" : "unconfirmed",
          },
        ],
      },
      code: { text: c.label },
      subject: patientRef,
      encounter: ref("Encounter", encounterId),
      recorder: c.recordedBy ? { display: c.recordedBy } : undefined,
      recordedDate: c.recordedAt.toISOString(),
    });
  }

  for (const a of p.allergies) {
    resources.push({
      resourceType: "AllergyIntolerance",
      id: `allergy-${Buffer.from(a).toString("hex").slice(0, 16)}`,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
      type: "allergy",
      criticality: "high",
      code: { text: a },
      patient: patientRef,
    });
  }

  for (const m of p.medications) {
    resources.push({
      resourceType: "MedicationStatement",
      id: `med-${m.id}`,
      status: m.status === "active" ? "active" : m.status === "completed" ? "completed" : "stopped",
      medicationCodeableConcept: { text: `${m.standardMolecule}${m.brandName ? ` (${m.brandName})` : ""} ${m.dosage}`.trim() },
      subject: patientRef,
      dosage: [{ text: `${m.dosage} ${m.frequency} ${m.duration}`.trim() }],
      informationSource: m.prescribedBy ? { display: m.prescribedBy } : m.dispensedBy ? { display: m.dispensedBy } : undefined,
    });
  }

  resources.push(...vitalsObservations(patientRef, vitals));

  for (const doc of p.documents) {
    for (const lab of doc.extractedLabs) {
      resources.push({
        resourceType: "Observation",
        id: `lab-${lab.id}`,
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: lab.loincCode ? { coding: [{ system: "http://loinc.org", code: lab.loincCode }], text: lab.parameter } : { text: lab.parameter },
        subject: patientRef,
        valueString: `${lab.value} ${lab.unit}`.trim(),
        referenceRange: lab.referenceRange ? [{ text: lab.referenceRange }] : undefined,
        interpretation: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: lab.isAbnormal ? "A" : "N",
              },
            ],
          },
        ],
      });
    }
  }

  return {
    resourceType: "Bundle",
    id: `talkrx-bundle-${p.id}`,
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: resources.map((r) => ({
      fullUrl: `urn:talkrx:${r.resourceType}:${r.id}`,
      resource: r,
    })),
  };
}
