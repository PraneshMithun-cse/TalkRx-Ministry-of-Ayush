import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/case-taking(.*)",
  "/doctor-dashboard(.*)",
  "/health-passport(.*)",
  "/triage-operations(.*)",
  "/pharmacy-network(.*)",
  "/document-intelligence(.*)",
  "/ayush(.*)",
  "/longitudinal-timeline(.*)",
  "/onboarding(.*)",
]);

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

// When Clerk env vars are absent, don't crash the whole site — just pass requests
// through. Auth-gated pages will still fail without keys, but public pages render.
export default clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        await auth.protect();
      }
    })
  : () => NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
