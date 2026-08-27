import type { Metadata } from "next";
import { ModulePageShell } from "@/components/talkrx/ModulePageShell";
import { LongitudinalTimeline } from "@/components/talkrx/LongitudinalTimeline";

export const metadata: Metadata = {
  title: "Longitudinal Health Timeline — TalkRx",
  description:
    "Central intelligence layer unifying case-taking, consultations, pharmacy dispensations, lab reports, documents, and red-flag events with source provenance.",
};

export default function LongitudinalTimelinePage() {
  return (
    <ModulePageShell moduleId="longitudinal-timeline">
      <LongitudinalTimeline />
    </ModulePageShell>
  );
}
