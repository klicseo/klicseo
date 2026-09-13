import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "../admin-users-shared";

let actor: AdminPrincipal;
let authenticated = true;
let rows: Record<string, any[]>;
let folderError: Error | null;
const selections: string[] = [];
const writes = vi.fn();

vi.mock("@/lib/admin-auth", () => ({
  currentAdmin: async () => authenticated ? actor : null,
  requirePermission: async (permission: string) => {
    if (!actor.permissions.includes(permission as any)) throw new Error("Forbidden");
    return actor;
  },
  resolveScope: async () => actor.role === "super_admin" ? { kind: "all" } : { kind: "assigned", adminUserId: "staff-a" },
}));
vi.mock("@/lib/admin-users", () => ({
  getAdminUser: async () => ({ id: "staff-a", email: actor.email }),
  listAdminUsers: async () => [{ id: "staff-a", email: actor.email, role: actor.role, status: "active" }],
  listAssignableAdminUsers: async () => [{ id: "staff-a" }, { id: "staff-b" }],
}));
vi.mock("@/lib/area", () => ({
  getOrBuildLocationIndex: async () => ({ allLeads: rows.leads.map((lead) => ({ ...lead, primaryLocality: lead.area })), leadMap: new Map(rows.leads.map((lead) => [lead.id, lead])) }),
  invalidateAreaCountsCache: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: () => ({ from: (table: string) => {
    const predicates: ((row: any) => boolean)[] = [];
    let single = false;
    let inserted: any;
    let bounds: [number, number] | undefined;
    const result = () => {
      if (table === "lead_lists" && folderError) return { data: null, error: folderError };
      let data = inserted ? [inserted] : (table === "lead_collection_items" ? [...(rows.lead_list_items ?? []), ...(rows.lead_folder_items ?? [])] : rows[table] ?? []).filter((row) => predicates.every((test) => test(row)));
      data = data.map((row) => ["lead_list_items", "lead_folder_items"].includes(table) ? { ...row, leads: rows.leads.find((lead) => lead.id === row.lead_id), lead_lists: rows.lead_lists.find((list) => list.id === row.list_id) } : row);
      const count = data.length;
      if (bounds) data = data.slice(bounds[0], bounds[1] + 1);
      return { data: single ? data[0] ?? null : data, error: null, count };
    };
    const query: any = {
      select: (columns: string) => { selections.push(columns); return query; },
      eq: (field: string, value: unknown) => { predicates.push((row) => field === "lead_lists.assigned_admin_user_id" ? rows.lead_lists.find((list) => list.id === row.list_id)?.assigned_admin_user_id === value : row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { predicates.push((row) => values.includes(row[field])); return query; },
      gte: (field: string, value: string) => { predicates.push((row) => row[field] >= value); return query; },
      lte: (field: string, value: string) => { predicates.push((row) => row[field] <= value); return query; },
      ilike: (field: string, value: string) => { predicates.push((row) => row[field]?.toLowerCase() === value.toLowerCase()); return query; },
      order: () => query, range: (from: number, to: number) => { bounds = [from, to]; return query; }, limit: () => query,
      maybeSingle: () => { single = true; return query; },
      single: () => { single = true; return query; },
      insert: (payload: any) => { inserted = { id: "created-folder", ...payload }; (rows[table] ??= []).push(inserted); writes(table, payload); return query; },
      delete: () => { writes(table, "delete"); return query; },
      update: (payload: any) => { writes(table, payload); return query; },
      upsert: (payload: any) => { writes(table, payload); return query; },
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  } }),
}));

import { insertLeadList, listLeadLists, getLeadList, invalidateLeadListCache } from "../leadLists";
import { getDailyStaffReport } from "../reports";
import { seal } from "../crypto";
import { listPaginatedLeads, listLeadStatusSummary, listFolderSummaries } from "../leads";
import { createFolderAction, bulkMoveLeadsToFolderAction } from "@/app/admin/folder-actions";
import { getLeadsInListAction, searchLeadsForListAction, updateLeadListAction, deleteLeadListAction } from "@/app/admin/lists/actions";
import { savePaymentAction } from "@/app/admin/payments/actions";

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  actor = { email: "staff@example.com", role: "staff", permissions: ["leads.view", "leads.manage", "payments.view", "payments.manage"] };
  authenticated = true;
  folderError = null;
  selections.length = 0;
  writes.mockClear();
  invalidateLeadListCache();
  rows = {
    app_settings: [{ key: "lead_custom_folder:own", value: "true" }, { key: "lead_custom_folder:other", value: "true" }],
    audit_logs: [],
    leads: [
      { id: "one", name: "Alice O'Neil", phone: seal("+91 98765 43210"), car_number: seal("TN 09 AB 1234"), area: "Adyar", source: "admin", status: "new" },
      { id: "two", name: "Alice Other", phone: seal("9123456780"), area: "Adyar", source: "admin", status: "booked" },
    ],
    lead_lists: [
      { id: "own", assigned_admin_user_id: "staff-a", name: "Own" },
      { id: "other", assigned_admin_user_id: "staff-b", name: "Other" },
    ],
    lead_list_items: [{ list_id: "own", lead_id: "one" }, { list_id: "other", lead_id: "two" }],
  };
});

describe("Admin and staff regression coverage", () => {
  it.each(["98765", "+91 98765 43210", "tn09ab1234", "O'Neil", "Adyar"])("finds scoped, encrypted leads for %s and agrees with counters", async (search) => {
    const result = await listPaginatedLeads({ search, assignedAdminUserId: "staff-a" });
    expect(result.leads.map((lead) => lead.id)).toEqual(["one"]);
    expect(result.leads[0].phone).toBe("+91 98765 43210");
    const summary = await listLeadStatusSummary({ search, assignedAdminUserId: "staff-a" });
    expect(summary.total).toBe(1);
  });
  it("search actions cannot return another user's leads", async () => {
    expect((await searchLeadsForListAction("Alice")).map((lead) => lead.id)).toEqual(["one"]);
  });
  it("list loading refuses an unassigned folder", async () => {
    expect((await getLeadsInListAction("other")).leads).toEqual([]);
  });
  it("bulk moves refuse an unassigned source lead before any write", async () => {
    expect((await bulkMoveLeadsToFolderAction(["two"], "own")).ok).toBe(false);
    expect(writes).not.toHaveBeenCalled();
  });
  it("bulk moves refuse an unassigned destination before any write", async () => {
    expect((await bulkMoveLeadsToFolderAction(["one"], "other")).ok).toBe(false);
    expect(writes).not.toHaveBeenCalled();
  });
  it.each(["staff", "admin"] as const)("new %s folders stay assigned to their creator", async (role) => {
    actor.role = role;
    const result = await createFolderAction({ name: "  Follow-ups  " });
    expect(result.ok).toBe(true);
    expect(rows.lead_lists.at(-1)).toMatchObject({ name: "Follow-ups", assigned_admin_user_id: "staff-a" });
  });
  it("cannot reassign another user's folder", async () => {
    const form = new FormData(); form.set("id", "other"); form.set("name", "Changed");
    await expect(updateLeadListAction({}, form)).rejects.toThrow("outside your assigned scope");
    expect(writes).not.toHaveBeenCalled();
  });
  it("payments refuse another user's lead", async () => {
    const form = new FormData(); form.set("lead_id", "two"); form.set("period", "2026-09");
    expect((await savePaymentAction({}, form)).error).toContain("outside your assigned scope");
    expect(writes).not.toHaveBeenCalled();
  });
  it("lead management alone does not grant payment edits", async () => {
    actor.permissions = ["leads.manage"];
    expect((await savePaymentAction({}, new FormData())).error).toBe("Forbidden");
  });
  it("folder summaries disambiguate the owner relationship and surface database failures", async () => {
    await listFolderSummaries();
    expect(selections).toContain("id, name, is_custom_folder, assigned_admin_user_id, admin_users:assigned_admin_user_id(email, employees:employee_id(name))");
    folderError = new Error("Database unavailable");
    await expect(listFolderSummaries()).rejects.toThrow("Database unavailable");
  });
  it("explicit limits above 200 and offsets are honored", async () => {
    actor.role = "super_admin";
    rows.leads = Array.from({ length: 350 }, (_, i) => ({ id: String(i), area: "Adyar", status: "new" }));
    const result = await listPaginatedLeads({ limit: 300, offset: 10 });
    expect(result.leads).toHaveLength(300);
    expect(result.leads[0].id).toBe("10");
  });
});

it('applies date bounds and service options consistently to list rows and summaries', async () => {
  actor.role = 'super_admin';
  rows.leads[0].created_at = '2026-09-01T10:00:00Z';
  rows.leads[0].service_option = 'monthly';
  rows.leads[1].created_at = '2026-08-01T10:00:00Z';
  rows.leads[1].service_option = 'once';
  const filter = { fromIso: '2026-09-01T00:00:00Z', toIso: '2026-09-02T00:00:00Z', serviceOption: 'monthly' };
  expect((await listPaginatedLeads(filter)).leads.map((lead) => lead.id)).toEqual(['one']);
  expect((await listLeadStatusSummary(filter)).total).toBe(1);
});


it('automated folder creation works without a browser session while interactive creation requires one', async () => {
  authenticated = false;
  await expect(insertLeadList({ name: 'Scheduled batch', created_by: null, assigned_admin_user_id: 'staff-a' })).resolves.toMatchObject({ created_by: null });
  await expect(insertLeadList({ name: 'Interactive batch' })).rejects.toThrow('No admin authenticated');
});

it('daily reports count changed dispositions, keep unanswered work pending, and respect explicit single-date ranges', async () => {
  rows.leads[0].status = 'call_not_responded';
  rows.audit_logs = [
    { id: 'status', created_at: '2026-09-01T10:00:00Z', actor_email: actor.email, action: 'lead.status', metadata: { status: 'contacted' } },
    { id: 'edit', created_at: '2026-09-01T11:00:00Z', actor_email: actor.email, action: 'lead.update', metadata: { before: { status: 'booked' }, after: { status: 'booked', name: 'Corrected name' } } },
    { id: 'older', created_at: '2026-08-01T11:00:00Z', actor_email: actor.email, action: 'lead.status', metadata: { status: 'booked' } },
  ];
  const result = await getDailyStaffReport({ startDate: '2026-09-01', endDate: '2026-09-01', assignedAdminUserId: 'staff-a' });
  expect(result.totalCalls).toBe(1);
  expect(result.totalBookings).toBe(0);
  expect(result.staffMetrics[0].pendingUncalledLeads).toBe(1);
  expect(result.staffMetrics[0].queueBreakdown?.completed).toBe(0);
});


it("keeps folder totals and completion counts consistent beyond the database response cap", async () => {
  rows.leads = Array.from({ length: 1251 }, (_, i) => ({ id: `lead-${i}`, status: i < 1001 ? "new" : "booked" }));
  rows.lead_list_items = rows.leads.map((lead) => ({ list_id: "own", lead_id: lead.id }));
  rows.lead_lists.push({ id: "folder", name: "Folder", assigned_admin_user_id: "staff-a", is_custom_folder: true });
  rows.app_settings = [{ key: "lead_custom_folder:folder", value: "true" }];
  rows.lead_folder_items = rows.leads.map((lead) => ({ list_id: "folder", lead_id: lead.id }));
  const lists = await listLeadLists();
  const detail = await getLeadList("own");
  const directory = await listFolderSummaries("staff-a");
  expect(directory.totalLeads).toBe(1251);
  expect(directory.customFolders.find((folder) => folder.id === "folder")).toMatchObject({ count: 1251, bookedCount: 250 });
  for (const folder of [lists.find((list) => list.id === "own"), detail]) {
    expect(folder).toMatchObject({ lead_count: 1251, completed_count: 250, pending_count: 1001 });
  }
});


it("shows manually named folders without generated staff queues, preserving scoped lead totals", async () => {
  rows.app_settings = [{ key: "lead_custom_folder:own", value: "true" }, { key: "lead_custom_folder:empty", value: "true" }];
  rows.lead_lists[0].name = "Customer follow-ups";
  rows.lead_lists[1].name = "Renamed allocation batch";
  rows.lead_lists.push({ id: "recycled", name: "Recycled Leads (13/9/2026)", assigned_admin_user_id: "staff-a" });
  rows.lead_lists.push({ id: "inbound", name: "Inbound Leads - Team member", assigned_admin_user_id: "staff-a" });
  rows.lead_lists.push({ id: "imported", name: "Imported Leads - 13/9/2026", assigned_admin_user_id: "staff-a" });
  rows.lead_lists.push({ id: "empty", name: "Instagram", assigned_admin_user_id: null });
  const directory = await listFolderSummaries();
  expect(directory.customFolders.map((folder) => folder.name)).toEqual(["Customer follow-ups", "Instagram"]);
  expect(directory.totalLeads).toBe(2);
  // Allocation queues remain available through the dedicated list workspace.
  expect((await listLeadLists()).map((list) => list.id)).toContain("other");
});


it("recovers manually created folders and preserves deliberately chosen allocation-like names", async () => {
  rows.app_settings = [];
  rows.lead_lists[0].name = "Allocated Leads (13/9/2026)";
  rows.audit_logs = [{ id: "creation", entity: "lead_lists", entity_id: "own", action: "create" }, { id: "list-creation", entity: "lead_list", entity_id: "other", action: "lead_list.create_with_leads" }];
  const result = await listFolderSummaries();
  expect(result.customFolders.map((folder) => folder.id)).toEqual(["own"]);
  expect(writes).toHaveBeenCalledWith("app_settings", [expect.objectContaining({ key: "lead_custom_folder:own", value: "true" })]);
});


it.each(["admin", "staff"] as const)("refuses folder deletion by %s even with lead management permission", async (role) => {
  actor.role = role;
  const form = new FormData();
  form.set("id", "own");
  const result = await deleteLeadListAction(form);
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Only the super admin");
  expect(writes).not.toHaveBeenCalled();
});

it("super admin folder deletion deletes the container, never customer lead records", async () => {
  actor.role = "super_admin";
  const form = new FormData();
  form.set("id", "own");
  expect(await deleteLeadListAction(form)).toEqual({ ok: true });
  expect(writes.mock.calls).toEqual([["lead_lists", "delete"]]);
});


it("folder rows and counts retain allocated leads while staff scope remains assignment-based", async () => {
  const folder = "00000000-0000-0000-0000-000000000001";
  rows.lead_lists.push({ id: folder, name: "Shared organization", is_custom_folder: true, assigned_admin_user_id: "staff-a" });
  rows.lead_folder_items = rows.leads.map((lead) => ({ list_id: folder, lead_id: lead.id }));
  actor.role = "super_admin";
  expect((await listPaginatedLeads({ folder })).leads.map((lead) => lead.id).sort()).toEqual(["one", "two"]);
  expect((await listLeadStatusSummary({ folder })).total).toBe(2);
  expect((await listFolderSummaries()).customFolders.find((item) => item.id === folder)?.count).toBe(2);
  actor.role = "staff";
  expect((await listPaginatedLeads({ folder, assignedAdminUserId: "staff-a" })).leads.map((lead) => lead.id)).toEqual(["one"]);
  expect((await getLeadsInListAction(folder)).leads.map((lead) => lead.id)).toEqual(["one"]);
  expect((await listFolderSummaries("staff-a")).customFolders.find((item) => item.id === folder)?.count).toBe(1);
});
