"use server";

import { prisma } from "@/lib/prisma";
import { checkPrescriptionSafety, type SafetyResult } from "@/lib/clinical/interactions";

export type { SafetyResult, SafetyLevel, SafetyFinding } from "@/lib/clinical/interactions";

/**
 * Real-time prescription safety guard for the Doctor Dashboard prescribe flow.
 * Checks a candidate drug against the patient's documented allergies and active
 * medication list using the deterministic rule engine.
 */
export async function checkPrescriptionSafetyAction(patientId: string, drugName: string): Promise<SafetyResult> {
  const name = drugName.trim();
  if (!name) return { level: "safe", findings: [] };

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      allergies: true,
      medications: { where: { status: "active" }, select: { standardMolecule: true, brandName: true } },
    },
  });
  if (!patient) return { level: "safe", findings: [] };

  const molecules = patient.medications.flatMap((m) => [m.standardMolecule, m.brandName].filter(Boolean) as string[]);
  return checkPrescriptionSafety(name, patient.allergies, molecules);
}
