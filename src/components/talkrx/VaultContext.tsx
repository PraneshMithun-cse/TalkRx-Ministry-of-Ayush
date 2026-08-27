"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import {
  getSessionStateAction,
  createAccountAction,
  lookupPatientAction,
  setDoctorIdentityAction,
  addSelfAssessmentAction,
  addDoctorRecordAction,
  addPharmacyDispensationAction,
  grantConsentAction,
  revokeConsentAction,
  logAccessAction,
  submitCaseTakingSummaryAction,
  submitCaseTakingAnswersAction,
  updatePatientHealthOverviewAction,
  switchRoleAction,
} from "@/lib/actions/vault";
import type { CreateAccountInput, DoctorRecordInput, PharmacyDispenseInput, UpdateHealthOverviewInput, CaseTakingAnswerInput } from "@/lib/actions/vault";
import { uploadMedicalDocumentAction } from "@/lib/actions/documents";
import {
  getOpsMetricsAction,
  getActiveRedFlagsAction,
  acknowledgeRedFlagAction,
  resolveRedFlagAction,
  updateQueueAction,
  exportFhirBundleAction,
  exportFhirBundlesForAllAction,
  resetAllDataAction,
} from "@/lib/actions/ops";
import type { OpsMetrics, RedFlagBroadcastRow, UpdateQueueInput, FhirExportResult } from "@/lib/actions/ops";
import { checkPrescriptionSafetyAction } from "@/lib/actions/clinical";
import type { SafetyResult } from "@/lib/actions/clinical";
import type {
  PatientProfile,
  DoctorIdentity,
  ConsentAuthorization,
  AccessAuditLog,
  StructuredHpiSummary,
  DashavidhaParikshaData,
} from "./types";

interface VaultState {
  role: "PATIENT" | "DOCTOR" | "PHARMACY" | "STAFF" | null;
  patients: PatientProfile[];
  currentPatient: PatientProfile | null;
  doctorIdentity: DoctorIdentity | null;
}

interface VaultContextValue {
  isHydrated: boolean;
  vaultError: string | null;
  role: "PATIENT" | "DOCTOR" | "PHARMACY" | "STAFF" | null;
  patients: PatientProfile[];
  currentPatient: PatientProfile | null;
  doctorIdentity: DoctorIdentity | null;

  createAccount(input: CreateAccountInput): Promise<PatientProfile>;
  signInWithSerial(serial: string): Promise<PatientProfile | null>;
  signOut(): void;
  lookupPatient(query: string): Promise<PatientProfile | null>;
  selectPatient(patientId: string): void;
  switchRole(role: "PATIENT" | "DOCTOR" | "PHARMACY" | "STAFF"): Promise<void>;
  updateHealthOverview(patientId: string, input: UpdateHealthOverviewInput): Promise<PatientProfile>;
  refreshVault(): Promise<void>;

  setDoctorIdentity(identity: DoctorIdentity): Promise<void>;
  addSelfAssessment(patientId: string, rawText: string): Promise<void>;
  addDoctorRecord(patientId: string, input: DoctorRecordInput): Promise<void>;
  addPharmacyDispensation(
    serial: string,
    input: PharmacyDispenseInput
  ): Promise<{ ok: true; patientName: string } | { ok: false; reason: string }>;

  grantConsent(patientId: string, consent: Omit<ConsentAuthorization, "id" | "status">): Promise<void>;
  revokeConsent(patientId: string, consentId: string): Promise<void>;
  logAccess(patientId: string, entry: Omit<AccessAuditLog, "id" | "timestamp">): Promise<void>;

  submitCaseTakingSummary(patientId: string, summary: StructuredHpiSummary, ayushData?: DashavidhaParikshaData): Promise<void>;
  submitCaseTakingAnswers(
    patientId: string,
    answers: CaseTakingAnswerInput[],
    mode: "conventional" | "ayush",
    redFlags: import("./types").RedFlagAlert[],
    intakeDurationSeconds: number,
    ayushData?: DashavidhaParikshaData
  ): Promise<void>;
  resetAllData(): Promise<void>;
  uploadMedicalDocument(formData: FormData): Promise<void>;

