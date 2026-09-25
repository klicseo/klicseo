import { beforeEach, expect, it, vi } from "vitest";
const { createSchedule, audit } = vi.hoisted(() => ({ createSchedule: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ currentAdmin: async () => ({ role: "super_admin" }), requirePermission: vi.fn() }));
vi.mock("@/lib/lead-routing", () => ({ createAllocationSchedule: createSchedule }));
vi.mock("@/lib/audit", () => ({ logAudit: audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { submitLeadAllocationAction } from "./routing-actions";
const request = { schedule_mode: "once_now" as const, lead_count: 2, conditions: {}, assignee_ids: ["staff-a"] };
beforeEach(() => { vi.resetAllMocks(); });
it("reports saved allocations as successful even when the audit write fails", async () => {
  createSchedule.mockResolvedValue({ allocatedCount: 2, mode: "once_now" });
  audit.mockRejectedValue(new Error("Audit unavailable"));
  const result = await submitLeadAllocationAction(request);
  expect(result.ok).toBe(true);
  expect(result.allocatedCount).toBe(2);
  expect(result.warnings?.join(" ")).toContain("Do not repeat the request");
  expect(createSchedule).toHaveBeenCalledTimes(1);
});
it("reports an allocation failure without writing a success audit entry", async () => {
  createSchedule.mockRejectedValue(new Error("Assignment unavailable"));
  expect(await submitLeadAllocationAction(request)).toEqual({ ok: false, error: "Assignment unavailable" });
  expect(audit).not.toHaveBeenCalled();
});

it("explains a legacy history schema failure returned as a plain database error", async () => {
  createSchedule.mockRejectedValue({ code: "42703", message: 'column "schedule_id" of relation "lead_allocations_log" does not exist' });
  const result = await submitLeadAllocationAction({ ...request, conditions: { include_assigned: true, statuses: ["call_not_responded"] } });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("migration 0046");
  expect(audit).not.toHaveBeenCalled();
});
it("preserves a useful plain-object database error message", async () => {
  createSchedule.mockRejectedValue({ code: "P0001", message: "Choose active team members" });
  expect(await submitLeadAllocationAction(request)).toEqual({ ok: false, error: "Choose active team members" });
});

it("explains the legacy allocation-type constraint instead of hiding its error", async () => {
  createSchedule.mockRejectedValue({ code: "23514", message: 'new row violates check constraint "lead_allocations_log_allocation_type_check"' });
  const result = await submitLeadAllocationAction(request);
  expect(result.ok).toBe(false);
  expect(result.error).toContain("migration 0047");
});
