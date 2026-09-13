"use server";

import { revalidatePath } from "next/cache";
import { currentAdmin } from "@/lib/admin-auth";
import {
  canManageRole,
  deleteAccess,
  getAdminUser,
  grantAccess,
  isPermission,
  listAdminUsers,
  normalizeEmail,
  resendInvite,
  updatePermissions,
  updateAccessEmployee,
  forceSignOut,
  forceSignOutAll,
  setUserStatus,
  changeUserRole,
  type AdminRole,
  type Permission,
} from "@/lib/admin-users";
import { logAudit } from "@/lib/audit";

async function requireManager() {
  const me = await currentAdmin();
  if (!me) throw new Error("Unauthorized");
  if (me.role !== "super_admin" && me.role !== "admin") throw new Error("Forbidden");
  return me;
}

function readPermissions(formData: FormData): Permission[] {
  return formData.getAll("permissions").map(String).filter(isPermission);
}

export async function grantAccessAction(
  _prev: { error?: string; ok?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const me = await requireManager();

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = String(formData.get("role") ?? "staff") as AdminRole;

  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (role !== "admin" && role !== "staff") return { error: "Invalid role." };
  if (!canManageRole(me.role, role)) {
    return { error: "You can only grant access at or below your own level." };
  }

  if (email === process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()) return { error: "The owner account is managed by server configuration." };
  const existing = await getAdminUser(email);
  if (existing && !canManageRole(me.role, existing.role)) return { error: "Forbidden: You cannot replace this account." };

  const permissions = role === "staff" ? readPermissions(formData) : [];
  const employeeId = String(formData.get("employee_id") ?? "").trim() || null;
  if (role === "staff" && permissions.length === 0) {
    return { error: "Select at least one permission for staff." };
  }

  let result: { emailSent: boolean; emailError?: string };
  try {
    result = await grantAccess({ email, role, permissions, invitedBy: me.email, employeeId });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not grant access." };
  }

  await logAudit("access.grant", { entity: "access", entityId: email, summary: `Granted ${role} access to ${email}`, metadata: { role, permissions } });
  revalidatePath("/admin/access");

  // Row is created either way; only the email may have failed.
  if (!result.emailSent) {
    return {
      error: `${email} was added, but the invite email didn’t send (${result.emailError}). Fix SMTP, then click Resend.`,
    };
  }
  return { ok: `Invite sent to ${email}.` };
}

export async function updateAccessEmployeeAction(
  _prev: { error?: string; ok?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const employeeId = String(formData.get("employee_id") ?? "").trim() || null;
  try {
    await loadManageable(email);
    await updateAccessEmployee(email, employeeId);
    await logAudit("access.employee_link", {
      entity: "access",
      entityId: email,
      summary: employeeId ? `Linked ${email} to employee ${employeeId}` : `Cleared employee link for ${email}`,
    });
    revalidatePath("/admin/access");
    return { ok: "Employee link saved." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save employee link." };
  }
}

// Shared guard for status / permission edits on an existing row.
async function loadManageable(email: string) {
  const me = await requireManager();
  const target = await getAdminUser(email);
  if (!target) throw new Error("No such user.");
  if (!canManageRole(me.role, target.role)) throw new Error("Forbidden");
  return { me, target };
}

// Revoke = fully remove the person (delete allowlist row + auth account).
export async function revokeAccessAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  await loadManageable(email);
  await deleteAccess(email);
  await logAudit("access.revoke", { entity: "access", entityId: email, summary: `Removed access for ${email}` });
  revalidatePath("/admin/access");
}

export async function resendInviteAction(
  _prev: { error?: string; ok?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  try {
    await loadManageable(email);
    const kind = await resendInvite(email);
    return { ok: kind === "invite" ? "Invite re-sent." : "Reset link sent." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not resend." };
  }
}

export async function updatePermissionsAction(
  _prev: { error?: string; ok?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  try {
    const { target } = await loadManageable(email);
    if (target.role !== "staff") return { error: "Only staff have editable permissions." };
    const beforePerms = [...target.permissions].sort();
    const permissions = readPermissions(formData);
    const afterPerms = [...permissions].sort();
    await updatePermissions(email, permissions);
    await logAudit("access.permissions", {
      entity: "access",
      entityId: email,
      summary: `Updated permissions for ${email}`,
      before: { permissions: beforePerms },
      after: { permissions: afterPerms },
    });
    revalidatePath("/admin/access");
    const n = permissions.length;
    return {
      ok: n === 0
        ? "Saved — no permissions (this person can’t access anything yet)."
        : `Saved — ${n} permission${n > 1 ? "s" : ""} now active.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn’t save permissions." };
  }
}

// Force one user's active session(s) to end. They keep their account and
// can log in again with their password — this only invalidates the cookie.
export async function forceLogoutAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) return;
  const me = await requireManager();
  // Don't allow logging yourself out via this button (use the normal sign-out).
  if (email === normalizeEmail(me.email)) return;
  const target = await getAdminUser(email);
  if (!target) return;
  // Only super_admin can sign out admins; admins can sign out staff only.
  if (target.role === "super_admin") return;
  if (target.role === "admin" && me.role !== "super_admin") return;
  await forceSignOut(email);
  await logAudit("access.force_logout", { entity: "access", entityId: email, summary: `Forced sign-out for ${email}` });
  revalidatePath("/admin/access");
}

// Bulk-logout every admin EXCEPT super_admins and the caller themselves.
// Only super_admins can trigger this.
export async function forceLogoutAllAction(): Promise<{ ok?: string; error?: string }> {
  try {
    const me = await requireManager();
    if (me.role !== "super_admin") return { error: "Only super-admin can sign everyone out." };

    // Build the keep-list: every super_admin + the caller themselves.
    const all = await listAdminUsers();
    const keep = new Set<string>();
    for (const u of all) if (u.role === "super_admin") keep.add(normalizeEmail(u.email));
    keep.add(normalizeEmail(me.email));

    const n = await forceSignOutAll([...keep]);
    await logAudit("access.force_logout_all", { entity: "access", summary: `Forced sign-out for ${n} user(s) (super admins kept signed in)` });
    revalidatePath("/admin/access");
    return { ok: `Signed out ${n} user${n === 1 ? "" : "s"}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn’t sign everyone out." };
  }
}

/**
 * Block / unblock a user. Blocking sets status='revoked' and kills the live
 * session so they can't access anything until a super-admin unblocks them.
 * Super-admins themselves can't be blocked through this UI.
 */
export async function toggleBlockAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const next = String(formData.get("status") ?? "");
  if (!email || (next !== "active" && next !== "revoked")) return;
  const me = await requireManager();
  if (me.role !== "super_admin") return; // block/unblock is super-admin only
  if (email === normalizeEmail(me.email)) return;
  const target = await getAdminUser(email);
  if (!target || target.role === "super_admin") return;
  await setUserStatus(email, next);
  await logAudit(next === "revoked" ? "access.block" : "access.unblock", {
    entity: "access",
    entityId: email,
    summary: next === "revoked" ? `Blocked ${email}` : `Unblocked ${email}`,
    before: { status: target.status },
    after: { status: next },
  });
  revalidatePath("/admin/access");
}

/**
 * Demote an admin to staff. Strips full-access privileges; the user starts
 * with zero permissions and a super-admin must re-grant explicitly. Forces a
 * re-login so the new role takes effect immediately.
 */
export async function demoteToStaffAction(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) return;
  const me = await requireManager();
  if (me.role !== "super_admin") return; // role changes are super-admin only
  if (email === normalizeEmail(me.email)) return;
  const target = await getAdminUser(email);
  if (!target) return;
  if (target.role !== "admin") return; // we only support admin → staff here
  await changeUserRole(email, "staff");
  await logAudit("access.role_change", {
    entity: "access",
    entityId: email,
    summary: `Demoted ${email}: admin → staff`,
    before: { role: target.role, permissions: target.permissions },
    after: { role: "staff", permissions: [] as Permission[] },
  });
  revalidatePath("/admin/access");
}
