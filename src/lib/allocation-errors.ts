/** Supabase/PostgREST failures are plain objects, not necessarily Error instances. */
export function allocationErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if ((record.code === "42703" || record.code === "PGRST204") && message.includes("schedule_id")) {
    return "The allocation history database needs an update (migration 0046). Apply it, then retry the allocation.";
  }
  if (record.code === "23514" && message.includes("lead_allocations_log_allocation_type_check")) {
    return "The allocation history database needs an update (migration 0047) to accept current allocation types. Apply it, then retry.";
  }
  if (record.code === "PGRST202") {
    return "A required allocation database function is unavailable. Apply the pending database migrations and reload the database API schema before retrying.";
  }
  if (record.code === "57014") {
    return "The allocation exceeded the database time limit. Check its result before retrying, or try a smaller batch.";
  }
  return message || fallback;
}
