import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkAdminCredentials, hasRole, verifySession } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Route protection (Baseline B1 + B3).
//
// Changes from upstream:
//   - Pages: require a *signed* session with role ADMIN (was: cookie === "true").
//   - /database added: it is a raw table browser that exposed submissions
//     (submitter emails) and private inventory to anonymous visitors.
//   - APIs: accept HTTP Basic with env credentials OR an admin session cookie.
//     No hardcoded fallback credentials: unset env = Basic auth disabled.
//
// Middleware is the first gate only. Pages and server actions check the role
// again (defense in depth), because matcher mistakes are easy to make.
// ---------------------------------------------------------------------------

const protectedPrefixes = ["/admin", "/data-pulls", "/database"];
const protectedApiPrefixes = ["/api/ingest", "/api/export"];

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** True if the request carries a valid, unexpired ADMIN session. */
async function isAdminSession(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  return hasRole(session?.role, "ADMIN");
}

/** True if the request carries correct HTTP Basic admin credentials. */
async function hasValidBasicAuth(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const sep = decoded.indexOf(":"); // password may itself contain ':'
    if (sep < 0) return false;
    return await checkAdminCredentials(decoded.slice(0, sep), decoded.slice(sep + 1));
  } catch {
    return false; // malformed base64
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Protected pages -> redirect to the login UI.
  if (matchesPrefix(pathname, protectedPrefixes)) {
    if (!(await isAdminSession(request))) {
      const loginUrl = new URL("/admin-login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // 2. Protected APIs -> 401 JSON (no WWW-Authenticate, avoids browser popups).
  if (matchesPrefix(pathname, protectedApiPrefixes)) {
    if ((await isAdminSession(request)) || (await hasValidBasicAuth(request))) {
      return NextResponse.next();
    }
    return new NextResponse(JSON.stringify({ error: "Unauthorized. Admin credentials required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/data-pulls/:path*",
    "/database/:path*",
    "/api/ingest/:path*",
    "/api/export"
  ]
};
