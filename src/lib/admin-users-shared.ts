// Shared types + permission catalog for the admin allowlist. No "server-only"
// guard here so client components (the access-management form) can import the
// catalog and labels. All DB access lives in lib/admin-users.ts (server-only).

export type AdminRole = "super_admin" | "admin" | "staff";

export type Permission =
  | "leads.view"
  | "leads.manage"
  | "employees.view"
  | "employees.manage"
  | "payments.view"
  | "payments.manage";

export interface PermissionDef {
  id: Permission;
  label: string;
  blurb: string;
  // A "manage" permission implies its "view" sibling.
  implies?: Permission;
}

// The toggleable capabilities shown when granting a staff member access.
export const ALL_PERMISSIONS: PermissionDef[] = [
  { id: "leads.view", label: "View leads", blurb: "See the leads list and lead details." },
  { id: "leads.manage", label: "Manage leads", blurb: "Create and edit assigned leads. Deletion also requires an administrator role.", implies: "leads.view" },
  { id: "employees.view", label: "View employees", blurb: "See the employees section." },
  { id: "employees.manage", label: "Manage employees", blurb: "Create and edit assigned employees. Deletion also requires an administrator role.", implies: "employees.view" },
  { id: "payments.view", label: "View payments", blurb: "See the payments grid and per-customer history." },
  { id: "payments.manage", label: "Manage payments", blurb: "Mark paid/pending, edit amounts, send WhatsApp messages.", implies: "payments.view" },
];

const PERMISSION_IDS = new Set<string>(ALL_PERMISSIONS.map((p) => p.id));

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && PERMISSION_IDS.has(v);
}

// Expand a granted set so that "manage" always carries its "view" sibling.
export function expandPermissions(perms: Permission[]): Permission[] {
  const out = new Set<Permission>(perms);
  for (const p of ALL_PERMISSIONS) {
    if (p.implies && out.has(p.id)) out.add(p.implies);
  }
  return [...out];
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  staff: "Staff",
};

export interface AdminUserRow {
  id: string;
  created_at: string;
  email: string;
  role: AdminRole;
  status: "active" | "revoked";
  permissions: Permission[];
  invited_by: string | null;
  employee_id: string | null;
  employees?: { name: string | null } | null;
  /** When set, any session cookie issued before this moment is treated as
   *  expired — forcing the user to log in again on their next request. */
  signed_out_after: string | null;
}

// The authenticated principal resolved per request (see currentAdmin()).
export interface AdminPrincipal {
  email: string;
  role: AdminRole;
  permissions: Permission[]; // fully expanded; admins/super hold ALL
}

export const EVERY_PERMISSION: Permission[] = ALL_PERMISSIONS.map((p) => p.id);

export function principalHas(me: AdminPrincipal, perm: Permission): boolean {
  return me.permissions.includes(perm);
}

// Can `actor` create/edit/revoke a target with role `targetRole`?
//   super_admin → manages admins and staff
//   admin       → manages staff only
//   staff       → manages no one
export function canManageRole(actor: AdminRole, targetRole: AdminRole): boolean {
  if (actor === "super_admin") return targetRole === "admin" || targetRole === "staff";
  if (actor === "admin") return targetRole === "staff";
  return false;
}
