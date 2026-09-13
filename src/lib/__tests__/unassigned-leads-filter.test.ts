import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase
const mockSupabase = {
  from: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  supabase: () => mockSupabase,
}));

vi.mock("@/lib/crypto", () => ({
  unseal: (val: string | null) => val,
  unsealFields: (obj: any) => obj,
  sealFields: (obj: any) => obj,
  phoneHash: (p: string | null) => (p ? `hash_${p}` : null),
  normalizePhone: (p: string | null) => p || "",
}));

import { listLeadStatusSummary, listPaginatedLeads } from "../leads";
import { listAreasWithCounts, setLocationIndexCache } from "../area";
import { setAssignedLeadsCache } from "../lead-assignments";

describe("Unassigned Leads Filter & Counts", () => {
  const mockAllLeads = [
    {
      id: "lead-unassigned-web-1",
      name: "Ramesh Web Unassigned",
      source: "wizard" as const,
      year: "2026",
      primaryLocality: "Velachery",
      pincode: null,
      area: "Velachery",
      status: "new" as const,
      service: "Ceramic Coating",
    },
    {
      id: "lead-assigned-web-2",
      name: "Suresh Web Assigned",
      source: "wizard" as const,
      year: "2026",
      primaryLocality: "Velachery",
      pincode: null,
      area: "Velachery",
      status: "contacted" as const,
      service: "Ceramic Coating",
    },
    {
      id: "lead-unassigned-hot-1",
      name: "Priya Hot Unassigned",
      source: "admin" as const,
      year: "2026",
      primaryLocality: "Adyar",
      pincode: null,
      area: "Adyar",
      status: "new" as const,
      service: "PPF",
      isBulkUpload: false,
    },
    {
      id: "lead-assigned-hot-2",
      name: "Anita Hot Assigned",
      source: "admin" as const,
      year: "2026",
      primaryLocality: "Adyar",
      pincode: null,
      area: "Adyar",
      status: "booked" as const,
      service: "PPF",
      isBulkUpload: false,
    },
    {
      id: "lead-unassigned-2026-1",
      name: "Karthik Upload 2026 Unassigned",
      source: "upload" as const,
      year: "2026",
      primaryLocality: "Velachery",
      pincode: null,
      area: "Velachery",
      status: "new" as const,
      service: "Graphene Coating",
      isBulkUpload: true,
    },
    {
      id: "lead-assigned-2026-2",
      name: "Deepak Upload 2026 Assigned",
      source: "upload" as const,
      year: "2026",
      primaryLocality: "Velachery",
      pincode: null,
      area: "Velachery",
      status: "follow_up" as const,
      service: "Graphene Coating",
      isBulkUpload: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    setLocationIndexCache({
      expires: Date.now() + 100000,
      leadMap: new Map(),
      areaToLeadIds: new Map(),
      yearToLeadIds: new Map(),
      allLeads: mockAllLeads as any,
    });

    setAssignedLeadsCache(new Set(["lead-assigned-web-2", "lead-assigned-hot-2", "lead-assigned-2026-2"]));

    // Mock lead_list_items and leads
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "lead_list_items") {
        return {
          select: vi.fn().mockReturnValue({
            count: 3,
            range: vi.fn().mockResolvedValue({
              data: [
                { lead_id: "lead-assigned-web-2" },
                { lead_id: "lead-assigned-hot-2" },
                { lead_id: "lead-assigned-2026-2" },
              ],
            }),
            eq: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: vi.fn().mockImplementation((_fields?: string, opts?: any) => {
            if (opts && opts.head) {
              return Promise.resolve({ count: mockAllLeads.length, data: null, error: null });
            }
            return {
              range: vi.fn().mockResolvedValue({ data: mockAllLeads, error: null }),
              in: vi.fn().mockImplementation((_col: string, ids: string[]) => {
                const rows = mockAllLeads.filter((l) => ids.includes(l.id));
                return Promise.resolve({ data: rows, error: null });
              }),
            };
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      };
    });
  });

  it("calculates unassigned vs assigned counts in listLeadStatusSummary", async () => {
    const { listLeadStatusSummary } = await import("@/lib/leads");
    const { setAssignedLeadsCache } = await import("@/lib/lead-assignments");

    setAssignedLeadsCache(new Set(["lead-assigned-web-2", "lead-assigned-hot-2", "lead-assigned-2026-2"]));

    const summary = await listLeadStatusSummary({ folder: "all_master" });
    expect(summary.total).toBe(6);
    expect(summary.unassigned).toBe(3);
    expect(summary.assigned).toBe(3);
  });

  it("filters leads to only unassigned leads in listPaginatedLeads", async () => {
    const { listPaginatedLeads } = await import("@/lib/leads");
    const { setAssignedLeadsCache } = await import("@/lib/lead-assignments");

    setAssignedLeadsCache(new Set(["lead-assigned-web-2", "lead-assigned-hot-2", "lead-assigned-2026-2"]));

    const res = await listPaginatedLeads({
      folder: "all_master",
      assignment: "unassigned",
    });

    expect(res.totalCount).toBe(3);
    const unassignedIds = res.leads.map((l) => l.id);
    expect(unassignedIds).toEqual([
      "lead-unassigned-web-1",
      "lead-unassigned-hot-1",
      "lead-unassigned-2026-1",
    ]);
  });

  it("filters leads to only assigned leads in listPaginatedLeads", async () => {
    const { listPaginatedLeads } = await import("@/lib/leads");
    const { setAssignedLeadsCache } = await import("@/lib/lead-assignments");

    setAssignedLeadsCache(new Set(["lead-assigned-web-2", "lead-assigned-hot-2", "lead-assigned-2026-2"]));

    const res = await listPaginatedLeads({
      folder: "all_master",
      assignment: "assigned",
    });

    expect(res.totalCount).toBe(3);
    const assignedIds = res.leads.map((l) => l.id);
    expect(assignedIds).toEqual([
      "lead-assigned-web-2",
      "lead-assigned-hot-2",
      "lead-assigned-2026-2",
    ]);
  });

  it("scopes unassigned filtering to website_form folder and Velachery area", async () => {
    const { listPaginatedLeads, listLeadStatusSummary } = await import("@/lib/leads");
    const { setAssignedLeadsCache } = await import("@/lib/lead-assignments");

    setAssignedLeadsCache(new Set(["lead-assigned-web-2", "lead-assigned-hot-2", "lead-assigned-2026-2"]));

    const summary = await listLeadStatusSummary({
      folder: "website_form",
      area: "Velachery",
    });
    expect(summary.total).toBe(2);
    expect(summary.unassigned).toBe(1);
    expect(summary.assigned).toBe(1);

    const res = await listPaginatedLeads({
      folder: "website_form",
      area: "Velachery",
      assignment: "unassigned",
    });
    expect(res.totalCount).toBe(1);
    expect(res.leads[0].id).toBe("lead-unassigned-web-1");
  });

  it("calculates unassignedCount in listAreasWithCounts", async () => {
    const { listAreasWithCounts } = await import("@/lib/area");
    const { setAssignedLeadsCache } = await import("@/lib/lead-assignments");

    setAssignedLeadsCache(new Set(["lead-assigned-web-2", "lead-assigned-hot-2", "lead-assigned-2026-2"]));

    const areas = await listAreasWithCounts({ folder: "website_form" });
    const velachery = areas.find((a) => a.area === "Velachery");
    expect(velachery).toBeDefined();
    expect(velachery?.count).toBe(2);
    expect(velachery?.unassignedCount).toBe(1);
  });
});
