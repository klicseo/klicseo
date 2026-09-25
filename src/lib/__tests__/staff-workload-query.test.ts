import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { rpc, from, lists } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), lists: [] as any[] }));
vi.mock("../supabase", () => ({ supabase: () => ({ rpc, from }) }));
import { listStaffWorkload } from "../lead-routing";

beforeEach(() => {
  vi.stubEnv("LEAD_DATABASE_READS", "true");
  vi.clearAllMocks();
  lists.splice(0, lists.length,
    { id: "list", name: "Campaign", assigned_admin_user_id: "staff" },
    { id: "empty", name: "Empty", assigned_admin_user_id: "staff" },
    { id: "unassigned", name: "Unassigned", assigned_admin_user_id: null });
  from.mockImplementation((table) => {
    if (table === "admin_users") return { select: () => ({ eq: () => ({ order: async () => ({ data: [
      { id: "staff", email: "staff@example.com", role: "staff", employees: { name: "Agent" } },
      { id: "idle", email: "idle@example.com", role: "staff", employees: null },
    ], error: null }) }) }) };
    if (table === "lead_lists") return { select: async () => ({ data: lists, error: null }) };
    throw new Error(`Unexpected bulk read: ${table}`);
  });
  rpc.mockResolvedValue({ data: [
    { list_id: "list", status: "new", count: 8000 },
    { list_id: "list", status: "booked", count: 2000 },
  ], error: null });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("calculates workloads from grouped counts without downloading memberships", async () => {
  const result = await listStaffWorkload();
  expect(result[0]).toMatchObject({ name: "Agent", totalLeadsCount: 10000, completedLeadsCount: 2000,
    pendingLeadsCount: 8000, overallCompletionRate: 20, assignedListsCount: 2 });
  expect(result[0].assignedLists[1]).toMatchObject({ totalLeads: 0, completionRate: 0 });
  expect(result[1]).toMatchObject({ name: "idle", totalLeadsCount: 0, assignedLists: [] });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("admin_lead_query", expect.objectContaining({ p_mode: "listStats", p_filter: { listIds: ["list", "empty"] } }));
});

it("does not query memberships when there are no assigned lists", async () => {
  lists.splice(0);
  expect((await listStaffWorkload())[0].totalLeadsCount).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
});

it("propagates failed counts instead of showing staff as idle", async () => {
  rpc.mockResolvedValue({ data: null, error: new Error("Counts unavailable") });
  await expect(listStaffWorkload()).rejects.toThrow("Counts unavailable");
});
