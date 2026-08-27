# TalkRx

**AI-assisted patient case-taking and consent-driven Health Passport for Indian OPDs.**

TalkRx turns the 20+ minutes a patient spends waiting in an outpatient queue into a
structured, multilingual clinical history — a 60-second physician-ready summary,
a 10-fold AYUSH Dashavidha Pariksha, and a longitudinal Health Passport — all
recorded before the consultation begins.

Built for the Ministry of AYUSH problem statement, aligned to ABDM / FHIR R4 and the
DPDP Act 2023.

---

## Why

In high-volume primary care, consultations often run under 2–3 minutes, yet
70–80% of diagnostic accuracy comes from history alone. TalkRx moves history-taking
*upstream* — into the waiting room — with an adaptive voice + touch kiosk that
speaks 11 Indian languages, branches its questions based on the patient's answers,
runs deterministic red-flag triage, and hands the doctor a coded summary.

---

## Modules

| Route | What it does |
| --- | --- |
| `/case-taking` | Multilingual adaptive intake kiosk. Voice (Groq Whisper) + touch, AI follow-up questions, Conventional and AYUSH streams, real-time red-flag triage. |
| `/doctor-dashboard` | 60-second structured HPI, longitudinal timeline, medication reconciliation, and a prescription builder with an allergy / drug-interaction safety guard. |
| `/triage-operations` | Live OPD queue, red-flag broadcast desk, operational metrics, FHIR R4 bundle export. |
| `/pharmacy-network` | Minimum-data-access dispensing portal with QR consent verification and closed-loop logging. |
| `/health-passport` | ABHA-linked digital passport, printable emergency QR, granular revocable consent, immutable audit ledger, document upload. |
| `/document-intelligence` | Prescription / lab-report OCR (Groq Vision for images, text-layer parsing for PDFs) with structured extraction that auto-fills the passport. |

---

## Tech

- **Next.js 16** (App Router) · **React 19** · **Tailwind CSS 4**
- **PostgreSQL** via **Prisma 7** (driver-adapter, `pg`)
- **Clerk** authentication
- **Groq** — `openai/gpt-oss-120b` (reasoning / extraction), `qwen/qwen3.6-27b` (vision OCR), `whisper-large-v3-turbo` (speech-to-text)

---

## Local development

### Prerequisites

- Node.js 20.9+
- A PostgreSQL 14+ database
- A [Clerk](https://clerk.com) application
- A [Groq](https://console.groq.com) API key

### Setup

```bash
npm install
```

Create a `.env` file in the project root:

```env
# PostgreSQL
DATABASE_URL="postgresql://user:password@localhost:5432/talkrx"

# Clerk (dashboard.clerk.com → API keys)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
CLERK_WEBHOOK_SECRET="whsec_..."           # optional, for /api/webhooks/clerk
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/onboarding"
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/onboarding"

# Groq (console.groq.com/keys)
GROQ_API_KEY="gsk_..."
```

Apply the schema and (optionally) load demo data:

```bash
npm run db:migrate      # prisma migrate dev
npm run db:seed         # 3 demo patients, incl. an active cardiac red-flag
```

Run it:

```bash
npm run dev
```

Open <http://localhost:3000>, sign up, and complete onboarding as a **Patient** or
**Clinical Staff**.

### Scripts

| Script | Action |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (`prisma generate` + `next build`) |
| `npm run db:migrate` | Create / apply migrations (dev) |
| `npm run db:deploy` | Apply migrations (CI / production) |
| `npm run db:seed` | Load demo data (wipes existing rows) |
| `npm run db:studio` | Prisma Studio |

---

## Deploy to Vercel

1. Import the repository into Vercel.
2. Provision a PostgreSQL database (Vercel Postgres, Neon, Supabase, …) and copy its
   connection string.
3. Add the environment variables from the `.env` block above in
   **Project → Settings → Environment Variables**.
4. Set the **Build Command** to `npm run vercel-build` (runs
   `prisma migrate deploy` before the build).
5. Deploy.

The Clerk webhook endpoint is `https://<your-domain>/api/webhooks/clerk` — add it in
the Clerk dashboard and set `CLERK_WEBHOOK_SECRET`.

---

## License

MIT