  // Triage & operations
  getOpsMetrics(): Promise<OpsMetrics>;
  getActiveRedFlags(): Promise<RedFlagBroadcastRow[]>;
  acknowledgeRedFlag(alertId: string): Promise<void>;
  resolveRedFlag(alertId: string): Promise<void>;
  updateQueue(patientId: string, input: UpdateQueueInput): Promise<void>;
  exportFhirBundle(patientId: string): Promise<FhirExportResult>;
  exportFhirBundlesForAll(): Promise<FhirExportResult>;

  // Prescription safety
  checkPrescriptionSafety(patientId: string, drugName: string): Promise<SafetyResult>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

const EMPTY_STATE: VaultState = { role: null, patients: [], currentPatient: null, doctorIdentity: null };

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const { signOut: clerkSignOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();

  const [state, setState] = useState<VaultState>(EMPTY_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    if (!isSignedIn) {
      setState(EMPTY_STATE);
      setVaultError(null);
      setIsHydrated(true);
      return;
    }
    try {
      const session = await getSessionStateAction();
      if (session.role === null && pathname !== "/onboarding") {
        router.replace("/onboarding");
        return;
      }
      setState((prev) => ({
        role: session.role,
        patients: session.patients,
        currentPatient: prev.currentPatient && session.patients.some((p) => p.id === prev.currentPatient?.id)
          ? session.patients.find((p) => p.id === prev.currentPatient?.id)!
          : session.currentPatient,
        doctorIdentity: session.doctorIdentity,
      }));
      setVaultError(null);
    } catch (err) {
      // Most commonly a missing / unreachable / un-migrated database on the deployment.
      console.error("VaultProvider: session load failed", err);
      setState(EMPTY_STATE);
      setVaultError(
        err instanceof Error && /P1001|ECONNREFUSED|database|relation .* does not exist/i.test(err.message)
          ? "Can't reach the database. Set DATABASE_URL and run the migrations, then reload."
          : "Something went wrong loading your session. Please reload."
      );
    } finally {
      setIsHydrated(true);
    }
  }, [isSignedIn, pathname, router]);

  useEffect(() => {
    if (!isLoaded) return;
    void fetchSession();
  }, [isLoaded, fetchSession]);

  const patchPatient = useCallback((updated: PatientProfile) => {
    setState((prev) => ({
      ...prev,
      patients: prev.patients.some((p) => p.id === updated.id)
        ? prev.patients.map((p) => (p.id === updated.id ? updated : p))
        : [updated, ...prev.patients],
      currentPatient: prev.currentPatient?.id === updated.id || !prev.currentPatient ? updated : prev.currentPatient,
    }));
  }, []);

  const selectPatient = useCallback((patientId: string) => {
    setState((prev) => {
      const found = prev.patients.find((p) => p.id === patientId);
      return found ? { ...prev, currentPatient: found } : prev;
    });
  }, []);

  const switchRole = useCallback(async (newRole: "PATIENT" | "DOCTOR" | "PHARMACY" | "STAFF") => {
    await switchRoleAction(newRole);
    setState((prev) => ({ ...prev, role: newRole }));
    await fetchSession();
  }, [fetchSession]);

  const updateHealthOverview = useCallback(async (patientId: string, input: UpdateHealthOverviewInput) => {
    const updated = await updatePatientHealthOverviewAction(patientId, input);
    patchPatient(updated);
    return updated;
  }, [patchPatient]);

  const createAccount = useCallback(async (input: CreateAccountInput) => {
    const created = await createAccountAction(input);
    setState((prev) => ({
      ...prev,
      patients: prev.patients.some((p) => p.id === created.id) ? prev.patients : [created, ...prev.patients],
      currentPatient: created,
    }));
    return created;
  }, []);

  const signInWithSerial = useCallback(async (serial: string) => {
    const found = await lookupPatientAction(serial);
    if (found) {
      setState((prev) => ({
        ...prev,
        patients: prev.patients.some((p) => p.id === found.id) ? prev.patients : [found, ...prev.patients],
        currentPatient: found,
      }));
    }
    return found;
  }, []);

  const signOut = useCallback(() => {
    setState(EMPTY_STATE);
    void clerkSignOut(() => router.push("/"));
  }, [clerkSignOut, router]);

  const lookupPatient = useCallback(async (query: string) => lookupPatientAction(query), []);

  const setDoctorIdentity = useCallback(async (identity: DoctorIdentity) => {
    await setDoctorIdentityAction(identity);
    setState((prev) => ({ ...prev, doctorIdentity: identity }));
  }, []);

