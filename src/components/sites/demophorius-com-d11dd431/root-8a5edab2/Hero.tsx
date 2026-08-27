"use client";

import React from "react";
import Link from "next/link";
import { Mic, Stethoscope, ArrowRight } from "lucide-react";

export function Hero() {
  return (
    // Header is a sticky h-20 (5rem) bar; fill the rest of the viewport exactly.
    <section className="relative w-full overflow-hidden bg-[#eef4fb] h-[calc(100vh-5rem)] min-h-[520px]">
      {/* Full-bleed banner */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/talkrx-hero.png"
        alt="TalkRx — India's clinical bottleneck is not knowledge. It is minutes."
        className="absolute inset-0 h-full w-full object-cover object-center select-none"
        draggable={false}
      />

      {/* Bottom scrim for button legibility */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#eef4fb] via-[#eef4fb]/60 to-transparent" />

      {/* CTA */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-6 pb-8 sm:pb-10">
        <Link
          href="/case-taking"
          className="group inline-flex items-center gap-3 rounded-full bg-blue-600 px-7 py-4 text-xs sm:text-sm font-bold uppercase tracking-[1.5px] text-white shadow-[0_16px_40px_rgba(37,99,235,0.35)] hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98] transition-all"
          style={{ fontFamily: "var(--do-font-label)" }}
        >
          <Mic className="h-4 w-4" />
          <span>Launch Case-Taking Kiosk &amp; Doctor Console</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>

        <Link
          href="/doctor-dashboard"
          className="inline-flex items-center gap-2 text-[11px] sm:text-xs font-bold uppercase tracking-[1.5px] text-blue-800 hover:text-blue-950 transition-colors"
          style={{ fontFamily: "var(--do-font-label)" }}
        >
          <Stethoscope className="h-3.5 w-3.5" />
          <span>Go straight to the Doctor Console</span>
        </Link>
      </div>
    </section>
  );
}
