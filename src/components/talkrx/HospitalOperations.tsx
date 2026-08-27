"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  Clock,
  ShieldCheck,
  CheckCircle2,
  Radio,
  FileCode,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { useVault } from "./VaultContext";
import type { OpsMetrics, RedFlagBroadcastRow } from "@/lib/actions/ops";
import type { PatientProfile } from "./types";

const QUEUE_STATUSES: PatientProfile["queueStatus"][] = [
  "waiting",
  "in-case-taking",
  "triage-alert",
  "case-completed",
  "consulting",
  "discharged",
];

export function HospitalOperations() {
  const {
    patients,
    selectPatient,
    getOpsMetrics,
    getActiveRedFlags,
    acknowledgeRedFlag,
    resolveRedFlag,
    updateQueue,
    exportFhirBundlesForAll,
  } = useVault();

  const [selectedQueueFilter, setSelectedQueueFilter] = useState<string>("all");
  const [metrics, setMetrics] = useState<OpsMetrics | null>(null);
  const [redFlags, setRedFlags] = useState<RedFlagBroadcastRow[]>([]);
  const [fhirExporting, setFhirExporting] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [m, rf] = await Promise.all([getOpsMetrics(), getActiveRedFlags()]);
    setMetrics(m);
    setRedFlags(rf);
  }, [getOpsMetrics, getActiveRedFlags]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh, patients.length]);

  const handleExportFhir = async () => {
    setFhirExporting(true);
    try {
      const result = await exportFhirBundlesForAll();
      const blob = new Blob([JSON.stringify(result.bundle, null, 2)], { type: "application/fhir+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setFhirExporting(false);
    }
  };

  const handleAck = async (id: string) => {
    setBusyRow(id);
    try {
      await acknowledgeRedFlag(id);
      await refresh();
    } finally {
      setBusyRow(null);
    }
  };

  const handleResolve = async (id: string) => {
    setBusyRow(id);
    try {
      await resolveRedFlag(id);
      await refresh();
    } finally {
      setBusyRow(null);
    }
  };

  const handleQueueChange = async (patientId: string, status: PatientProfile["queueStatus"]) => {
    setBusyRow(patientId);
    try {
      await updateQueue(patientId, { queueStatus: status });
      await refresh();
    } finally {
      setBusyRow(null);
    }
  };

  const filteredPatients =
    selectedQueueFilter === "all" ? patients : patients.filter((p) => p.queueStatus === selectedQueueFilter);

  const metricCards = [
    { label: "Patients Today", value: metrics ? String(metrics.patientsToday) : "—", sub: metrics ? `${metrics.intakeCompletionPct}% completed digital intake` : "Loading…", Icon: Users },
    { label: "Physician Hours Gained", value: metrics ? `+${metrics.physicianHoursGained}` : "—", sub: metrics ? `~${metrics.secondsSavedPerConsult}s saved per consultation` : "Loading…", Icon: Clock },
    { label: "Red-Flags Diverted", value: metrics ? String(metrics.redFlagsCaught) : "—", sub: "Emergency Triage < 3 mins", Icon: ShieldAlert },
    { label: "ABDM Rails Sync", value: metrics ? `${metrics.abdmLinkedPct}%` : "—", sub: "ABHA-linked patient records", Icon: ShieldCheck },
  ];

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-black/[0.06] pb-5 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-neutral-900 animate-pulse" />
            <span
              className="text-[11px] font-bold uppercase tracking-[1.5px] text-neutral-800"
              style={{ fontFamily: "var(--do-font-label)" }}
            >
              Hospital &amp; Clinic Operations &bull; Live OPD Hub
            </span>
          </div>
          <h3 className="mt-1 text-2xl font-normal tracking-tight text-neutral-950">
            OPD Intake &amp; Triage Control Center
          </h3>
          <p className="text-xs text-neutral-500">
            {metrics ? `${metrics.totalPatients} patient record(s) in system` : "General Medicine & AYUSH OPD Network"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportFhir}
            disabled={fhirExporting}
            className="inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white hover:bg-neutral-800 shadow-sm disabled:opacity-50"
            style={{ fontFamily: "var(--do-font-label)" }}
          >
            {fhirExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCode className="h-3.5 w-3.5 text-neutral-300" />}
            <span>{fhirExporting ? "Building FHIR…" : "Export FHIR R4 Bundle"}</span>
          </button>
        </div>
      </div>

      {/* Operational Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metricCards.map(({ label, value, sub, Icon }) => (
          <div key={label} className="rounded-3xl border border-black/[0.08] bg-white/70 backdrop-blur-xl p-5 shadow-sm">
            <div className="flex items-center justify-between text-neutral-500">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ fontFamily: "var(--do-font-label)" }}>
                {label}
              </span>
              <Icon className="h-4 w-4 stroke-[1.5]" />
            </div>
            <div className="mt-3 text-3xl font-normal tracking-tight text-neutral-950">{value}</div>
            <div className="mt-1 text-xs text-neutral-500 font-medium">{sub}</div>
          </div>
        ))}
      </div>

      {/* Live Priority Red-Flag Broadcast Desk */}
      <div className="rounded-3xl border border-red-500/20 bg-red-500/[0.03] backdrop-blur-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
            <h4
              className="text-xs font-bold text-neutral-950 uppercase tracking-[1.5px]"
              style={{ fontFamily: "var(--do-font-label)" }}
            >
              Emergency Triage Priority Broadcast (Deterministic Rule Engine)
            </h4>
          </div>
          <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
            {redFlags.length} Active
          </span>
        </div>

        {redFlags.length === 0 && (
          <div className="rounded-2xl bg-white/90 p-5 border border-black/5 text-xs text-neutral-500 text-center">
            No active red-flags in the OPD queue. Deterministic rule engine monitoring all live intakes.
          </div>
        )}

        {redFlags.map((rf) => (
          <div
            key={rf.id}
            className="rounded-2xl bg-white/90 p-5 border border-black/5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-bold text-white uppercase">
                  {rf.tokenNumber}
                </span>
                <span className="font-bold text-neutral-950 text-sm">
                  {rf.patientName} ({rf.patientAge}y, {rf.patientGender})
                </span>
                <span className="text-sm font-mono text-neutral-500">
                  &bull; {rf.matchedRule} ({rf.category})
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                    rf.severity === "critical" ? "bg-red-100 text-red-800" : rf.severity === "high" ? "bg-orange-100 text-orange-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {rf.severity}
                </span>
              </div>
              <p className="text-sm text-neutral-700 mt-1 font-mono bg-neutral-50 p-2.5 rounded-lg border border-black/5">
                &ldquo;{rf.patientStatement}&rdquo;
              </p>
              <div className="mt-2 text-[11px] text-neutral-500 font-medium">
                Escalated to: <strong>{rf.escalatedTo}</strong> &bull; {rf.actionRequired}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {rf.status === "active" ? (
                <button
                  type="button"
                  disabled={busyRow === rf.id}
                  onClick={() => handleAck(rf.id)}
                  className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  Acknowledge
                </button>
              ) : (
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-800">
                  Acknowledged
                </span>
              )}
              <button
                type="button"
                disabled={busyRow === rf.id}
                onClick={() => handleResolve(rf.id)}
                className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
              >
                Resolve
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Live OPD Patient Queue Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-base font-bold text-neutral-950 tracking-tight">
            Live OPD Intake &amp; Case Completion Queue
          </h4>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {["all", ...QUEUE_STATUSES].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setSelectedQueueFilter(status)}
                className={`rounded-full px-3 py-1 font-medium uppercase text-[9px] transition-colors ${
                  selectedQueueFilter === status
                    ? "bg-black text-white shadow-sm"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
                style={{ fontFamily: "var(--do-font-label)" }}
              >
                {status}
                {status !== "all" && metrics?.queueByStatus[status] ? ` (${metrics.queueByStatus[status]})` : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-black/[0.08] bg-white/80 backdrop-blur-xl">
          <table className="w-full text-left text-xs min-w-[720px]">
            <thead className="bg-neutral-100/70 font-bold uppercase text-neutral-700 text-[10px]" style={{ fontFamily: "var(--do-font-label)" }}>
              <tr>
                <th className="p-3.5">Token</th>
                <th className="p-3.5">Patient Name</th>
                <th className="p-3.5">Age / Sex</th>
                <th className="p-3.5">Department</th>
                <th className="p-3.5">Language</th>
                <th className="p-3.5">Intake Status</th>
                <th className="p-3.5">Red-Flag Safety</th>
                <th className="p-3.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredPatients.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-neutral-400">
                    No patients match this filter.
                  </td>
                </tr>
              )}
              {filteredPatients.map((p) => {
                const activeFlags = p.redFlagAlerts.filter((r) => r.status !== "resolved");
                return (
                  <tr key={p.id} className="hover:bg-neutral-50/60">
                    <td className="p-3.5 font-bold text-neutral-950">{p.tokenNumber}</td>
                    <td className="p-3.5 font-semibold text-neutral-800">{p.name}</td>
                    <td className="p-3.5 text-neutral-600">{p.age} / {p.gender.charAt(0)}</td>
                    <td className="p-3.5 text-neutral-600">{p.department}</td>
                    <td className="p-3.5 uppercase font-bold text-neutral-500">{p.preferredLanguage}</td>
                    <td className="p-3.5">
                      <select
                        value={p.queueStatus}
                        disabled={busyRow === p.id}
                        onChange={(e) => handleQueueChange(p.id, e.target.value as PatientProfile["queueStatus"])}
                        className="rounded-full border border-black/10 bg-neutral-50 px-2.5 py-1 text-[9px] font-bold uppercase text-neutral-800"
                      >
                        {QUEUE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3.5">
                      {activeFlags.length > 0 ? (
                        <span className="rounded-full bg-red-600 px-2.5 py-0.5 font-bold text-white text-[9px] uppercase">
                          {activeFlags.length} CRITICAL TRIAGE
                        </span>
                      ) : (
                        <span className="text-neutral-500 font-medium">Routine Queue</span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <Link
                        href="/health-passport"
                        onClick={() => selectPatient(p.id)}
                        className="text-neutral-900 hover:underline font-bold"
                      >
                        View Chart &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
