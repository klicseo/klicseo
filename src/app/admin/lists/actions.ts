"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertListAccess, assertLeadSelectionAccess, resolveListOwner } from "@/lib/lead-access";
import { requirePermission, resolveScope } from "@/lib/admin-auth";
import { supabase } from "@/lib/supabase";
import {
  insertLeadList,
  listLeadLists,
  getLeadList,
  updateLeadList,
  deleteLeadList,
  addLeadsToList,
  removeLeadFromList,
  getLeadsInList,
} from "@/lib/leadLists";
import { listLeads, mapLeadIdsToLists } from "@/lib/leads";
import { getAdminUser, listAssignableAdminUsers } from "@/lib/admin-users";
import { logAudit } from "@/lib/audit";
import type { LeadStatus } from "@/lib/leads-shared";

/**
 * Create a new lead list action.
 * Used by the lead list creation form.
 */
export async function createLeadListAction(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string; redirectTo?: string }> {
  const me = await requirePermission("leads.manage");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "List name is required" };
  }
  const assigned_admin_user_id_raw = String(formData.get("assigned_admin_user_id") ?? "").trim() || null;
  const assigned_admin_user_id = await resolveListOwner(me, assigned_admin_user_id_raw);

  if (assigned_admin_user_id && me.role !== "staff") {
    const adminUsers = await listAssignableAdminUsers();
    const allowed = adminUsers.some((u) => u.id === assigned_admin_user_id);
    if (!allowed) {
      return { error: "Cannot assign to a team member without admin panel access." };
    }
  }

  try {
    const list = await insertLeadList({
      name,
      assigned_admin_user_id,
    });

    await logAudit("lead_list.create", {
      entity: "lead_list",
      entityId: list.id,
      summary: `Created lead list "${list.name}"`,
    });

    revalidatePath("/admin/lists");
    return { redirectTo: `/admin/lists/${list.id}` };
  } catch (err) {
    console.error("Failed to create lead list:", err);
    return { error: "Failed to create lead list" };
  }
}

/**
 * Update a lead list action.
 * Used by the lead list edit form.
 */
export async function updateLeadListAction(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string; redirectTo?: string }> {
  const me = await requirePermission("leads.manage");

  const listId = String(formData.get("id") ?? "");
  if (!listId) {
    return { error: "Missing list ID" };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "List name is required" };
  }
  await assertListAccess(me, listId);
  const assigned_admin_user_id = await resolveListOwner(me, String(formData.get("assigned_admin_user_id") ?? "").trim() || null);

  if (assigned_admin_user_id) {
    const adminUsers = await listAssignableAdminUsers();
    const allowed = adminUsers.some((u) => u.id === assigned_admin_user_id);
    if (!allowed) {
      return { error: "Cannot assign to a team member without admin panel access." };
    }
  }

  try {
    await updateLeadList(listId, {
      name,
      assigned_admin_user_id,
    });

    await logAudit("lead_list.update", {
      entity: "lead_list",
      entityId: listId,
      summary: `Updated lead list "${name}"`,
    });

    revalidatePath("/admin/lists");
    return { redirectTo: `/admin/lists/${listId}` };
  } catch (err) {
    console.error("Failed to update lead list:", err);
    return { error: "Failed to update lead list" };
  }
}

/**
 * Add leads to a list action.
 * Used when selecting leads from the leads list and adding to a list.
 */
export async function addLeadsToListAction(formData: FormData): Promise<{ error?: string }> {
  const me = await requirePermission("leads.manage");

  const listId = String(formData.get("listId") ?? "");
  if (!listId) {
    return { error: "Missing list ID" };
  }

  const leadIds = formData.getAll("leadIds"); // This will be an array of strings from checkboxes
  if (leadIds.length === 0) {
    return { error: "No leads selected" };
  }

  try {
    await assertListAccess(me, listId);
    await assertLeadSelectionAccess(me, leadIds as string[]);
    await addLeadsToList(listId, leadIds as string[]);

    // Get list name for audit log
    const list = await getLeadList(listId);
    const listName = list?.name || "Unknown";

    await logAudit("lead_list.add_leads", {
      entity: "lead_list",
      entityId: listId,
      summary: `Added ${leadIds.length} leads to list "${listName}"`,
    });

    revalidatePath(`/admin/lists/${listId}`);
    revalidatePath("/admin/lists");
    revalidatePath("/admin/my-lists");
    revalidatePath("/admin"); // Revalidate leads list in case we show list info there
    return { error: undefined };
  } catch (err) {
    console.error("Failed to add leads to list:", err);
    return { error: "Failed to add leads to list" };
  }
}

/**
 * Create a new lead list and immediately assign selected leads to it.
 * Used when manually selecting leads in the sheet view and clicking "Create New List".
 */