  const addSelfAssessment = useCallback(
    async (patientId: string, rawText: string) => {
      const updated = await addSelfAssessmentAction(patientId, rawText);
      patchPatient(updated);
    },
    [patchPatient]
  );

  const addDoctorRecord = useCallback(
    async (patientId: string, input: DoctorRecordInput) => {
      const updated = await addDoctorRecordAction(patientId, input);
      patchPatient(updated);
    },
    [patchPatient]
  );

  const addPharmacyDispensation = useCallback(async (serial: string, input: PharmacyDispenseInput) => {
    return addPharmacyDispensationAction(serial, input);
  }, []);

  const grantConsent = useCallback(
    async (patientId: string, consent: Omit<ConsentAuthorization, "id" | "status">) => {
      const updated = await grantConsentAction(patientId, consent);
      patchPatient(updated);
    },
    [patchPatient]
  );

  const revokeConsent = useCallback(
    async (patientId: string, consentId: string) => {
      const updated = await revokeConsentAction(patientId, consentId);
      patchPatient(updated);
    },
    [patchPatient]
  );

  const logAccess = useCallback(async (patientId: string, entry: Omit<AccessAuditLog, "id" | "timestamp">) => {
    await logAccessAction(patientId, entry);
  }, []);

  const submitCaseTakingSummary = useCallback(
    async (patientId: string, summary: StructuredHpiSummary, ayushData?: DashavidhaParikshaData) => {
      const updated = await submitCaseTakingSummaryAction(patientId, summary, ayushData);
      patchPatient(updated);
    },
    [patchPatient]
  );

  const submitCaseTakingAnswers = useCallback<VaultContextValue["submitCaseTakingAnswers"]>(
    async (patientId, answers, mode, redFlags, intakeDurationSeconds, ayushData) => {
      const updated = await submitCaseTakingAnswersAction(
        patientId,
        answers,
        mode,
        redFlags,
        intakeDurationSeconds,
        ayushData
      );
      patchPatient(updated);
    },
    [patchPatient]
  );

  const resetAllData = useCallback(async () => {
    await resetAllDataAction();
    await fetchSession();
  }, [fetchSession]);

  const uploadMedicalDocument = useCallback(
    async (formData: FormData) => {
      const updated = await uploadMedicalDocumentAction(formData);
      patchPatient(updated);
    },
    [patchPatient]
  );

  const getOpsMetrics = useCallback(() => getOpsMetricsAction(), []);
  const getActiveRedFlags = useCallback(() => getActiveRedFlagsAction(), []);

  const acknowledgeRedFlag = useCallback(async (alertId: string) => {
    await acknowledgeRedFlagAction(alertId);
    await fetchSession();
  }, [fetchSession]);

  const resolveRedFlag = useCallback(async (alertId: string) => {
    await resolveRedFlagAction(alertId);
    await fetchSession();
  }, [fetchSession]);

  const updateQueue = useCallback(async (patientId: string, input: UpdateQueueInput) => {
    const updated = await updateQueueAction(patientId, input);
    patchPatient(updated);
  }, [patchPatient]);

  const exportFhirBundle = useCallback((patientId: string) => exportFhirBundleAction(patientId), []);
  const exportFhirBundlesForAll = useCallback(() => exportFhirBundlesForAllAction(), []);
  const checkPrescriptionSafety = useCallback(
    (patientId: string, drugName: string) => checkPrescriptionSafetyAction(patientId, drugName),
    []
  );

  const value: VaultContextValue = {
    isHydrated,
    vaultError,
    role: state.role,
    patients: state.patients,
    currentPatient: state.currentPatient,
    doctorIdentity: state.doctorIdentity,
    createAccount,
    signInWithSerial,
    signOut,
    lookupPatient,
    selectPatient,
    switchRole,
    updateHealthOverview,
    refreshVault: fetchSession,
    setDoctorIdentity,
    addSelfAssessment,
    addDoctorRecord,
    addPharmacyDispensation,
    grantConsent,
    revokeConsent,
    logAccess,
    submitCaseTakingSummary,
    submitCaseTakingAnswers,
    resetAllData,
    uploadMedicalDocument,
    getOpsMetrics,
    getActiveRedFlags,
    acknowledgeRedFlag,
    resolveRedFlag,
    updateQueue,
    exportFhirBundle,
    exportFhirBundlesForAll,
    checkPrescriptionSafety,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within a VaultProvider");
  return ctx;
}
