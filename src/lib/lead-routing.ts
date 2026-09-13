import { matchesAllocationStatus } from "./lead-routing-shared";
import { allocationFolderLeadIds } from "./lead-folder-items";
import "server-only";
import { listAssignableAdminUsers } from "./admin-users";
import { validateAllocationRequest } from "./allocation-validation";
import { invalidateLeadListCache } from "./leadLists";
import { readAllRows } from "./db-pagination";
import { isCompletedLeadStatus } from "./leads-shared";
import { supabase } from "./supabase";
import { unseal } from "./crypto";
import { addLeadsToList, insertLeadList, claimUnassignedLeads, getLeadList } from "./leadLists";
import { resolveLeadIdsForArea, resolvePrimaryLocality, getOrBuildLocationIndex, invalidateAreaCountsCache, CANONICAL_AREA_ALIASES } from "./area";
import { isWebsiteFormLead, isHotLead, isYearLead } from "./leads-shared";
import {
  getAllAssignedLeadIds,
  invalidateAssignedLeadsCache,
  markLeadsAsAssigned,
  setAssignedLeadsCache,
} from "./lead-assignments";
import type {
  LeadAllocationFilter,
  LeadAllocationSchedule,
  NewLeadAllocationRequest,
  StaffAssignedListInfo,
  StaffWorkloadSummary,
  RecycleLeadsRequest,
  RecycleLeadsResult,
} from "./lead-routing-shared";

export * from "./lead-routing-shared";
export {
  getAllAssignedLeadIds,
  invalidateAssignedLeadsCache,
  markLeadsAsAssigned,
  setAssignedLeadsCache,
};

/**
 * In-memory / unit-test filter matcher for a lead.
 */
export function matchesFilter(
  lead: {
    area?: string | null;
    address?: string | null;
    pincode?: string | null;
    service?: string | null;
    status?: string | null;
    price_total?: number | null;
  },
  filter: LeadAllocationFilter,
): boolean {
  if (!filter) return true;

  // Status is an optional filter, independent of current assignment.
  if (!matchesAllocationStatus(lead.status, filter.statuses)) return false;

  // 1.5 Folder / Year / Source Filter
  if (filter.folder) {
    if (filter.folder === "all_master" || filter.folder === "all") {
      // Show all
    } else if (filter.folder.startsWith("year_")) {
      const yr = filter.folder.replace("year_", "");
      if (!isYearLead(lead as any, yr)) return false;
    } else if (filter.folder === "website_form") {
      if (!isWebsiteFormLead(lead as any)) return false;
    } else if (filter.folder === "hot_leads") {
      if (!isHotLead(lead as any)) return false;
    }
  } else if (filter.year && filter.year !== "all") {
    if (!isYearLead(lead as any, filter.year)) return false;
  }

  // 2. Area (checks both area column and permanent address text with unseal & canonical matching)
  if (filter.areas && filter.areas.length > 0) {
    const plainAddress = unseal(lead.address);
    const leadArea = String(lead.area ?? "").toLowerCase().trim();
    const leadAddr = String(plainAddress ?? "").toLowerCase().trim();
    const matched = filter.areas.some((area) => {
      const canonicalTarget = (CANONICAL_AREA_ALIASES[area.toLowerCase().trim()] || area.trim()).toLowerCase();
      return (
        (leadArea && (leadArea === canonicalTarget || leadArea.includes(canonicalTarget))) ||
        (leadAddr && leadAddr.includes(canonicalTarget))
      );
    });
    if (!matched) return false;
  }

  // 3. Pincodes
  if (filter.pincodes && filter.pincodes.length > 0) {
    const leadPin = String(lead.pincode ?? "").trim();
    const matched = filter.pincodes.some((pin) => leadPin.includes(pin.trim()));
    if (!matched) return false;
  }

  // 4. Service
  if (filter.services && filter.services.length > 0) {
    const leadService = String(lead.service ?? "").toLowerCase().trim();
    if (!leadService) return false;

    const matched = filter.services.some((srv) =>
      leadService.includes(srv.toLowerCase().trim()),
    );
    if (!matched) return false;
  }

  // 5. Minimum Order Price
  if (filter.min_price != null && filter.min_price > 0) {
    const price = lead.price_total ?? 0;
    if (price < filter.min_price) return false;
  }

  return true;
}


/**
 * Count unassigned leads, optionally narrowed by status and other filters.
 * Evaluates in memory using the fast location index for near-instant (under 10ms) responses.
 */
