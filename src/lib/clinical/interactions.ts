import "server-only";

/**
 * Deterministic prescription safety rules for the OPD prescribe flow.
 * Not exhaustive — a demonstrable, auditable rule engine covering the highest-yield
 * OPD contraindications. Molecule matching is substring, case-insensitive.
 */

export type SafetyLevel = "blocked" | "warning" | "safe";

export interface SafetyFinding {
  level: Exclude<SafetyLevel, "safe">;
  rule: string;
  detail: string;
}

export interface SafetyResult {
  level: SafetyLevel;
  findings: SafetyFinding[];
}

interface AllergyRule {
  /** substrings that identify the allergy in a patient's free-text allergy list */
  allergyMatch: string[];
  /** drug substrings that are contraindicated for that allergy */
  drugMatch: string[];
  rule: string;
  detail: string;
}

const ALLERGY_RULES: AllergyRule[] = [
  {
    allergyMatch: ["sulfa", "sulfonamide", "cotrimoxazole", "septran"],
    drugMatch: ["sulfa", "cotrimoxazole", "cotrim", "sulfamethoxazole", "sulfasalazine", "furosemide", "acetazolamide", "celecoxib"],
    rule: "RULE_ALLERGY_SULFA",
    detail: "Documented sulfonamide allergy — cross-reactive with the prescribed agent.",
  },
  {
    allergyMatch: ["penicillin", "amoxicillin", "ampicillin", "augmentin"],
    drugMatch: ["penicillin", "amoxicillin", "ampicillin", "augmentin", "piperacillin", "cloxacillin", "cephalexin", "cefuroxime", "ceftriaxone", "cefixime"],
    rule: "RULE_ALLERGY_BETALACTAM",
    detail: "Beta-lactam allergy — penicillins and (with ~2% cross-reactivity) cephalosporins are contraindicated.",
  },
  {
    allergyMatch: ["nsaid", "aspirin", "ibuprofen", "diclofenac", "asthma"],
    drugMatch: ["ibuprofen", "diclofenac", "naproxen", "aspirin", "ketorolac", "aceclofenac", "piroxicam", "indomethacin"],
    rule: "RULE_ALLERGY_NSAID",
    detail: "NSAID hypersensitivity / NSAID-exacerbated respiratory disease — avoid non-selective NSAIDs.",
  },
  {
    allergyMatch: ["egg", "gelatin"],
    drugMatch: ["propofol"],
    rule: "RULE_ALLERGY_EGG",
    detail: "Egg/soy allergy noted — propofol lipid emulsion caution.",
  },
];

interface DrugDrugRule {
  a: string[];
  b: string[];
  level: Exclude<SafetyLevel, "safe">;
  rule: string;
  detail: string;
}

const DRUG_DRUG_RULES: DrugDrugRule[] = [
  {
    a: ["warfarin", "acenocoumarol"],
    b: ["aspirin", "ibuprofen", "diclofenac", "naproxen", "clopidogrel", "ketorolac"],
    level: "blocked",
    rule: "RULE_DDI_ANTICOAG_NSAID",
    detail: "Anticoagulant + antiplatelet/NSAID — major bleeding risk.",
  },
  {
    a: ["warfarin"],
    b: ["fluconazole", "metronidazole", "ciprofloxacin", "amiodarone"],
    level: "warning",
    rule: "RULE_DDI_WARFARIN_POTENTIATOR",
    detail: "CYP2C9 inhibition potentiates warfarin — INR monitoring required.",
  },
  {
    a: ["metformin"],
    b: ["contrast", "iohexol", "iodinated"],
    level: "warning",
    rule: "RULE_DDI_METFORMIN_CONTRAST",
    detail: "Hold metformin around iodinated contrast — lactic acidosis risk.",
  },
  {
    a: ["spironolactone", "amiloride", "eplerenone"],
    b: ["potassium", "enalapril", "ramipril", "lisinopril", "losartan", "telmisartan"],
    level: "warning",
    rule: "RULE_DDI_HYPERKALEMIA",
    detail: "K-sparing diuretic + ACEi/ARB/K supplement — hyperkalemia risk.",
  },
  {
    a: ["clarithromycin", "erythromycin", "ketoconazole", "itraconazole"],
    b: ["atorvastatin", "simvastatin", "lovastatin"],
    level: "warning",
    rule: "RULE_DDI_STATIN_CYP3A4",
    detail: "Strong CYP3A4 inhibitor + statin — rhabdomyolysis risk.",
  },
  {
    a: ["tramadol", "sertraline", "fluoxetine", "amitriptyline", "linezolid"],
    b: ["tramadol", "sertraline", "fluoxetine", "amitriptyline", "linezolid", "ondansetron"],
    level: "warning",
    rule: "RULE_DDI_SEROTONIN",
    detail: "Multiple serotonergic agents — serotonin syndrome risk.",
  },
];

const DUP_CLASSES: { name: string; members: string[] }[] = [
  { name: "ACE inhibitor", members: ["enalapril", "ramipril", "lisinopril", "perindopril"] },
  { name: "ARB", members: ["losartan", "telmisartan", "olmesartan", "valsartan"] },
  { name: "PPI", members: ["omeprazole", "pantoprazole", "rabeprazole", "esomeprazole"] },
  { name: "Statin", members: ["atorvastatin", "rosuvastatin", "simvastatin"] },
  { name: "Sulfonylurea", members: ["glimepiride", "gliclazide", "glipizide", "glibenclamide"] },
  { name: "NSAID", members: ["ibuprofen", "diclofenac", "naproxen", "aceclofenac", "ketorolac"] },
];

function norm(s: string): string {
  return s.toLowerCase();
}

function hit(haystack: string, needles: string[]): boolean {
  const h = norm(haystack);
  return needles.some((n) => h.includes(n));
}

export function checkPrescriptionSafety(
  drugName: string,
  allergies: string[],
  activeMedicationMolecules: string[]
): SafetyResult {
  const findings: SafetyFinding[] = [];
  const drug = norm(drugName);

  for (const r of ALLERGY_RULES) {
    const hasAllergy = allergies.some((a) => hit(a, r.allergyMatch));
    if (hasAllergy && r.drugMatch.some((d) => drug.includes(d))) {
      findings.push({ level: "blocked", rule: r.rule, detail: r.detail });
    }
  }

  for (const r of DRUG_DRUG_RULES) {
    const newDrugMatchesA = r.a.some((x) => drug.includes(x));
    const newDrugMatchesB = r.b.some((x) => drug.includes(x));
    const activeHasA = activeMedicationMolecules.some((m) => hit(m, r.a));
    const activeHasB = activeMedicationMolecules.some((m) => hit(m, r.b));
    if ((newDrugMatchesA && activeHasB) || (newDrugMatchesB && activeHasA)) {
      findings.push({ level: r.level, rule: r.rule, detail: r.detail });
    }
  }

  for (const cls of DUP_CLASSES) {
    const newIn = cls.members.some((x) => drug.includes(x));
    const activeIn = activeMedicationMolecules.find((m) => hit(m, cls.members));
    if (newIn && activeIn) {
      findings.push({
        level: "warning",
        rule: "RULE_THERAPEUTIC_DUPLICATION",
        detail: `Therapeutic duplication — patient already on a ${cls.name} (${activeIn}).`,
      });
    }
  }

  const blocked = findings.some((f) => f.level === "blocked");
  return { level: blocked ? "blocked" : findings.length ? "warning" : "safe", findings };
}
