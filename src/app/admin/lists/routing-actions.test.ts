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