export async function countMatchingLeads(
  filter: LeadAllocationFilter,
): Promise<{ count: number; totalUnallocated: number }> {
  try {
    const hasExplicitFilters = Boolean(
      (filter.folder && filter.folder !== "all") ||
      (filter.year && filter.year !== "all") ||
      (filter.source && filter.source !== "all") ||
      (filter.areas && filter.areas.length > 0) ||
      (filter.pincodes && filter.pincodes.length > 0) ||
      (filter.services && filter.services.length > 0) ||
      (filter.min_price != null && filter.min_price > 0),
    );

    const [locationIndex, assignedSet, customFolderIds] = await Promise.all([
      getOrBuildLocationIndex(),
      getAllAssignedLeadIds({ fresh: true }),
      allocationFolderLeadIds(filter.folder),
    ]);

    const statusFilteredLeads = locationIndex.allLeads.filter((lead) => matchesAllocationStatus(lead.status, filter.statuses));

    // If a folder/year filter is specified, totalUnallocated is scoped to that folder/year
    const folderFilteredLeads = statusFilteredLeads.filter((lead) => {
      if (filter.folder && filter.folder !== "all") {
        if (filter.folder === "all_master") {
          // Show all
        } else if (filter.folder.startsWith("year_")) {
          const yr = filter.folder.replace("year_", "");
          if (!isYearLead(lead, yr)) return false;
        } else if (filter.folder === "website_form") {
          if (!isWebsiteFormLead(lead)) return false;
        } else if (filter.folder === "hot_leads") {
          if (!isHotLead(lead)) return false;
        } else {
          if (!customFolderIds?.has(lead.id)) return false;
        }
      }
      const targetYear = filter.folder?.startsWith("year_") ? filter.folder.slice(5) : filter.year;
      if (targetYear && targetYear !== "all" && !isYearLead(lead, targetYear)) return false;
      return true;
    });

    const sourceFilteredLeads = folderFilteredLeads.filter((lead) => !filter.source || filter.source === "all" || lead.source === filter.source);
    const totalUnallocated = sourceFilteredLeads.filter((l) => !assignedSet.has(l.id)).length;

    if (!hasExplicitFilters) {
      return { count: totalUnallocated, totalUnallocated };
    }

    const availableMatching = sourceFilteredLeads.filter((lead) => {
      if (assignedSet.has(lead.id)) return false;

      // 1. Area filter (Location-scoped matching)
      if (filter.areas && filter.areas.length > 0) {
        const leadPrimary = lead.primaryLocality.toLowerCase();
        const matched = filter.areas.some((area) => {
          const canonicalTarget = (CANONICAL_AREA_ALIASES[area.toLowerCase().trim()] || area.trim()).toLowerCase();
          return leadPrimary === canonicalTarget || leadPrimary.includes(canonicalTarget);
        });
        if (!matched) return false;
      }

      // 2. Pincodes
      if (filter.pincodes && filter.pincodes.length > 0) {
        const leadPin = String(lead.pincode ?? "").trim();
        const matched = filter.pincodes.some((pin) => leadPin.includes(pin.trim()));
        if (!matched) return false;
      }

      // 3. Services
      if (filter.services && filter.services.length > 0) {
        const leadService = String(lead.service ?? "").toLowerCase().trim();
        if (!leadService) return false;
        const matched = filter.services.some((srv) =>
          leadService.includes(srv.toLowerCase().trim()),
        );
        if (!matched) return false;
      }

      // 4. Min Price
      if (filter.min_price != null && filter.min_price > 0) {
        const price = lead.price_total ?? 0;
        if (price < filter.min_price) return false;
      }

      return true;
    }).length;

    return { count: availableMatching, totalUnallocated };
  } catch (err) {
    console.error("countMatchingLeads error:", err);
    throw err;
  }
}

/**
 * List all scheduled, recurring, and past lead allocations.
 */
export async function listScheduledAllocations(): Promise<LeadAllocationSchedule[]> {
  try {
    const { data, error } = await supabase()
      .from("lead_allocation_schedules")
      .select(`
        *,
        target_list:target_list_id (id, name)
      `)
      .order("created_at", { ascending: false });

    if (error) {
      if (error.code === "42P01") return [];
      throw error;
    }

    return (data ?? []).map((row: any) => ({
      id: row.id,
      created_at: row.created_at,
      scheduled_for: row.scheduled_for,
      status: row.status ?? "completed",
      schedule_mode: row.schedule_mode ?? "once_now",
      lead_count: row.lead_count ?? 10,
      conditions: row.conditions ?? {},
      assignee_ids: row.assignee_ids ?? [],
      target_list_id: row.target_list_id ?? null,
      target_list: row.target_list ?? null,
      recurring_time: row.recurring_time?.slice(0, 5) ?? "09:30",
      recurring_days: row.recurring_days ?? [1, 2, 3, 4, 5, 6],
      replenish_threshold: row.replenish_threshold ?? 5,
      allocated_lead_ids: row.allocated_lead_ids ?? [],
      notes: row.notes ?? null,
    }));
  } catch {
    return [];
  }
}

async function assertAllocationDestination(assigneeIds: string[], targetListId?: string | null): Promise<{ assigned_admin_user_id: string | null } | null> {
  const users = await listAssignableAdminUsers();
  const activeIds = new Set(users.map((user) => user.id));
  if (targetListId) {
    const { data: target, error } = await supabase().from("lead_lists")
      .select("id, assigned_admin_user_id, is_custom_folder").eq("id", targetListId).maybeSingle();
    if (error) throw error;
    if (!target) throw new Error("Destination list no longer exists.");
    if (target.is_custom_folder) throw new Error("Choose a staff assignment list as the destination; custom folders are source folders.");
    if (target.assigned_admin_user_id && !activeIds.has(target.assigned_admin_user_id)) throw new Error("The destination list belongs to an inactive team member.");
    return target;
  } else if (assigneeIds.some((id) => !activeIds.has(id))) {
    throw new Error("Choose active team members for allocation.");
  }
  return null;
}

