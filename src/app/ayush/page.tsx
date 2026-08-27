import type { Metadata } from "next";
import { ModulePageShell } from "@/components/talkrx/ModulePageShell";
import { AyushModule } from "@/components/talkrx/AyushModule";

export const metadata: Metadata = {
  title: "AYUSH Dashavidha Pariksha Console — TalkRx",
  description:
    "Tenfold (Dashavidha) and eightfold (Ashtavidha) constitutional assessment with NAMASTE morbidity codes mapped to WHO ICD-11 TM-2.",
};

export default function AyushPage() {
  return (
    <ModulePageShell moduleId="ayush">
      <AyushModule />
    </ModulePageShell>
  );
}
