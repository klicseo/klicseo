"use server";

import { getOrBuildLocationIndex } from "@/lib/area";
import { getSiteSettings } from "@/lib/site-settings";
import { DEFAULT_LEAD_STATUS_ITEMS } from "@/lib/site-settings-shared";
import { revalidatePath } from "next/cache";
import { requirePermission, currentAdmin } from "@/lib/admin-auth";
import { logAudit } from "@/lib/audit";
import {
  countMatchingLeads,
  createAllocationSchedule,
  cancelScheduledAllocation,
  pauseScheduledAllocation,
  resumeScheduledAllocation,
  deleteScheduledAllocation,
  transferStaffLeads,
  recycleAndReassignLeads,
  type NewLeadAllocationRequest,
  type LeadAllocationFilter,
  type RecycleLeadsRequest,
  type RecycleLeadsResult,
} from "@/lib/lead-routing";

async function requireAdminManager() {
  const me = await currentAdmin();
  if (!me) throw new Error("Unauthorized");
  if (me.role !== "super_admin") {
    throw new Error("Forbidden: Only administrators can allocate or reassign leads.");
  }
  return me;
}

export async function getAllocationFilterOptionsAction(): Promise<{
  statuses: { id: string; label: string }[];
  services: string[];
}> {
  await requireAdminManager();
  const [settings, index] = await Promise.all([getSiteSettings(), getOrBuildLocationIndex()]);
  const statuses = settings.leadStatuses?.length ? settings.leadStatuses : DEFAULT_LEAD_STATUS_ITEMS;
  return {
    statuses: statuses.map(({ id, label }) => ({ id, label })),
    services: [...new Set(index.allLeads.map((lead) => lead.service?.trim()).filter((service): service is string => !!service))].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Preview how many unallocated leads match the given conditions.
 */
export async function previewMatchingLeadsAction(
  filter: LeadAllocationFilter,
): Promise<{ count: number; totalUnallocated: number; error?: string }> {
  try {
    await requireAdminManager();
    return await countMatchingLeads(filter);
  } catch (err) {
    console.error("previewMatchingLeadsAction error:", err);
    return { count: 0, totalUnallocated: 0, error: err instanceof Error ? err.message : "Could not load the available leads." };
  }
}

/**
 * Execute immediate allocation or configure advanced scheduling.
 */
export async function submitLeadAllocationAction(
  req: NewLeadAllocationRequest,
): Promise<{ ok: boolean; allocatedCount?: number; mode?: string; warnings?: string[]; error?: string }> {
  try {
    await requireAdminManager();

    if (!req.lead_count || req.lead_count <= 0) {
      return { ok: false, error: "Please enter a valid number of leads to allocate." };
    }

    if ((!req.assignee_ids || req.assignee_ids.length === 0) && !req.target_list_id) {
      return { ok: false, error: "Please select at least one staff member or destination list." };
    }

    const res = await createAllocationSchedule(req);

    let summary = `Allocated ${res.allocatedCount} leads to ${req.assignee_ids.length} staff`;
    if (res.mode === "daily_recurring") {
      summary = `Configured daily recurring schedule: ${req.lead_count} leads at ${req.recurring_time || "09:30"} IST`;
    } else if (res.mode === "queue_replenish") {
      summary = `Configured queue auto-replenish: refill ${req.lead_count} leads when staff queue reaches or falls below ${req.replenish_threshold ?? 5}`;
    } else if (res.mode === "once_scheduled") {
      summary = `Scheduled allocation of ${req.lead_count} leads for ${req.scheduled_for}`;
    }

    const warnings = [...(res.warnings ?? [])];
    try {
      await logAudit("lead_allocation.configure", {
        entity: "lead_allocation",
        entityId: res.id || "immediate",
        summary,
      });
    } catch (auditError) {
      console.error("Allocation saved but audit logging failed", auditError);
      warnings.push("The allocation was saved, but its audit entry could not be recorded. Do not repeat the request.");
    }

    revalidatePath("/admin");
    revalidatePath("/admin/lists");
    revalidatePath("/admin/my-lists");
    return {
      ok: true,
      allocatedCount: res.allocatedCount,
      mode: res.mode,
      warnings,
    };
  } catch (err: unknown) {
    console.error("submitLeadAllocationAction error:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to allocate leads.",
    };
  }
}



/**
 * Cancel a pending one-time scheduled allocation.
 */
export async function cancelScheduledAllocationAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdminManager();
    await cancelScheduledAllocation(id);
    await logAudit("lead_schedule.cancel", {
      entity: "lead_allocation_schedule",
      entityId: id,
      summary: "Cancelled scheduled lead allocation",
    });

    revalidatePath("/admin/lists");
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to cancel schedule.",
    };
  }
}

