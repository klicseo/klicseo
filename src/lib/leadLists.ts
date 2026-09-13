import { isCustomLeadFolder, moveLeadsToCustomFolder, removeLeadFromCustomFolder } from "./lead-folder-items";
import "server-only";
import { readAllRows } from "./db-pagination";
import { matchesLeadSearch } from "./lead-search-shared";
import { isCompletedLeadStatus } from "./leads-shared";
import { supabase } from "./supabase";
import { currentAdmin } from "./admin-auth";
import { getAdminUser } from "./admin-users";
import type { LeadListRow, NewLeadList, LeadListItem } from "./leadLists-shared";
import type { LeadRow } from "./leads";
import { sealFields, unsealFields } from "./crypto";
import { markLeadsAsAssigned, invalidateAssignedLeadsCache } from "./lead-assignments";

interface LeadListsCacheEntry {
  data: LeadListRow[];
  expires: number;
}

const leadListsCache = new Map<string, LeadListsCacheEntry>();

export function invalidateLeadListCache(): void {
  leadListsCache.clear();
}

/**
 * Insert a new lead list.
 * @param list - The lead list data (name, optional created_by, optional assigned_employee_id)
 * @returns The created lead list row
 */
export async function insertLeadList(list: NewLeadList): Promise<LeadListRow> {
  invalidateLeadListCache();
  // Scheduled jobs explicitly pass null; interactive callers resolve their authenticated creator.
  let createdBy = list.created_by;
  if (createdBy === undefined) {
    const admin = await currentAdmin();
    if (!admin) throw new Error("No admin authenticated");
    const adminRow = await getAdminUser(admin.email);
    createdBy = adminRow?.id ?? null;
  }
  const payload = { ...list, created_by: createdBy };

  const { data, error } = await supabase()
    .from("lead_lists")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as LeadListRow;
}

/**
 * List lead lists with optional filtering.
 * @param opts - Options: createdBy to filter by creator
 * @returns Array of lead list rows with lead count and creator/admin details
 */
export async function listLeadLists(opts: {
  createdBy?: string;
  assignedAdminUserId?: string;
  search?: string;
  includeFolders?: boolean;
} = {}): Promise<LeadListRow[]> {
  const cacheKey = `${opts.createdBy || ""}_${opts.assignedAdminUserId || ""}_${opts.search || ""}_${opts.includeFolders ?? false}`;
  const now = Date.now();
  const cached = leadListsCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  let q = supabase()
    .from("lead_lists")
    .select(`
      *,
      admin_users:created_by (email)
    `)
    .order("created_at", { ascending: false });

  if (opts.createdBy) {
    q = q.eq("created_by", opts.createdBy);
  }

  if (opts.assignedAdminUserId) {
    q = q.eq("assigned_admin_user_id", opts.assignedAdminUserId);
  }

  if (opts.search) {
    // Search by list name
    q = q.ilike("name", `%${opts.search}%`);
  }

  const rows = await readAllRows(q.order("id", { ascending: true }));
  const data = opts.includeFolders ? rows : rows.filter((row) => !row.is_custom_folder);

  const assignedAdminUserIds = Array.from(
    new Set(
      (data ?? []).map((r: any) => r?.assigned_admin_user_id).filter(Boolean),
    ),
  );

  let assignedUsersById: Record<string, { email: string | null; name: string | null }> = {};
  if (assignedAdminUserIds.length > 0) {
    const { data: assignedUsers, error: assignedUsersErr } = await supabase()
      .from("admin_users")
      .select("id, email, employees:employee_id (name)")
      .in("id", assignedAdminUserIds);
    if (assignedUsersErr) throw assignedUsersErr;
      assignedUsersById = (assignedUsers ?? []).reduce(
        (acc: Record<string, { email: string | null; name: string | null }>, u: any) => {
          if (u?.id) {
            const empName = Array.isArray(u.employees) ? u.employees[0]?.name ?? null : u.employees?.name ?? null;
            acc[u.id] = { email: u.email ?? null, name: empName ?? u.email ?? null };
          }
          return acc;
        },
        {},
      );
    }

  // Batch fetch all items and statuses for the returned lists in a single fast query
  const listIds = (data ?? []).map((r: any) => r.id);
  const statsByListId = new Map<
    string,
    { total: number; completed: number; pending: number; statuses: Record<string, number> }
  >();

  if (listIds.length > 0) {
    const allItems: { list_id: string; lead_id: string; leads: unknown }[] = [];
    for (const table of ["lead_list_items", "lead_folder_items"]) {
      const ids = data.filter((row) => Boolean(row.is_custom_folder) === (table === "lead_folder_items")).map((row) => row.id);
      for (let offset = 0; offset < ids.length; offset += 250) {
        allItems.push(...await readAllRows(supabase().from(table)
          .select("list_id, lead_id, leads:lead_id (status)")
          .in("list_id", ids.slice(offset, offset + 250)).order("lead_id")));
      }
    }
    const scopedAssignments = new Set(allItems.filter((item) => !data.find((row) => row.id === item.list_id)?.is_custom_folder).map((item) => item.lead_id));


    if (allItems) {
      for (const item of allItems) {
        if (opts.assignedAdminUserId && data.find((row) => row.id === item.list_id)?.is_custom_folder && !scopedAssignments.has(item.lead_id)) continue;
        const lid = item.list_id;
        const current = statsByListId.get(lid) ?? {
          total: 0,
          completed: 0,
          pending: 0,
          statuses: {},
        };
        current.total += 1;

        const lead: any = Array.isArray(item.leads) ? item.leads[0] : item.leads;
        const status = (lead?.status ?? "new") as string;
        current.statuses[status] = (current.statuses[status] ?? 0) + 1;

        // Completed = contacted, booked, cancelled, follow_up
        if (isCompletedLeadStatus(status)) {
          current.completed += 1;
        } else {
          current.pending += 1;
        }

        statsByListId.set(lid, current);
      }
    }
  }

  // Combine joined data and stats
  const result: LeadListRow[] = (data ?? []).map((row: any) => {
    const stats = statsByListId.get(row.id) ?? {
      total: 0,
      completed: 0,
      pending: 0,
      statuses: {},
    };
    const completionRate =
      stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

    const assignedAdminUser = row.assigned_admin_user_id
      ? assignedUsersById[row.assigned_admin_user_id] ?? { email: null, name: null }
      : null;

    return {
      ...row,
      assigned_admin_user: assignedAdminUser,
      lead_count: stats.total,
      completed_count: stats.completed,
      pending_count: stats.pending,
      completion_rate: completionRate,
      status_counts: stats.statuses,
    } as LeadListRow;
  });

  leadListsCache.set(cacheKey, { data: result, expires: now + 30_000 });
  return result;
}