/**
 * Execute immediate allocation of N leads matching conditions, guaranteeing no duplicate assignments.
 */
export async function executeLeadAllocation(req: {
  lead_count: number;
  conditions: LeadAllocationFilter;
  assignee_ids: string[];
  target_list_id?: string | null;
  notes?: string | null;
  allocation_type?: "manual" | "scheduled" | "daily_recurring" | "queue_replenish";
}): Promise<{
  allocatedCount: number;
  leadIds: string[];
  warnings?: string[];
}> {
  if (!Number.isSafeInteger(req.lead_count) || req.lead_count <= 0) {
    throw new Error("Lead count must be a positive whole number.");
  }
  const assignees = [...new Set(req.assignee_ids ?? [])];
  if (!req.target_list_id && !assignees.length) {
    throw new Error("Select a destination list or at least one staff member.");
  }
  const destination = await assertAllocationDestination(assignees, req.target_list_id);
  // 1. Fetch location index and assigned lead IDs
  const [locationIndex, globalAssignedSet, customFolderIds] = await Promise.all([
    getOrBuildLocationIndex(),
    getAllAssignedLeadIds({ fresh: true }),
    allocationFolderLeadIds(req.conditions.folder),
  ]);

  const assignedSet = globalAssignedSet;

  // 2. Select unassigned candidates; do not reset or implicitly restrict status.
  const candidateLeads = locationIndex.allLeads.filter((lead) => {
    if (assignedSet.has(lead.id)) return false;
    if (!matchesAllocationStatus(lead.status, req.conditions.statuses)) return false;

    // 0.5 Folder / Year / Source filter
    if (req.conditions.folder && req.conditions.folder !== "all") {
      if (req.conditions.folder === "all_master") {
        // Show all
      } else if (req.conditions.folder.startsWith("year_")) {
        const yr = req.conditions.folder.replace("year_", "");
        if (!isYearLead(lead, yr)) return false;
      } else if (req.conditions.folder === "website_form") {
        if (!isWebsiteFormLead(lead)) return false;
      } else if (req.conditions.folder === "hot_leads") {
        if (!isHotLead(lead)) return false;
      } else {
        if (!customFolderIds?.has(lead.id)) return false;
      }
    }
    const targetYear = req.conditions.folder?.startsWith("year_") ? req.conditions.folder.slice(5) : req.conditions.year;
    if (targetYear && targetYear !== "all" && !isYearLead(lead, targetYear)) return false;

    if (req.conditions.source && req.conditions.source !== "all" && lead.source !== req.conditions.source) return false;

    // 1. Area filter (Location-scoped matching)
    if (req.conditions.areas && req.conditions.areas.length > 0) {
      const leadPrimary = lead.primaryLocality.toLowerCase();
      const matched = req.conditions.areas.some((area) => {
        const canonicalTarget = (CANONICAL_AREA_ALIASES[area.toLowerCase().trim()] || area.trim()).toLowerCase();
        return leadPrimary === canonicalTarget || leadPrimary.includes(canonicalTarget);
      });
      if (!matched) return false;
    }

    // 2. Pincodes
    if (req.conditions.pincodes && req.conditions.pincodes.length > 0) {
      const leadPin = String(lead.pincode ?? "").trim();
      const matched = req.conditions.pincodes.some((pin) => leadPin.includes(pin.trim()));
      if (!matched) return false;
    }

    // 3. Services
    if (req.conditions.services && req.conditions.services.length > 0) {
      const leadService = String(lead.service ?? "").toLowerCase().trim();
      if (!leadService) return false;
      const matched = req.conditions.services.some((srv) =>
        leadService.includes(srv.toLowerCase().trim()),
      );
      if (!matched) return false;
    }

    // 4. Min Price
    if (req.conditions.min_price != null && req.conditions.min_price > 0) {
      const price = lead.price_total ?? 0;
      if (price < req.conditions.min_price) return false;
    }

    return true;
  });

  const selectedLeadIds = candidateLeads.slice(0, req.lead_count).map((l) => l.id);

  if (selectedLeadIds.length === 0) {
    return { allocatedCount: 0, leadIds: [] };
  }

  const allocatedLeadIds: string[] = [];
  const warnings: string[] = [];
  async function recordHistory(listId: string, staffId: string | null, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await supabase().from("lead_allocations_log").insert(ids.map((leadId) => ({
      lead_id: leadId,
      assigned_to_admin_user_id: staffId,
      assigned_to_list_id: listId,
      allocation_type: req.allocation_type ?? "manual",
      reason: req.notes || `Allocated in batch of ${ids.length} leads`,
    })));
    if (error) {
      console.error("Allocation history could not be recorded", error);
      if (!warnings.length) warnings.push("Leads were assigned, but allocation history could not be saved. Do not repeat the allocation.");
    }
  }
  let candidateOffset = 0;
  async function claimForList(listId: string, desired: number): Promise<string[]> {
    const claimed: string[] = [];
    while (claimed.length < desired && candidateOffset < candidateLeads.length) {
      const batchSize = Math.min(250, desired - claimed.length);
      const batch = candidateLeads.slice(candidateOffset, candidateOffset + batchSize).map((lead) => lead.id);
      candidateOffset += batch.length;
      claimed.push(...await claimUnassignedLeads(listId, batch));
    }
    return claimed;
  }

  if (req.target_list_id) {
    allocatedLeadIds.push(...await claimForList(req.target_list_id, selectedLeadIds.length));
    await recordHistory(req.target_list_id, destination?.assigned_admin_user_id ?? null, allocatedLeadIds);
  } else if (assignees.length > 0) {
    const leadsPerStaff = Math.floor(selectedLeadIds.length / assignees.length);
    const remainder = selectedLeadIds.length % assignees.length;

    for (let i = 0; i < assignees.length; i++) {
      const staffId = assignees[i];
      const start = i * leadsPerStaff + Math.min(i, remainder);
      const slice = selectedLeadIds.slice(start, start + leadsPerStaff + (i < remainder ? 1 : 0));
      if (slice.length === 0) continue;

      const listName = `Allocated Leads (${new Date().toLocaleDateString("en-IN")})`;
      const list = await insertLeadList({
        name: listName,
        created_by: req.allocation_type && req.allocation_type !== "manual" ? null : undefined,
        assigned_admin_user_id: staffId,
      });

      const claimed = await claimForList(list.id, slice.length);
      allocatedLeadIds.push(...claimed);

      await recordHistory(list.id, staffId, claimed);
    }
  }

  // Incrementally update assigned leads cache (0ms) so subsequent modal queries never experience cold cache reloads
  markLeadsAsAssigned(allocatedLeadIds);

  return {
    allocatedCount: allocatedLeadIds.length,
    leadIds: allocatedLeadIds,
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * Schedule or immediately execute a lead allocation request.
 */
export async function createAllocationSchedule(req: NewLeadAllocationRequest): Promise<{
  id?: string;
  allocatedCount?: number;
  mode: string;
  warnings?: string[];
}> {
  validateAllocationRequest(req);
  req = { ...req, assignee_ids: [...new Set(req.assignee_ids ?? [])] };
  await assertAllocationDestination(req.assignee_ids, req.target_list_id);
  // 1. One-Time Immediate
  if (req.schedule_mode === "once_now") {
    const res = await executeLeadAllocation({
      lead_count: req.lead_count,
      conditions: req.conditions,
      assignee_ids: req.assignee_ids,
      target_list_id: req.target_list_id,
      notes: req.notes,
      allocation_type: "manual",
    });

    const { error: historyError } = await supabase().from("lead_allocation_schedules").insert({
      scheduled_for: new Date().toISOString(),
      status: "completed",
      schedule_mode: "once_now",
      lead_count: req.lead_count,
      conditions: req.conditions,
      assignee_ids: req.assignee_ids,
      target_list_id: req.target_list_id ?? null,
      allocated_lead_ids: res.leadIds,
      notes: req.notes ?? null,
    });

    const warnings = [...(res.warnings ?? [])];
    if (historyError) warnings.push("Leads were assigned, but the dispatch record could not be saved. Do not repeat the allocation.");
    return { allocatedCount: res.allocatedCount, mode: "once_now", ...(warnings.length ? { warnings } : {}) };
  }

  // 2. Daily Recurring Schedule
  if (req.schedule_mode === "daily_recurring") {
    const { data, error } = await supabase()
      .from("lead_allocation_schedules")
      .insert({
        scheduled_for: new Date().toISOString(),
        status: "active_recurring",
        schedule_mode: "daily_recurring",
        lead_count: req.lead_count,
        recurring_time: req.recurring_time ? `${req.recurring_time}:00` : "09:30:00",
        recurring_days: req.recurring_days ?? [1, 2, 3, 4, 5, 6],
        conditions: req.conditions,
        assignee_ids: req.assignee_ids,
        target_list_id: req.target_list_id ?? null,
        notes: req.notes ?? null,
      })
      .select("id")
      .single();

    if (error) throw error;
    return { id: data.id, mode: "daily_recurring" };
  }

  // 3. Queue Auto-Replenish on Completion
  if (req.schedule_mode === "queue_replenish") {
    // Persist a paused rule before assigning anything. A failed insert must not
    // leave an untracked initial batch, and a worker must not race this request.
    const claimedAt = new Date().toISOString();
    const { data, error } = await supabase()
      .from("lead_allocation_schedules")
      .insert({
        scheduled_for: claimedAt,
        status: "paused",
        schedule_mode: "queue_replenish",
        lead_count: req.lead_count,
        replenish_threshold: req.replenish_threshold ?? 5,
        conditions: req.conditions,
        assignee_ids: req.assignee_ids,
        target_list_id: req.target_list_id ?? null,
        allocated_lead_ids: [],
        last_run_at: claimedAt,
        notes: req.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const rule = { id: data.id, status: "paused", last_run_at: claimedAt, notes: req.notes };
    let initialAllocation: Awaited<ReturnType<typeof executeLeadAllocation>>;
    try {
      initialAllocation = await executeLeadAllocation({
        lead_count: req.lead_count,
        conditions: req.conditions,
        assignee_ids: req.assignee_ids,
        target_list_id: req.target_list_id,
        notes: req.notes || "Initial Auto-Refill batch allocation",
        allocation_type: "queue_replenish",
      });
    } catch (failure) {
      await recordDispatchFailure(rule, claimedAt, failure);
      throw new Error("Initial auto-refill dispatch failed. The saved rule is paused; review existing assignments before resuming it. Do not create a duplicate rule.", { cause: failure });
    }
    const warnings = [...(initialAllocation.warnings ?? [])];
    try {
      await finishDispatch(rule, claimedAt, "active_recurring", initialAllocation.leadIds);
    } catch (failure) {
      console.error("Could not confirm activation of auto-refill rule", failure);
      warnings.push("The initial batch was assigned, but auto-refill activation could not be confirmed. Review the saved rule before resuming it. Do not repeat the allocation.");
    }
    return {
      id: data.id,
      allocatedCount: initialAllocation.allocatedCount,
      mode: "queue_replenish",
      warnings,
    };
  }

  // 4. One-Time Future Schedule
  const { data, error } = await supabase()
    .from("lead_allocation_schedules")
    .insert({
      scheduled_for: req.scheduled_for || new Date().toISOString(),
      status: "pending",
      schedule_mode: "once_scheduled",
      lead_count: req.lead_count,
      conditions: req.conditions,
      assignee_ids: req.assignee_ids,
      target_list_id: req.target_list_id ?? null,
      notes: req.notes ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: data.id, mode: "once_scheduled" };
}

/**
 * Cancel a pending one-time schedule.
 */
export async function cancelScheduledAllocation(id: string): Promise<void> {
  const { error } = await supabase()
    .from("lead_allocation_schedules")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) throw error;
}

/**
 * Pause an active recurring automation rule.
 */
export async function pauseScheduledAllocation(id: string): Promise<void> {
  const { error } = await supabase()
    .from("lead_allocation_schedules")
    .update({ status: "paused" })
    .eq("id", id);

  if (error) throw error;
}

/**
 * Resume a paused recurring automation rule.
 */
export async function resumeScheduledAllocation(id: string): Promise<void> {
  // One-time jobs must return to pending, not the recurring-only state.
  const { error: oneTimeError } = await supabase().from("lead_allocation_schedules")
    .update({ status: "pending" }).eq("id", id).eq("status", "paused").eq("schedule_mode", "once_scheduled");
  if (oneTimeError) throw oneTimeError;
  const { error: dailyError } = await supabase().from("lead_allocation_schedules")
    .update({ status: "active_recurring" }).eq("id", id).eq("status", "paused").eq("schedule_mode", "daily_recurring");
  if (dailyError) throw dailyError;
  const { error: refillError } = await supabase().from("lead_allocation_schedules")
    .update({ status: "active_recurring" }).eq("id", id).eq("status", "paused").eq("schedule_mode", "queue_replenish");
  if (refillError) throw refillError;
}

/**
 * Permanently delete / remove a scheduled allocation or automation rule.
 */
export async function deleteScheduledAllocation(id: string): Promise<void> {
  const { error } = await supabase()
    .from("lead_allocation_schedules")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

/**
 * List staff members with active workload summary, including assigned lists breakdown, completion rates, and total leads.
 */
export async function listStaffWorkload(): Promise<StaffWorkloadSummary[]> {
  const { data: adminUsers, error: usersErr } = await supabase()
    .from("admin_users")
    .select("id, email, role, employees:employee_id (name)")
    .eq("status", "active")
    .order("email");

  if (usersErr) throw usersErr;

  const { data: lists, error: listsErr } = await supabase()
    .from("lead_lists")
    .select("id, name, assigned_admin_user_id");

  if (listsErr) throw listsErr;

  const listItems = await readAllRows(supabase()
    .from("lead_list_items")
    .select("list_id, lead_id, leads:lead_id (status)")
    .order("lead_id"));

  // Compute total & completed leads per list
  const statsByListId = new Map<string, { total: number; completed: number }>();
  for (const item of listItems ?? []) {
    const listId = item.list_id;
    const current = statsByListId.get(listId) ?? { total: 0, completed: 0 };
    current.total += 1;

    const lead: any = Array.isArray(item.leads) ? item.leads[0] : item.leads;
    const status = lead?.status ?? "new";
    const isCompleted = isCompletedLeadStatus(status);
    if (isCompleted) {
      current.completed += 1;
    }

    statsByListId.set(listId, current);
  }

  // Group lists by assigned admin user
  const listsByUser = new Map<string, StaffAssignedListInfo[]>();
  for (const l of lists ?? []) {
    if (l.assigned_admin_user_id) {
      const userLists = listsByUser.get(l.assigned_admin_user_id) ?? [];
      const stats = statsByListId.get(l.id) ?? { total: 0, completed: 0 };
      const pending = Math.max(0, stats.total - stats.completed);
      const rate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

      userLists.push({
        id: l.id,
        name: l.name,
        totalLeads: stats.total,
        completedLeads: stats.completed,
        pendingLeads: pending,
        completionRate: rate,
      });
      listsByUser.set(l.assigned_admin_user_id, userLists);
    }
  }

  return (adminUsers ?? []).map((u: any) => {
    const empName = Array.isArray(u.employees) ? u.employees[0]?.name : u.employees?.name;
    const name = empName || u.email.split("@")[0];
    const userLists = listsByUser.get(u.id) ?? [];
    
    const totalLeadsCount = userLists.reduce((sum, item) => sum + item.totalLeads, 0);
    const completedLeadsCount = userLists.reduce((sum, item) => sum + item.completedLeads, 0);
    const pendingLeadsCount = Math.max(0, totalLeadsCount - completedLeadsCount);
    const overallCompletionRate = totalLeadsCount > 0
      ? Math.round((completedLeadsCount / totalLeadsCount) * 100)
      : 0;

    return {
      adminUserId: u.id,
      name,
      email: u.email,
      role: u.role,
      totalLeadsCount,
      completedLeadsCount,
      pendingLeadsCount,
      overallCompletionRate,
      assignedListsCount: userLists.length,
      assignedLists: userLists,
    };
  });
}

/**
 * 1-Click transfer all campaign lists from one staff to another.
 */
export async function transferStaffLeads(
  fromAdminUserId: string,
  toAdminUserId: string,
  reason: string = "Staff reallocation",
): Promise<{ transferredCount: number }> {
  const { data: updatedLists, error: listErr } = await supabase()
    .from("lead_lists")
    .update({ assigned_admin_user_id: toAdminUserId })
    .eq("assigned_admin_user_id", fromAdminUserId)
    .select("id");

  if (listErr) throw listErr;
  invalidateLeadListCache();

  return { transferredCount: updatedLists?.length ?? 0 };
}

type DispatchRule = { id: string; status: string; last_run_at?: string | null; notes?: string | null };
function dispatchTimestamp(rule: DispatchRule, now = Date.now()): string {
  return new Date(Math.max(now, (rule.last_run_at ? Date.parse(rule.last_run_at) : 0) + 1)).toISOString();
}

/** Atomically suspend dispatch while a worker owns the rule. No local lock: this works across server instances. */
async function claimDispatch(rule: DispatchRule, claimedAt: string): Promise<boolean> {
  let query = supabase().from("lead_allocation_schedules")
    .update({ status: "paused", last_run_at: claimedAt })
    .eq("id", rule.id).eq("status", rule.status);
  query = rule.last_run_at ? query.eq("last_run_at", rule.last_run_at) : query.is("last_run_at", null);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return !!data?.length;
}

async function finishDispatch(rule: DispatchRule, claimedAt: string, status: string, leadIds: string[]): Promise<void> {
  const { data, error } = await supabase().from("lead_allocation_schedules")
    .update({ status, allocated_lead_ids: leadIds })
    .eq("id", rule.id).eq("status", "paused").eq("last_run_at", claimedAt).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The rule changed during dispatch; its current state was preserved.");
}

async function recordDispatchFailure(rule: DispatchRule, claimedAt: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Dispatch failed";
  const { error: recordError } = await supabase().from("lead_allocation_schedules")
    .update({ notes: `${rule.notes ? `${rule.notes}\n` : ""}Dispatch paused: ${message}. Review existing assignments before resuming.` })
    .eq("id", rule.id).eq("status", "paused").eq("last_run_at", claimedAt);
  if (recordError) console.error("Could not record dispatch failure", recordError);
}

/**
 * Serverless Auto-Refill Processor:
 * Inspects active queue_replenish rules. If any assigned telecaller's pending
 * leads drop below their threshold, it immediately refills their queue.
 */
export async function processQueueAutoRefills(): Promise<{ refilledStaffCount: number }> {
  try {
    const { data: activeRules, error } = await supabase()
      .from("lead_allocation_schedules")
      .select("*")
      .eq("status", "active_recurring")
      .eq("schedule_mode", "queue_replenish");

    if (error) throw error;
    if (!activeRules || activeRules.length === 0) return { refilledStaffCount: 0 };

    let refilled = 0;
    for (const rule of activeRules) {
      const threshold = rule.replenish_threshold ?? 5;
      // Refresh for each rule: an earlier rule may already have replenished
      // the same staff member during this pass.
      const workload = await listStaffWorkload();
      const workloadByAdminId = new Map(workload.map((staff) => [staff.adminUserId, staff]));
      let eligible: string[];
      if (rule.target_list_id) {
        const list = await getLeadList(rule.target_list_id);
        if (!list || (list.pending_count ?? 0) > threshold) continue;
        eligible = [];
      } else {
        eligible = [...new Set<string>(rule.assignee_ids ?? [])].filter((id) => {
          const staff = workloadByAdminId.get(id);
          return !!staff && staff.pendingLeadsCount <= threshold;
        });
        if (!eligible.length) continue;
      }
      // lead_count is the total per batch, just as in initial allocation.
      const claimedAt = dispatchTimestamp(rule);
      if (!await claimDispatch(rule, claimedAt)) continue;
      try {
        const res = await executeLeadAllocation({
          lead_count: rule.lead_count ?? 10,
          conditions: rule.conditions ?? {},
          assignee_ids: eligible,
          target_list_id: rule.target_list_id,
          notes: `Auto-refill triggered (pending queue <= ${threshold})`,
          allocation_type: "queue_replenish",
        });
        if (res.allocatedCount > 0) {
          refilled += rule.target_list_id ? 1 : Math.min(eligible.length, res.allocatedCount);
        }
        await finishDispatch(rule, claimedAt, "active_recurring", res.leadIds);
      } catch (error) {
        await recordDispatchFailure(rule, claimedAt, error);
        throw error;
      }
    }

    return { refilledStaffCount: refilled };
  } catch (err) {
    console.error("processQueueAutoRefills error:", err);
    throw err;
  }
}

/**
 * Process pending one-time schedules and recurring daily releases.
 */
export async function processScheduledJobs(): Promise<{ executedCount: number }> {
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    let executed = 0;

    // 1. Process pending one-time schedules due now
    const { data: pendingJobs, error: pendingError } = await supabase()
      .from("lead_allocation_schedules")
      .select("*")
      .eq("status", "pending")
      .eq("schedule_mode", "once_scheduled")
      .lte("scheduled_for", nowIso);

    if (pendingError) throw pendingError;
    for (const job of pendingJobs ?? []) {
      const claimedAt = dispatchTimestamp(job, now.getTime());
      if (!await claimDispatch(job, claimedAt)) continue;
      try {
        const res = await executeLeadAllocation({
          lead_count: job.lead_count,
          conditions: job.conditions ?? {},
          assignee_ids: job.assignee_ids ?? [],
          target_list_id: job.target_list_id,
          notes: "Scheduled release executed",
          allocation_type: "scheduled",
        });
        await finishDispatch(job, claimedAt, "completed", res.leadIds);
        executed++;
      } catch (error) {
        await recordDispatchFailure(job, claimedAt, error);
        throw error;
      }
    }

    // 2. Process active daily recurring releases
    const { data: recurringRules, error: recurringError } = await supabase()
      .from("lead_allocation_schedules")
      .select("*")
      .eq("status", "active_recurring")
      .eq("schedule_mode", "daily_recurring");

    if (recurringError) throw recurringError;
    if (recurringRules && recurringRules.length > 0) {
      const istDateStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // "YYYY-MM-DD"
      const istTimeStr = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }); // "HH:MM"
      const istDayOfWeekStr = now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" });
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const istDayOfWeek = dayMap[istDayOfWeekStr] ?? now.getDay();

      for (const rule of recurringRules) {
        const recurringDays: number[] = rule.recurring_days ?? [1, 2, 3, 4, 5, 6];
        const targetTime = (rule.recurring_time ?? "09:30").slice(0, 5);
        const isDayDue = recurringDays.includes(istDayOfWeek);
        const isTimeDue = istTimeStr >= targetTime;

        let alreadyRanToday = false;
        if (rule.last_run_at) {
          const lastRunDateStr = new Date(rule.last_run_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
          alreadyRanToday = lastRunDateStr === istDateStr;
        }

        if (isDayDue && isTimeDue && !alreadyRanToday) {
          const claimedAt = dispatchTimestamp(rule, now.getTime());
          if (!await claimDispatch(rule, claimedAt)) continue;
          try {
            const res = await executeLeadAllocation({
              lead_count: rule.lead_count ?? 10,
              conditions: rule.conditions ?? {},
              assignee_ids: rule.assignee_ids ?? [],
              target_list_id: rule.target_list_id,
              notes: `Daily recurring release (${targetTime} IST)`,
              allocation_type: "daily_recurring",
            });
            await finishDispatch(rule, claimedAt, "active_recurring", res.leadIds);
            executed++;
          } catch (error) {
            await recordDispatchFailure(rule, claimedAt, error);
            throw error;
          }
        }
      }
    }

    // 3. Process queue auto-refills check
    await processQueueAutoRefills();

    return { executedCount: executed };
  } catch (err) {
    console.error("processScheduledJobs error:", err);
    throw err;
  }
}

/**
 * Selectively recycle and reassign non-positive / unbooked leads from a source list or staff member
 * to one or more target telecallers, cleanly moving them and optionally resetting status to "new".
 */
export async function recycleAndReassignLeads(
  req: RecycleLeadsRequest,
): Promise<RecycleLeadsResult> {
  const targetStaffIds = [...new Set(req.target_admin_user_ids ?? [])];
  if (!req.target_list_id && targetStaffIds.length === 0) {
    throw new Error("Please select at least one target telecaller or destination list.");
  }

  if (req.source_list_id && req.source_list_id === req.target_list_id) throw new Error("Choose a different destination list.");
  await assertAllocationDestination(targetStaffIds, req.target_list_id);

  // 1. Gather all candidate lead items from the source
  let listItemsQuery = supabase()
    .from("lead_list_items")
    .select(`
      list_id,
      lead_id,
      leads:lead_id (id, status, name)
    `);

  if (req.source_list_id) {
    listItemsQuery = listItemsQuery.eq("list_id", req.source_list_id);
  } else if (req.source_admin_user_id) {
    const { data: sourceLists } = await supabase()
      .from("lead_lists")
      .select("id")
      .eq("assigned_admin_user_id", req.source_admin_user_id);
    const sourceListIds = (sourceLists ?? []).map((l) => l.id);
    if (sourceListIds.length === 0) {
      return { recycledCount: 0, assignedStaffCount: 0, createdListIds: [], protectedCount: 0 };
    }
    listItemsQuery = listItemsQuery.in("list_id", sourceListIds);
  } else {
    throw new Error("Source list or source staff member is required.");
  }

  const rawItems = await readAllRows(listItemsQuery.order("lead_id", { ascending: true }));

  const allowedStatuses = new Set(req.include_statuses ?? ["call_not_responded", "contacted", "cancelled", "draft"]);
  const specificIdsSet = req.specific_lead_ids && req.specific_lead_ids.length > 0
    ? new Set(req.specific_lead_ids)
    : null;

  const leadsToRecycle: { leadId: string; sourceListId: string }[] = [];
  let protectedCount = 0;

  for (const item of rawItems ?? []) {
    const lead: any = Array.isArray(item.leads) ? item.leads[0] : item.leads;
    if (!lead) continue;

    const status = lead.status ?? "new";
    const matchesSpecific = !specificIdsSet || specificIdsSet.has(lead.id);

    if (status !== "booked" && allowedStatuses.has(status) && matchesSpecific) {
      leadsToRecycle.push({ leadId: lead.id, sourceListId: item.list_id });
    } else {
      protectedCount++;
    }
  }

  if (leadsToRecycle.length === 0) {
    return { recycledCount: 0, assignedStaffCount: 0, createdListIds: [], protectedCount };
  }

  const leadIdsToMove = Array.from(new Set(leadsToRecycle.map((l) => l.leadId)));

  const createdListIds: string[] = [];

  // 4. Assign to target(s)
  if (req.target_list_id) {
    await addLeadsToList(req.target_list_id, leadIdsToMove);
  } else if (targetStaffIds.length > 0) {
    const perStaff = Math.floor(leadIdsToMove.length / targetStaffIds.length);
    const remainder = leadIdsToMove.length % targetStaffIds.length;
    const dateStr = new Date().toLocaleDateString("en-IN");

    for (let i = 0; i < targetStaffIds.length; i++) {
      const staffId = targetStaffIds[i];
      const start = i * perStaff + Math.min(i, remainder);
      const slice = leadIdsToMove.slice(start, start + perStaff + (i < remainder ? 1 : 0));
      if (slice.length === 0) continue;

      const listName = req.create_new_list_name
        ? `${req.create_new_list_name}${targetStaffIds.length > 1 ? ` (Part ${i + 1})` : ""}`
        : `Recycled Leads (${dateStr})`;

      const newList = await insertLeadList({
        name: listName,
        assigned_admin_user_id: staffId,
      });

      await addLeadsToList(newList.id, slice);
      createdListIds.push(newList.id);

      // Log allocation audit using standard manual allocation_type with recycling reason
      const logRows = slice.map((leadId) => ({
        lead_id: leadId,
        assigned_to_admin_user_id: staffId,
        assigned_to_list_id: newList.id,
        allocation_type: "manual" as const,
        reason: req.reason || "Selective lead recycling / 2nd attempt pitch",
      }));
      await supabase().from("lead_allocations_log").insert(logRows);
    }
  }

  // Reset only after the moves succeed; a failed destination must not alter source dispositions.
  if (req.reset_status_to_new) {
    const { error: updateStatusErr } = await supabase()
      .from("leads")
      .update({ status: "new" })
      .in("id", leadIdsToMove);
    if (updateStatusErr) throw updateStatusErr;
  }

  invalidateAreaCountsCache();
  invalidateLeadListCache();

  return {
    recycledCount: leadIdsToMove.length,
    assignedStaffCount: targetStaffIds.length || 1,
    createdListIds,
    protectedCount,
  };
}

/**
 * Fetch the persistent campaign list membership and allocation history for a specific lead.
 */
export async function getLeadAllocationHistory(leadId: string): Promise<
  {
    id: string;
    created_at: string;
    allocation_type: string;
    reason: string;
    staffName: string | null;
    staffEmail: string | null;
    listName: string | null;
    listId: string | null;
  }[]
> {
  try {
    const { data, error } = await supabase()
      .from("lead_allocations_log")
      .select(`
        id,
        created_at,
        allocation_type,
        reason,
        assigned_to_list_id,
        lead_lists:assigned_to_list_id (id, name),
        admin_users:assigned_to_admin_user_id (id, email, employees:employee_id (name))
      `)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];

    return data.map((row: any) => {
      const admin = row.admin_users;
      const emp = admin?.employees;
      const empName = Array.isArray(emp) ? emp[0]?.name : emp?.name;
      const staffName = empName || (admin?.email ? admin.email.split("@")[0] : null);
      const list = row.lead_lists;
      const listName = Array.isArray(list) ? list[0]?.name : list?.name;

      return {
        id: row.id,
        created_at: row.created_at,
        allocation_type: row.allocation_type ?? "manual",
        reason: row.reason || "Assigned to list",
        staffName: staffName ?? null,
        staffEmail: admin?.email ?? null,
        listName: listName ?? null,
        listId: row.assigned_to_list_id ?? null,
      };
    });
  } catch (err) {
    console.error("getLeadAllocationHistory error:", err);
    return [];
  }
}



