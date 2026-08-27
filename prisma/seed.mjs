import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  process.env.PRISMA_CONNECTION_STRING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  "postgresql://postgres:postgres@localhost:5432/talkrx";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const today = new Date().toISOString().slice(0, 10);
const now = () => new Date();

async function wipe() {
  // child → parent
  await prisma.extractedLabResult.deleteMany();
  await prisma.redFlagAlert.deleteMany();
  await prisma.timelineEvent.deleteMany();
  await prisma.accessAuditLog.deleteMany();
  await prisma.consentAuthorization.deleteMany();
  await prisma.patientCondition.deleteMany();
  await prisma.extractedMedication.deleteMany();
  await prisma.selfAssessmentEntry.deleteMany();
  await prisma.doctorConsultationRecord.deleteMany();
  await prisma.medicalDocument.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await wipe();

  // ---- Staff users -------------------------------------------------------
  const doctor = await prisma.user.create({
    data: {
      clerkId: "seed_doctor_rajan",
      email: "dr.rajan@talkrx.demo",
      role: "DOCTOR",
      name: "Dr. A. Rajan, MD",
      licenseNumber: "TN-MED-88214",
      organization: "District Hospital Tirunelveli",
      department: "General Medicine",
    },
  });

  await prisma.user.create({
    data: {
      clerkId: "seed_pharmacy_apollo",
      email: "apollo419@talkrx.demo",
      role: "PHARMACY",
      name: "Apollo Pharmacy #419",
      organization: "Apollo Pharmacy",
      department: "Retail Dispensation",
    },
  });

  await prisma.user.create({
    data: {
      clerkId: "seed_staff_frontdesk",
      email: "frontdesk@talkrx.demo",
      role: "STAFF",
      name: "OPD Front Desk",
      organization: "District Hospital Tirunelveli",
      department: "Registration",
    },
  });

  // ---- Patient 1: Kamala — returning, diabetic, red-flag free -----------
  const kamalaUser = await prisma.user.create({
    data: { clerkId: "seed_patient_kamala", email: null, role: "PATIENT", name: "Kamala Sundaram" },
  });
  const kamala = await prisma.patient.create({
    data: {
      userId: kamalaUser.id,
      serialNumber: "48217790",
      abhaId: "14-8921-4402-9912",
      abhaAddress: "kamala.s@abdm",
      name: "Kamala Sundaram",
      age: 58,
      gender: "Female",
      phone: "+91 98402 21174",
      bloodGroup: "B+",
      preferredLanguage: "ta",
      isReturningPatient: true,
      tokenNumber: "TK-104",
      department: "General Medicine",
      hospitalName: "District Hospital Tirunelveli",
      queueStatus: "case-completed",
      allergies: ["Sulfa Drugs (Sulfonamides) — Severe Angioedema (2022)"],
      structuredSummary: {
        chiefComplaint: "Burning epigastric pain and acid reflux",
        duration: "10 days",
        hpiNarrative:
          "58F, known T2DM and hypertension, reports 10 days of burning epigastric pain worse at night and after meals, with sour regurgitation. No haematemesis, melaena, weight loss or dysphagia. Partial relief with over-the-counter antacid.",
        pertinentPositives: ["Nocturnal epigastric burning", "Post-prandial worsening", "Sour regurgitation"],
        pertinentNegatives: ["No haematemesis", "No melaena", "No weight loss", "No chest pain on exertion"],
        redFlagsDetected: [],
        allergies: [{ allergen: "Sulfonamides", reaction: "Angioedema", severity: "Life-Threatening" }],
        currentMedications: [],
        pastMedicalHistory: ["Type 2 Diabetes Mellitus (8 yrs)", "Essential Hypertension (5 yrs)"],
        pastSurgicalHistory: ["LSCS x2 (remote)"],
        familyHistory: ["Father — Ischaemic heart disease"],
        lifestyle: { smoking: "Never", alcohol: "Never", diet: "Vegetarian, high refined carbs", sleep: "6h, disturbed" },
        reviewOfSystems: { GI: "Epigastric burning, reflux", CVS: "No angina, no dyspnoea", CNS: "No focal deficit" },
        generatedAt: `${today} 09:12`,
        intakeDurationSeconds: 386,
        vitals: {
          bloodPressure: "138/86",
          bloodPressureStatus: "Stage 1 Hypertension",
          bloodGlucose: "162",
          bloodGlucoseType: "Fasting • Monitored",
          heartRate: "78 bpm",
          spO2: "98%",
          temperature: "98.4 °F",
          weight: "64 kg",
          height: "154 cm",
        },
      },
      conditions: {
        create: [
          { label: "Type 2 Diabetes Mellitus", kind: "condition", source: "doctor-prescribed", confidence: 1, verified: true, recordedBy: "Dr. A. Rajan, MD" },
          { label: "Essential Hypertension", kind: "condition", source: "doctor-prescribed", confidence: 1, verified: true, recordedBy: "Dr. A. Rajan, MD" },
          { label: "Amlapitta (Hyperacidity)", kind: "symptom", source: "patient-reported", confidence: 0.82, verified: false, recordedBy: "Self-reported" },
        ],
      },
      medications: {
        create: [
          { rawText: "Metformin 500mg BD", standardMolecule: "Metformin", brandName: "Glycomet 500", dosage: "500 mg", frequency: "BD", duration: "Ongoing", confidence: 1, confirmedByPatient: true, status: "active", source: "doctor-prescribed", prescribedBy: "Dr. A. Rajan, MD" },
          { rawText: "Telmisartan 40mg OD", standardMolecule: "Telmisartan", brandName: "Telma 40", dosage: "40 mg", frequency: "OD", duration: "Ongoing", confidence: 1, confirmedByPatient: true, status: "active", source: "doctor-prescribed", prescribedBy: "Dr. A. Rajan, MD" },
          { rawText: "Antacid syrup PRN", standardMolecule: "Aluminium Hydroxide + Magnesium Hydroxide", dosage: "10 ml", frequency: "SOS", duration: "10 days", confidence: 0.7, confirmedByPatient: true, status: "active", source: "patient-reported" },
        ],
      },
      consents: {
        create: [
          {
            granteeName: "Dr. A. Rajan (MD, General Medicine)",
            granteeType: "Doctor",
            purpose: "Routine OPD Consultation & Prescription Reconciliation",
            dataCategories: ["All History", "Active Medications", "Lab Reports"],
            accessLevel: "Full Care Access",
            validFrom: now(),
            validTill: new Date(Date.now() + 12 * 3600 * 1000),
            status: "Active",
          },
        ],
      },
      auditLog: {
        create: [
          { accessorName: "Dr. A. Rajan (MD)", accessorRole: "Treating Physician", facility: "District Hospital Tirunelveli", action: "Read Case Summary", dataAccessed: "60s HPI, Sulfa allergy, active meds", ipLocation: "Hospital LAN — Room 104" },
        ],
      },
      timeline: {
        create: [
          { date: today, time: "09:12", title: "AI Case-Taking Completed", subtitle: "Burning epigastric pain and acid reflux", category: "case-taking", source: "patient-reported", sourceEntity: "TalkRx Case-Taking Kiosk", facility: "TalkRx Digital", description: "Patient completed multilingual intake in Tamil. No red-flags detected.", tags: ["Case-Taking"] },
          { date: today, time: "09:40", title: "Doctor Consultation Recorded", subtitle: "Dr. A. Rajan · District Hospital Tirunelveli", category: "consultation", source: "doctor-prescribed", sourceEntity: "TalkRx Doctor Dashboard", doctorName: "Dr. A. Rajan, MD", facility: "District Hospital Tirunelveli", description: "Impression: GERD on background of T2DM/HTN. Started PPI, reinforced glycaemic control.", tags: ["Doctor-Verified", "1 Diagnosis"] },
        ],
      },
    },
  });

  await prisma.doctorConsultationRecord.create({
    data: {
      patientId: kamala.id,
      doctorId: doctor.id,
      doctorName: "Dr. A. Rajan, MD",
      licenseNumber: "TN-MED-88214",
      organization: "District Hospital Tirunelveli",
      clinicalNotes: "GERD symptoms, no alarm features. T2DM sub-optimally controlled (FBS 162).",
      recommendations: "Pantoprazole 40mg OD before breakfast x 4 weeks. Diet counselling. Review HbA1c.",
    },
  });

  // ---- Patient 2: Suresh — ACTIVE CARDIAC RED FLAG --------------------
  const sureshUser = await prisma.user.create({
    data: { clerkId: "seed_patient_suresh", email: null, role: "PATIENT", name: "Suresh Kumar" },
  });
  const suresh = await prisma.patient.create({
    data: {
      userId: sureshUser.id,
      serialNumber: "55019284",
      name: "Suresh Kumar",
      age: 47,
      gender: "Male",
      phone: "+91 90031 55210",
      bloodGroup: "O+",
      preferredLanguage: "hi",
      tokenNumber: "TK-108",
      department: "General Medicine",
      hospitalName: "District Hospital Tirunelveli",
      queueStatus: "triage-alert",
      allergies: [],
      structuredSummary: {
        chiefComplaint: "Central chest heaviness radiating to left arm with sweating",
        duration: "40 minutes",
        hpiNarrative:
          "47M, smoker, sudden central chest heaviness for 40 minutes radiating to the left arm, associated with profuse sweating and breathlessness. Deterministic rule RULE_ACS_01 triggered at intake.",
        pertinentPositives: ["Radiation to left arm", "Diaphoresis", "Exertional onset"],
        pertinentNegatives: ["No trauma", "No fever"],
        redFlagsDetected: [
          {
            category: "cardiac",
            severity: "critical",
            matchedRule: "RULE_ACS_01",
            patientStatement: "chhati me bahut bhaari pan hai, baaye haath me dard jaa raha hai aur bahut paseena aa raha hai",
            escalatedTo: "Emergency Triage Bed #1 • Dr. K. Balaji on duty",
            actionRequired: "Immediate ECG, troponin, aspirin 300mg, shift to emergency triage.",
          },
        ],
        allergies: [],
        currentMedications: [],
        pastMedicalHistory: ["Smoker 20 pack-years"],
        pastSurgicalHistory: [],
        familyHistory: ["Brother — MI at 50"],
        lifestyle: { smoking: "Current, 1 pack/day", alcohol: "Occasional", diet: "Mixed", sleep: "6h" },
        reviewOfSystems: { CVS: "Chest heaviness, diaphoresis", RS: "Mild breathlessness" },
        generatedAt: `${today} 10:03`,
        intakeDurationSeconds: 142,
        vitals: {
          bloodPressure: "148/94",
          bloodPressureStatus: "Elevated",
          bloodGlucose: "121",
          bloodGlucoseType: "Random",
          heartRate: "104 bpm",
          spO2: "96%",
          temperature: "98.8 °F",
        },
      },
      redFlagAlerts: {
        create: [
          {
            category: "cardiac",
            severity: "critical",
            matchedRule: "RULE_ACS_01",
            patientStatement: "chhati me bahut bhaari pan hai, baaye haath me dard jaa raha hai aur bahut paseena aa raha hai",
            escalatedTo: "Emergency Triage Bed #1 • Dr. K. Balaji on duty",
            status: "active",
            actionRequired: "Immediate ECG, troponin, aspirin 300mg, shift to emergency triage.",
          },
        ],
      },
      conditions: {
        create: [
          { label: "Chest pain — query acute coronary syndrome", kind: "symptom", source: "patient-reported", confidence: 0.95, verified: false, recordedBy: "Self-reported" },
        ],
      },
      timeline: {
        create: [
          { date: today, time: "10:03", title: "AI Case-Taking Completed", subtitle: "Central chest heaviness radiating to left arm", category: "case-taking", source: "patient-reported", sourceEntity: "TalkRx Case-Taking Kiosk", facility: "TalkRx Digital", description: "RULE_ACS_01 triggered — critical cardiac red-flag. Token escalated to position #1.", tags: ["Case-Taking", "Red-Flag"], isRedFlag: true },
        ],
      },
    },
  });

  // ---- Patient 3: Ramesh — AYUSH Dashavidha + document + lab ---------
  const rameshUser = await prisma.user.create({
    data: { clerkId: "seed_patient_ramesh", email: null, role: "PATIENT", name: "Ramesh Sharma" },
  });
  const ramesh = await prisma.patient.create({
    data: {
      userId: rameshUser.id,
      serialNumber: "77340561",
      abhaId: "72-1145-9930-2210",
      abhaAddress: "ramesh.sharma@abdm",
      name: "Ramesh Sharma",
      age: 52,
      gender: "Male",
      phone: "+91 99520 71130",
      bloodGroup: "A+",
      preferredLanguage: "hi",
      isReturningPatient: true,
      tokenNumber: "AY-021",
      department: "AYUSH OPD",
      hospitalName: "District Hospital Tirunelveli",
      queueStatus: "consulting",
      allergies: ["No known drug allergies (NKDA)"],
      structuredSummary: {
        chiefComplaint: "Chronic acidity, joint stiffness and disturbed sleep",
        duration: "6 months",
        hpiNarrative:
          "52M seeking Ayurvedic care for 6 months of hyperacidity (Amlapitta), early-morning knee stiffness and non-restorative sleep. Dashavidha Pariksha completed in queue.",
        pertinentPositives: ["Burning sensation post meals", "Knee crepitus", "Irritability"],
        pertinentNegatives: ["No joint swelling", "No fever"],
        redFlagsDetected: [],
        allergies: [],
        currentMedications: [],
        pastMedicalHistory: ["Amlapitta", "Sandhivata (early osteoarthritis)"],
        pastSurgicalHistory: [],
        familyHistory: ["Mother — diabetes"],
        lifestyle: { smoking: "Never", alcohol: "Never", diet: "Spicy, irregular timing", sleep: "5h, disturbed" },
        reviewOfSystems: { GI: "Amlapitta", MSK: "Sandhivata knees" },
        generatedAt: `${today} 08:50`,
        intakeDurationSeconds: 604,
        vitals: {
          bloodPressure: "126/80",
          bloodPressureStatus: "Optimal Range",
          bloodGlucose: "108",
          bloodGlucoseType: "Fasting",
          heartRate: "72 bpm",
          spO2: "99%",
          temperature: "98.6 °F",
        },
      },
      ayushData: {
        prakriti: {
          primaryDosha: "Pitta-Vata",
          scores: { vata: 34, pitta: 46, kapha: 20 },
          physicalTraits: "Medium build, warm skin, sharp features, tendency to early greying.",
          psychologicalTraits: "Sharp intellect, goal-driven, irritable under stress.",
        },
        vikriti: {
          imbalancedDosha: "Pitta",
          currentDeviation: "Pitta aggravation in Amashaya — Amlapitta with Vata involvement in Sandhi.",
          namasteMorbidityCode: "AYU-MOR-0419 (Amlapitta)",
          whoIcd11Tm2Code: "TM2-GA-084: Pittaja Grahani Disorder",
        },
        sara: { tissueQuality: "Madhyama (Medium)", dominantTissue: "Rakta-Mamsa" },
        samhanana: { build: "Moderate" },
        pramana: { anthropometry: "Proportionate" },
        satmya: { habituation: "Mixed" },
        sattva: { mentalStrength: "Madhyama (Moderate)" },
        aharaShakti: { abhyavaharana: "Moderate", jaranaShakti: "Sluggish" },
        vyayamaShakti: { exerciseCapacity: "Moderate" },
        vaya: { ageClassification: "Madhyama (Middle age)" },
        ashtavidha: {
          nadi: "Pitta-Vata, 76/min, Sarpa-Manduka gati",
          mutra: "Slightly yellow, normal frequency",
          mala: "Tends to loose, burning",
          jihva: "Sama (coated) centrally",
          shabda: "Clear, assertive",
          sparsha: "Warm, Ushna",
          drik: "Sharp, mild redness of sclera",
          akriti: "Madhyama, proportionate",
        },
        agni: "Tikshnagni (Intense)",
        koshtha: "Mridu (Soft)",
      },
      conditions: {
        create: [
          { label: "Amlapitta (Hyperacidity syndrome)", kind: "diagnosis", source: "ayush-assessed", confidence: 0.9, verified: true, recordedBy: "Vaidya S. Menon" },
          { label: "Sandhivata (Early osteoarthritis, knees)", kind: "diagnosis", source: "ayush-assessed", confidence: 0.85, verified: true, recordedBy: "Vaidya S. Menon" },
        ],
      },
      medications: {
        create: [
          { rawText: "Avipattikar Churna 3g BD", standardMolecule: "Avipattikar Churna", dosage: "3 g", frequency: "BD", duration: "30 days", confidence: 0.9, confirmedByPatient: true, status: "active", source: "ayush-assessed", prescribedBy: "Vaidya S. Menon" },
          { rawText: "Yogaraja Guggulu 500mg BD", standardMolecule: "Yogaraja Guggulu", dosage: "500 mg", frequency: "BD", duration: "30 days", confidence: 0.88, confirmedByPatient: true, status: "active", source: "ayush-assessed", prescribedBy: "Vaidya S. Menon" },
        ],
      },
      timeline: {
        create: [
          { date: today, time: "08:50", title: "Dashavidha Pariksha Completed", subtitle: "Pitta-Vata Prakriti • Pitta Vikriti", category: "ayush", source: "ayush-assessed", sourceEntity: "TalkRx AYUSH Kiosk", facility: "TalkRx Digital", description: "10-fold constitutional assessment completed in queue. NAMASTE AYU-MOR-0419 mapped to ICD-11 TM2-GA-084.", tags: ["AYUSH", "Dashavidha Pariksha"] },
        ],
      },
    },
  });

  const rameshDoc = await prisma.medicalDocument.create({
    data: {
      patientId: ramesh.id,
      title: "Complete Blood Count + LFT — Thyrocare",
      category: "lab_report",
      date: today,
      facility: "Thyrocare Central Diagnostic Laboratory",
      doctorName: "Dr. (Lab) Priya N.",
      ocrConfidence: 0.94,
      extractedDiagnoses: ["Mild transaminitis"],
      rawText: "Hb 13.8 g/dL; TLC 7200 /uL; Platelets 2.4 L/uL; SGPT 58 U/L (H); SGOT 44 U/L (H); Total Bilirubin 0.9 mg/dL",
      verified: true,
      extractedLabs: {
        create: [
          { parameter: "Haemoglobin", value: "13.8", unit: "g/dL", referenceRange: "13.0–17.0", isAbnormal: false, loincCode: "718-7", sourceDoc: "CBC + LFT — Thyrocare", date: today },
          { parameter: "SGPT (ALT)", value: "58", unit: "U/L", referenceRange: "7–40", isAbnormal: true, loincCode: "1742-6", sourceDoc: "CBC + LFT — Thyrocare", date: today },
          { parameter: "SGOT (AST)", value: "44", unit: "U/L", referenceRange: "8–40", isAbnormal: true, loincCode: "1920-8", sourceDoc: "CBC + LFT — Thyrocare", date: today },
        ],
      },
    },
  });

  await prisma.timelineEvent.create({
    data: {
      patientId: ramesh.id,
      date: today,
      time: "09:05",
      title: "Medical Document Digitized",
      subtitle: rameshDoc.title,
      category: "document",
      source: "document-extracted",
      sourceEntity: "TalkRx Document Intelligence",
      facility: "Thyrocare Central Diagnostic Laboratory",
      description: "AI OCR extracted 3 lab results (2 abnormal) and 1 diagnosis mention from the uploaded lab report.",
      tags: ["Document-Extracted", "94% OCR Confidence"],
    },
  });

  const counts = {
    users: await prisma.user.count(),
    patients: await prisma.patient.count(),
    redFlags: await prisma.redFlagAlert.count(),
    documents: await prisma.medicalDocument.count(),
    timeline: await prisma.timelineEvent.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