/**
 * Get a single lead list by ID.
 * @param listId - The ID of the lead list
 * @returns The lead list row or null if not found
 */
export async function getLeadList(listId: string): Promise<LeadListRow | null> {
  const { data, error } = await supabase()
    .from("lead_lists")
    .select(`
      *,
      admin_users:created_by (email)
    `)
    .eq("id", listId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const allItems = await readAllRows(supabase()
    .from(data.is_custom_folder ? "lead_folder_items" : "lead_list_items")
    .select("lead_id, leads:lead_id (status)")
    .eq("list_id", listId)
    .order("lead_id", { ascending: true }));

  const total = allItems.length;
  let completed = 0;
  let pending = 0;
  const statuses: Record<string, number> = {};

  if (allItems) {
    for (const item of allItems) {
      const lead: any = Array.isArray(item.leads) ? item.leads[0] : item.leads;
      const status = (lead?.status ?? "new") as string;
      statuses[status] = (statuses[status] ?? 0) + 1;
      if (isCompletedLeadStatus(status)) {
        completed += 1;
      } else {
        pending += 1;
      }
    }
  }

  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const assignedAdminUser = data.assigned_admin_user_id
    ? await (async () => {
        const { data: assignedUser, error: assignedUserErr } = await supabase()
          .from("admin_users")
          .select("id, email, employees:employee_id (name)")
          .eq("id", data.assigned_admin_user_id)
          .maybeSingle();
        if (assignedUserErr) throw assignedUserErr;
        if (!assignedUser) return null;
        const au: any = assignedUser;
        const empName = Array.isArray(au.employees) ? au.employees[0]?.name ?? null : au.employees?.name ?? null;
        return { email: assignedUser.email ?? null, name: empName ?? assignedUser.email ?? null };
      })()
    : null;

  return {
    ...data,
    assigned_admin_user: assignedAdminUser,
    admin_users: data.admin_users,
    lead_count: total,
    completed_count: completed,
    pending_count: pending,
    completion_rate: completionRate,
    status_counts: statuses,
  } as LeadListRow;
}

/**
 * Add leads to a lead list.
 * @param listId - The ID of the lead list
 * @param leadIds - Array of lead IDs to add
 */
export async function addLeadsToList(listId: string, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;
  invalidateLeadListCache();
  if (await isCustomLeadFolder(listId)) {
    await moveLeadsToCustomFolder(listId, leadIds);
    return;
  }

  const uniqueLeadIds = Array.from(new Set(leadIds));

  // One statement preserves existing membership if the target is invalid or the write fails.
  const items = uniqueLeadIds.map((leadId) => ({ list_id: listId, lead_id: leadId, added_at: new Date().toISOString() }));
  const { error } = await supabase().from("lead_list_items")
    .upsert(items, { onConflict: "lead_id" });
  if (error) throw error;

  markLeadsAsAssigned(uniqueLeadIds);
}

/** Claim available leads without changing any existing assignment (including concurrent claims). */
export async function claimUnassignedLeads(listId: string, leadIds: string[]): Promise<string[]> {
  const ids = [...new Set(leadIds)];
  if (!ids.length) return [];
  const { data, error } = await supabase().from("lead_list_items")
    .upsert(ids.map((leadId) => ({ list_id: listId, lead_id: leadId })), {
      onConflict: "lead_id", ignoreDuplicates: true,
    }).select("lead_id");
  if (error) throw error;
  const claimed = (data ?? []).map((row) => row.lead_id);
  invalidateLeadListCache();
  invalidateAssignedLeadsCache();
  return claimed;
}

/**
 * Remove a lead from a lead list.
 * @param listId - The ID of the lead list
 * @param leadId - The ID of the lead to remove
 */
export async function removeLeadFromList(listId: string, leadId: string): Promise<void> {
  invalidateLeadListCache();
  if (await isCustomLeadFolder(listId)) {
    await removeLeadFromCustomFolder(listId, leadId);
    return;
  }
  invalidateAssignedLeadsCache();
  const { error } = await supabase()
    .from("lead_list_items")
    .delete()
    .eq("list_id", listId)
    .eq("lead_id", leadId);

  if (error) throw error;
}

/**
 * Get all leads in a specific lead list.
 * @param listId - The ID of the lead list
 * @param opts - Pagination options
 * @returns Array of lead rows (unsealed)
 */
export async function getLeadsInList(listId: string, opts: {
  limit?: number;
  offset?: number;
  status?: string | "all";
  search?: string;
  assignedAdminUserId?: string;
} = {}): Promise<LeadRow[]> {
  const ENCRYPTED_LEAD_FIELDS = [
    "phone",
    "car_number",
    "address",
    "map_link",
    "gate_access_notes",
    "notes",
  ] as const;

  const customFolder = await isCustomLeadFolder(listId);
  // Join the collection membership with leads and unseal fields.
  const q = supabase()
    .from(customFolder ? "lead_folder_items" : "lead_list_items")
    .select(`
      lead_id,
      leads:lead_id (*)
    `)
    .eq("list_id", listId);

  const data = await readAllRows(q.order("lead_id"));

  // Flatten the joined data and unseal encrypted fields
  const leads = (data ?? [])
    .map((item: any) => item.leads)
    .filter(Boolean)
    .map((lead: any) => unsealFields(lead, ENCRYPTED_LEAD_FIELDS as unknown as string[]));

  // In-memory filtering if needed
  let filtered = leads;
  if (customFolder && opts.assignedAdminUserId) {
    const assigned = await readAllRows(supabase().from("lead_list_items")
      .select("lead_id, lead_lists!inner(assigned_admin_user_id)")
      .eq("lead_lists.assigned_admin_user_id", opts.assignedAdminUserId).order("lead_id"));
    const allowed = new Set(assigned.map((item) => item.lead_id));
    filtered = filtered.filter((lead) => allowed.has(lead.id));
  }

  if (opts.status && opts.status !== "all") {
    filtered = filtered.filter((lead: any) => lead.status === opts.status);
  }

  if (opts.search) filtered = filtered.filter((lead) => matchesLeadSearch(lead, opts.search!));
  const offset = opts.offset ?? 0;
  return filtered.slice(offset, opts.limit == null ? undefined : offset + opts.limit) as LeadRow[];

}

/**
 * Update a lead list (name or assigned employee).
 * @param listId - The ID of the lead list
 * @param updates - Partial updates for the list
 */
export async function updateLeadList(listId: string, updates: Partial<NewLeadList>): Promise<void> {
  invalidateLeadListCache();
  const { error } = await supabase()
    .from("lead_lists")
    .update(updates)
    .eq("id", listId);

  if (error) throw error;
}

/**
 * Delete a lead list and all its items.
 * @param listId - The ID of the lead list to delete
 */
export async function deleteLeadList(listId: string): Promise<void> {
  invalidateLeadListCache();
  invalidateAssignedLeadsCache();
  // Foreign keys cascade memberships and null schedule targets in the same transaction.
  const { error } = await supabase()
    .from("lead_lists")
    .delete()
    .eq("id", listId);

  if (error) throw error;
}

/**
 * Check if a lead is assigned to a specific admin user.
 * @param leadId - The ID of the lead
 * @param adminUserId - The ID of the admin user
 * @returns boolean
 */
export async function isLeadAssignedToAdmin(leadId: string, adminUserId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from("lead_list_items")
    .select("lead_id, lead_lists!inner(assigned_admin_user_id)")
    .eq("lead_id", leadId)
    .eq("lead_lists.assigned_admin_user_id", adminUserId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}
