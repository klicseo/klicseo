import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lead-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lead-query")>(),
  ensureLeadQueryMetadata: vi.fn().mockResolvedValue(undefined),
}));

// Mock supabase client and dependencies
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockIn = vi.fn();
const mockEq = vi.fn();
const mockLte = vi.fn();
const mockGte = vi.fn();

let mockSchedulesData: any[] = [];
let mockLeadsData: any[] = [];
let mockLeadListItemsData: any[] = [];
let mockFolderItemsData: any[] = [];
let mockAdminUsersData: any[] = [];
let mockLeadListsData: any[] = [];

let mockAllocationsLogData: any[] = [];
let allocationLogError: Error | null = null;
let scheduleInsertError: Error | null = null;
let scheduleUpdateError: Error | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    rpc: mockRpc,
    from: (table: string) => {
      if (table === "lead_allocation_schedules") {
        return {
          select: (cols?: string) => ({
            eq: (field: string, val: any) => ({
              eq: (field2: string, val2: any) => ({
                lte: (field3: string, val3: any) => {
                  mockLte(field3, val3);
                  const filtered = mockSchedulesData.filter(
                    (s) =>
                      s[field] === val &&
                      s[field2] === val2 &&
                      new Date(s[field3]) <= new Date(val3),
                  );
                  return Promise.resolve({ data: filtered, error: null });
                },
                then: (resolve: any) => {
                  const filtered = mockSchedulesData.filter(
                    (s) => s[field] === val && s[field2] === val2,
                  );
                  return resolve({ data: filtered, error: null });
                },
              }),
              then: (resolve: any) => {
                const filtered = mockSchedulesData.filter((s) => s[field] === val);
                return resolve({ data: filtered, error: null });
              },
            }),
            order: () => Promise.resolve({ data: mockSchedulesData, error: null }),
          }),
          insert: (payload: any) => {
            mockInsert(payload);
            const row = Array.isArray(payload) ? payload[0] : payload;
            const newRow = { id: `sched-${Date.now()}`, ...row };
            if (!scheduleInsertError) mockSchedulesData.push(newRow);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: scheduleInsertError ? null : newRow, error: scheduleInsertError }),
              }),
              then: (resolve: any) => resolve({ data: scheduleInsertError ? null : newRow, error: scheduleInsertError }),
            };
          },
          update: (patch: any) => {
            const checks: Array<(row: any) => boolean> = [];
            const apply = () => {
              if (scheduleUpdateError) return { data: null, error: scheduleUpdateError };
              const matched = mockSchedulesData.filter((row) => checks.every((check) => check(row)));
              mockUpdate(patch, "id", matched.map((row) => row.id));
              mockSchedulesData = mockSchedulesData.map((row) => matched.includes(row) ? { ...row, ...patch } : row);
              return { data: matched.map((row) => ({ ...row, ...patch })), error: null };
            };
            const query: any = {
              eq: (field: string, value: any) => { checks.push((row) => row[field] === value); return query; },
              is: (field: string, value: any) => { checks.push((row) => (row[field] ?? null) === value); return query; },
              select: () => Promise.resolve(apply()),
              then: (resolve: any) => Promise.resolve(apply()).then(resolve),
            };
            return query;
          },
          delete: () => ({
            eq: (field: string, val: any) => {
              mockDelete(field, val);
              mockSchedulesData = mockSchedulesData.filter((s) => s[field] !== val);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      if (table === "leads") {
        const leadChain: any = {
          in: (field: string, vals: any[]) => leadChain,
          neq: (field: string, val: any) => leadChain,
          or: (clause: string) => leadChain,
          order: () => leadChain,
          gte: () => leadChain,
          range: () => Promise.resolve({ data: mockLeadsData, error: null }),
          limit: () => Promise.resolve({ data: mockLeadsData, error: null }),
          then: (resolve: any) => resolve({ data: mockLeadsData, error: null }),
        };

        return {
          select: (cols?: string, options?: { head?: boolean }) => options?.head ? Promise.resolve({ count: mockLeadsData.length, error: null }) : leadChain,
          update: (patch: any) => ({
            in: (field: string, vals: string[]) => {
              mockUpdate(patch, field, vals);
              mockLeadsData = mockLeadsData.map((l) =>
                vals.includes(l.id) ? { ...l, ...patch } : l,
              );
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      if (table === "lead_folder_items") return {
        select: () => ({ eq: (field: string, value: string) => ({ order: () => ({
          range: async (from: number, to: number) => ({ data: mockFolderItemsData.filter((row) => row[field] === value).slice(from, to + 1), error: null }),
        }) }) }),
      };
      if (table === "lead_list_items") {
        return {
          select: (cols?: string) => ({
            order: () => ({ range: (from: number, to: number) => Promise.resolve({ data: mockLeadListItemsData.slice(from, to + 1), error: null }) }),
            eq: (field: string, val: any) => ({
              order: () => ({ range: (from: number, to: number) => Promise.resolve({ data: mockLeadListItemsData.filter((item) => item[field] === val).slice(from, to + 1), error: null }) }),
              range: () => {
                const filtered = mockLeadListItemsData.filter((item) => item[field] === val);
                return Promise.resolve({ data: filtered, error: null });
              },
              then: (resolve: any) => {
                const filtered = mockLeadListItemsData.filter((item) => item[field] === val);
                return resolve({ data: filtered, error: null });
              },
            }),
            in: (field: string, vals: string[]) => ({
              order: () => ({ range: (from: number, to: number) => Promise.resolve({ data: mockLeadListItemsData.filter((item) => vals.includes(item[field])).slice(from, to + 1), error: null }) }),
              range: () => {
                const filtered = mockLeadListItemsData.filter((item) => vals.includes(item[field]));
                return Promise.resolve({ data: filtered, error: null });
              },
              then: (resolve: any) => {
                const filtered = mockLeadListItemsData.filter((item) => vals.includes(item[field]));
                return resolve({ data: filtered, error: null });
              },
            }),
            range: () => Promise.resolve({ data: mockLeadListItemsData, error: null }),
            then: (resolve: any) => resolve({ data: mockLeadListItemsData, error: null }),
          }),
          upsert: (items: any, options?: { ignoreDuplicates?: boolean }) => {
            const arr = Array.isArray(items) ? items : [items];
            const inserted = options?.ignoreDuplicates ? arr.filter((item) => !mockLeadListItemsData.some((existing) => existing.lead_id === item.lead_id)) : arr;
            mockLeadListItemsData.push(...inserted);
            return {
              select: () => Promise.resolve({ data: inserted, error: null }),
              then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
            };
          },
          delete: () => ({
            in: (field: string, vals: string[]) => {
              mockLeadListItemsData = mockLeadListItemsData.filter(
                (item) => !vals.includes(item[field]),
              );
              return Promise.resolve({ error: null });
            },
            eq: (field: string, val: string) => ({
              in: (field2: string, vals2: string[]) => {
                mockLeadListItemsData = mockLeadListItemsData.filter(
                  (item) => !(item[field] === val && vals2.includes(item[field2])),
                );
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }

      if (table === "lead_allocation_deliveries") return { select: () => ({ eq: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }) }) }) };

      if (table === "lead_lists") {
        return {
          select: () => ({
            order: () => ({ range: () => Promise.resolve({ data: mockLeadListsData, error: null }) }),
            eq: (field: string, val: any) => {
              const filtered = mockLeadListsData.filter((l) => l[field] === val);
              return {
                maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
                then: (resolve: any) => Promise.resolve({ data: filtered, error: null }).then(resolve),
              };
            },
            then: (resolve: any) => resolve({ data: mockLeadListsData, error: null }),
          }),
          insert: (payload: any) => {
            const row = Array.isArray(payload) ? payload[0] : payload;
            const newRow = { id: `list-${Date.now()}-${Math.random()}`, ...row };
            mockLeadListsData.push(newRow);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: scheduleInsertError ? null : newRow, error: scheduleInsertError }),
              }),
            };
          },
          update: (patch: any) => ({
            eq: (field: string, val: any) => {
              mockLeadListsData = mockLeadListsData.map((l) =>
                l[field] === val ? { ...l, ...patch } : l,
              );
              return {
                select: () => Promise.resolve({ data: [{ id: "transferred-1" }], error: null }),
              };
            },
          }),
        };
      }

      if (table === "admin_users") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: mockAdminUsersData, error: null }),
            }),
          }),
        };
      }

      if (table === "lead_allocations_log") {
        return {
          select: () => ({
            eq: (field: string, val: any) => ({
              order: () => {
                const filtered = mockAllocationsLogData.filter((log) => log[field] === val);
                return Promise.resolve({ data: filtered, error: null });
              },
            }),
          }),
          insert: (log: any) => {
            if (allocationLogError) return Promise.resolve({ error: allocationLogError });
            mockInsert(log);
            const arr = Array.isArray(log) ? log : [log];
            mockAllocationsLogData.push(...arr);
            return Promise.resolve({ error: null });
          },
        };
      }

      return {};
    },
  }),
}));

