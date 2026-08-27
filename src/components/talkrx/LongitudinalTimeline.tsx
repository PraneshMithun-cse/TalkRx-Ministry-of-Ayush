"use client";

import React, { useMemo, useState } from "react";
import { History } from "lucide-react";
import { useVault } from "./VaultContext";
import { TimelineStream } from "./TimelineStream";
import type { TimelineEvent } from "./types";

export function LongitudinalTimeline() {
  const { isHydrated, currentPatient, patients } = useVault();
  const [scope, setScope] = useState<"current" | "all">("current");

  const patient = currentPatient ?? patients[0] ?? null;

  const events: TimelineEvent[] = useMemo(() => {
    if (scope === "all") {
      return patients
        .flatMap((p) => p.timeline.map((e) => ({ ...e, subtitle: `${p.name} · ${e.subtitle}` })))
        .sort((a, b) => `${b.date} ${b.time ?? ""}`.localeCompare(`${a.date} ${a.time ?? ""}`));
    }
    return patient?.timeline ?? [];
  }, [scope, patients, patient]);

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-black/[0.06] pb-5 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-neutral-900" />
            <span
              className="text-[11px] font-bold uppercase tracking-[1.5px] text-neutral-800"
              style={{ fontFamily: "var(--do-font-label)" }}
            >
              Central Intelligence Layer &bull; Longitudinal Health Timeline
            </span>
          </div>
          <h3 className="mt-1 text-2xl font-normal tracking-tight text-neutral-950">
            Connected Patient Healthcare Journey
          </h3>
          <p className="text-xs text-neutral-500">
            Unifies consultations, pharmacy dispensations, lab reports, AI case-taking, and adverse drug reactions
            {patient && scope === "current" ? ` for ${patient.name}` : ""}.
          </p>
        </div>

        <div className="flex gap-1.5 text-xs shrink-0">
          {[
            { id: "current", label: patient ? patient.name : "Current" },
            { id: "all", label: `All Patients (${patients.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScope(tab.id as "current" | "all")}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                scope === tab.id ? "bg-neutral-950 text-white shadow-sm" : "bg-white/60 text-neutral-600 hover:text-black hover:bg-white"
              }`}
              style={{ fontFamily: "var(--do-font-label)" }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {!isHydrated ? (
        <div className="rounded-3xl border border-black/[0.08] bg-white/60 p-10 text-center text-xs text-neutral-400 animate-pulse">
          Loading connected timeline&hellip;
        </div>
      ) : (
        <TimelineStream
          events={events}
          variant="card"
          showSearch
          showFilters
          emptyStateLabel="No timeline events yet. Complete a case-taking session or upload a document to populate the journey."
        />
      )}
    </div>
  );
}
