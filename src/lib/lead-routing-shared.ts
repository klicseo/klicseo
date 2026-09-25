// Clean, client-safe types for Lead Allocation, Advanced Scheduling & Queue Replenishment

export type ScheduleMode =
  | "once_now"
  | "once_scheduled"
  | "daily_recurring"
  | "queue_replenish";

export type ScheduleStatus =
  | "pending"
  | "completed"
  | "cancelled"
  | "paused"
  | "active_recurring";

export interface LeadAllocationFilter {
  include_assigned?: boolean;
  folder?: string;
  year?: string;
  source?: string;
  areas?: string[];
  pincodes?: string[];
  services?: string[];
  /** Omitted or empty means all statuses; allocation preserves the current status. */
  statuses?: string[];
  min_price?: number | null;
}

export interface LeadAllocationSchedule {
  id: string;
  created_at: string;
  scheduled_for: string;
  status: ScheduleStatus;
  schedule_mode: ScheduleMode;
  lead_count: number;
  conditions: LeadAllocationFilter;
  assignee_ids: string[];
  target_list_id: string | null;
  target_list?: { id: string; name: string } | null;
  recurring_time: string; // "09:30"
  recurring_days: number[]; // [1,2,3,4,5,6]
  replenish_threshold: number; // e.g. 5 leads
  allocated_lead_ids: string[];
  notes: string | null;
}

export interface NewLeadAllocationRequest {
  schedule_mode: ScheduleMode;
  lead_count: number;
  conditions: LeadAllocationFilter;
  assignee_ids: string[];
  target_list_id?: string | null;
  scheduled_for?: string | null; // ISO string for future date/time
  recurring_time?: string | null; // "09:30"
  recurring_days?: number[] | null;
  replenish_threshold?: number | null;
  notes?: string | null;
}

import type { LeadStatus } from "./leads-shared";

export interface StaffAssignedListInfo {
  id: string;
  name: string;
  totalLeads: number;
  completedLeads: number;
  pendingLeads: number;
  completionRate: number; // 0 to 100 percentage
}

export interface StaffWorkloadSummary {
  adminUserId: string;
  name: string;
  email: string;
  role: string;
  totalLeadsCount: number;
  completedLeadsCount: number;
  pendingLeadsCount: number;
  overallCompletionRate: number; // 0 to 100 percentage
  assignedListsCount: number;
  assignedLists: StaffAssignedListInfo[];
}

export interface RecycleLeadsRequest {
  source_list_id?: string;
  source_admin_user_id?: string;
  target_admin_user_ids: string[];
  target_list_id?: string | null;
  create_new_list_name?: string;
  include_statuses: LeadStatus[];
  reset_status_to_new?: boolean;
  specific_lead_ids?: string[];
  reason?: string;
}

export interface RecycleLeadsResult {
  recycledCount: number;
  assignedStaffCount: number;
  createdListIds: string[];
  protectedCount: number;
}


/** Assignment availability is independent of the last call outcome. */
export function matchesAllocationStatus(status: string | null | undefined, statuses?: string[]): boolean {
  if (!statuses?.length) return true;
  const normalized = (status ?? "new").trim().toLowerCase();
  return statuses.some((value) => value.trim().toLowerCase() === normalized);
}

export interface AllocationDestinationContext {
  assignee_ids?: string[];
  target_list_id?: string | null;
  schedule_id?: string;
  exclude_admin_user_ids?: string[];
}