vi.mock("@/lib/admin-auth", () => ({
  currentAdmin: () => Promise.resolve({ email: "admin@klicseo.com", role: "super_admin", permissions: ["leads.view", "leads.manage"] }),
}));

vi.mock("@/lib/admin-users", () => ({
  listAssignableAdminUsers: async () => mockAdminUsersData.filter((user) => user.status !== "inactive"),
  getAdminUser: (email: string) => Promise.resolve({ id: "admin-123", email, role: "super_admin" }),
}));

import {
  matchesFilter,
  countMatchingLeads,
  executeLeadAllocation,
  createAllocationSchedule,
  processScheduledJobs,
  resumeScheduledAllocation,
  processQueueAutoRefills,
  transferStaffLeads,
  recycleAndReassignLeads,
  listStaffWorkload,
  getLeadAllocationHistory,
  invalidateAssignedLeadsCache,
} from "../lead-routing";
import { invalidateAreaCountsCache } from "../area";

describe("Allocation Automations Full Test Suite", () => {
  beforeEach(() => {
    mockFolderItemsData = [];
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: { leadIds: ["lead-1"], reassignedCount: 1 }, error: null });
    invalidateAreaCountsCache();
    invalidateAssignedLeadsCache();
    allocationLogError = null;
    scheduleInsertError = null;
    scheduleUpdateError = null;
    mockAllocationsLogData = [];
    mockSchedulesData = [];
    mockLeadListItemsData = [];
    mockLeadListsData = [];
    mockAdminUsersData = [
      { id: "staff-1", email: "priya@klicseo.com", role: "staff", employees: { name: "Priya" } },
      { id: "staff-2", email: "girija@klicseo.com", role: "staff", employees: { name: "Girija" } },
    ];
    mockLeadsData = [
      { id: "lead-1", area: "Velachery", pincode: "600042", service: "Ceramic Coating", price_total: 8000, status: "new" },
      { id: "lead-2", area: "Velachery", pincode: "600042", service: "Ceramic Coating", price_total: 9000, status: "new" },
      { id: "lead-3", area: "OMR", pincode: "600096", service: "PPF", price_total: 15000, status: "new" },
      { id: "lead-4", area: "OMR", pincode: "600096", service: "PPF", price_total: 12000, status: "new" },
    ];
  });

  it("previews assigned candidates but excludes the destination team", async () => {
    mockLeadListsData = [{ id: "source", assigned_admin_user_id: "staff-1" }, { id: "target", assigned_admin_user_id: "staff-2" }];
    mockLeadListItemsData = [{ lead_id: "lead-1", list_id: "source" }, { lead_id: "lead-2", list_id: "target" }];
    mockRpc.mockResolvedValueOnce({ data: { count: 3, assignedCount: 1, unassignedCount: 2, totalMatchingCount: 5 }, error: null });
    const result = await countMatchingLeads({ include_assigned: true }, { assignee_ids: ["staff-2"] });
    expect(result).toMatchObject({ count: 3, assignedCount: 1, unassignedCount: 2 });
    await executeLeadAllocation({ lead_count: 3, conditions: { include_assigned: true }, assignee_ids: ["staff-2"] });
    expect(mockRpc).toHaveBeenCalledWith("allocate_recycle_round", expect.objectContaining({
      p_filter: expect.objectContaining({ include_assigned: true, excludedStaff: ["staff-2"] }), p_count: 3, p_request_id: expect.any(String),
    }));
  });

  it.each(["once_now", "once_scheduled", "daily_recurring", "queue_replenish"] as const)("persists recycling for %s and supplies the rule ID on dispatch", async (mode) => {
    const res = await createAllocationSchedule({ schedule_mode: mode, lead_count: 1, conditions: { include_assigned: true }, assignee_ids: ["staff-2"], scheduled_for: "2020-01-01T00:00:00Z", recurring_time: "00:00", recurring_days: [0,1,2,3,4,5,6] });
    expect(mockSchedulesData[0].conditions.include_assigned).toBe(true);
    if (mode === "once_scheduled" || mode === "daily_recurring") await processScheduledJobs();
    expect(mockRpc).toHaveBeenCalledWith("allocate_recycle_round", expect.objectContaining({ p_schedule: mode === "once_now" ? null : mockSchedulesData[0].id }));
    if (mode === "queue_replenish") expect(res.reassignedCount).toBe(1);
  });

  it("does not assign an initial refill batch when its schedule cannot be saved", async () => {
    scheduleInsertError = new Error("Schedule storage unavailable");
    await expect(createAllocationSchedule({ schedule_mode: "queue_replenish", lead_count: 2, conditions: {}, assignee_ids: ["staff-1"] })).rejects.toThrow("Schedule storage unavailable");
    expect(mockLeadListItemsData).toEqual([]);
    expect(mockLeadListsData).toEqual([]);
    expect(mockSchedulesData).toEqual([]);
  });

  it("preserves the initial batch and warns when refill activation cannot be confirmed", async () => {
    scheduleUpdateError = new Error("Activation unavailable");
    const result = await createAllocationSchedule({ schedule_mode: "queue_replenish", lead_count: 2, conditions: {}, assignee_ids: ["staff-1"] });
    expect(result.allocatedCount).toBe(2);
    expect(result.warnings?.join(" ")).toContain("Do not repeat the allocation");
    expect(mockLeadListItemsData).toHaveLength(2);
    expect(mockSchedulesData[0].status).toBe("paused");
  });

  it("normally allocates unassigned leads of every status without changing their outcomes", async () => {
    const statuses = ["follow_up", "call_not_responded", "contacted", "cancelled", "not_interested", "booked", "new", "draft"];
    mockLeadsData = statuses.map((status, i) => ({ id: `status-${i}`, status, area: "Adyar" }));
    mockLeadListItemsData = [{ lead_id: "status-6", list_id: "already-assigned" }];
    expect((await countMatchingLeads({})).count).toBe(7);
    expect((await countMatchingLeads({ statuses: [] })).count).toBe(7);
    const before = mockLeadsData.map((lead) => lead.status);
    const result = await executeLeadAllocation({ lead_count: 20, conditions: {}, assignee_ids: ["staff-1"] });
    expect(result.allocatedCount).toBe(7);
    expect(result.leadIds).not.toContain("status-6");
    expect(mockLeadsData.map((lead) => lead.status)).toEqual(before);
    expect((await countMatchingLeads({})).count).toBe(0);
  });

  it("honors an explicit status selection equally in preview and allocation", async () => {
    mockLeadsData[0].status = "follow_up";
    mockLeadsData[1].status = "call_not_responded";
    const conditions = { statuses: ["follow_up", "call_not_responded"] };
    expect((await countMatchingLeads(conditions)).count).toBe(2);
    const result = await executeLeadAllocation({ lead_count: 20, conditions, assignee_ids: ["staff-1"] });
    expect(result.leadIds).toEqual(["lead-1", "lead-2"]);
    expect(mockLeadsData.slice(0, 2).map((lead) => lead.status)).toEqual(conditions.statuses);
  });

  it("uses the same source and unassigned pool for preview and existing-list allocation", async () => {
    mockLeadsData = mockLeadsData.map((lead, i) => ({ ...lead, source: i < 2 ? "wizard" : "admin" }));
    mockLeadListItemsData = [{ list_id: "another-staff-list", lead_id: "lead-1" }];
    mockLeadListsData = [{ id: "destination", assigned_admin_user_id: null }];
    const preview = await countMatchingLeads({ source: "wizard" });
    expect(preview).toEqual({ count: 1, totalUnallocated: 1 });
    const result = await executeLeadAllocation({ lead_count: 10, conditions: { source: "wizard" }, assignee_ids: [], target_list_id: "destination" });
    expect(result.leadIds).toEqual(["lead-2"]);
    expect(mockLeadListItemsData.find((item) => item.lead_id === "lead-1")?.list_id).toBe("another-staff-list");
  });

  it("honors a year filter inside the master folder in preview and execution", async () => {
    mockLeadsData = mockLeadsData.map((lead, i) => ({ ...lead, source: "upload", created_at: i === 0 ? "2024-01-01T00:00:00Z" : "2025-01-01T00:00:00Z" }));
    const conditions = { folder: "all_master", year: "2024" };
    expect((await countMatchingLeads(conditions)).count).toBe(1);
    const result = await executeLeadAllocation({ lead_count: 10, conditions, assignee_ids: ["staff-1"] });
    expect(result.leadIds).toEqual(["lead-1"]);
  });

  it("allocates only available leads from a custom folder and keeps its complete contents", async () => {
    const folder = "00000000-0000-0000-0000-000000000001";
    mockFolderItemsData = ["lead-1", "lead-2", "lead-3"].map((lead_id) => ({ list_id: folder, lead_id }));
    mockLeadListItemsData = [{ list_id: "old-staff-list", lead_id: "lead-1" }];
    mockLeadsData[2].status = "booked";
    expect(await countMatchingLeads({ folder })).toEqual({ count: 2, totalUnallocated: 2 });
    const result = await executeLeadAllocation({ lead_count: 10, conditions: { folder }, assignee_ids: ["staff-1"] });
    expect(result.leadIds).toEqual(["lead-2", "lead-3"]);
    expect(mockFolderItemsData.map((item) => item.lead_id)).toEqual(["lead-1", "lead-2", "lead-3"]);
    expect(mockLeadListItemsData.find((item) => item.lead_id === "lead-1")?.list_id).toBe("old-staff-list");
    expect((await countMatchingLeads({ folder })).count).toBe(0);
  });

  it("refuses a custom folder as an assignment destination", async () => {
    mockLeadListsData = [{ id: "folder", is_custom_folder: true, assigned_admin_user_id: "staff-1" }];
    await expect(executeLeadAllocation({ lead_count: 1, conditions: {}, assignee_ids: [], target_list_id: "folder" })).rejects.toThrow("staff assignment list");
    expect(mockLeadListItemsData).toEqual([]);
  });

  it("does not broaden a custom folder allocation to the global pool", async () => {
    const conditions = { folder: "custom-folder" };
    expect((await countMatchingLeads(conditions)).count).toBe(0);
    const result = await executeLeadAllocation({ lead_count: 10, conditions, assignee_ids: ["staff-1"] });
    expect(result.allocatedCount).toBe(0);
    expect(mockLeadListItemsData).toEqual([]);
  });

  it("concurrent allocations never steal leads and retry candidates claimed by another request", async () => {
    mockLeadListsData = [{ id: "list-a", assigned_admin_user_id: null }, { id: "list-b", assigned_admin_user_id: null }];
    const results = await Promise.all([
      executeLeadAllocation({ lead_count: 2, conditions: {}, assignee_ids: [], target_list_id: "list-a" }),
      executeLeadAllocation({ lead_count: 2, conditions: {}, assignee_ids: [], target_list_id: "list-b" }),
    ]);
    expect(results.map((result) => result.allocatedCount)).toEqual([2, 2]);
    expect(new Set(results.flatMap((result) => result.leadIds)).size).toBe(4);
    expect(mockLeadListItemsData.filter((item) => item.list_id === "list-a")).toHaveLength(2);
    expect(mockLeadListItemsData.filter((item) => item.list_id === "list-b")).toHaveLength(2);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid lead counts (%s) before any assignment", async (lead_count) => {
    await expect(executeLeadAllocation({ lead_count, conditions: {}, assignee_ids: ["staff-1"] })).rejects.toThrow("whole number");
    expect(mockLeadListItemsData).toEqual([]);
    expect(mockLeadListsData).toEqual([]);
  });

  it("rejects a missing destination and deduplicates staff selections", async () => {
    await expect(executeLeadAllocation({ lead_count: 2, conditions: {}, assignee_ids: [] })).rejects.toThrow("destination");
    await executeLeadAllocation({ lead_count: 4, conditions: {}, assignee_ids: ["staff-1", "staff-1", "staff-2"] });
    expect(mockLeadListsData).toHaveLength(2);
    for (const list of mockLeadListsData) expect(mockLeadListItemsData.filter((item) => item.list_id === list.id)).toHaveLength(2);
  });

  it("refills an existing destination list even when no separate staff are selected", async () => {
    mockLeadListsData = [{ id: "queue-list", name: "Queue", assigned_admin_user_id: null }];
    mockSchedulesData = [{ id: "queue-rule", status: "active_recurring", schedule_mode: "queue_replenish", target_list_id: "queue-list", assignee_ids: [], lead_count: 2, replenish_threshold: 0 }];
    const first = await processQueueAutoRefills();
    expect(first.refilledStaffCount).toBe(1);
    expect(mockLeadListItemsData).toHaveLength(2);
    expect(mockSchedulesData[0].allocated_lead_ids).toHaveLength(2);
    expect((await processQueueAutoRefills()).refilledStaffCount).toBe(0);
    expect(mockLeadListItemsData).toHaveLength(2);
  });

  it("uses one total refill batch across eligible staff and does not run overlapping rules against stale workloads", async () => {
    mockSchedulesData = ["rule-a", "rule-b"].map((id) => ({ id, status: "active_recurring", schedule_mode: "queue_replenish", assignee_ids: ["staff-1", "staff-2"], lead_count: 2, replenish_threshold: 0 }));
    expect((await processQueueAutoRefills()).refilledStaffCount).toBe(2);
    expect(mockLeadListItemsData).toHaveLength(2);
    expect(mockLeadListsData).toHaveLength(2);
    expect(mockSchedulesData[1].last_run_at).toBeUndefined();
  });

  it("refuses malformed scheduled requests before any allocation or schedule write", async () => {
    await expect(createAllocationSchedule({ schedule_mode: "daily_recurring", lead_count: 2, assignee_ids: ["staff-1"], conditions: {}, recurring_time: "25:61" })).rejects.toThrow("recurring time");
    await expect(createAllocationSchedule({ schedule_mode: "once_scheduled", lead_count: 2, assignee_ids: ["staff-1"], conditions: {}, scheduled_for: "not-a-date" })).rejects.toThrow("date and time");
    await expect(createAllocationSchedule({ schedule_mode: "queue_replenish", lead_count: 2, assignee_ids: ["staff-1"], conditions: {}, replenish_threshold: -1 })).rejects.toThrow("threshold");
    expect(mockSchedulesData).toEqual([]);
    expect(mockLeadListItemsData).toEqual([]);
  });

  it("rejects missing destinations and inactive staff before changing leads", async () => {
    await expect(executeLeadAllocation({ lead_count: 2, conditions: {}, assignee_ids: [], target_list_id: "deleted-list" })).rejects.toThrow("no longer exists");
    mockAdminUsersData[0].status = "inactive";
    await expect(executeLeadAllocation({ lead_count: 2, conditions: {}, assignee_ids: ["staff-1"] })).rejects.toThrow("active team members");
    expect(mockLeadListItemsData).toEqual([]);
    expect(mockLeadListsData).toEqual([]);
  });

  it("recycling validates its destination before resetting source lead status", async () => {
    mockLeadListItemsData = [{ list_id: "source", lead_id: "lead-1", leads: { id: "lead-1", status: "contacted" } }];
    await expect(recycleAndReassignLeads({ source_list_id: "source", target_list_id: "deleted-list", target_admin_user_ids: [], include_statuses: ["contacted"], reset_status_to_new: true })).rejects.toThrow("no longer exists");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLeadListItemsData[0].list_id).toBe("source");
  });

  it.each(["once_scheduled", "daily_recurring"])("claims a %s rule only once across concurrent scheduler runs", async (schedule_mode) => {
    mockSchedulesData = [{ id: "shared-rule", status: schedule_mode === "once_scheduled" ? "pending" : "active_recurring", schedule_mode, scheduled_for: new Date(Date.now() - 60000).toISOString(), recurring_days: [0,1,2,3,4,5,6], recurring_time: "00:00", lead_count: 2, assignee_ids: ["staff-1"], conditions: {} }];
    const results = await Promise.all([processScheduledJobs(), processScheduledJobs()]);
    expect(results.reduce((sum, result) => sum + result.executedCount, 0)).toBe(1);
    expect(mockLeadListItemsData).toHaveLength(2);
    expect(mockLeadListsData).toHaveLength(1);
  });

  it("claims a refill rule only once when two requests see the same low workload", async () => {
    mockSchedulesData = [{ id: "refill-rule", status: "active_recurring", schedule_mode: "queue_replenish", lead_count: 2, replenish_threshold: 0, assignee_ids: ["staff-1"], conditions: {} }];
    const results = await Promise.all([processQueueAutoRefills(), processQueueAutoRefills()]);
    expect(results.reduce((sum, result) => sum + result.refilledStaffCount, 0)).toBe(1);
    expect(mockLeadListItemsData).toHaveLength(2);
    expect(mockSchedulesData[0].status).toBe("active_recurring");
  });

  it("leaves a failed dispatch paused with a reason instead of silently retrying", async () => {
    mockSchedulesData = [{ id: "invalid-rule", status: "pending", schedule_mode: "once_scheduled", scheduled_for: new Date(Date.now() - 60000).toISOString(), lead_count: 2, assignee_ids: ["inactive-staff"], conditions: {} }];
    await expect(processScheduledJobs()).rejects.toThrow("active team members");
    expect(mockSchedulesData[0].status).toBe("paused");
    expect(mockSchedulesData[0].notes).toContain("Review existing assignments before resuming");
    expect((await processScheduledJobs()).executedCount).toBe(0);
    expect(mockLeadListItemsData).toEqual([]);
  });

  it("resumes a paused one-time job as pending and a recurring rule as active", async () => {
    mockSchedulesData = [{ id: "once", status: "paused", schedule_mode: "once_scheduled" }, { id: "daily", status: "paused", schedule_mode: "daily_recurring" }];
    await resumeScheduledAllocation("once");
    await resumeScheduledAllocation("daily");
    expect(mockSchedulesData[0].status).toBe("pending");
    expect(mockSchedulesData[1].status).toBe("active_recurring");
  });

  it("records history for an existing list and warns without claiming failure after a successful assignment", async () => {
    mockLeadListsData = [{ id: "existing", assigned_admin_user_id: null }];
    const first = await executeLeadAllocation({ lead_count: 1, conditions: {}, assignee_ids: [], target_list_id: "existing" });
    expect(mockAllocationsLogData[0]).toMatchObject({ lead_id: first.leadIds[0], assigned_to_list_id: "existing" });
    allocationLogError = new Error("History unavailable");
    const next = await executeLeadAllocation({ lead_count: 1, conditions: {}, assignee_ids: [], target_list_id: "existing" });
    expect(next.allocatedCount).toBe(1);
    expect(next.warnings?.[0]).toContain("Do not repeat");
    expect(mockLeadListItemsData).toHaveLength(2);
  });

  describe("1. Immediate Lead Allocation (once_now)", () => {
    it("allocates leads evenly across assignees and creates lists", async () => {
      const res = await createAllocationSchedule({
        schedule_mode: "once_now",
        lead_count: 2,
        conditions: { areas: ["Velachery"] },
        assignee_ids: ["staff-1", "staff-2"],
      });

      expect(res.mode).toBe("once_now");
      expect(res.allocatedCount).toBe(2);
      expect(mockLeadListItemsData.length).toBe(2);
      expect(mockLeadListsData.length).toBe(2); // 1 list per assignee
    });
  });

  describe("2. One-Time Future Scheduled Release (once_scheduled)", () => {
    it("creates pending schedule and executes when due", async () => {
      const pastTime = new Date(Date.now() - 60000).toISOString();
      const sched = await createAllocationSchedule({
        schedule_mode: "once_scheduled",
        scheduled_for: pastTime,
        lead_count: 2,
        conditions: {},
        assignee_ids: ["staff-1"],
      });

      expect(sched.mode).toBe("once_scheduled");
      expect(mockSchedulesData[0].status).toBe("pending");

      // Process cron job
      const cronRes = await processScheduledJobs();
      expect(cronRes.executedCount).toBe(1);
      expect(mockSchedulesData[0].status).toBe("completed");
    });
  });

  describe("3. Daily Recurring Automation (daily_recurring)", () => {
    it("executes recurring release on matching day and time", async () => {
      const now = new Date();
      const currentIstDay = now.getDay();
      const pastIstTime = "00:01"; // Early time guaranteed to be <= current time

      await createAllocationSchedule({
        schedule_mode: "daily_recurring",
        lead_count: 2,
        recurring_time: pastIstTime,
        recurring_days: [currentIstDay],
        conditions: {},
        assignee_ids: ["staff-1"],
      });

      expect(mockSchedulesData[0].status).toBe("active_recurring");

      // Process cron job
      const cronRes = await processScheduledJobs();
      expect(cronRes.executedCount).toBe(1);
      expect(mockSchedulesData[0].last_run_at).toBeDefined();

      // Running cron again today should not duplicate
      const secondRun = await processScheduledJobs();
      expect(secondRun.executedCount).toBe(0);
    });
  });

  describe("4. Queue Auto-Replenish Automation (queue_replenish)", () => {
    it("automatically refills queue when staff pending leads drop below threshold", async () => {
      // Create auto-refill rule with threshold 5
      await createAllocationSchedule({
        schedule_mode: "queue_replenish",
        replenish_threshold: 5,
        lead_count: 2,
        conditions: {},
        assignee_ids: ["staff-1"],
      });

      expect(mockSchedulesData[0].status).toBe("active_recurring");

      // Staff-1 currently has 0 pending leads <= threshold 5, so auto-refill triggers
      const refillRes = await processQueueAutoRefills();
      expect(refillRes.refilledStaffCount).toBe(1);
    });
  });

  describe("5. 1-Click Staff Reallocation (transferStaffLeads)", () => {
    it("transfers all lists from source staff to target staff", async () => {
      mockLeadListsData = [
        { id: "list-1", name: "Priya Campaign", assigned_admin_user_id: "staff-1" },
        { id: "list-2", name: "Priya Batch 2", assigned_admin_user_id: "staff-1" },
      ];

      const res = await transferStaffLeads("staff-1", "staff-2");
      expect(res.transferredCount).toBe(1);
    });
  });

  describe("6. Lead Recycling Automation (recycleAndReassignLeads)", () => {
    it("recycles non-booked leads, resets status, and creates new batch lists", async () => {
      mockLeadListsData = [
        { id: "source-list-1", name: "Old Campaign", assigned_admin_user_id: "staff-1" },
      ];
      mockLeadListItemsData = [
        { list_id: "source-list-1", lead_id: "lead-recycle-1", leads: { id: "lead-recycle-1", status: "call_not_responded" } },
        { list_id: "source-list-1", lead_id: "lead-recycle-2", leads: { id: "lead-recycle-2", status: "cancelled" } },
        { list_id: "source-list-1", lead_id: "lead-booked-3", leads: { id: "lead-booked-3", status: "booked" } },
      ];

      mockRpc.mockResolvedValueOnce({ data: { reassignedCount: 2, protectedCount: 1, createdListIds: ["new-list"], assignedStaffCount: 1, roundComplete: true, waitingCount: 4 }, error: null });
      const res = await recycleAndReassignLeads({
        source_list_id: "source-list-1",
        target_admin_user_ids: ["staff-2"],
        include_statuses: ["call_not_responded", "cancelled"],
        reset_status_to_new: true,
      });

      expect(mockRpc).toHaveBeenCalledWith("allocate_recycle_round", expect.objectContaining({
        p_filter: expect.objectContaining({ source_list_id: "source-list-1", recycle_only: true, statuses: ["call_not_responded", "cancelled"] }),
        p_reset_status: true,
      }));
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(res.waitingCount).toBe(4);
      expect(res.recycledCount).toBe(2);
      expect(res.protectedCount).toBe(1); // booked lead protected
      expect(res.createdListIds.length).toBe(1);
    });
  });

  describe("7. Persistent Campaign & Allocation History (getLeadAllocationHistory)", () => {
    it("fetches chronological list allocation and recycling history for a lead", async () => {
      mockAllocationsLogData = [
        {
          id: "log-1",
          created_at: "2026-08-19T09:30:00Z",
          lead_id: "lead-hist-1",
          allocation_type: "manual",
          reason: "Recycled from Old Campaign → Assigned to Girija",
          assigned_to_list_id: "list-2",
          lead_lists: { id: "list-2", name: "Recycled Leads (19/08/2026)" },
          admin_users: { id: "staff-2", email: "girija@klicseo.com", employees: { name: "Girija" } },
        },
        {
          id: "log-2",
          created_at: "2026-08-15T09:30:00Z",
          lead_id: "lead-hist-1",
          allocation_type: "daily_recurring",
          reason: "Initial release",
          assigned_to_list_id: "list-1",
          lead_lists: { id: "list-1", name: "Priya Campaign" },
          admin_users: { id: "staff-1", email: "priya@klicseo.com", employees: { name: "Priya" } },
        },
      ];

      const history = await getLeadAllocationHistory("lead-hist-1");
      expect(history.length).toBe(2);
      expect(history[0].listName).toBe("Recycled Leads (19/08/2026)");
      expect(history[0].staffName).toBe("Girija");
      expect(history[1].listName).toBe("Priya Campaign");
      expect(history[1].staffName).toBe("Priya");
    });
  });
});
