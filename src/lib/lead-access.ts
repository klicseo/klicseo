import "server-only";
import { resolveScope } from "./admin-auth";
import type { AdminPrincipal } from "./admin-users-shared";
import { getAdminUser, listAssignableAdminUsers } from "./admin-users";
import { getLeadList } from "./leadLists";
import { assertLeadInScope } from "./leads";

export async function assertListAccess(me: AdminPrincipal, listId: string): Promise<void> {
  const list = await getLeadList(listId);
  if (!list) throw new Error("Lead folder not found.");
  const scope = await resolveScope(me);
  if (!scope) throw new Error("No admin account found.");
  if (scope.kind === "assigned" && list.assigned_admin_user_id !== scope.adminUserId) {
    throw new Error("Forbidden: This folder is outside your assigned scope.");
  }
}

export async function assertLeadSelectionAccess(me: AdminPrincipal, leadIds: string[]): Promise<void> {
  const scope = await resolveScope(me);
  if (!scope) throw new Error("No admin account found.");
  for (const id of new Set(leadIds)) await assertLeadInScope(id, scope);
}

export async function resolveListOwner(me: AdminPrincipal, requested?: string | null): Promise<string | null> {
  if (me.role !== "super_admin") {
    const user = await getAdminUser(me.email);
    if (!user) throw new Error("No admin account found.");
    if (requested && requested !== user.id) throw new Error("Forbidden: You can only organize your own assigned leads.");
    return user.id;
  }
  if (!requested) return null;
  const users = await listAssignableAdminUsers();
  if (!users.some((user) => user.id === requested)) throw new Error("Choose an active team member.");
  return requested;
}
