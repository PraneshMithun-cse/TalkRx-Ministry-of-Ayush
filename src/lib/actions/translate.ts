"use server";

import { groq, GROQ_TEXT_MODEL } from "@/lib/groq";
import type { IndicLanguage } from "@/components/talkrx/types";

const LANG_NAME: Record<IndicLanguage, string> = {
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
  mr: "Marathi",
  kn: "Kannada",
  ml: "Malayalam",
  gu: "Gujarati",
  pa: "Punjabi",
  od: "Odia",
  en: "English",
};

/**
 * Translates a batch of short UI strings (question prompts, quick-reply chips)
 * into the target Indic language. Returns the array in the same order and length;
 * on any failure it returns the input unchanged so the UI still works.
 */
export async function translateBatchAction(target: IndicLanguage, items: string[]): Promise<string[]> {
  const clean = items.map((s) => (s ?? "").toString());
  if (target === "en" || clean.length === 0) return clean;

  const schema = {
    type: "object",
    properties: {
      translations: { type: "array", items: { type: "string" } },
    },
    required: ["translations"],
    additionalProperties: false,
  } as const;

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      max_tokens: 1400,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            `Translate each string in the JSON array into ${LANG_NAME[target]} for a medical intake kiosk. ` +
            "Keep medical/Ayurvedic proper nouns (e.g. Amlapitta, Sandhivata, NAMASTE) and drug names as-is; " +
            "translate the surrounding words naturally. Return exactly the same number of items, same order, " +
            "in the 'translations' array. Do not add explanations.",
        },
        { role: "user", content: JSON.stringify(clean) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "ui_translation", schema, strict: true } },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return clean;
    const parsed = JSON.parse(raw) as { translations: string[] };
    if (!Array.isArray(parsed.translations) || parsed.translations.length !== clean.length) return clean;
    return parsed.translations.map((s, i) => (s && s.trim() ? s : clean[i]));
  } catch (err) {
    console.error("translateBatchAction failed", err);
    return clean;
  }
}
