import "server-only";
import { cache } from "react";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAuth } from "./supabase-auth";
import { normalizeEmail, resolvePrincipal } from "./admin-users";
import type { AdminPrincipal, Permission } from "./admin-users-shared";

// Multi-admin auth. Credentials + reset/invite emails are owned by Supabase
// Auth; this module owns the *session* (an HMAC-signed cookie) and the gate.
//
// Token format: `<expiry_ms>.<email_b64url>.<hex_signature>`. The signature is
// HMAC-SHA256 of `<expiry>.<email_b64url>` keyed by ADMIN_COOKIE_SECRET, so a
// leaked cookie can't be edited (different email/expiry) without the secret,
// and rotating the secret invalidates all sessions. The email is carried so we
// can re-resolve the principal (role + permissions) and honour live revocation
// on every request.

const COOKIE_NAME = "klicseo-admin";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function secret(): string {
  const s = process.env.ADMIN_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error("ADMIN_COOKIE_SECRET must be set (>=16 chars).");
  }
  return s;
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function unb64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

interface ParsedToken {
  expiry: number;
  email: string;
  valid: boolean;
}

function parseToken(token: string | undefined): ParsedToken | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiryStr, emailPart, sig] = parts;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return null;
  const expected = sign(`${expiryStr}.${emailPart}`);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  const ok = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  let email = "";
  try {
    email = unb64url(emailPart);
  } catch {
    return null;
  }
  return { expiry, email, valid: ok && expiry > Date.now() };
}

// Verify email+password against Supabase Auth, then require an active allowlist
// row. Returns the resolved principal on success, or null on any failure (bad
// password, unknown user, not allowlisted, revoked).
export async function verifyCredentials(
  emailRaw: string,
  password: string,
): Promise<AdminPrincipal | null> {
  const email = normalizeEmail(emailRaw);
  if (!email || !password) return null;

  const { data, error } = await supabaseAuth().auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;

  // Credentials are valid — but are they still allowed in?
  return resolvePrincipal(email);
}

// --- cookie spec helpers (attached directly to a NextResponse) ----------

export interface CookieSpec {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    path: string;
    expires?: Date;
    maxAge?: number;
  };
}

export function buildAdminSessionCookie(email: string): CookieSpec {
  const expiry = Date.now() + SESSION_TTL_MS;
  const emailPart = b64url(normalizeEmail(email));
  const token = `${expiry}.${emailPart}.${sign(`${expiry}.${emailPart}`)}`;
  return {
    name: COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(expiry),
    },
  };
}

export function buildAdminLogoutCookie(): CookieSpec {
  return {
    name: COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    },
  };
}

export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

// Resolve the current admin from the session cookie. Re-checks the allowlist on
// every call (deduped per-request via React cache) so revoked / force-logged-
// out users are kicked out on their next request rather than waiting for the
// cookie to expire.
export const currentAdmin = cache(async (): Promise<AdminPrincipal | null> => {
  const jar = await cookies();
  const parsed = parseToken(jar.get(COOKIE_NAME)?.value);
  if (!parsed?.valid || !parsed.email) return null;

  // Reject the session if a force-logout was issued after this cookie was
  // minted. Cookie's "issued at" = expiry - SESSION_TTL_MS.
  try {
    const { getAdminUser } = await import("./admin-users");
    const row = await getAdminUser(parsed.email);
    const cutoff = row?.signed_out_after ? Date.parse(row.signed_out_after) : 0;
    if (cutoff > 0) {
      const issuedAt = parsed.expiry - SESSION_TTL_MS;
      if (issuedAt < cutoff) return null;
    }
  } catch {
    // If the lookup fails we fall through to the standard allowlist check
    // rather than locking everyone out.
  }

  return resolvePrincipal(parsed.email);
});

export async function isAdmin(): Promise<boolean> {
  return (await currentAdmin()) !== null;
}

// Server-action guard. Throws "Unauthorized" if not signed in, or "Forbidden"
// if signed in without the required permission.
export async function requirePermission(perm: Permission): Promise<AdminPrincipal> {
  const me = await currentAdmin();
  if (!me) throw new Error("Unauthorized");
  if (!me.permissions.includes(perm)) throw new Error("Forbidden");
  return me;
}

// Edge-runtime-safe shape check used by proxy.ts (no node:crypto there).
export function verifyTokenString(token: string | undefined): boolean {
  if (!token) return false;
  return /^\d{10,}\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(token);
}

// --- scope resolution -------------------------------------------------------
// Every read path uses this to decide whether the caller sees everything or only
// rows explicitly assigned to them.

export type LeadScope =
  | { kind: "all" }
  | { kind: "assigned"; adminUserId: string };

export type EmployeeScope = LeadScope;

/** Resolve the visibility scope for the current admin principal.
 *  super_admin → { kind: "all" }
 *  everyone else → { kind: "assigned", adminUserId: <admin_users.id> }
 *  Returns null if the principal has no admin_users row (defensive). */
export async function resolveScope(me: AdminPrincipal): Promise<LeadScope | null> {
  if (me.role === "super_admin") return { kind: "all" };
  const { getAdminUser } = await import("./admin-users");
  const row = await getAdminUser(me.email);
  if (!row?.id) throw new Error("No admin account found.");
  return { kind: "assigned", adminUserId: row.id };
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
