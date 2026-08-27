"use server";

import { groq, GROQ_TEXT_MODEL } from "@/lib/groq";

export interface FollowUpResult {
  question: string | null;
  suggestions: string[];
}

const SCHEMA = {
  type: "object",
  properties: {
    needsFollowUp: { type: "boolean" },
    question: { type: "string", description: "The single follow-up question, empty string if none" },
    suggestions: { type: "array", items: { type: "string" }, description: "2-4 short tappable example answers" },
  },
  required: ["needsFollowUp", "question", "suggestions"],
  additionalProperties: false,
} as const;

/**
 * Adaptive branching: given everything the patient has said so far and the section they are in,
 * decide whether ONE short clinical follow-up is warranted before moving on.
 */
export async function nextFollowUpAction(
  answers: { category: string; question: string; answer: string }[],
  section: string,
  mode: "conventional" | "ayush"
): Promise<FollowUpResult> {
  const last = answers[answers.length - 1];
  if (!last || !last.answer.trim()) return { question: null, suggestions: [] };
  if (/\b(no|none|nil|nka|nkda|no known|nothing|not really)\b/i.test(last.answer.trim()) && last.answer.trim().length < 25) {
    return { question: null, suggestions: [] };
  }

  const transcript = answers.map((a) => `[${a.category}] ${a.answer}`).join("\n");

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are an adaptive OPD intake assistant. The patient is answering the '" +
            section +
            "' section" +
            (mode === "ayush" ? " of an AYUSH Dashavidha Pariksha" : "") +
            ". Based on their LAST answer, decide if ONE brief, specific follow-up question would " +
            "meaningfully improve the clinical picture. Examples: patient names an allergy -> ask the " +
            "reaction and how severe; patient reports pain -> ask site, radiation, character or severity; " +
            "reports a symptom -> ask duration, timing or triggers; names a medicine -> ask dose and " +
            "whether they take it regularly. If the last answer is already complete, is a plain 'no', or a " +
            "follow-up would be redundant, set needsFollowUp=false and question=''. Never ask more than one " +
            "question. Keep it under 15 words, plain language. Provide 2-4 short example answers.",
        },
        { role: "user", content: `Answers so far:\n${transcript}\n\nMost recent answer: "${last.answer}"` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "follow_up", schema: SCHEMA, strict: true } },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return { question: null, suggestions: [] };
    const parsed = JSON.parse(raw) as { needsFollowUp: boolean; question: string; suggestions: string[] };
    if (!parsed.needsFollowUp || !parsed.question?.trim()) return { question: null, suggestions: [] };
    return {
      question: parsed.question.trim(),
      suggestions: (parsed.suggestions ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4),
    };
  } catch (err) {
    console.error("nextFollowUpAction failed", err);
    return { question: null, suggestions: [] };
  }
}
