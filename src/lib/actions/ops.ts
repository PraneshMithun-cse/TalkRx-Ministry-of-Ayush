"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/actions/auth-helpers";
import { loadPatient } from "@/lib/actions/vault";
import { PATIENT_INCLUDE, nowParts } from "@/lib/actions/serialize";
import { buildPatientFhirBundle } from "@/lib/fhir/bundle";
import type { PatientProfile, RedFlagAlert } from "@/components/talkrx/types";

// ---------------------------------------------------------------------------
// OPD operational metrics (Hospital & Clinic Operations dashboard)
// ---------------------------------------------------------------------------

export interface OpsMetrics {
  patientsToday: number;
  completedIntakes: number;
  intakeCompletionPct: number;
  redFlagsCaught: number;
  physicianHoursGained: string;
  secondsSavedPerConsult: number;
  abdmLinkedPct: number;
  totalPatients: number;
  queueByStatus: Record<string, number>;
}

const SEC_SAVED_PER_CONSULT = 90;
const COMPLETED_STATUSES = ["case-completed", "consulting", "discharged"];

export async function getOpsMetricsAction(): Promise<OpsMetrics> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [patientsToday, allPatients, redFlagsToday] = await Promise.all([
    prisma.patient.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.patient.findMany({ select: { queueStatus: true, abhaId: true, structuredSummary: true } }),
    prisma.redFlagAlert.count({ where: { timestamp: { gte: startOfDay } } }),
  ]);

  const queueByStatus: Record<string, number> = {};
  let completedIntakes = 0;
  let abdmLinked = 0;
  for (const p of allPatients) {
    queueByStatus[p.queueStatus] = (queueByStatus[p.queueStatus] ?? 0) + 1;
    if (COMPLETED_STATUSES.includes(p.queueStatus) || p.structuredSummary != null) completedIntakes += 1;
    if (p.abhaId && p.abhaId !== "Not Linked") abdmLinked += 1;
  }

  const total = allPatients.length;
  const hoursGained = (completedIntakes * SEC_SAVED_PER_CONSULT) / 3600;

  return {
    patientsToday,
    completedIntakes,
    intakeCompletionPct: total ? Math.round((completedIntakes / total) * 100) : 0,
    redFlagsCaught: redFlagsToday,
    physicianHoursGained: hoursGained >= 1 ? `${hoursGained.toFixed(1)} hrs` : `${Math.round(hoursGained * 60)} min`,
    secondsSavedPerConsult: SEC_SAVED_PER_CONSULT,
    abdmLinkedPct: total ? Math.round((abdmLinked / total) * 100) : 0,
    totalPatients: total,
    queueByStatus,
  };
}

// ---------------------------------------------------------------------------
// Active red-flag broadcast desk (across the whole OPD)
// ---------------------------------------------------------------------------

export interface RedFlagBroadcastRow extends RedFlagAlert {
  patientId: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  tokenNumber: string;
}