export async function createListAndAssignLeadsAction(formData: FormData): Promise<{
  ok: boolean;
  listId?: string;
  listName?: string;
  count?: number;
  error?: string;
}> {
  const me = await requirePermission("leads.manage");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { ok: false, error: "List name is required." };
  }

  const assigned_admin_user_id_raw = String(formData.get("assigned_admin_user_id") ?? "").trim() || null;
  const assigned_admin_user_id = await resolveListOwner(me, assigned_admin_user_id_raw);

  if (assigned_admin_user_id && me.role !== "staff") {
    const adminUsers = await listAssignableAdminUsers();
    const allowed = adminUsers.some((u) => u.id === assigned_admin_user_id);
    if (!allowed) {
      return { ok: false, error: "Cannot assign to a team member without admin panel access." };
    }
  }

  const leadIds = formData.getAll("leadIds") as string[];
  if (!leadIds || leadIds.length === 0) {
    return { ok: false, error: "No leads selected to assign." };
  }

  try {
    await assertLeadSelectionAccess(me, leadIds);
    const list = await insertLeadList({
      name,
      assigned_admin_user_id,
    });

    await addLeadsToList(list.id, leadIds);

    await logAudit("lead_list.create_with_leads", {
      entity: "lead_list",
      entityId: list.id,
      summary: `Created lead list "${list.name}" with ${leadIds.length} assigned leads`,
      metadata: {
        listId: list.id,
        listName: list.name,
        assigned_admin_user_id,
        leadCount: leadIds.length,
      },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/lists");
    revalidatePath("/admin/my-lists");
    return {
      ok: true,
      listId: list.id,
      listName: list.name,
      count: leadIds.length,
    };
  } catch (err: any) {
    console.error("createListAndAssignLeadsAction error:", err);
    return { ok: false, error: err.message || "Failed to create list and assign leads." };
  }
}

/**
 * Remove a lead from a list action.
 */
export async function removeLeadFromListAction(formData: FormData): Promise<{ error?: string }> {
  const me = await requirePermission("leads.manage");

  const listId = String(formData.get("listId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");

  if (!listId || !leadId) {
    return { error: "Missing list ID or lead ID" };
  }

  try {
    await assertListAccess(me, listId);
    await assertLeadSelectionAccess(me, [leadId]);
    await removeLeadFromList(listId, leadId);

    // Get list name for audit log
    const list = await getLeadList(listId);
    const listName = list?.name || "Unknown";

    await logAudit("lead_list.remove_lead", {
      entity: "lead_list",
      entityId: listId,
      summary: `Removed lead from list "${listName}"`,
    });

    revalidatePath(`/admin/lists/${listId}`);
    revalidatePath("/admin/lists");
    revalidatePath("/admin/my-lists");
    return { error: undefined };
  } catch (err) {
    console.error("Failed to remove lead from list:", err);
    return { error: "Failed to remove lead from list" };
  }
}

/**
 * Delete a lead list action.
 */
export async function deleteLeadListAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await requirePermission("leads.manage");
  if (me.role !== "super_admin") {
    return { ok: false, error: "Forbidden: Only the super admin can delete folders or lead lists." };
  }

  const listId = String(formData.get("id") ?? "");
  if (!listId) return { ok: false, error: "Missing list ID" };

  try {
    // Get list name for audit log before deletion
    const list = await getLeadList(listId);
    const listName = list?.name || "Unknown";

    await assertListAccess(me, listId);
    await deleteLeadList(listId);

    await logAudit("lead_list.delete", {
      entity: "lead_list",
      entityId: listId,
      summary: `Deleted lead list "${listName}"`,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/lists");
    revalidatePath("/admin/my-lists");
    return { ok: true };
  } catch (err) {
    console.error("Failed to delete lead list:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete lead list",
    };
  }
}

/**
 * Get leads in a list for display in the list view page.
 */
export async function getLeadsInListAction(
  listId: string,
  opts: {
    limit?: number;
    offset?: number;
    status?: LeadStatus | "all";
    search?: string;
  } = {}
): Promise<{ leads: any[]; count: number }> {
  const me = await requirePermission("leads.view");

  try {
    await assertListAccess(me, listId);
    const scope = await resolveScope(me);
    const leads = await getLeadsInList(listId, { status: opts.status, search: opts.search, assignedAdminUserId: scope?.kind === "assigned" ? scope.adminUserId : undefined });
    const offset = opts.offset ?? 0;
    return {
      leads: leads.slice(offset, opts.limit == null ? undefined : offset + opts.limit),
      count: leads.length,
    };
  } catch (err) {
    console.error("Failed to get leads in list:", err);
    return { leads: [], count: 0 };
  }
}

export async function searchLeadsForListAction(search: string): Promise<any[]> {
  const me = await requirePermission("leads.view");

  const q = search.trim();
  if (!q) return [];

  try {
    const scope = await resolveScope(me);
    if (!scope) throw new Error("No admin account found.");
    const leads = await listLeads({
      assignedAdminUserId: scope.kind === "assigned" ? scope.adminUserId : undefined,
      search: q,
      limit: 20,
    });
    if (leads.length === 0) return [];
    const listMap = await mapLeadIdsToLists(leads.map((l) => l.id));
    return leads.map((l) => ({
      ...l,
      currentListNames: listMap.get(l.id) ?? [],
    }));
  } catch (err) {
    console.error("Failed to search leads for list:", err);
    return [];
  }
}
