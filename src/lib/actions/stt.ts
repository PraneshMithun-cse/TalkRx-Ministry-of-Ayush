"use server";

import { groq } from "@/lib/groq";
import type { IndicLanguage } from "@/components/talkrx/types";

/** Whisper large v3 turbo — Groq speech-to-text. Maps our Indic codes to ISO-639-1. */
const LANG_ISO: Record<IndicLanguage, string> = {
  hi: "hi",
  ta: "ta",
  te: "te",
  bn: "bn",
  mr: "mr",
  kn: "kn",
  ml: "ml",
  gu: "gu",
  pa: "pa",
  od: "or",
  en: "en",
};

export interface TranscriptionResult {
  text: string;
  language: string;
}

export async function transcribeAudioAction(formData: FormData): Promise<TranscriptionResult> {
  const file = formData.get("audio");
  const langRaw = String(formData.get("language") ?? "en") as IndicLanguage;
  if (!(file instanceof File)) throw new Error("No audio provided");

  const iso = LANG_ISO[langRaw] ?? "en";

  try {
    const res = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",
      language: iso,
      response_format: "json",
      temperature: 0,
    });
    return { text: (res.text ?? "").trim(), language: iso };
  } catch (err) {
    console.error("transcribeAudioAction: Groq Whisper failed", err);
    throw new Error("Voice transcription is unavailable right now — please type your answer.");
  }
}
