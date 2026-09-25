import type { NewLeadAllocationRequest } from "./lead-routing-shared";

export function validateAllocationRequest(req: NewLeadAllocationRequest): void {
  if (req.conditions?.include_assigned != null && typeof req.conditions.include_assigned !== "boolean") throw new Error("Invalid include-assigned option.");
  if (!Number.isSafeInteger(req.lead_count) || req.lead_count <= 0) throw new Error("Lead count must be a positive whole number.");
  if (!req.target_list_id && !req.assignee_ids?.length) throw new Error("Select a destination list or at least one staff member.");
  if (!["once_now", "once_scheduled", "daily_recurring", "queue_replenish"].includes(req.schedule_mode)) throw new Error("Choose a valid allocation mode.");
  if (req.schedule_mode === "once_scheduled" && (!req.scheduled_for || !Number.isFinite(Date.parse(req.scheduled_for)))) throw new Error("Choose a valid scheduled date and time.");
  if (req.schedule_mode === "daily_recurring") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(req.recurring_time ?? "09:30")) throw new Error("Choose a valid recurring time.");
    if (req.recurring_days && (!req.recurring_days.length || req.recurring_days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) throw new Error("Choose at least one valid recurring day.");
  }
  if (req.schedule_mode === "queue_replenish" && req.replenish_threshold != null && (!Number.isSafeInteger(req.replenish_threshold) || req.replenish_threshold < 0)) throw new Error("Queue threshold must be a non-negative whole number.");
}
