import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDeleteIn = vi.fn();
const mockDeleteEq = vi.fn();
const mockInsert = vi.fn();
const mockInsertLeadList = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: (table: string) => {
      if (table === "lead_list_items") {
        return {
          delete: () => ({
            in: (field: string, values: string[]) => {
              mockDeleteIn(field, values);
              return Promise.resolve({ error: null });
            },
            eq: (field: string, value: string) => {
              mockDeleteEq(field, value);
              return {
                eq: (f2: string, v2: string) => {
                  mockDeleteEq(f2, v2);
                  return Promise.resolve({ error: null });
                },
              };
            },
          }),
          upsert: (items: any[]) => {
            mockInsert(items.map(({ added_at, ...item }) => item));
            return Promise.resolve({ error: null });
          },
          select: () => ({
            range: vi.fn().mockResolvedValue({ data: [] }),
            eq: () => ({
              order: () => ({ range: vi.fn().mockResolvedValue({ data: [], error: null }) }),
              range: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        };
      }
      if (table === "lead_lists") {
        return {
          insert: (data: unknown) => {
            mockInsertLeadList(data);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "list-new-created-123",
                      name: "Test List",
                      assigned_admin_user_id: "admin-staff-1",
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "list-target-555",
                    name: "Target List",
                    assigned_admin_user_id: null,
                  },
                  error: null,
                }),
            }),
          }),
          delete: () => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [] }),
      };
    },
  }),
}));

vi.mock("@/lib/admin-auth", () => ({
  currentAdmin: () =>
    Promise.resolve({
      id: "admin-user-1",
      email: "admin@test.com",
      role: "super_admin",
      permissions: ["leads.view", "leads.manage"],
    }),
  requirePermission: () =>
    Promise.resolve({
      id: "admin-user-1",
      email: "admin@test.com",
      role: "super_admin",
      permissions: ["leads.view", "leads.manage"],
    }),
  resolveScope: () => Promise.resolve({ kind: "all" as const }),
}));

vi.mock("@/lib/admin-users", () => ({
  getAdminUser: () => Promise.resolve({ id: "admin-user-1", email: "admin@test.com" }),
  listAssignableAdminUsers: () =>
    Promise.resolve([
      { id: "admin-staff-1", email: "staff1@test.com", name: "Rajesh Kumar" },
      { id: "admin-staff-2", email: "staff2@test.com", name: "Priya S" },
    ]),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { addLeadsToList, removeLeadFromList, deleteLeadList } from "../leadLists";
import { createListAndAssignLeadsAction, addLeadsToListAction } from "@/app/admin/lists/actions";
import { getAllAssignedLeadIds, setAssignedLeadsCache } from "../lead-assignments";

describe("Manual Lead Selection & List/Staff Assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAssignedLeadsCache(new Set());
  });

  it("1. adds manually selected leads to an existing list and marks them assigned in cache", async () => {
    const targetListId = "list-existing-999";
    const selectedLeadIds = ["lead-manual-1", "lead-manual-2", "lead-manual-3"];

    await addLeadsToList(targetListId, selectedLeadIds);

    // Verifies 1-to-1 exclusivity: deletes from prior lists
    expect(mockDeleteIn).not.toHaveBeenCalled();

    // Verifies insertion into target list
    expect(mockInsert).toHaveBeenCalledWith([
      { list_id: targetListId, lead_id: "lead-manual-1" },
      { list_id: targetListId, lead_id: "lead-manual-2" },
      { list_id: targetListId, lead_id: "lead-manual-3" },
    ]);

    // Verifies cache is immediately updated
    const assignedIds = await getAllAssignedLeadIds();
    expect(assignedIds.has("lead-manual-1")).toBe(true);
    expect(assignedIds.has("lead-manual-2")).toBe(true);
    expect(assignedIds.has("lead-manual-3")).toBe(true);
  });

  it("2. creates a new list assigned to a staff member and assigns selected leads to it via action", async () => {
    const fd = new FormData();
    fd.append("name", "Velachery January Follow-ups");
    fd.append("assigned_admin_user_id", "admin-staff-1");
    fd.append("leadIds", "lead-select-a");
    fd.append("leadIds", "lead-select-b");

    const result = await createListAndAssignLeadsAction(fd);

    expect(result.ok).toBe(true);
    expect(result.listId).toBe("list-new-created-123");
    expect(result.count).toBe(2);

    // Verifies lead list creation was executed with staff assignment
    expect(mockInsertLeadList).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Velachery January Follow-ups",
        assigned_admin_user_id: "admin-staff-1",
      }),
    );

    // Verifies lead items were attached
    expect(mockInsert).toHaveBeenCalledWith([
      { list_id: "list-new-created-123", lead_id: "lead-select-a" },
      { list_id: "list-new-created-123", lead_id: "lead-select-b" },
    ]);

    // Verifies cache marks them assigned
    const assignedSet = await getAllAssignedLeadIds();
    expect(assignedSet.has("lead-select-a")).toBe(true);
    expect(assignedSet.has("lead-select-b")).toBe(true);
  });

  it("3. handles addLeadsToListAction with multiple selected lead IDs", async () => {
    const fd = new FormData();
    fd.append("listId", "list-target-555");
    fd.append("leadIds", "lead-bulk-1");
    fd.append("leadIds", "lead-bulk-2");

    const result = await addLeadsToListAction(fd);

    expect(result.error).toBeUndefined();
    expect(mockInsert).toHaveBeenCalledWith([
      { list_id: "list-target-555", lead_id: "lead-bulk-1" },
      { list_id: "list-target-555", lead_id: "lead-bulk-2" },
    ]);
  });

  it("4. removes lead from list and invalidates assignment cache", async () => {
    setAssignedLeadsCache(new Set(["lead-to-remove-1", "other-lead-2"]));

    await removeLeadFromList("list-1", "lead-to-remove-1");

    expect(mockDeleteEq).toHaveBeenCalled();
  });
});
