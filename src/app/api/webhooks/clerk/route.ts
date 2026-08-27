import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

interface ClerkEmail {
  id: string;
  email_address: string;
}

interface ClerkUserData {
  id: string;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmail[];
  first_name?: string | null;
  last_name?: string | null;
}

interface ClerkEvent {
  type: string;
  data: ClerkUserData;
}

/**
 * Verifies a Svix (Clerk) webhook signature without the `svix` package.
 * Signed content is `${id}.${timestamp}.${body}`, HMAC-SHA256 with the base64
 * secret body, compared against any `v1,` entry in the `svix-signature` header.
 */
function verifySvix(secret: string, headers: Headers, body: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${body}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  return signature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean)
    .some((sig) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch {
        return false;
      }
    });
}

function resolveEmail(data: ClerkUserData): string | undefined {
  const list = data.email_addresses ?? [];
  const primary = list.find((e) => e.id === data.primary_email_address_id) ?? list[0];
  return primary?.email_address;
}

function resolveName(data: ClerkUserData): string | undefined {
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return name || undefined;
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const secret = process.env.CLERK_WEBHOOK_SECRET;

  if (secret) {
    if (!verifySvix(secret, req.headers, body)) {
      return new Response("Invalid signature", { status: 401 });
    }
  }

  let event: ClerkEvent;
  try {
    event = JSON.parse(body) as ClerkEvent;
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const { type, data } = event;

  try {
    if (type === "user.updated" || type === "user.created") {
      // Role is assigned during in-app onboarding, so only sync identity fields
      // onto rows that already exist. `updateMany` is a no-op when absent.
      await prisma.user.updateMany({
        where: { clerkId: data.id },
        data: {
          email: resolveEmail(data),
          ...(resolveName(data) ? { name: resolveName(data)! } : {}),
        },
      });
    } else if (type === "user.deleted") {
      await prisma.user.deleteMany({ where: { clerkId: data.id } });
    }
  } catch (err) {
    console.error("clerk webhook: db write failed", err);
    return new Response("DB error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true, type }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