export async function getActiveRedFlagsAction(): Promise<RedFlagBroadcastRow[]> {
  const rows = await prisma.redFlagAlert.findMany({
    where: { status: { in: ["active", "acknowledged"] } },
    orderBy: [{ severity: "asc" }, { timestamp: "desc" }],
    include: { patient: { select: { id: true, name: true, age: true, gender: true, tokenNumber: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    category: r.category as RedFlagAlert["category"],
    severity: r.severity,
    matchedRule: r.matchedRule,
    patientStatement: r.patientStatement,
    timestamp: r.timestamp.toISOString().slice(0, 16).replace("T", " "),
    escalatedTo: r.escalatedTo,
    status: r.status,
    actionRequired: r.actionRequired,
    patientId: r.patient.id,
    patientName: r.patient.name,
    patientAge: r.patient.age,
    patientGender: r.patient.gender,
    tokenNumber: r.patient.tokenNumber,
  }));
}

async function setRedFlagStatus(alertId: string, status: "acknowledged" | "resolved"): Promise<void> {
  const user = await getCurrentUser();
  const alert = await prisma.redFlagAlert.update({ where: { id: alertId }, data: { status } });
  const { date, time } = nowParts();
  await prisma.timelineEvent.create({
    data: {
      patientId: alert.patientId,
      date,
      time,
      title: status === "acknowledged" ? "Red-Flag Acknowledged by Triage" : "Red-Flag Resolved",
      subtitle: alert.matchedRule,
      category: "triage",
      source: "doctor-prescribed",
      sourceEntity: "TalkRx Triage Operations",
      facility: user?.organization || "TalkRx OPD",
      description: `${alert.category} red-flag (${alert.severity}) marked ${status}${user?.name ? ` by ${user.name}` : ""}. ${alert.actionRequired}`,
      tags: ["Triage", status === "acknowledged" ? "Acknowledged" : "Resolved"],
      isRedFlag: status !== "resolved",
    },
  });
}

export async function acknowledgeRedFlagAction(alertId: string): Promise<void> {
  await setRedFlagStatus(alertId, "acknowledged");
}

export async function resolveRedFlagAction(alertId: string): Promise<void> {
  await setRedFlagStatus(alertId, "resolved");
}

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

export interface UpdateQueueInput {
  queueStatus?: PatientProfile["queueStatus"];
  tokenNumber?: string;
  department?: string;
  hospitalName?: string;
}

export async function updateQueueAction(patientId: string, input: UpdateQueueInput): Promise<PatientProfile> {
  const user = await getCurrentUser();
  const { date, time } = nowParts();

  await prisma.$transaction(async (tx) => {
    await tx.patient.update({
      where: { id: patientId },
      data: {
        queueStatus: input.queueStatus ?? undefined,
        tokenNumber: input.tokenNumber ?? undefined,
        department: input.department ?? undefined,
        hospitalName: input.hospitalName ?? undefined,
      },
    });
    await tx.timelineEvent.create({
      data: {
        patientId,
        date,
        time,
        title: "OPD Queue Updated",
        subtitle: input.queueStatus ? `Status → ${input.queueStatus}` : "Queue details updated",
        category: "triage",
        source: "doctor-prescribed",
        sourceEntity: "TalkRx Triage Operations",
        facility: input.hospitalName || user?.organization || "TalkRx OPD",
        description: [
          input.queueStatus && `Queue status set to "${input.queueStatus}"`,
          input.tokenNumber && `token ${input.tokenNumber}`,
          input.department && `department ${input.department}`,
        ]
          .filter(Boolean)
          .join(", ") || "Queue record updated.",
        tags: ["Queue", ...(input.queueStatus === "triage-alert" ? ["Escalated"] : [])],
      },
    });
  });

  return loadPatient(patientId);
}

// ---------------------------------------------------------------------------
// FHIR R4 export
// ---------------------------------------------------------------------------

export interface FhirExportResult {
  fileName: string;
  bundle: Record<string, unknown>;
  resourceCount: number;
}

export async function exportFhirBundleAction(patientId: string): Promise<FhirExportResult> {
  const user = await getCurrentUser();
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, include: PATIENT_INCLUDE });
  const bundle = buildPatientFhirBundle(patient);

  await prisma.accessAuditLog.create({
    data: {
      patientId,
      accessorName: user?.name ?? "TalkRx Operations",
      accessorRole: user?.role ?? "STAFF",
      facility: user?.organization ?? "TalkRx OPD",
      action: "Read Case Summary",
      dataAccessed: "FHIR R4 Bundle export (Patient, Encounter, Condition, AllergyIntolerance, MedicationStatement, Observation)",
      ipLocation: "TalkRx Triage Operations",
    },
  });

  const entry = (bundle.entry as unknown[]) ?? [];
  return {
    fileName: `talkrx-fhir-${patient.serialNumber}-${new Date().toISOString().slice(0, 10)}.json`,
    bundle,
    resourceCount: entry.length,
  };
}

// ---------------------------------------------------------------------------
// Danger zone — wipe every patient + clinical record in TalkRx
// ---------------------------------------------------------------------------

export async function resetAllDataAction(): Promise<{ deletedPatients: number }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.extractedLabResult.deleteMany();
    await tx.redFlagAlert.deleteMany();
    await tx.timelineEvent.deleteMany();
    await tx.accessAuditLog.deleteMany();
    await tx.consentAuthorization.deleteMany();
    await tx.patientCondition.deleteMany();
    await tx.extractedMedication.deleteMany();
    await tx.selfAssessmentEntry.deleteMany();
    await tx.doctorConsultationRecord.deleteMany();
    await tx.medicalDocument.deleteMany();
    const { count } = await tx.patient.deleteMany();
    // Remove patient/guest user shells; keep DOCTOR / PHARMACY / STAFF logins intact.
    await tx.user.deleteMany({ where: { role: "PATIENT" } });
    return { deletedPatients: count };
  });
  return result;
}

export async function exportFhirBundlesForAllAction(): Promise<FhirExportResult> {
  const user = await getCurrentUser();
  const patients = await prisma.patient.findMany({ include: PATIENT_INCLUDE, orderBy: { createdAt: "desc" } });
  const entries = patients.flatMap((p) => {
    const b = buildPatientFhirBundle(p);
    return (b.entry as unknown[]) ?? [];
  });

  const bundle = {
    resourceType: "Bundle",
    id: `talkrx-bundle-all-${Date.now()}`,
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
  };

  return {
    fileName: `talkrx-fhir-opd-${new Date().toISOString().slice(0, 10)}.json`,
    bundle,
    resourceCount: entries.length,
  };
}