/**
 * Pause an active recurring automation.
 */
export async function pauseScheduledAllocationAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdminManager();
    await pauseScheduledAllocation(id);
    await logAudit("lead_schedule.pause", {
      entity: "lead_allocation_schedule",
      entityId: id,
      summary: "Paused recurring lead allocation rule",
    });

    revalidatePath("/admin/lists");
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to pause automation.",
    };
  }
}

/**
 * Resume a paused recurring automation.
 */
export async function resumeScheduledAllocationAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdminManager();
    await resumeScheduledAllocation(id);
    await logAudit("lead_schedule.resume", {
      entity: "lead_allocation_schedule",
      entityId: id,
      summary: "Resumed recurring lead allocation rule",
    });

    revalidatePath("/admin/lists");
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to resume automation.",
    };
  }
}

/**
 * Permanently delete a schedule or automation rule.
 */
export async function deleteScheduledAllocationAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdminManager();
    await deleteScheduledAllocation(id);
    await logAudit("lead_schedule.delete", {
      entity: "lead_allocation_schedule",
      entityId: id,
      summary: "Deleted lead allocation rule permanently",
    });

    revalidatePath("/admin/lists");
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete automation rule.",
    };
  }
}

/**
 * 1-Click transfer all campaign lists from one staff to another.
 */
export async function transferStaffLeadsAction(
  fromAdminUserId: string,
  toAdminUserId: string,
  reason: string,
): Promise<{ ok: boolean; transferredCount?: number; error?: string }> {
  try {
    await requireAdminManager();
    if (!fromAdminUserId || !toAdminUserId) {
      return { ok: false, error: "Source and destination staff must be selected." };
    }
    const res = await transferStaffLeads(fromAdminUserId, toAdminUserId, reason);
    await logAudit("lead_lists.transfer", {
      entity: "admin_user",
      entityId: toAdminUserId,
      summary: `Transferred ${res.transferredCount} lists from ${fromAdminUserId} to ${toAdminUserId}`,
    });

    revalidatePath("/admin/lists");
    revalidatePath("/admin/my-lists");
    return { ok: true, transferredCount: res.transferredCount };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to transfer leads.",
    };
  }
}

/**
 * Selectively recycle and reassign non-positive leads from a list or telecaller to new telecallers.
 */
export async function recycleLeadsAction(
  req: RecycleLeadsRequest,
): Promise<{ ok: boolean; result?: RecycleLeadsResult; error?: string }> {
  try {
    await requireAdminManager();
    if (!req.target_admin_user_ids?.length && !req.target_list_id) {
      return { ok: false, error: "Please select at least one target telecaller or destination list." };
    }

    const result = await recycleAndReassignLeads(req);

    await logAudit("lead_recycling.execute", {
      entity: "lead_list",
      entityId: req.source_list_id || req.source_admin_user_id || "bulk",
      summary: `Recycled ${result.recycledCount} leads across ${result.assignedStaffCount} telecaller(s). Protected ${result.protectedCount} leads.`,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/lists");
    if (req.source_list_id) revalidatePath(`/admin/lists/${req.source_list_id}`);
    for (const id of result.createdListIds) {
      revalidatePath(`/admin/lists/${id}`);
    }
    revalidatePath("/admin/my-lists");

    return { ok: true, result };
  } catch (err: unknown) {
    console.error("recycleLeadsAction error:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to recycle leads.",
    };
  }
}
